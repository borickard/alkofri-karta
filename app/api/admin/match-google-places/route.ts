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

async function findGooglePlace(lat: number, lng: number, name: string, apiKey: string): Promise<{
  place_id: string;
  name: string;
  similarity: number;
  dist: number;
} | null> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.businessStatus,places.formattedAddress',
    },
    body: JSON.stringify({
      includedTypes: ['bar', 'pub', 'restaurant', 'night_club', 'cafe', 'food'],
      maxResultCount: 10,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radiusMeters: 150 },
      },
    }),
  });

  if (!r.ok) return null;
  const data = await r.json() as { places?: GooglePlace[] };
  const places = (data.places ?? []).filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.location && p.displayName);

  if (!places.length) return null;

  let best: GooglePlace | null = null;
  let bestScore = -Infinity;

  for (const p of places) {
    const dist = metersDist(lat, lng, p.location!.latitude, p.location!.longitude);
    const sim = nameSimilarity(name, p.displayName!.text);
    // Weight: name match matters most, distance as tiebreaker
    const score = sim * 1000 - dist;
    if (score > bestScore) { bestScore = score; best = p; }
  }

  if (!best) return null;

  const sim = nameSimilarity(name, best.displayName!.text);
  const dist = metersDist(lat, lng, best.location!.latitude, best.location!.longitude);

  return { place_id: best.id, name: best.displayName!.text, similarity: sim, dist };
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

  for (const bar of bars ?? []) {
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
  });
}
