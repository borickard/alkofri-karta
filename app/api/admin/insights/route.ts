export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTableNames } from '@/lib/tableNames';
import { parseCityFromAddress, cityForLatLng, countyForLatLng } from '@/lib/geo';

const ALLOWED_CATEGORIES = ['na_beer', 'soda', 'na_wine', 'other'] as const;
type Category = typeof ALLOWED_CATEGORIES[number];

type Stats = {
  bar_count: number;
  price_count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  p25: number | null;
  p75: number | null;
  median: number | null;
  range: number | null;
  iqr: number | null;
  unique_names: number;
  variety_per_bar: number | null;
};

type BucketRow = Stats & {
  name: string;
  pct_vs_national: number | null;
};

type PriceOutlier = {
  bar_id: number;
  bar_name: string;
  city: string;
  county: string;
  price_sek: number;
  beverage_name: string | null;
  category: Category;
  created_at: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  const idx = Math.floor((p / 100) * (sortedAsc.length - 1));
  return sortedAsc[idx];
}

function computeStats(prices: number[], barIds: Set<number>, uniqueNames: Set<string>): Stats {
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, x) => s + x, 0);
  const avg = n ? sum / n : null;
  const min = n ? sorted[0] : null;
  const max = n ? sorted[n - 1] : null;
  const p25 = percentile(sorted, 25);
  const p75 = percentile(sorted, 75);
  const median = percentile(sorted, 50);
  const range = min !== null && max !== null ? max - min : null;
  const iqr = p25 !== null && p75 !== null ? p75 - p25 : null;
  const bar_count = barIds.size;
  const variety_per_bar = bar_count > 0 ? uniqueNames.size / bar_count : null;
  return {
    bar_count,
    price_count: n,
    avg,
    min,
    max,
    p25,
    p75,
    median,
    range,
    iqr,
    unique_names: uniqueNames.size,
    variety_per_bar,
  };
}

