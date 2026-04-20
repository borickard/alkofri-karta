export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return NextResponse.json({ ok: false, names: [] });

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { searchParams } = new URL(req.url);
    const demo = searchParams.has('demo');
    const pricesTable = demo ? 'prices_demo' : 'prices';

    const { data, error } = await supabase
      .from(pricesTable)
      .select('beverage_name')
      .is('deleted_at', null)
      .not('beverage_name', 'is', null);

    if (error) return NextResponse.json({ ok: false, names: [] });

    const counts = new Map<string, { name: string; count: number }>();
    for (const row of data ?? []) {
      const name = (row as { beverage_name: unknown }).beverage_name as string;
      if (!name?.trim()) continue;
      const key = name.trim().toLowerCase();
      const entry = counts.get(key);
      if (!entry) {
        counts.set(key, { name: name.trim(), count: 1 });
      } else {
        entry.count++;
      }
    }

    const names = [...counts.values()]
      .filter(e => e.count >= 2)
      .sort((a, b) => b.count - a.count)
      .map(e => e.name);

    return NextResponse.json({ ok: true, names });
  } catch {
    return NextResponse.json({ ok: false, names: [] });
  }
}
