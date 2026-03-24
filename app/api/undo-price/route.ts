export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function getClientIp(req: Request) {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() ?? null;
}

function sha256Hex(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

const WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) return jsonError('Server env saknas.', 500);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Ogiltig JSON.');

    const price_id = Number(body.price_id);
    const demo = Boolean(body.demo);
    if (!price_id) return jsonError('price_id saknas.');

    const ip = getClientIp(req);
    if (!ip) return jsonError('Kunde inte fastställa IP.', 403);
    const salt = process.env.IP_HASH_SALT || process.env.ADMIN_PASSWORD || 'fallback_salt';
    const ip_hash = sha256Hex(`${ip}|${salt}`);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Verify audit record: same IP, same price_id, within time window
    const { data: audit, error: auditErr } = await supabase
      .from('audit_events')
      .select('ip_hash, created_at')
      .eq('action', 'insert_price')
      .eq('price_id', price_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (auditErr || !audit) return jsonError('Hittar inte originalhändelsen.', 404);
    if (audit.ip_hash !== ip_hash) return jsonError('Inte behörig att ångra detta.', 403);

    const age = Date.now() - new Date(audit.created_at).getTime();
    if (age > WINDOW_MS) return jsonError('Ångrafönstret har stängt (5 min).', 403);

    const pricesTable = demo ? 'prices_demo' : 'prices';
    const { error } = await supabase
      .from(pricesTable)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', price_id)
      .is('deleted_at', null);

    if (error) return jsonError(`DB: ${error.message}`, 500);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
