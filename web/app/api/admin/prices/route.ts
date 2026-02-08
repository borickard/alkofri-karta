export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError('Server env saknas (SUPABASE_SERVICE_ROLE_KEY).', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const u = new URL(req.url);
    const days = Number(u.searchParams.get('days') || '30');
    const limit = Math.min(500, Math.max(20, Number(u.searchParams.get('limit') || '200')));
    const includeDeleted = (u.searchParams.get('include_deleted') || '0') === '1';

    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();

    // Join via FK relationship: prices -> bars
    let q = supabase
      .from('prices')
      .select('id,bar_id,price_sek,created_at,deleted_at,bars(name)')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!includeDeleted) q = q.is('deleted_at', null);

    const { data, error } = await q;
    if (error) return jsonError(`DB: ${error.message}`, 500);

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      bar_id: r.bar_id,
      bar_name: r.bars?.name ?? '(okänd)',
      price_sek: r.price_sek,
      created_at: r.created_at,
      deleted_at: r.deleted_at ?? null,
    }));

    return NextResponse.json({ ok: true, days, limit, include_deleted: includeDeleted, rows });
  } catch (e: any) {
    return jsonError(e?.message || 'Server error', 500);
  }
}