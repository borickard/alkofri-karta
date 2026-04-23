'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';

type AuditRow = {
  id: number;
  created_at: string;
  action: string;
  bar_id: number | null;
  price_id: number | null;
  price_sek: number | null;
  ip_hash: string | null;
  user_agent: string | null;
  meta: unknown;
};

type PriceRow = {
  id: number;
  bar_id: number;
  bar_name: string;
  price_sek: number;
  created_at: string;
  deleted_at: string | null;
};

type Category = 'na_beer' | 'soda' | 'na_wine' | 'other';

const CATEGORY_LABELS: Record<Category, string> = {
  na_beer: 'Öl',
  soda: 'Läsk',
  na_wine: 'Vin',
  other: 'Övrigt',
};

type BeverageNameRow = {
  name: string;
  category: Category;
  total: number;
  bars: { bar_id: number; bar_name: string; count: number }[];
};

type Stats = {
  bar_count: number;
  price_count: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  p25: number | null;
  p75: number | null;
  median: number | null;
  range: number | null;
  iqr: number | null;
  unique_names: number;
  variety_per_bar: number | null;
};

type BucketRow = Stats & {
  name: string;
  pct_vs_national: number | null;
};

type Rankings = {
  cheapest_avg: BucketRow[];
  most_expensive_avg: BucketRow[];
  widest_range: BucketRow[];
  most_variety_per_bar: BucketRow[];
};

type PriceOutlier = {
  bar_id: number;
  bar_name: string;
  kommun: string;
  lan: string;
  price_sek: number;
  beverage_name: string | null;
  category: Category;
  created_at: string;
};

type InsightsResponse = {
  ok: boolean;
  national: Stats;
  by_kommun: { rows: BucketRow[]; rankings: Rankings };
  by_lan: { rows: BucketRow[]; rankings: Rankings };
  outliers: { cheapest_prices: PriceOutlier[]; priciest_prices: PriceOutlier[] };
};

type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';

type MatchRow = { id: number; bar_name: string; google_name: string; similarity: number; dist: number; place_id: string };
type MatchResult = {
  ok: boolean;
  dry_run: boolean;
  total: number;
  matched: number;
  unmatched: number;
  skipped_low_confidence: number;
  results: { matched: MatchRow[]; unmatched: { id: number; name: string }[]; skipped: { id: number; bar_name: string; google_name: string; similarity: number }[] };
};

const card = (extra?: CSSProperties): CSSProperties => ({
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  borderRadius: 8,
  ...extra,
});

const btn = (variant: 'dark' | 'light' | 'danger' = 'light'): CSSProperties => {
  const base: CSSProperties = {
    border: '1px solid #d1d5db',
    borderRadius: 6,
    padding: '8px 14px',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  };
  if (variant === 'dark') return { ...base, background: '#111827', color: '#ffffff', borderColor: '#111827' };
  if (variant === 'danger') return { ...base, background: '#b91c1c', color: '#ffffff', borderColor: '#b91c1c' };
  return { ...base, background: '#ffffff', color: '#111827' };
};

const inputStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 6,
  padding: '8px 12px',
  fontWeight: 500,
  fontSize: 14,
  outline: 'none',
  background: '#ffffff',
  color: '#111827',
};

const muted: CSSProperties = { color: '#6b7280', fontSize: 13, fontWeight: 400 };
const label: CSSProperties = { color: '#374151', fontSize: 14, fontWeight: 600 };

function DbToggle({ isDemo, onChange }: { isDemo: boolean; onChange: (v: boolean) => void }) {
  const seg = (active: boolean): CSSProperties => ({
    padding: '4px 12px',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: active ? '#111827' : 'transparent',
    color: active ? '#ffffff' : '#6b7280',
    transition: 'background 0.15s, color 0.15s',
  });
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid #d1d5db',
      borderRadius: 6,
      padding: 2,
      background: '#f9fafb',
      gap: 2,
    }}>
      <button style={seg(!isDemo)} onClick={() => onChange(false)}>Live</button>
      <button style={seg(isDemo)} onClick={() => onChange(true)}>Demo</button>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('sv-SE');
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function calcStats(rows: PriceRow[]) {
  const active = rows.filter(r => !r.deleted_at).map(r => r.price_sek);
  if (!active.length) return null;
  const sorted = [...active].sort((a, b) => a - b);
  const avg = Math.round(active.reduce((s, v) => s + v, 0) / active.length);
  const median = percentile(sorted, 50);
  const p25 = percentile(sorted, 25);
  const p75 = percentile(sorted, 75);
  return { count: active.length, avg, median, p25, p75, min: sorted[0], max: sorted[sorted.length - 1] };
}

