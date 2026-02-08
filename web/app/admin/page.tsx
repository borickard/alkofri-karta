'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

type AuditRow = {
  id: number;
  created_at: string;
  action: string;
  bar_id: number | null;
  price_id: number | null;
  price_sek: number | null;
  ip_hash: string | null;
  user_agent: string | null;
  meta: any;
};

type PriceRow = {
  id: number;
  bar_id: number;
  bar_name: string;
  price_sek: number;
  created_at: string;
  deleted_at: string | null;
};

const retro = {
  border: '2px solid #111827',
  shadow: '2px 2px 0 #111827',
  bg: '#FFFFFF',
  radius: 16,
};

const box = (extra?: CSSProperties): CSSProperties => ({
  background: retro.bg,
  border: retro.border,
  boxShadow: retro.shadow,
  borderRadius: retro.radius,
  ...extra,
});

const btn = (variant: 'dark' | 'light' | 'danger' = 'dark'): CSSProperties => {
  const base: CSSProperties = {
    border: retro.border,
    boxShadow: retro.shadow,
    borderRadius: 12,
    padding: '10px 12px',
    fontWeight: 900,
    cursor: 'pointer',
  };
  if (variant === 'dark') return { ...base, background: '#111827', color: 'white' };
  if (variant === 'danger') return { ...base, background: '#B91C1C', color: 'white' };
  return { ...base, background: '#FFFFFF', color: '#111827' };
};

const input: CSSProperties = {
  border: retro.border,
  boxShadow: retro.shadow,
  borderRadius: 12,
  padding: '10px 12px',
  fontWeight: 900,
  outline: 'none',
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('sv-SE');
}

