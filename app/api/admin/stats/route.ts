export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from('prices')
    .select('bar_id')
    .is('deleted_at', null);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const uniqueBars = new Set((data ?? []).map((r: { bar_id: number }) => r.bar_id)).size;

  return NextResponse.json({ ok: true, barsWithPrices: uniqueBars });
}
