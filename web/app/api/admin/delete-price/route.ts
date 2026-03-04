export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTableNames } from '@/lib/tableNames';

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

    const price_id = Number(body.price_id);
    if (!Number.isFinite(price_id)) return jsonError('price_id saknas.');

    const isDemo = body.demo === true || body.demo === '1';
    const { prices: pricesTable } = getTableNames(isDemo);

    const { data: row, error: readErr } = await supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,created_at,deleted_at')
      .eq('id', price_id)
      .maybeSingle();

    if (readErr) return jsonError(`DB: ${readErr.message}`, 500);
    if (!row) return jsonError('Price hittades inte.', 404);

    const ts = new Date().toISOString();
    const { error: delErr } = await supabase.from(pricesTable).update({ deleted_at: ts }).eq('id', price_id);
    if (delErr) return jsonError(`DB: ${delErr.message}`, 500);

    await supabase.from('audit_events').insert({
      action: 'delete_price',
      bar_id: row.bar_id ?? null,
      price_id: price_id,
      price_sek: row.price_sek ?? null,
      ip_hash: null,
      user_agent: null,
      meta: { via: 'api/admin/delete-price', deleted_at: ts, admin: true, demo: isDemo },
    });

    return NextResponse.json({ ok: true, deleted_price_id: price_id, deleted_at: ts, demo: isDemo });
  } catch (e: any) {
    return jsonError(e?.message || 'Server error', 500);
  }
}