export default function AdminPage() {
  const [tab, setTab] = useState<'prices' | 'audit'>('prices');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const headline = useMemo(() => (tab === 'prices' ? 'Prishistorik' : 'Audit-logg'), [tab]);

  async function load() {
    setLoading(true);
    setStatus('');
    try {
      if (tab === 'prices') {
        const url = `/api/admin/prices?days=${encodeURIComponent(days)}&limit=200&include_deleted=${
          includeDeleted ? '1' : '0'
        }`;
        const r = await fetch(url, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda priser');
        setPrices(j.rows || []);
      } else {
        const r = await fetch(`/api/admin/audit?days=${encodeURIComponent(days)}&limit=250`, { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'Kunde inte ladda audit');
        setAudit(j.rows || []);
      }
    } catch (e: any) {
      setStatus(e?.message || 'Fel');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, days, includeDeleted]);

  async function deletePrice(price_id: number) {
    if (!confirm(`Soft-delete price_id=${price_id}?`)) return;
    setStatus('Tar bort...');
    try {
      const r = await fetch('/api/admin/delete-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_id }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Delete misslyckades');
      setStatus(`Borttagen (${price_id}).`);
      await load();
    } catch (e: any) {
      setStatus(e?.message || 'Fel');
    }
  }

  async function bulkDeleteAll() {
    if (!confirm('Rensa ALLA priser (soft delete)?')) return;
    setStatus('Rensar alla...');
    try {
      const r = await fetch('/api/admin/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all' }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Bulk delete misslyckades');
      setStatus(`Klart. Påverkade: ${j.affected}`);
      await load();
    } catch (e: any) {
      setStatus(e?.message || 'Fel');
    }
  }

  async function bulkDeleteLastDays() {
    if (!confirm(`Rensa priser från senaste ${days} dagar (soft delete)?`)) return;
    setStatus(`Rensar senaste ${days} dagar...`);
    try {
      const r = await fetch('/api/admin/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'last_days', days }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Bulk delete misslyckades');
      setStatus(`Klart. Påverkade: ${j.affected}`);
      await load();
    } catch (e: any) {
      setStatus(e?.message || 'Fel');
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#F3F4F6', padding: 16 }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={box({ padding: 16 })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 1000, color: '#111827' }}>Admin</div>
              <div style={{ marginTop: 6, fontWeight: 900, color: '#111827' }}>{headline}</div>
              <div style={{ marginTop: 6, color: '#374151', fontWeight: 800 }}>
                Här kan du moderera sabotage: soft-delete priser och se logg (IP-hash + user agent).
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <button style={btn(tab === 'prices' ? 'dark' : 'light')} onClick={() => setTab('prices')}>
                Priser
              </button>
              <button style={btn(tab === 'audit' ? 'dark' : 'light')} onClick={() => setTab('audit')}>
                Audit
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontWeight: 900, color: '#111827' }}>Dagar:</label>
            <input
              style={{ ...input, width: 110 }}
              inputMode="numeric"
              value={String(days)}
              onChange={(e) => setDays(Number(e.target.value || 0))}
            />

            {tab === 'prices' ? (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 900, color: '#111827' }}>
                <input
                  type="checkbox"
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                />
                Visa deletade
              </label>
            ) : null}

            <button style={btn('light')} onClick={load} disabled={loading}>
              {loading ? 'Laddar…' : 'Uppdatera'}
            </button>

            <div style={{ flex: 1 }} />

            <button style={btn('light')} onClick={bulkDeleteLastDays}>
              Rensa senaste {days} dagar
            </button>
            <button style={btn('danger')} onClick={bulkDeleteAll}>
              Rensa ALLA priser
            </button>
          </div>

          {status ? <div style={{ marginTop: 10, fontWeight: 900, color: '#111827' }}>{status}</div> : null}
        </div>

        {tab === 'prices' ? (
          <div style={box({ padding: 12 })}>
            <div style={{ fontWeight: 1000, color: '#111827' }}>Senaste prisrader</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {prices.map((p) => (
                <div
                  key={p.id}
                  style={box({
                    padding: 12,
                    borderRadius: 14,
                    boxShadow: '1px 1px 0 #111827',
                  })}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 1000, color: '#111827' }}>
                      {p.bar_name} <span style={{ fontWeight: 900, color: '#374151' }}>#{p.bar_id}</span>
                    </div>
                    <div style={{ fontWeight: 1000, color: '#111827' }}>{p.price_sek} kr</div>
                  </div>

                  <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 900, color: '#374151' }}>Skapad: {fmt(p.created_at)}</div>
                    <div style={{ fontWeight: 900, color: p.deleted_at ? '#B91C1C' : '#065F46' }}>
                      {p.deleted_at ? `DELETAD: ${fmt(p.deleted_at)}` : 'AKTIV'}
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button style={btn('light')} onClick={() => deletePrice(p.id)}>
                      Soft-delete
                    </button>
                  </div>
                </div>
              ))}

              {!prices.length ? <div style={{ fontWeight: 900, color: '#374151' }}>Inga rader.</div> : null}
            </div>
          </div>
        ) : (
          <div style={box({ padding: 12 })}>
            <div style={{ fontWeight: 1000, color: '#111827' }}>Audit events</div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {audit.map((a) => (
                <div
                  key={a.id}
                  style={box({
                    padding: 12,
                    borderRadius: 14,
                    boxShadow: '1px 1px 0 #111827',
                  })}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 1000, color: '#111827' }}>
                      {a.action}{' '}
                      <span style={{ fontWeight: 900, color: '#374151' }}>
                        #{a.id} {fmt(a.created_at)}
                      </span>
                    </div>
                    <div style={{ fontWeight: 1000, color: '#111827' }}>
                      {a.price_sek !== null ? `${a.price_sek} kr` : ''}
                    </div>
                  </div>

                  <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 900, color: '#374151' }}>bar_id: {a.bar_id ?? '-'}</div>
                    <div style={{ fontWeight: 900, color: '#374151' }}>price_id: {a.price_id ?? '-'}</div>
                    <div style={{ fontWeight: 900, color: '#374151' }}>
                      ip_hash: {a.ip_hash ? a.ip_hash.slice(0, 16) + '…' : '-'}
                    </div>
                  </div>

                  <div style={{ marginTop: 6, fontWeight: 900, color: '#374151' }}>
                    UA: {a.user_agent ? a.user_agent.slice(0, 120) : '-'}
                  </div>

                  {a.price_id ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button style={btn('light')} onClick={() => deletePrice(a.price_id!)}>
                        Soft-delete price_id {a.price_id}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}

              {!audit.length ? <div style={{ fontWeight: 900, color: '#374151' }}>Inga events.</div> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}