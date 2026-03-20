export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function getClientIp(req: Request) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return null;
}

function sha256Hex(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError('Server env saknas (SUPABASE_SERVICE_ROLE_KEY).', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Ogiltig JSON.');

    const demo = Boolean(body.demo);
    const barsTable = demo ? 'bars_demo' : 'bars';

    const bar_id = body.bar_id ? Number(body.bar_id) : null;

    const userAgent = req.headers.get('user-agent') || null;
    const ip = getClientIp(req);
    const salt = process.env.IP_HASH_SALT || process.env.ADMIN_PASSWORD || 'fallback_salt';
    const ip_hash = ip ? sha256Hex(`${ip}|${salt}`) : null;

    let finalBarId: number | null = null;

    if (bar_id) {
      finalBarId = bar_id;
    } else {
      const name = String(body.name || '').trim();
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      const source_id_raw = body.source_id ?? body.sourceId ?? null;
      const source_id = source_id_raw === null || source_id_raw === undefined ? null : String(source_id_raw);

      if (!name) return jsonError('name saknas.');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return jsonError('lat/lng saknas.');

      type BarUpsertPayload = {
        name: string;
        lat: number;
        lng: number;
        source: 'maptiler';
        source_id: string;
      };

      const payload: BarUpsertPayload = {
        name,
        lat,
        lng,
        source: 'maptiler',
        source_id: source_id ?? `fallback-${name}-${lat.toFixed(6)}-${lng.toFixed(6)}`,
      };

      const { data: upserted, error: upsertErr } = await supabase
        .from(barsTable)
        .upsert(payload, { onConflict: 'source,source_id' })
        .select('id')
        .single();

      if (upsertErr) return jsonError(`DB: ${upsertErr.message}`, 500);
      finalBarId = upserted?.id ?? null;
    }

    if (!finalBarId) return jsonError('Kunde inte hitta/skapa bar.', 500);

    const ts = new Date().toISOString();

    const { error: updErr } = await supabase
      .from(barsTable)
      .update({ no_na_beer: true, no_na_reported_at: ts })
      .eq('id', finalBarId);

    if (updErr) return jsonError(`DB: ${updErr.message}`, 500);

    const { error: auditErr } = await supabase.from('audit_events').insert({
      action: 'report_no_na',
      bar_id: finalBarId,
      price_id: null,
      price_sek: null,
      ip_hash,
      user_agent: userAgent,
      meta: { via: 'api/no-na', demo },
    });

    if (auditErr) console.warn('audit insert failed:', auditErr.message);

    return NextResponse.json({ ok: true, bar_id: finalBarId, no_na_beer: true, no_na_reported_at: ts });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 },
    );
  }
}