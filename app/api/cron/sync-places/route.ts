export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type GooglePeriod = {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
};

type PlaceDetails = {
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
  formattedAddress?: string;
  regularOpeningHours?: { periods?: GooglePeriod[] };
};

const OSM_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function pad(n: number) { return String(n).padStart(2, '0'); }
function monFirst(d: number) { return d === 0 ? 7 : d; }

function googlePeriodsToOsm(periods: GooglePeriod[]): string | null {
  const valid = periods.filter(p => p.open && p.close);
  if (!valid.length) return null;
  const byTime: Record<string, number[]> = {};
  for (const p of valid) {
    const key = `${pad(p.open.hour)}:${pad(p.open.minute)}-${pad(p.close!.hour)}:${pad(p.close!.minute)}`;
    (byTime[key] ??= []).push(p.open.day);
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_PLACES_KEY saknas' }, { status: 500 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // Fetch all bars that have a google_place_id and aren't already marked closed
  const { data: bars, error } = await supabase
    .from('bars')
    .select('id, name, lat, lng, google_place_id')
    .not('google_place_id', 'is', null)
    .neq('permanently_closed', true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0, closed = 0, unchanged = 0;

  for (const bar of bars ?? []) {
    const r = await fetch(`https://places.googleapis.com/v1/places/${bar.google_place_id}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'displayName,location,businessStatus,formattedAddress,regularOpeningHours',
      },
    });
    await sleep(80);

    if (!r.ok) continue;
    const details = await r.json() as PlaceDetails;

    if (details.businessStatus === 'CLOSED_PERMANENTLY') {
      await supabase.from('bars').update({ permanently_closed: true }).eq('id', bar.id);
      closed++;
      continue;
    }

    const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };

    if (details.displayName?.text && details.displayName.text !== bar.name)
      patch.name = details.displayName.text;
    if (details.location?.latitude && Math.abs(details.location.latitude - bar.lat) > 0.0001)
      patch.lat = details.location.latitude;
    if (details.location?.longitude && Math.abs(details.location.longitude - bar.lng) > 0.0001)
      patch.lng = details.location.longitude;
    if (details.formattedAddress)
      patch.address = details.formattedAddress;
    if (details.regularOpeningHours?.periods?.length) {
      const oh = googlePeriodsToOsm(details.regularOpeningHours.periods);
      if (oh) patch.opening_hours = oh;
    }

    await supabase.from('bars').update(patch).eq('id', bar.id);
    if (Object.keys(patch).length > 1) updated++; else unchanged++;
  }

  return NextResponse.json({
    ok: true,
    total: bars?.length ?? 0,
    updated,
    closed,
    unchanged,
  });
}
