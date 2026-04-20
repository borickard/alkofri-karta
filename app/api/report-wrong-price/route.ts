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
    const pricesTable = demo ? 'prices_demo' : 'prices';

    const bar_id = Number(body.bar_id);
    if (!Number.isFinite(bar_id)) return jsonError('bar_id saknas.');
    const price_id_param = body.price_id ? Number(body.price_id) : null;

    const userAgent = req.headers.get('user-agent') || null;
    const ip = getClientIp(req);
    const salt = process.env.IP_HASH_SALT || process.env.ADMIN_PASSWORD || 'fallback_salt';
    const ip_hash = ip ? sha256Hex(`${ip}|${salt}`) : null;

    let latest: { id: number; price_sek: number } | null = null;

    if (price_id_param) {
      const { data, error } = await supabase
        .from(pricesTable)
        .select('id,price_sek')
        .eq('id', price_id_param)
        .eq('bar_id', bar_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return jsonError(`DB: ${error.message}`, 500);
      latest = data ?? null;
    } else {
      const { data, error: latestErr } = await supabase
        .from(pricesTable)
        .select('id,price_sek')
        .eq('bar_id', bar_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestErr) return jsonError(`DB: ${latestErr.message}`, 500);
      latest = data ?? null;
    }

    if (!latest?.id) return jsonError('Inget pris att ta bort.', 404);

    const ts = new Date().toISOString();
    const { error: delErr } = await supabase.from(pricesTable).update({ deleted_at: ts }).eq('id', latest.id);
    if (delErr) return jsonError(`DB: ${delErr.message}`, 500);

    const { error: auditErr } = await supabase.from('audit_events').insert({
      action: 'delete_price',
      bar_id,
      price_id: latest.id,
      price_sek: latest.price_sek,
      ip_hash,
      user_agent: userAgent,
      meta: { via: 'api/report-wrong-price', deleted_at: ts, demo },
    });
    if (auditErr) console.warn('audit insert failed:', auditErr.message);

    return NextResponse.json({ ok: true, bar_id, deleted_price_id: latest.id });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 },
    );
  }
}