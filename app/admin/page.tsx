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

type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';

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
  const [tab, setTab] = useState<'prices' | 'audit'>('prices');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [isDemo, setIsDemo] = useState(() => searchParams.has('demo'));
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const headline = useMemo(() => (tab === 'prices' ? 'Prishistorik' : 'Audit-logg'), [tab]);

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
    window.history.replaceState(null, '', isDemo ? '?demo' : window.location.pathname);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, days, includeDeleted, isDemo]);

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
              <div style={{ marginTop: 2, ...muted }}>{headline}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={btn(tab === 'prices' ? 'dark' : 'light')} onClick={() => setTab('prices')}>Priser</button>
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

            <div style={{ flex: 1 }} />

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
                  <div style={{ marginTop: 8 }}>
                    <button style={btn('light')} onClick={() => deletePrice(p.id)}>Soft-delete</button>
                  </div>
                </div>
              ))}
              {!sortedPrices.length && <div style={muted}>Inga rader.</div>}
            </div>
          </div>
        )}

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
