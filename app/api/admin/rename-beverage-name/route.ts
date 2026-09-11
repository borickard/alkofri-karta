export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTableNames } from '@/lib/tableNames';

const ALLOWED_CATEGORIES = ['na_beer', 'soda', 'na_wine', 'other'] as const;

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

    const rawCategory = typeof body.category === 'string' ? body.category : '';
    if (!ALLOWED_CATEGORIES.includes(rawCategory as typeof ALLOWED_CATEGORIES[number])) {
      return jsonError('Ogiltig kategori.');
    }
    const category = rawCategory as typeof ALLOWED_CATEGORIES[number];

    const old_name = typeof body.old_name === 'string' ? body.old_name.trim() : '';
    const new_name = typeof body.new_name === 'string' ? body.new_name.trim() : '';
    if (!old_name) return jsonError('old_name saknas.');
    if (!new_name) return jsonError('new_name saknas.');
    if (new_name.length > 200) return jsonError('new_name för långt (max 200 tecken).');

    const isDemo = body.demo === true || body.demo === '1';
    const { prices: pricesTable } = getTableNames(isDemo);

    const { data: candidateRows, error: readErr } = await supabase
      .from(pricesTable)
      .select('id, beverage_name')
      .eq('category', category)
      .is('deleted_at', null)
      .not('beverage_name', 'is', null);

    if (readErr) return jsonError(`DB: ${readErr.message}`, 500);

    const oldLower = old_name.toLowerCase();
    const matchIds = (candidateRows ?? [])
      .filter((r) => {
        const rr = r as { id: unknown; beverage_name: unknown };
        return typeof rr.beverage_name === 'string'
          && rr.beverage_name.trim().toLowerCase() === oldLower;
      })
      .map((r) => Number((r as { id: unknown }).id))
      .filter(Number.isFinite);

    if (matchIds.length === 0) {
      return NextResponse.json({ ok: true, affected: 0, demo: isDemo });
    }

    const { error: updErr } = await supabase
      .from(pricesTable)
      .update({ beverage_name: new_name })
      .in('id', matchIds);

    if (updErr) return jsonError(`DB: ${updErr.message}`, 500);

    await supabase.from('audit_events').insert({
      action: 'rename_beverage_name',
      bar_id: null,
      price_id: null,
      price_sek: null,
      ip_hash: null,
      user_agent: null,
      meta: {
        via: 'api/admin/rename-beverage-name',
        category,
        old_name,
        new_name,
        affected: matchIds.length,
        admin: true,
        demo: isDemo,
      },
    });

    return NextResponse.json({ ok: true, affected: matchIds.length, demo: isDemo });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
