export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Server env saknas.' }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as { bar_id?: number; demo?: boolean };
  const bar_id = Number(body.bar_id);
  const demo = Boolean(body.demo);

  if (!bar_id) return NextResponse.json({ ok: false, error: 'bar_id saknas.' }, { status: 400 });

  const barsTable = demo ? 'bars_demo' : 'bars';
  const { error } = await supabase
    .from(barsTable)
    .update({ no_na_beer: false, no_na_reported_at: null })
    .eq('id', bar_id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
