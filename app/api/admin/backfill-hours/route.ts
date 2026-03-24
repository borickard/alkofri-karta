export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

type OsmElement = {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { opening_hours?: string; name?: string };
};

function dist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat1 - lat2, dlon = lon1 - lon2;
  return dlat * dlat + dlon * dlon;
}

async function fetchOpeningHours(lat: number, lng: number): Promise<string | null> {
  const amenity = 'bar|pub|restaurant|cafe|nightclub|fast_food|theatre|cinema|arts_centre';
  const tourism = 'hotel|hostel|motel|guest_house';
  const q = `[out:json][timeout:8];(node["opening_hours"]["amenity"~"${amenity}"](around:100,${lat},${lng});node["opening_hours"]["tourism"~"${tourism}"](around:100,${lat},${lng});way["opening_hours"]["amenity"~"${amenity}"](around:100,${lat},${lng});way["opening_hours"]["tourism"~"${tourism}"](around:100,${lat},${lng}););out center;`;
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
      const data = await r.json() as { elements?: OsmElement[] };
      const elements = data?.elements ?? [];
      if (!elements.length) return null;

      let best: OsmElement | null = null;
      let bestDist = Infinity;
      for (const el of elements) {
        if (!el.tags?.opening_hours) continue;
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (elLat == null || elLon == null) continue;
        const d = dist(lat, lng, elLat, elLon);
        if (d < bestDist) { bestDist = d; best = el; }
      }
      return best?.tags?.opening_hours ?? null;
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
  const body = await req.json().catch(() => ({})) as { demo?: boolean; limit?: number; force?: boolean };
  const demo = Boolean(body.demo);
  const force = Boolean(body.force);
  const limit = Math.min(Number(body.limit) || 100, 200);
  const barsTable = demo ? 'bars_demo' : 'bars';
  const pricesTable = demo ? 'prices_demo' : 'prices';

  const { data: barsWithPrices } = await supabase
    .from(pricesTable)
    .select('bar_id')
    .is('deleted_at', null);

  const barIdsWithPrices = new Set((barsWithPrices ?? []).map((r: { bar_id: number }) => r.bar_id));

  const query = supabase
    .from(barsTable)
    .select('id,name,lat,lng,no_na_beer,opening_hours')
    .limit(limit);

  if (!force) query.is('opening_hours', null);

  const { data: bars, error } = await query;

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
    await sleep(1500);
  }

  return NextResponse.json({ ok: true, total: candidates.length, updated, notFound, results });
}