export async function GET(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError('Server env saknas (SUPABASE_SERVICE_ROLE_KEY).', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const u = new URL(req.url);
    const categoryParam = u.searchParams.get('category');
    const category: Category = ALLOWED_CATEGORIES.includes(categoryParam as Category)
      ? (categoryParam as Category)
      : 'na_beer';

    const daysParam = Number(u.searchParams.get('days') || '0');
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.floor(daysParam) : 0;
    const minPrices = Math.max(1, Math.floor(Number(u.searchParams.get('min_prices') || '1')));
    const minBars = Math.max(1, Math.floor(Number(u.searchParams.get('min_bars') || '1')));
    const isDemo = (u.searchParams.get('demo') || '0') === '1';

    const { prices: pricesTable, bars: barsTable } = getTableNames(isDemo);

    let pricesQuery = supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,category,beverage_name,created_at')
      .is('deleted_at', null)
      .eq('category', category);
    if (days > 0) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      pricesQuery = pricesQuery.gte('created_at', since);
    }

    const { data: pricesData, error: pricesErr } = await pricesQuery;
    if (pricesErr) return jsonError(`DB: ${pricesErr.message}`, 500);

    type PriceRow = {
      id: number;
      bar_id: number;
      price_sek: number;
      category: Category;
      beverage_name: string | null;
      created_at: string;
    };
    const prices: PriceRow[] = (pricesData ?? []).map((r) => {
      const rr = r as { id: unknown; bar_id: unknown; price_sek: unknown; category: unknown; beverage_name: unknown; created_at: unknown };
      const cat = (typeof rr.category === 'string' && ALLOWED_CATEGORIES.includes(rr.category as Category))
        ? (rr.category as Category)
        : 'na_beer';
      return {
        id: Number(rr.id),
        bar_id: Number(rr.bar_id),
        price_sek: Number(rr.price_sek),
        category: cat,
        beverage_name: typeof rr.beverage_name === 'string' ? rr.beverage_name : null,
        created_at: String(rr.created_at),
      };
    });

    const barIds = [...new Set(prices.map(p => p.bar_id))].filter(Number.isFinite);
    const { data: barsData, error: barsErr } = await supabase
      .from(barsTable)
      .select('id,name,lat,lng,address')
      .in('id', barIds.length ? barIds : [0]);
    if (barsErr) return jsonError(`DB: ${barsErr.message}`, 500);

    type BarRow = { id: number; name: string; lat: number; lng: number; address: string | null; city: string; county: string };
    const barMap = new Map<number, BarRow>();
    for (const b of barsData ?? []) {
      const bb = b as { id: unknown; name: unknown; lat: unknown; lng: unknown; address: unknown };
      const id = Number(bb.id);
      const lat = Number(bb.lat);
      const lng = Number(bb.lng);
      const address = typeof bb.address === 'string' ? bb.address : null;
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const city = parseCityFromAddress(address)
        ?? (hasCoords ? cityForLatLng(lat, lng) : null)
        ?? 'Okänd';
      const county = hasCoords ? countyForLatLng(lat, lng) : 'Okänd';
      barMap.set(id, { id, name: String(bb.name ?? ''), lat, lng, address, city, county });
    }

    // National aggregate
    const nationalBarIds = new Set<number>();
    const nationalNames = new Set<string>();
    const nationalPrices: number[] = [];
    for (const p of prices) {
      nationalBarIds.add(p.bar_id);
      if (p.beverage_name) nationalNames.add(p.beverage_name.trim().toLowerCase());
      nationalPrices.push(p.price_sek);
    }
    const national = computeStats(nationalPrices, nationalBarIds, nationalNames);

    // Per-bucket aggregation — reused for both groupings
    function aggregateBy(pick: (bar: BarRow) => string): BucketRow[] {
      const buckets = new Map<string, { prices: number[]; barIds: Set<number>; names: Set<string> }>();
      for (const p of prices) {
        const bar = barMap.get(p.bar_id);
        if (!bar) continue;
        const key = pick(bar);
        let b = buckets.get(key);
        if (!b) { b = { prices: [], barIds: new Set(), names: new Set() }; buckets.set(key, b); }
        b.prices.push(p.price_sek);
        b.barIds.add(p.bar_id);
        if (p.beverage_name) b.names.add(p.beverage_name.trim().toLowerCase());
      }
      const rows: BucketRow[] = [];
      for (const [name, b] of buckets.entries()) {
        const s = computeStats(b.prices, b.barIds, b.names);
        const pct = (national.avg !== null && s.avg !== null && national.avg > 0)
          ? ((s.avg - national.avg) / national.avg) * 100
          : null;
        rows.push({ ...s, name, pct_vs_national: pct });
      }
      return rows;
    }

    const cityRows = aggregateBy(b => b.city);
    const countyRows = aggregateBy(b => b.county);

    function rankings(rows: BucketRow[]) {
      const eligible = rows.filter(r => r.price_count >= minPrices && r.bar_count >= minBars);
      const byAvgAsc = [...eligible].filter(r => r.avg !== null).sort((a, b) => (a.avg! - b.avg!));
      const byAvgDesc = [...eligible].filter(r => r.avg !== null).sort((a, b) => (b.avg! - a.avg!));
      const byRange = [...eligible].filter(r => r.range !== null).sort((a, b) => (b.range! - a.range!));
      const byVariety = [...eligible].filter(r => r.variety_per_bar !== null).sort((a, b) => (b.variety_per_bar! - a.variety_per_bar!));
      return {
        cheapest_avg: byAvgAsc.slice(0, 5),
        most_expensive_avg: byAvgDesc.slice(0, 5),
        widest_range: byRange.slice(0, 5),
        most_variety_per_bar: byVariety.slice(0, 5),
      };
    }

    const cityRankings = rankings(cityRows);
    const countyRankings = rankings(countyRows);

    // Outlier prices (top 5 cheapest and priciest individual active prices)
    const byPriceAsc = [...prices].sort((a, b) => a.price_sek - b.price_sek);
    const byPriceDesc = [...prices].sort((a, b) => b.price_sek - a.price_sek);
    function toOutlier(p: typeof prices[number]): PriceOutlier | null {
      const bar = barMap.get(p.bar_id);
      if (!bar) return null;
      return {
        bar_id: bar.id,
        bar_name: bar.name,
        city: bar.city,
        county: bar.county,
        price_sek: p.price_sek,
        beverage_name: p.beverage_name,
        category: p.category,
        created_at: p.created_at,
      };
    }
    const cheapest_prices = byPriceAsc.slice(0, 5).map(toOutlier).filter((x): x is PriceOutlier => !!x);
    const priciest_prices = byPriceDesc.slice(0, 5).map(toOutlier).filter((x): x is PriceOutlier => !!x);

    return NextResponse.json({
      ok: true,
      national,
      by_city: { rows: cityRows, rankings: cityRankings },
      by_county: { rows: countyRows, rankings: countyRankings },
      outliers: { cheapest_prices, priciest_prices },
      params: { category, days, min_prices: minPrices, min_bars: minBars, demo: isDemo },
    });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
