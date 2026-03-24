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

type GooglePeriod = {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
};

type GooglePlace = {
  displayName?: { text?: string };
  regularOpeningHours?: { periods?: GooglePeriod[] };
  location?: { latitude?: number; longitude?: number };
};

function metersDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dlat = (lat1 - lat2) * 111000;
  const dlon = (lon1 - lon2) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

function nameTokens(name: string): Set<string> {
  const stopwords = new Set(['restaurant', 'restaurang', 'bar', 'pub', 'cafe', 'café',
    'kafe', 'kafé', 'bistro', 'hotel', 'hotell', 'the', 'och', 'and', 'ab', 'i', 'på']);
  return new Set(name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.has(w)));
}

function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.max(ta.size, tb.size);
}

const OSM_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function pad(n: number) { return String(n).padStart(2, '0'); }
function monFirst(d: number): number { return d === 0 ? 7 : d; }

function googlePeriodsToOsm(periods: GooglePeriod[]): string | null {
  const valid = periods.filter(p => p.open && p.close);
  if (!valid.length) return null;

  const byTime: Record<string, number[]> = {};
  for (const p of valid) {
    const timeStr = `${pad(p.open.hour)}:${pad(p.open.minute)}-${pad(p.close!.hour)}:${pad(p.close!.minute)}`;
    if (!byTime[timeStr]) byTime[timeStr] = [];
    byTime[timeStr].push(p.open.day);
  }

  const parts: string[] = [];
  for (const [timeStr, days] of Object.entries(byTime)) {
    days.sort((a, b) => monFirst(a) - monFirst(b));
    const ranges: string[] = [];
    let i = 0;
    while (i < days.length) {
      let j = i;
      while (j + 1 < days.length && monFirst(days[j + 1]) - monFirst(days[j]) === 1) j++;
      ranges.push(j > i ? `${OSM_DAYS[days[i]]}-${OSM_DAYS[days[j]]}` : OSM_DAYS[days[i]]);
      i = j + 1;
    }
    parts.push(`${ranges.join(',')} ${timeStr}`);
  }
  return parts.join('; ');
}

async function fetchOpeningHoursGoogle(
  lat: number,
  lng: number,
  barName?: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.regularOpeningHours,places.location',
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 100 },
        },
        includedTypes: ['bar', 'restaurant', 'cafe', 'night_club', 'hotel'],
        maxResultCount: 10,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!r.ok) return null;

    const data = await r.json() as { places?: GooglePlace[] };
    const places = (data?.places ?? []).filter(p => p.regularOpeningHours?.periods?.length);
    if (!places.length) return null;

    let best: GooglePlace | null = null;
    let bestScore = -Infinity;
    for (const place of places) {
      const pLat = place.location?.latitude;
      const pLon = place.location?.longitude;
      if (pLat == null || pLon == null) continue;
      const distM = metersDist(lat, lng, pLat, pLon);
      const sim = barName ? nameSimilarity(barName, place.displayName?.text ?? '') : 0;
      const score = sim * 1000 - distM;
      if (score > bestScore) { bestScore = score; best = place; }
    }

    if (!best?.regularOpeningHours?.periods) return null;

    const matchedName = best.displayName?.text ?? null;
    const sim = barName ? nameSimilarity(barName, matchedName ?? '') : 1;
    if (barName && matchedName && sim === 0) return null;

    return googlePeriodsToOsm(best.regularOpeningHours.periods);
  } catch {
    return null;
  }
}

async function fetchOpeningHoursOsm(lat: number, lng: number, barName?: string): Promise<string | null> {
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

      let best: OsmElement | null = null;
      let bestScore = -Infinity;
      for (const el of elements) {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        if (elLat == null || elLon == null) continue;
        const distM = metersDist(lat, lng, elLat, elLon);
        const sim = barName ? nameSimilarity(barName, el.tags?.name ?? '') : 0;
        const score = sim * 1000 - distM;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      if (!best?.tags?.opening_hours) return null;
      const matchedName = best.tags.name ?? null;
      const sim = barName ? nameSimilarity(barName, matchedName ?? '') : 1;
      if (barName && matchedName && sim === 0) return null;
      return best.tags.opening_hours;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function fetchOpeningHours(lat: number, lng: number, barName?: string): Promise<string | null> {
  const googleResult = await fetchOpeningHoursGoogle(lat, lng, barName);
  if (googleResult) return googleResult;
  return fetchOpeningHoursOsm(lat, lng, barName);
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
    const oh = await fetchOpeningHours(bar.lat, bar.lng, bar.name);
    if (oh) {
      await supabase.from(barsTable).update({ opening_hours: oh }).eq('id', bar.id);
      updated++;
      results.push({ id: bar.id, name: bar.name, oh });
    } else {
      notFound++;
      results.push({ id: bar.id, name: bar.name, oh: null });
    }
    await sleep(300);
  }

  return NextResponse.json({ ok: true, total: candidates.length, updated, notFound, results });
}
