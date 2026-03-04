export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTableNames } from '@/lib/tableNames';

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
    const isDemo = (u.searchParams.get('demo') || '0') === '1';

    const { prices: pricesTable, bars: barsTable } = getTableNames(isDemo);
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();

    // Steg 1: hämta priser
    let q = supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,created_at,deleted_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!includeDeleted) q = q.is('deleted_at', null);

    const { data: pricesData, error: pricesErr } = await q;
    if (pricesErr) return jsonError(`DB: ${pricesErr.message}`, 500);

    // Steg 2: hämta bar-namn för unika bar_ids
    const barIds = [...new Set((pricesData ?? []).map((r: any) => r.bar_id))];
    const { data: barsData, error: barsErr } = await supabase
      .from(barsTable)
      .select('id,name')
      .in('id', barIds.length ? barIds : [0]);

    if (barsErr) return jsonError(`DB: ${barsErr.message}`, 500);

    const barMap = new Map((barsData ?? []).map((b: any) => [b.id, b.name]));

    const rows = (pricesData ?? []).map((r: any) => ({
      id: r.id,
      bar_id: r.bar_id,
      bar_name: barMap.get(r.bar_id) ?? '(okänd)',
      price_sek: r.price_sek,
      created_at: r.created_at,
      deleted_at: r.deleted_at ?? null,
    }));

    return NextResponse.json({ ok: true, days, limit, include_deleted: includeDeleted, demo: isDemo, rows });
  } catch (e: any) {
    return jsonError(e?.message || 'Server error', 500);
  }
}