export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return jsonError('Server env saknas.', 500);

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const body = await req.json().catch(() => null);
    if (!body) return jsonError('Ogiltig JSON.');

    const bar_id = body.bar_id ? Number(body.bar_id) : null;
    if (!bar_id) return jsonError('bar_id saknas.');

    const opening_hours = body.opening_hours ? String(body.opening_hours).trim() : null;
    if (!opening_hours) return jsonError('opening_hours saknas.');

    const demo = Boolean(body.demo);
    const barsTable = demo ? 'bars_demo' : 'bars';

    const { error } = await supabase
      .from(barsTable)
      .update({ opening_hours })
      .eq('id', bar_id);

    if (error) return jsonError(`DB: ${error.message}`, 500);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