export default function AdminPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'prices' | 'names' | 'insights' | 'audit'>(() => {
    if (searchParams.has('priser')) return 'prices';
    if (searchParams.has('namn')) return 'names';
    if (searchParams.has('audit')) return 'audit';
    return 'insights';
  });
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [isDemo, setIsDemo] = useState(() => searchParams.has('demo'));
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  useEffect(() => {
    const tabKey = tab === 'prices' ? 'priser' : tab === 'names' ? 'namn' : tab === 'insights' ? 'insikter' : 'audit';
    const qs = [tabKey, ...(isDemo ? ['demo'] : [])].join('&');
    window.history.replaceState(null, '', `/admin?${qs}`);
  }, [tab, isDemo]);

  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [beverageNames, setBeverageNames] = useState<BeverageNameRow[]>([]);
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [renameSaving, setRenameSaving] = useState<string | null>(null);

  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [insightCategory, setInsightCategory] = useState<Category>('na_beer');
  const [insightDays, setInsightDays] = useState<0 | 30 | 90 | 365>(0);
  const [insightGeo, setInsightGeo] = useState<'kommun' | 'lan'>('kommun');
  const [insightMinPrices, setInsightMinPrices] = useState(1);
  const [insightMinBars, setInsightMinBars] = useState(1);
  const [insightsTableOpen, setInsightsTableOpen] = useState(false);
  const [insightsTableSort, setInsightsTableSort] = useState<{ key: keyof BucketRow; dir: 'asc' | 'desc' }>({ key: 'price_count', dir: 'desc' });
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [barsWithPrices, setBarsWithPrices] = useState<number | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  const headline = useMemo(() => {
    if (tab === 'prices') return 'Prishistorik';
    if (tab === 'names') return 'Dryckesnamn';
    if (tab === 'insights') return 'Insikter';
    return 'Audit-logg';
  }, [tab]);

  const sortedPrices = useMemo(() => {
    const copy = [...prices];
    if (sortKey === 'newest') return copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (sortKey === 'oldest') return copy.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortKey === 'highest') return copy.sort((a, b) => b.price_sek - a.price_sek);
    if (sortKey === 'lowest') return copy.sort((a, b) => a.price_sek - b.price_sek);
    return copy;
  }, [prices, sortKey]);

  const stats = useMemo(() => calcStats(prices), [prices]);

  async function load() {
    setLoading(true);
    setStatus('');
    try {
      if (tab === 'prices') {
        const url = `/api/admin/prices?days=${encodeURIComponent(days)}&limit=200&include_deleted=${includeDeleted ? '1' : '0'}&demo=${isDemo ? '1' : '0'}`;
        const r = await fetch(url, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda priser');
        setPrices(j.rows || []);
      } else if (tab === 'names') {
        const r = await fetch(`/api/admin/beverage-names?demo=${isDemo ? '1' : '0'}`, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda namn');
        setBeverageNames(j.rows || []);
      } else if (tab === 'insights') {
        const params = new URLSearchParams();
        params.set('category', insightCategory);
        if (insightDays > 0) params.set('days', String(insightDays));
        params.set('min_prices', String(insightMinPrices));
        params.set('min_bars', String(insightMinBars));
        params.set('demo', isDemo ? '1' : '0');
        const r = await fetch(`/api/admin/insights?${params.toString()}`, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda insikter');
        setInsights(j as InsightsResponse);
      } else {
        const r = await fetch(
          `/api/admin/audit?days=${encodeURIComponent(days)}&limit=250&demo=${isDemo ? '1' : '0'}`,
          { cache: 'no-store' }
        );
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda audit');
        setAudit(j.rows || []);
      }
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Fel');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/admin/stats').then(r => r.json()).then(j => {
      if (j.ok) setBarsWithPrices(j.barsWithPrices);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.history.replaceState(null, '', isDemo ? '?demo' : window.location.pathname);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, days, includeDeleted, isDemo, insightCategory, insightDays, insightMinPrices, insightMinBars]);

  async function renameBeverage(row: BeverageNameRow) {
    const key = `${row.category}::${row.name.toLowerCase()}`;
    const draft = (renameDrafts[key] ?? row.name).trim();
    if (!draft) { setStatus('Nytt namn saknas.'); return; }
    if (draft === row.name) { setStatus('Inget att uppdatera.'); return; }
    const existing = beverageNames.find(
      r => r.category === row.category && r.name.toLowerCase() === draft.toLowerCase() && r !== row,
    );
    const confirmMsg = existing
      ? `Sammanfoga "${row.name}" (${row.total}) med "${existing.name}" (${existing.total})?`
      : `Byt namn från "${row.name}" till "${draft}"?`;
    if (!confirm(confirmMsg)) return;
    setRenameSaving(key);
    setStatus('Sparar...');
    try {
      const r = await fetch('/api/admin/rename-beverage-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: row.category,
          old_name: row.name,
          new_name: draft,
          demo: isDemo,
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Rename misslyckades');
      setStatus(`Uppdaterade ${j.affected} rad${j.affected === 1 ? '' : 'er'}.`);
      setRenameDrafts(prev => { const next = { ...prev }; delete next[key]; return next; });
      await load();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Fel');
    } finally {
      setRenameSaving(null);
    }
  }

  async function deletePrice(price_id: number) {
    if (!confirm(`Soft-delete price_id=${price_id}?`)) return;
    setStatus('Tar bort...');
    try {
      const r = await fetch('/api/admin/delete-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_id, demo: isDemo }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Delete misslyckades');
      setStatus(`Borttagen (${price_id}).`);
      await load();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Fel');
    }
  }

  async function bulkDeleteAll() {
    if (!confirm('Rensa ALLA priser (soft delete)?')) return;
    setStatus('Rensar alla...');
    try {
      const r = await fetch('/api/admin/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all', demo: isDemo }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Bulk delete misslyckades');
      setStatus(`Klart. Påverkade: ${j.affected}`);
      await load();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Fel');
    }
  }

  async function bulkDeleteLastDays() {
    if (!confirm(`Rensa priser från senaste ${days} dagar (soft delete)?`)) return;
    setStatus(`Rensar senaste ${days} dagar...`);
    try {
      const r = await fetch('/api/admin/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'last_days', days, demo: isDemo }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Bulk delete misslyckades');
      setStatus(`Klart. Påverkade: ${j.affected}`);
      await load();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Fel');
    }
  }

  async function runMatch(dryRun: boolean) {
    setMatchLoading(true);
    try {
      const r = await fetch('/api/admin/match-google-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, min_similarity: 0.3 }),
      });
      const j = await r.json();
      setMatchResult(j);
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : 'Fel');
    } finally {
      setMatchLoading(false);
    }
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'newest', label: 'Senast' },
    { key: 'oldest', label: 'Äldst' },
    { key: 'highest', label: 'Högst' },
    { key: 'lowest', label: 'Lägst' },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: '#f3f4f6', padding: 16 }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Header */}
        <div style={card({ padding: 16 })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>Admin</div>
              <a href={isDemo ? '/?demo' : '/'} style={{ ...btn('light'), marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', fontSize: 13, padding: '5px 10px' }}>
                ← Tillbaka till sajten
              </a>
              <div style={{ marginTop: 2, ...muted }}>{headline}</div>
              {barsWithPrices !== null && (
                <div style={{ marginTop: 4, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
                  {barsWithPrices} platser med priser
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn(tab === 'prices' ? 'dark' : 'light')} onClick={() => setTab('prices')}>Priser</button>
              <button style={btn(tab === 'names' ? 'dark' : 'light')} onClick={() => setTab('names')}>Namn</button>
              <button style={btn(tab === 'insights' ? 'dark' : 'light')} onClick={() => setTab('insights')}>Insikter</button>
              <button style={btn(tab === 'audit' ? 'dark' : 'light')} onClick={() => setTab('audit')}>Audit</button>
            </div>
          </div>

          {/* Controls */}
          <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={label}>Dagar:</span>
            <input
              style={{ ...inputStyle, width: 90 }}
              inputMode="numeric"
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value || 0))}
            />

            {tab === 'prices' && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', ...label, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                />
                Visa deletade
              </label>
            )}

            <button style={btn('light')} onClick={load} disabled={loading}>
              {loading ? 'Laddar…' : 'Uppdatera'}
            </button>

            <button style={btn('light')} onClick={bulkDeleteLastDays}>
              Rensa {days} dagar
            </button>
            <button style={btn('danger')} onClick={bulkDeleteAll}>
              Rensa alla
            </button>
          </div>

          {status && (
            <div style={{ marginTop: 10, ...muted }}>{status}</div>
          )}
        </div>

        {/* Prices */}
        {tab === 'prices' && (
          <div style={card({ padding: 16 })}>
            {/* Section heading with db indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Priser</span>
                <DbToggle isDemo={isDemo} onChange={setIsDemo} />
              </div>

              {/* Sort */}
              <div style={{ display: 'flex', gap: 4 }}>
                {sortOptions.map(o => (
                  <button
                    key={o.key}
                    style={{
                      ...btn(sortKey === o.key ? 'dark' : 'light'),
                      padding: '5px 10px',
                      fontSize: 13,
                    }}
                    onClick={() => setSortKey(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stats */}
            {stats && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 8,
                marginBottom: 16,
              }}>
                {[
                  { label: 'Snitt', value: `${stats.avg} kr` },
                  { label: 'Median', value: `${stats.median} kr` },
                  { label: 'Topp 25%', value: `≥ ${stats.p75} kr` },
                  { label: 'Mitten 50%', value: `${stats.p25}–${stats.p75} kr` },
                  { label: 'Botten 25%', value: `≤ ${stats.p25} kr` },
                  { label: 'Antal', value: `${stats.count} st` },
                ].map(s => (
                  <div key={s.label} style={{ background: '#f9fafb', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ ...muted, fontSize: 11, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sortedPrices.map((p) => (
                <div key={p.id} style={card({ padding: '10px 12px' })}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>
                      {p.bar_name} <span style={muted}>#{p.bar_id}</span>
                    </div>
                    <div style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>{p.price_sek} kr</div>
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={muted}>Skapad: {fmt(p.created_at)}</div>
                    <div style={{ ...muted, color: p.deleted_at ? '#b91c1c' : '#065f46', fontWeight: 600 }}>
                      {p.deleted_at ? `Deletad: ${fmt(p.deleted_at)}` : 'Aktiv'}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button style={btn('light')} onClick={() => deletePrice(p.id)}>Soft-delete</button>
                    <a href={isDemo ? `/?demo&bar=${p.bar_id}` : `/?bar=${p.bar_id}`} style={{ ...btn('light'), textDecoration: 'none' }}>Visa på karta</a>
                  </div>
                </div>
              ))}
              {!sortedPrices.length && <div style={muted}>Inga rader.</div>}
            </div>
          </div>
        )}

        {/* Dryckesnamn */}
        {tab === 'names' && (
          <div style={card({ padding: 16 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Namn</span>
              <button
                style={{ ...btn(isDemo ? 'light' : 'dark'), padding: '4px 12px', fontSize: 13 }}
                onClick={() => setIsDemo(!isDemo)}
              >
                {isDemo ? 'Demo' : 'Live'}
              </button>
              <span style={{ ...muted, fontSize: 12 }}>
                Sorterad efter antal rapporter. Klicka på ett namn för att se platserna, och på en plats för att öppna den på kartan i en ny flik.
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {beverageNames.map((row) => {
                const key = `${row.category}::${row.name.toLowerCase()}`;
                const expanded = expandedNames.has(key);
                return (
                  <div key={key} style={card({ padding: '10px 12px' })}>
                    <button
                      onClick={() => {
                        setExpandedNames(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        });
                      }}
                      style={{
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: '#6b7280', width: 10 }}>{expanded ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>{row.name}</span>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: '#f3f4f6',
                          border: '1px solid #e5e7eb',
                          color: '#374151',
                          fontSize: 12,
                          fontWeight: 600,
                        }}>
                          {CATEGORY_LABELS[row.category]}
                        </span>
                      </div>
                      <span style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>
                        {row.total} {row.total === 1 ? 'rapport' : 'rapporter'}
                        <span style={{ ...muted, marginLeft: 6 }}>· {row.bars.length} {row.bars.length === 1 ? 'plats' : 'platser'}</span>
                      </span>
                    </button>
                    {expanded && (
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {row.bars.map(b => (
                            <a
                              key={b.bar_id}
                              href={`/?bar=${b.bar_id}${isDemo ? '&demo' : ''}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 10px',
                                background: '#f9fafb',
                                border: '1px solid #e5e7eb',
                                borderRadius: 6,
                                fontSize: 13,
                                color: '#111827',
                                textDecoration: 'none',
                              }}
                            >
                              <span>{b.bar_name} <span style={muted}>↗</span></span>
                              <span style={muted}>{b.count} {b.count === 1 ? 'rapport' : 'rapporter'}</span>
                            </a>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ ...muted, fontSize: 12 }}>Byt namn:</span>
                          <input
                            style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                            value={renameDrafts[key] ?? row.name}
                            onChange={(e) => setRenameDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') renameBeverage(row); }}
                            disabled={renameSaving === key}
                            placeholder={row.name}
                          />
                          <button
                            style={{ ...btn('dark'), padding: '5px 12px', fontSize: 13 }}
                            onClick={() => renameBeverage(row)}
                            disabled={renameSaving === key}
                          >
                            {renameSaving === key ? 'Sparar…' : 'Spara'}
                          </button>
                          <button
                            style={{ ...btn('light'), padding: '5px 12px', fontSize: 13 }}
                            onClick={() => setRenameDrafts(prev => { const next = { ...prev }; delete next[key]; return next; })}
                            disabled={renameSaving === key || (renameDrafts[key] ?? row.name) === row.name}
                          >
                            Återställ
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {!beverageNames.length && !loading && <div style={muted}>Inga namngivna drycker än.</div>}
            </div>
          </div>
        )}

        {/* Insikter */}
        {tab === 'insights' && (() => {
          const geoLabel = insightGeo === 'kommun' ? 'kommuner' : 'län';
          const active = insights ? (insightGeo === 'kommun' ? insights.by_kommun : insights.by_lan) : null;
          const fmtKr = (v: number | null) => v === null ? '–' : `${Math.round(v)} kr`;
          const fmtPct = (v: number | null) => {
            if (v === null || !Number.isFinite(v)) return '–';
            const sign = v > 0 ? '+' : '';
            return `${sign}${v.toFixed(0)}%`;
          };
          const fmtVariety = (v: number | null) => v === null ? '–' : v.toFixed(1);

          const tableRows = active ? [...active.rows].sort((a, b) => {
            const key = insightsTableSort.key;
            const av = a[key];
            const bv = b[key];
            const aNull = av === null || av === undefined;
            const bNull = bv === null || bv === undefined;
            if (aNull && bNull) return 0;
            if (aNull) return 1;
            if (bNull) return -1;
            if (typeof av === 'number' && typeof bv === 'number') {
              return insightsTableSort.dir === 'asc' ? av - bv : bv - av;
            }
            const as = String(av); const bs = String(bv);
            return insightsTableSort.dir === 'asc' ? as.localeCompare(bs, 'sv') : bs.localeCompare(as, 'sv');
          }) : [];

          return (
          <div style={card({ padding: 16 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Insikter</span>
              <button
                style={{ ...btn(isDemo ? 'light' : 'dark'), padding: '4px 12px', fontSize: 13 }}
                onClick={() => setIsDemo(!isDemo)}
              >
                {isDemo ? 'Demo' : 'Live'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['na_beer', 'soda', 'na_wine', 'other'] as const).map((c) => {
                  const selected = insightCategory === c;
                  const label = CATEGORY_LABELS[c];
                  return (
                    <button
                      key={c}
                      style={{
                        padding: '4px 12px',
                        borderRadius: 999,
                        border: selected ? '1.5px solid #111827' : '1px solid #d1d5db',
                        background: selected ? '#111827' : '#ffffff',
                        color: selected ? '#ffffff' : '#374151',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      onClick={() => setInsightCategory(c)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <select
                style={{ ...inputStyle, padding: '5px 8px' }}
                value={String(insightDays)}
                onChange={(e) => setInsightDays(Number(e.target.value) as 0 | 30 | 90 | 365)}
              >
                <option value="0">Alla tider</option>
                <option value="365">365 dagar</option>
                <option value="90">90 dagar</option>
                <option value="30">30 dagar</option>
              </select>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  style={btn(insightGeo === 'kommun' ? 'dark' : 'light')}
                  onClick={() => setInsightGeo('kommun')}
                >
                  Kommuner
                </button>
                <button
                  style={btn(insightGeo === 'lan' ? 'dark' : 'light')}
                  onClick={() => setInsightGeo('lan')}
                >
                  Län
                </button>
              </div>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', ...label, cursor: 'pointer' }}>
                Min rapporter
                <input
                  style={{ ...inputStyle, width: 60 }}
                  inputMode="numeric"
                  value={String(insightMinPrices)}
                  onChange={(e) => setInsightMinPrices(Math.max(1, Number(e.target.value || 1)))}
                />
              </label>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', ...label, cursor: 'pointer' }}>
                Min platser
                <input
                  style={{ ...inputStyle, width: 60 }}
                  inputMode="numeric"
                  value={String(insightMinBars)}
                  onChange={(e) => setInsightMinBars(Math.max(1, Number(e.target.value || 1)))}
                />
              </label>
            </div>

            {!insights && !loading && <div style={muted}>Ingen data.</div>}

            {insights && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* National headline */}
                <div style={card({ padding: 12, background: '#f9fafb' })}>
                  <div style={{ fontWeight: 700, color: '#111827', fontSize: 14, marginBottom: 4 }}>
                    Nationellt
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, color: '#374151' }}>
                    <span>Snitt <strong>{fmtKr(insights.national.avg)}</strong></span>
                    <span>Min <strong>{fmtKr(insights.national.min)}</strong></span>
                    <span>Max <strong>{fmtKr(insights.national.max)}</strong></span>
                    <span>{insights.national.price_count} rapporter</span>
                    <span>på {insights.national.bar_count} platser</span>
                    <span>{active?.rows.length ?? 0} {geoLabel}</span>
                  </div>
                </div>

                {/* Ranking cards */}
                {active && (
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                    {/* Billigaste */}
                    <div style={card({ padding: 12 })}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Billigaste {geoLabel}</div>
                      {!active.rankings.cheapest_avg.length && <div style={muted}>–</div>}
                      {active.rankings.cheapest_avg.map((r) => (
                        <div key={`cheap-${r.name}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
                          <span style={{ fontWeight: 600, color: '#111827' }}>{r.name}</span>
                          <span style={{ color: '#374151' }}>
                            {fmtKr(r.avg)} <span style={muted}>({r.price_count}) · {fmtPct(r.pct_vs_national)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Dyraste */}
                    <div style={card({ padding: 12 })}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Dyraste {geoLabel}</div>
                      {!active.rankings.most_expensive_avg.length && <div style={muted}>–</div>}
                      {active.rankings.most_expensive_avg.map((r) => (
                        <div key={`expensive-${r.name}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
                          <span style={{ fontWeight: 600, color: '#111827' }}>{r.name}</span>
                          <span style={{ color: '#374151' }}>
                            {fmtKr(r.avg)} <span style={muted}>({r.price_count}) · {fmtPct(r.pct_vs_national)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Störst prisspann */}
                    <div style={card({ padding: 12 })}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Störst prisspann</div>
                      {!active.rankings.widest_range.length && <div style={muted}>–</div>}
                      {active.rankings.widest_range.map((r) => (
                        <div key={`range-${r.name}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
                          <span style={{ fontWeight: 600, color: '#111827' }}>{r.name}</span>
                          <span style={{ color: '#374151' }}>
                            {fmtKr(r.min)}–{fmtKr(r.max)} <span style={muted}>spann {fmtKr(r.range)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Variation per plats */}
                    <div style={card({ padding: 12 })}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Mest variation per plats</div>
                      {!active.rankings.most_variety_per_bar.length && <div style={muted}>–</div>}
                      {active.rankings.most_variety_per_bar.map((r) => (
                        <div key={`var-${r.name}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0' }}>
                          <span style={{ fontWeight: 600, color: '#111827' }}>{r.name}</span>
                          <span style={{ color: '#374151' }}>
                            {fmtVariety(r.variety_per_bar)}/plats <span style={muted}>({r.unique_names} unika på {r.bar_count})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Outliers */}
                <div style={card({ padding: 12 })}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Billigaste / dyraste enskilda rapporter</div>
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                    <div>
                      <div style={{ ...muted, fontSize: 12, marginBottom: 4 }}>Billigaste</div>
                      {!insights.outliers.cheapest_prices.length && <div style={muted}>–</div>}
                      {insights.outliers.cheapest_prices.map((p) => (
                        <a
                          key={`oc-${p.bar_id}-${p.created_at}-${p.price_sek}`}
                          href={`/?bar=${p.bar_id}${isDemo ? '&demo' : ''}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 13, color: '#111827', textDecoration: 'none' }}
                        >
                          <span>
                            <strong>{p.price_sek} kr</strong> · {p.beverage_name || CATEGORY_LABELS[p.category]} · {p.bar_name} <span style={muted}>({p.kommun}) ↗</span>
                          </span>
                        </a>
                      ))}
                    </div>
                    <div>
                      <div style={{ ...muted, fontSize: 12, marginBottom: 4 }}>Dyraste</div>
                      {!insights.outliers.priciest_prices.length && <div style={muted}>–</div>}
                      {insights.outliers.priciest_prices.map((p) => (
                        <a
                          key={`op-${p.bar_id}-${p.created_at}-${p.price_sek}`}
                          href={`/?bar=${p.bar_id}${isDemo ? '&demo' : ''}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 13, color: '#111827', textDecoration: 'none' }}
                        >
                          <span>
                            <strong>{p.price_sek} kr</strong> · {p.beverage_name || CATEGORY_LABELS[p.category]} · {p.bar_name} <span style={muted}>({p.kommun}) ↗</span>
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Full table */}
                <div style={card({ padding: 12 })}>
                  <button
                    onClick={() => setInsightsTableOpen(v => !v)}
                    style={{ ...btn('light'), width: '100%', justifyContent: 'center' }}
                  >
                    {insightsTableOpen ? 'Dölj' : 'Visa'} alla {geoLabel}
                  </button>
                  {insightsTableOpen && active && (
                    <div style={{ overflowX: 'auto', marginTop: 10 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                            {([
                              ['name', 'Namn'],
                              ['bar_count', 'Platser'],
                              ['price_count', 'Rapporter'],
                              ['avg', 'Snitt'],
                              ['min', 'Min'],
                              ['max', 'Max'],
                              ['range', 'Spann'],
                              ['unique_names', 'Unika namn'],
                              ['variety_per_bar', 'Variation/plats'],
                              ['pct_vs_national', '% mot riks'],
                            ] as const).map(([key, label]) => {
                              const isSorted = insightsTableSort.key === key;
                              return (
                                <th
                                  key={key}
                                  onClick={() => setInsightsTableSort(prev => ({
                                    key,
                                    dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
                                  }))}
                                  style={{ padding: '6px 8px', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', borderBottom: '1px solid #e5e7eb' }}
                                >
                                  {label}{isSorted ? (insightsTableSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map((r) => (
                            <tr key={`row-${r.name}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600, color: '#111827' }}>{r.name}</td>
                              <td style={{ padding: '6px 8px' }}>{r.bar_count}</td>
                              <td style={{ padding: '6px 8px' }}>{r.price_count}</td>
                              <td style={{ padding: '6px 8px' }}>{fmtKr(r.avg)}</td>
                              <td style={{ padding: '6px 8px' }}>{fmtKr(r.min)}</td>
                              <td style={{ padding: '6px 8px' }}>{fmtKr(r.max)}</td>
                              <td style={{ padding: '6px 8px' }}>{fmtKr(r.range)}</td>
                              <td style={{ padding: '6px 8px' }}>{r.unique_names}</td>
                              <td style={{ padding: '6px 8px' }}>{fmtVariety(r.variety_per_bar)}</td>
                              <td style={{ padding: '6px 8px' }}>{fmtPct(r.pct_vs_national)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* Audit */}
        {tab === 'audit' && (
          <div style={card({ padding: 16 })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Audit</span>
              <button
                style={{ ...btn(isDemo ? 'light' : 'dark'), padding: '4px 12px', fontSize: 13 }}
                onClick={() => setIsDemo(!isDemo)}
              >
                {isDemo ? 'Demo' : 'Live'}
              </button>
            </div>

            <div style={card({ padding: 12, marginBottom: 14 })}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Matcha mot Google Places</div>
              <div style={{ ...muted, marginBottom: 10 }}>Kopplar barer utan google_place_id till Google Places för att hämta adress och öppettider.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={btn('light')} onClick={() => runMatch(true)} disabled={matchLoading}>
                  {matchLoading ? 'Kör…' : 'Förhandsgranska'}
                </button>
                {matchResult && matchResult.matched > 0 && matchResult.dry_run && (
                  <button style={btn('dark')} onClick={() => runMatch(false)} disabled={matchLoading}>
                    Spara {matchResult.matched} matchningar
                  </button>
                )}
              </div>
              {matchResult && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ ...muted, marginBottom: 8 }}>
                    Totalt: {matchResult.total} · Matchade: {matchResult.matched} · Ej matchade: {matchResult.unmatched} · Osäkra: {matchResult.skipped_low_confidence}
                    {!matchResult.dry_run && <span style={{ color: '#065f46', fontWeight: 600 }}> · Sparade!</span>}
                  </div>
                  {matchResult.results.matched.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {matchResult.results.matched.map(m => (
                        <div key={m.id} style={card({ padding: '8px 10px', background: '#f0fdf4' })}>
                          <span style={{ fontWeight: 600, color: '#111827', fontSize: 13 }}>{m.bar_name}</span>
                          <span style={{ ...muted, fontSize: 12 }}> → {m.google_name} ({Math.round(m.similarity * 100)}% likhet, {m.dist}m)</span>
                        </div>
                      ))}
                      {matchResult.results.unmatched.map(m => (
                        <div key={m.id} style={card({ padding: '8px 10px', background: '#fef2f2' })}>
                          <span style={{ fontWeight: 600, color: '#991b1b', fontSize: 13 }}>{m.name}</span>
                          <span style={{ ...muted, fontSize: 12 }}> — ingen match hittad</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {audit.map((a) => (
                <div key={a.id} style={card({ padding: '10px 12px' })}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>
                      {a.action} <span style={muted}>#{a.id} · {fmt(a.created_at)}</span>
                    </div>
                    <div style={{ fontWeight: 600, color: '#111827', fontSize: 14 }}>
                      {a.price_sek !== null ? `${a.price_sek} kr` : ''}
                    </div>
                  </div>
                  <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span style={muted}>bar_id: {a.bar_id ?? '–'}</span>
                    <span style={muted}>price_id: {a.price_id ?? '–'}</span>
                    <span style={muted}>ip: {a.ip_hash ? a.ip_hash.slice(0, 16) + '…' : '–'}</span>
                  </div>
                  <div style={{ marginTop: 2, ...muted, wordBreak: 'break-all' }}>
                    UA: {a.user_agent ? a.user_agent.slice(0, 120) : '–'}
                  </div>
                  {a.price_id && (
                    <div style={{ marginTop: 8 }}>
                      <button style={btn('light')} onClick={() => deletePrice(a.price_id!)}>
                        Soft-delete price_id {a.price_id}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!audit.length && <div style={muted}>Inga events.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
