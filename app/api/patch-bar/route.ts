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

async function fetchOpeningHours(lat: number, lng: number): Promise<string | null> {
  const q = `[out:json][timeout:8];(node["opening_hours"](around:60,${lat},${lng});way["opening_hours"](around:60,${lat},${lng}););out body 1;`;
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
      opening_hours = await fetchOpeningHours(lat, lng);
      if (!opening_hours) return NextResponse.json({ ok: false, error: 'Ingen öppettidsdata hittad' });
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
