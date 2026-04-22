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
    const ALLOWED_CATEGORIES = ['na_beer', 'soda', 'na_wine', 'other'] as const;
    const categoryParam = searchParams.get('category');
    const category = ALLOWED_CATEGORIES.includes(categoryParam as typeof ALLOWED_CATEGORIES[number])
      ? (categoryParam as typeof ALLOWED_CATEGORIES[number])
      : null;

    let query = supabase
      .from(pricesTable)
      .select('beverage_name')
      .is('deleted_at', null)
      .not('beverage_name', 'is', null);
    if (category) query = query.eq('category', category);
    const { data, error } = await query;

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
