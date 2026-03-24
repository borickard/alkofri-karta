export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min (Vercel pro/hobby limit)

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchOpeningHours(lat: number, lng: number): Promise<string | null> {
  const q = `[out:json][timeout:8];(node["opening_hours"](around:150,${lat},${lng});way["opening_hours"](around:150,${lat},${lng}););out body 1;`;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data = await r.json() as { elements?: { tags?: { opening_hours?: string } }[] };
      const oh = data?.elements?.[0]?.tags?.opening_hours;
      if (oh) return oh;
      return null; // got a valid response but no opening_hours — no point trying next mirror
    } catch {
      // try next endpoint
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Server env saknas.' }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as { demo?: boolean; limit?: number };
  const demo = Boolean(body.demo);
  const limit = Math.min(Number(body.limit) || 100, 200);
  const barsTable = demo ? 'bars_demo' : 'bars';
  const pricesTable = demo ? 'prices_demo' : 'prices';

  // Get all bars without opening_hours that have a price or no_na_beer flag
  const { data: barsWithPrices } = await supabase
    .from(pricesTable)
    .select('bar_id')
    .is('deleted_at', null);

  const barIdsWithPrices = new Set((barsWithPrices ?? []).map((r: { bar_id: number }) => r.bar_id));

  const { data: bars, error } = await supabase
    .from(barsTable)
    .select('id,name,lat,lng,no_na_beer,opening_hours')
    .is('opening_hours', null)
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const candidates = (bars ?? []).filter((b: { id: number; no_na_beer: boolean | null }) =>
    barIdsWithPrices.has(b.id) || b.no_na_beer
  ) as { id: number; name: string; lat: number; lng: number }[];

  let updated = 0;
  let notFound = 0;
  const results: { id: number; name: string; oh: string | null }[] = [];

  for (const bar of candidates) {
    const oh = await fetchOpeningHours(bar.lat, bar.lng);
    if (oh) {
      await supabase.from(barsTable).update({ opening_hours: oh }).eq('id', bar.id);
      updated++;
      results.push({ id: bar.id, name: bar.name, oh });
    } else {
      notFound++;
      results.push({ id: bar.id, name: bar.name, oh: null });
    }
    await sleep(1500); // be polite to Overpass
  }

  return NextResponse.json({ ok: true, total: candidates.length, updated, notFound, results });
}
