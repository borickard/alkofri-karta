export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError('Server env saknas.', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Ogiltig JSON.');

    const demo = Boolean(body.demo);
    const barsTable = demo ? 'bars_demo' : 'bars';

    const name = String(body.name || '').trim();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const source_id_raw = body.source_id ?? body.sourceId ?? null;
    const source_id = source_id_raw === null ? null : String(source_id_raw);
    const venue_type = body.venue_type ? String(body.venue_type) : null;
    const opening_hours = body.opening_hours ? String(body.opening_hours).trim() : null;

    if (!name) return jsonError('name saknas.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return jsonError('lat/lng saknas.');

    const { data: upserted, error } = await supabase
      .from(barsTable)
      .upsert({
        name,
        lat,
        lng,
        source: 'maptiler',
        source_id: source_id ?? `fallback-${name}-${lat.toFixed(6)}-${lng.toFixed(6)}`,
        venue_type,
        opening_hours,
      }, { onConflict: 'source,source_id' })
      .select('id')
      .single();

    if (error) return jsonError(`DB: ${error.message}`, 500);

    return NextResponse.json({ ok: true, bar_id: upserted.id });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
