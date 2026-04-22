export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTableNames } from '@/lib/tableNames';

type Category = 'na_beer' | 'soda' | 'na_wine' | 'other';

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
    const isDemo = (u.searchParams.get('demo') || '0') === '1';
    const { prices: pricesTable, bars: barsTable } = getTableNames(isDemo);

    const { data: pricesData, error: pricesErr } = await supabase
      .from(pricesTable)
      .select('beverage_name, category, bar_id')
      .is('deleted_at', null)
      .not('beverage_name', 'is', null);

    if (pricesErr) return jsonError(`DB: ${pricesErr.message}`, 500);

    // Group by normalized (lowercased+trimmed) name + category, but preserve
    // the most common raw casing for display.
    type NameKey = string;
    type BarKey = string;
    const groups = new Map<NameKey, {
      display: string;
      category: Category;
      casingCounts: Map<string, number>;
      bars: Map<BarKey, { bar_id: number; count: number }>;
      total: number;
    }>();

    for (const row of pricesData ?? []) {
      const rr = row as { beverage_name: unknown; category: unknown; bar_id: unknown };
      const rawName = typeof rr.beverage_name === 'string' ? rr.beverage_name.trim() : '';
      if (!rawName) continue;
      const category: Category = (typeof rr.category === 'string'
        && ['na_beer', 'soda', 'na_wine', 'other'].includes(rr.category))
        ? (rr.category as Category)
        : 'na_beer';
      const bar_id = Number(rr.bar_id);
      if (!Number.isFinite(bar_id)) continue;

      const key = `${category}::${rawName.toLowerCase()}`;
      let group = groups.get(key);
      if (!group) {
        group = { display: rawName, category, casingCounts: new Map(), bars: new Map(), total: 0 };
        groups.set(key, group);
      }
      group.casingCounts.set(rawName, (group.casingCounts.get(rawName) ?? 0) + 1);
      group.total += 1;
      const barKey = String(bar_id);
      const existing = group.bars.get(barKey);
      if (existing) existing.count += 1;
      else group.bars.set(barKey, { bar_id, count: 1 });
    }

    // Pick the most-used casing as the display label.
    for (const group of groups.values()) {
      let best = group.display;
      let bestCount = -1;
      for (const [casing, count] of group.casingCounts.entries()) {
        if (count > bestCount) { bestCount = count; best = casing; }
      }
      group.display = best;
    }

    const allBarIds = new Set<number>();
    for (const g of groups.values()) for (const b of g.bars.values()) allBarIds.add(b.bar_id);

    const { data: barsData, error: barsErr } = await supabase
      .from(barsTable)
      .select('id,name')
      .in('id', allBarIds.size ? [...allBarIds] : [0]);

    if (barsErr) return jsonError(`DB: ${barsErr.message}`, 500);

    const barNames = new Map<number, string>();
    for (const b of barsData ?? []) {
      const bb = b as { id: unknown; name: unknown };
      barNames.set(Number(bb.id), String(bb.name));
    }

    const rows = [...groups.values()]
      .map(g => ({
        name: g.display,
        category: g.category,
        total: g.total,
        bars: [...g.bars.values()]
          .map(b => ({ bar_id: b.bar_id, bar_name: barNames.get(b.bar_id) ?? '(okänd)', count: b.count }))
          .sort((a, b) => b.count - a.count || a.bar_name.localeCompare(b.bar_name, 'sv')),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'sv'));

    return NextResponse.json({ ok: true, demo: isDemo, rows });
  } catch (e: unknown) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500);
  }
}
