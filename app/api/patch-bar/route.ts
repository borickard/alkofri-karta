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

function metersDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = (lat1 - lat2) * 111000;
  const dlon = (lon1 - lon2) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

// Normalize name for comparison: lowercase, strip diacritics, remove punctuation,
// strip common venue words that don't help differentiate
function nameTokens(name: string): Set<string> {
  const stopwords = new Set(['restaurant', 'restaurang', 'bar', 'pub', 'cafe', 'café',
    'kafe', 'kafé', 'bistro', 'hotel', 'hotell', 'the', 'och', 'and', 'ab', 'i', 'på']);
  const normalized = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.has(w));
  return new Set(normalized);
}

function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  return intersection / Math.max(ta.size, tb.size); // overlap coefficient (lenient)
}

async function fetchOpeningHours(lat: number, lng: number, barName?: string): Promise<{ oh: string; name: string | null } | null> {
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
      const elements = (data?.elements ?? []).filter(el => el.tags?.opening_hours);
      if (!elements.length) return null;

      // Score each candidate: name similarity (primary) + proximity (tiebreaker)
      let best: OsmElement | null = null;
      let bestScore = -Infinity;
      for (const el of elements) {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (elLat == null || elLon == null) continue;
        const distM = metersDist(lat, lng, elLat, elLon);
        const sim = barName ? nameSimilarity(barName, el.tags?.name ?? '') : 0;
        // Name similarity dominates; distance breaks ties. Penalise > 30m.
        const score = sim * 1000 - distM;
        if (score > bestScore) { bestScore = score; best = el; }
      }

      if (!best?.tags?.opening_hours) return null;

      const matchedName = best.tags.name ?? null;
      const sim = barName ? nameSimilarity(barName, matchedName ?? '') : 1;

      // Reject if OSM has a name and zero tokens overlap with our bar name
      // (catches wrong-venue matches like offices, pharmacies, etc.)
      if (barName && matchedName && sim === 0) {
        console.log(`[OH] rejected: sim=0 for "${barName}" vs OSM "${matchedName}"`);
        return null;
      }

      const elLat = best.lat ?? best.center?.lat ?? lat;
      const elLon = best.lon ?? best.center?.lon ?? lng;
      console.log(`[OH] matched "${matchedName}" sim=${sim.toFixed(2)} dist≈${Math.round(metersDist(lat, lng, elLat, elLon))}m oh="${best.tags.opening_hours}"`);
      return { oh: best.tags.opening_hours, name: matchedName };
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

    let osm_name: string | null = null;
    if (!opening_hours) {
      const lat = body.lat ? Number(body.lat) : null;
      const lng = body.lng ? Number(body.lng) : null;
      const barName = body.name ? String(body.name) : undefined;
      if (!lat || !lng) return jsonError('opening_hours eller lat/lng saknas.');
      const result = await fetchOpeningHours(lat, lng, barName);
      if (!result) return NextResponse.json({ ok: false, error: 'Ingen öppettidsdata hittad' });
      opening_hours = result.oh;
      osm_name = result.name;
    }

    // If bar_id provided, save to DB; otherwise just return the value (fetch-only mode)
    if (bar_id) {
      const { error } = await supabase
        .from(barsTable)
        .update({ opening_hours })
        .eq('id', bar_id);
      if (error) return jsonError(`DB: ${error.message}`, 500);
    }

    return NextResponse.json({ ok: true, opening_hours, osm_name });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
