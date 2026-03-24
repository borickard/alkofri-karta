export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

type OsmElement = {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: { opening_hours?: string; name?: string };
};

function dist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = lat1 - lat2, dlon = lon1 - lon2;
  return dlat * dlat + dlon * dlon; // squared distance, sufficient for sorting
}

async function fetchOpeningHours(lat: number, lng: number): Promise<{ oh: string; name: string | null } | null> {
  const amenity = 'bar|pub|restaurant|cafe|nightclub|fast_food|theatre|cinema|arts_centre';
  const tourism = 'hotel|hostel|motel|guest_house';
  // Use "out center" so ways also get a coordinate, allowing distance sorting
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

      // Pick the closest element by actual coordinates
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
      if (!best?.tags?.opening_hours) return null;
      console.log(`[OH] matched OSM: "${best.tags.name}" oh="${best.tags.opening_hours}" dist≈${Math.round(Math.sqrt(bestDist) * 111000)}m`);
      return { oh: best.tags.opening_hours, name: best.tags.name ?? null };
    } catch {
      // try next endpoint
    }
  }
  return null;
}

export async function PATCH(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError('Server env saknas.', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Ogiltig JSON.');

    const bar_id = body.bar_id ? Number(body.bar_id) : null;
    const demo = Boolean(body.demo);
    const barsTable = demo ? 'bars_demo' : 'bars';

    // If opening_hours is provided directly, use it; otherwise fetch from Overpass
    let opening_hours: string | null = body.opening_hours ? String(body.opening_hours).trim() : null;

    if (!opening_hours) {
      const lat = body.lat ? Number(body.lat) : null;
      const lng = body.lng ? Number(body.lng) : null;
      if (!lat || !lng) return jsonError('opening_hours eller lat/lng saknas.');
      const result = await fetchOpeningHours(lat, lng);
      if (!result) return NextResponse.json({ ok: false, error: 'Ingen öppettidsdata hittad' });
      opening_hours = result.oh;
    }

    // If bar_id provided, save to DB; otherwise just return the value (fetch-only mode)
    if (bar_id) {
      const { error } = await supabase
        .from(barsTable)
        .update({ opening_hours })
        .eq('id', bar_id);
      if (error) return jsonError(`DB: ${error.message}`, 500);
    }

    return NextResponse.json({ ok: true, opening_hours });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
