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
    if (!url || !serviceKey) return jsonError('Server env saknas (SUPABASE_SERVICE_ROLE_KEY).', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Ogiltig JSON.');

    const mode = String(body.mode || '').toLowerCase(); // 'all' | 'last_days'
    const days = body.days !== undefined ? Number(body.days) : null;

    const ts = new Date().toISOString();

    if (mode === 'all') {
      // Soft-delete allt som inte redan är deletat
      const { data, error } = await supabase
        .from('prices')
        .update({ deleted_at: ts })
        .is('deleted_at', null)
        .select('id');

      if (error) return jsonError(`DB: ${error.message}`, 500);

      const affected = (data ?? []).length;

      const { error: auditErr } = await supabase.from('audit_events').insert({
        action: 'bulk_delete',
        bar_id: null,
        price_id: null,
        price_sek: null,
        ip_hash: null,
        user_agent: null,
        meta: { via: 'api/admin/bulk-delete', mode: 'all', affected, deleted_at: ts, admin: true },
      });
      if (auditErr) console.warn('audit insert failed:', auditErr.message);

      return NextResponse.json({ ok: true, mode: 'all', affected, deleted_at: ts });
    }

    if (mode === 'last_days') {
      if (!days || !Number.isFinite(days) || days < 1 || days > 3650) return jsonError('days måste vara 1-3650.');

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('prices')
        .update({ deleted_at: ts })
        .is('deleted_at', null)
        .gte('created_at', since) // senaste X dagar
        .select('id');

      if (error) return jsonError(`DB: ${error.message}`, 500);

      const affected = (data ?? []).length;

      const { error: auditErr } = await supabase.from('audit_events').insert({
        action: 'bulk_delete',
        bar_id: null,
        price_id: null,
        price_sek: null,
        ip_hash: null,
        user_agent: null,
        meta: { via: 'api/admin/bulk-delete', mode: 'last_days', days, affected, since, deleted_at: ts, admin: true },
      });
      if (auditErr) console.warn('audit insert failed:', auditErr.message);

      return NextResponse.json({ ok: true, mode: 'last_days', days, affected, deleted_at: ts, since });
    }

    return jsonError("mode måste vara 'all' eller 'last_days'.");
  } catch (e: any) {
    return jsonError(e?.message || 'Server error', 500);
  }
}