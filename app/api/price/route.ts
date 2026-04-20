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
    const pricesTable = demo ? 'prices_demo' : 'prices';

    const bar_id = body.bar_id ? Number(body.bar_id) : null;
    const price_sek = Number(body.price_sek);
    const beverage_name = typeof body.beverage_name === 'string' && body.beverage_name.trim() ? body.beverage_name.trim() : null;

    if (!Number.isFinite(price_sek)) return jsonError('price_sek saknas.');
    if (price_sek < 10 || price_sek > 150) return jsonError('Pris måste vara 10-150 kr.');

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
      if (lat < 55.0 || lat > 69.5 || lng < 10.0 || lng > 25.0) return jsonError('Platsen är utanför Sverige.');

      type BarUpsertPayload = {
        name: string;
        lat: number;
        lng: number;
        source: 'maptiler';
        source_id: string;
        venue_type?: string | null;
        opening_hours?: string | null;
      };

      const venue_type_raw = body.venue_type ?? null;
      const venue_type = venue_type_raw ? String(venue_type_raw) : null;
      const opening_hours_raw = body.opening_hours ?? null;
      const opening_hours = opening_hours_raw ? String(opening_hours_raw).trim() : null;

      const payload: BarUpsertPayload = {
        name,
        lat,
        lng,
        source: 'maptiler',
        source_id: source_id ?? `fallback-${name}-${lat.toFixed(6)}-${lng.toFixed(6)}`,
        venue_type,
        opening_hours,
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

    const { error: barUpdErr } = await supabase
      .from(barsTable)
      .update({ no_na_beer: false, no_na_reported_at: null })
      .eq('id', finalBarId);

    if (barUpdErr) return jsonError(`DB: ${barUpdErr.message}`, 500);

    const { data: priceRow, error: priceErr } = await supabase
      .from(pricesTable)
      .insert({ bar_id: finalBarId, price_sek, beverage_name })
      .select('id,bar_id,price_sek,created_at,beverage_name')
      .single();

    if (priceErr) return jsonError(`DB: ${priceErr.message}`, 500);

    const { error: auditErr } = await supabase.from('audit_events').insert({
      action: 'insert_price',
      bar_id: finalBarId,
      price_id: priceRow?.id ?? null,
      price_sek,
      ip_hash,
      user_agent: userAgent,
      meta: { via: 'api/price', demo },
    });

    if (auditErr) console.warn('audit insert failed:', auditErr.message);

    return NextResponse.json({ ok: true, bar_id: finalBarId, price: priceRow });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}