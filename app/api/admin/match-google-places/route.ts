export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type GooglePlace = {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
  formattedAddress?: string;
};

function metersDist(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dlat = (lat1 - lat2) * 111000;
  const dlon = (lon1 - lon2) * 111000 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

function nameTokens(name: string): Set<string> {
  const stopwords = new Set(['restaurant', 'restaurang', 'bar', 'pub', 'cafe', 'café',
    'kafe', 'kafé', 'bistro', 'hotel', 'hotell', 'the', 'och', 'and', 'ab', 'i', 'på']);
  return new Set(
    name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 1 && !stopwords.has(w))
  );
}

function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.max(ta.size, tb.size);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const FIELD_MASK = 'places.id,places.displayName,places.location,places.businessStatus';

function pickBest(places: GooglePlace[], lat: number, lng: number, name: string) {
  const candidates = places.filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.location && p.displayName);
  if (!candidates.length) return null;
  let best: GooglePlace | null = null;
  let bestScore = -Infinity;
  for (const p of candidates) {
    const dist = metersDist(lat, lng, p.location!.latitude, p.location!.longitude);
    const sim = nameSimilarity(name, p.displayName!.text);
    const score = sim * 1000 - dist;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (!best) return null;
  return {
    place_id: best.id,
    name: best.displayName!.text,
    similarity: nameSimilarity(name, best.displayName!.text),
    dist: Math.round(metersDist(lat, lng, best.location!.latitude, best.location!.longitude)),
  };
}

async function findGooglePlace(lat: number, lng: number, name: string, apiKey: string): Promise<{
  place_id: string;
  name: string;
  similarity: number;
  dist: number;
} | null> {
  // Step 1: nearby search within 300m (no type filter to avoid invalid type errors)
  const nearbyRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({
      includedTypes: ['bar', 'restaurant', 'night_club', 'cafe'],
      maxResultCount: 20,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } },
    }),
  });
  if (nearbyRes.ok) {
    const data = await nearbyRes.json() as { places?: GooglePlace[] };
    const result = pickBest(data.places ?? [], lat, lng, name);
    if (result) return result;
  }

  // Step 2: fallback — text search by name biased toward the coordinates
  const textRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify({
      textQuery: name,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } },
      regionCode: 'SE',
      maxResultCount: 5,
    }),
  });
  if (textRes.ok) {
    const data = await textRes.json() as { places?: GooglePlace[] };
    return pickBest(data.places ?? [], lat, lng, name);
  }

  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'GOOGLE_PLACES_KEY saknas' }, { status: 500 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean; min_similarity?: number };
  const dryRun = body.dry_run !== false; // default to dry run for safety
  const minSimilarity = body.min_similarity ?? 0.5;

  // Fetch bars without a google_place_id
  const { data: bars, error } = await supabase
    .from('bars')
    .select('id, name, lat, lng')
    .is('google_place_id', null);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const matched: { id: number; bar_name: string; google_name: string; similarity: number; dist: number; place_id: string }[] = [];
  const unmatched: { id: number; name: string }[] = [];
  const skipped: { id: number; bar_name: string; google_name: string; similarity: number }[] = [];
  let debugFirst: unknown = null;

  for (const bar of bars ?? []) {
    if (!debugFirst) {
      // Step-by-step debug for first bar
      const nearbyRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({
          includedTypes: ['bar', 'restaurant', 'night_club', 'cafe'],
          maxResultCount: 20,
          locationRestriction: { circle: { center: { latitude: bar.lat, longitude: bar.lng }, radius: 300 } },
        }),
      });
      const nearbyBody = await nearbyRes.json();
      const nearbyPick = pickBest((nearbyBody.places ?? []) as GooglePlace[], bar.lat, bar.lng, bar.name);

      const textRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({ textQuery: bar.name, locationBias: { circle: { center: { latitude: bar.lat, longitude: bar.lng }, radius: 2000 } }, regionCode: 'SE', maxResultCount: 5 }),
      });
      const textBody = await textRes.json();
      const textPick = pickBest((textBody.places ?? []) as GooglePlace[], bar.lat, bar.lng, bar.name);

      debugFirst = {
        bar: bar.name, lat: bar.lat, lng: bar.lng,
        nearby: { status: nearbyRes.status, placeCount: (nearbyBody.places ?? []).length, pick: nearbyPick },
        text: { status: textRes.status, placeCount: (textBody.places ?? []).length, pick: textPick },
      };
    }

    const result = await findGooglePlace(bar.lat, bar.lng, bar.name, apiKey);
    await sleep(100);

    if (!result) {
      unmatched.push({ id: bar.id, name: bar.name });
      continue;
    }

    if (result.similarity < minSimilarity) {
      skipped.push({ id: bar.id, bar_name: bar.name, google_name: result.name, similarity: result.similarity });
      continue;
    }

    matched.push({ id: bar.id, bar_name: bar.name, google_name: result.name, similarity: result.similarity, dist: Math.round(result.dist), place_id: result.place_id });

    if (!dryRun) {
      await supabase.from('bars').update({
        google_place_id: result.place_id,
        source: 'google_places',
        source_id: result.place_id,
      }).eq('id', bar.id);
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    total: bars?.length ?? 0,
    matched: matched.length,
    unmatched: unmatched.length,
    skipped_low_confidence: skipped.length,
    results: { matched, unmatched, skipped },
    debug: debugFirst,
  });
}
