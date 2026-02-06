'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Marker } from 'maplibre-gl';
import type { Map as MLMap } from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';

type Bar = { id: number; name: string; lat: number; lng: number };
type LatestPrice = { bar_id: number; price_sek: number; created_at: string };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function colorForPrice(price?: number) {
  if (!price) return '#9CA3AF'; // grå
  if (price <= 45) return '#16A34A'; // grön
  if (price <= 59) return '#F59E0B'; // gul
  return '#DC2626'; // röd
}

const ui = {
  panel: {
    background: 'rgba(255,255,255,0.98)',
    border: '1px solid rgba(17,24,39,0.08)',
    borderRadius: 16,
    padding: 14,
    boxShadow: '0 18px 50px rgba(0,0,0,0.18)',
  } as React.CSSProperties,
  title: { fontWeight: 800, fontSize: 16, color: '#111827', letterSpacing: -0.2 } as React.CSSProperties,
  subtitle: { fontSize: 13, color: '#374151', marginTop: 2 } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 700, color: '#111827' } as React.CSSProperties,
  muted: { fontSize: 12, color: '#4B5563' } as React.CSSProperties,
  hr: { height: 1, background: '#E5E7EB', marginTop: 12, marginBottom: 12 } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '11px 12px',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    background: '#FFFFFF',
    color: '#111827',
    fontSize: 14,
    outline: 'none',
  } as React.CSSProperties,
  btn: {
    padding: '11px 12px',
    borderRadius: 12,
    border: '1px solid #111827',
    background: '#111827',
    color: 'white',
    fontWeight: 800,
    fontSize: 14,
  } as React.CSSProperties,
  btnGhost: {
    padding: '9px 10px',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    background: '#F9FAFB',
    color: '#111827',
    fontWeight: 700,
    fontSize: 13,
  } as React.CSSProperties,
  badge: (bg: string) =>
    ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      borderRadius: 999,
      background: bg,
      fontSize: 12,
      fontWeight: 700,
      color: '#111827',
      border: '1px solid rgba(17,24,39,0.06)',
    }) as React.CSSProperties,
};

export default function Page() {
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef(new globalThis.Map<number, Marker>());

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState(() => new globalThis.Map<number, LatestPrice>());

  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);
  const [priceInput, setPriceInput] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const [barName, setBarName] = useState('');
  const [barLat, setBarLat] = useState('');
  const [barLng, setBarLng] = useState('');

  const latestPriceForSelected = useMemo(() => {
    if (!selectedBar) return undefined;
    return latestPrices.get(selectedBar.id);
  }, [selectedBar, latestPrices]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: 'map',
      style: 'https://demotiles.maplibre.org/style.json',
      center: [18.065, 59.333],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  async function loadBarsAndPrices() {
    setStatus('');

    const { data: barsData, error: barsErr } = await supabase
      .from('bars')
      .select('id,name,lat,lng')
      .order('id', { ascending: true });

    if (barsErr) return setStatus(`Fel: ${barsErr.message}`);
    setBars(barsData ?? []);

    const { data: pricesData, error: pricesErr } = await supabase
      .from('prices')
      .select('bar_id,price_sek,created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (pricesErr) return setStatus(`Fel: ${pricesErr.message}`);

    const m = new globalThis.Map<number, LatestPrice>();
    for (const p of pricesData ?? []) {
      if (!m.has(p.bar_id)) m.set(p.bar_id, p as LatestPrice);
    }
    setLatestPrices(m);
  }

  function renderMarkers(barsToRender: Bar[], pricesMap: globalThis.Map<number, LatestPrice>) {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const b of barsToRender) {
      const lp = pricesMap.get(b.id);
      const color = colorForPrice(lp?.price_sek);

      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '999px';
      el.style.background = color;
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 10px rgba(0,0,0,0.25)';
      el.style.cursor = 'pointer';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([b.lng, b.lat])
        .addTo(map);

      el.onclick = () => {
        setSelectedBar(b);
        setPriceInput('');
        setStatus('');
      };

      markersRef.current.set(b.id, marker);
    }
  }

  useEffect(() => {
    loadBarsAndPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    renderMarkers(bars, latestPrices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, latestPrices]);

  async function savePrice() {
    if (!selectedBar) return;

    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p <= 0) return setStatus('Skriv ett giltigt pris.');

    setStatus('Sparar...');

    const { error } = await supabase.from('prices').insert({
      bar_id: selectedBar.id,
      price_sek: p,
    });

    if (error) return setStatus(`Fel: ${error.message}`);

    setStatus('Sparat.');
    await loadBarsAndPrices();
  }

  async function addBar() {
    const name = barName.trim();
    const lat = parseFloat(barLat.trim());
    const lng = parseFloat(barLng.trim());

    if (!name) return setStatus('Skriv namn på baren.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return setStatus('Skriv giltig lat/lng.');

    setStatus('Lägger till bar...');

    const { error } = await supabase.from('bars').insert({
      name,
      lat,
      lng,
    });

    if (error) return setStatus(`Fel: ${error.message}`);

    setBarName('');
    setBarLat('');
    setBarLng('');
    setStatus('Bar tillagd.');

    await loadBarsAndPrices();
  }

  const legend = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      <span style={ui.badge('#E9F9EF')}>🟢 ≤ 45 kr</span>
      <span style={ui.badge('#FFF4DF')}>🟡 46-59 kr</span>
      <span style={ui.badge('#FFE4E4')}>🔴 ≥ 60 kr</span>
      <span style={ui.badge('#F3F4F6')}>⚪ saknar pris</span>
    </div>
  );

  return (
    <div style={{ height: '100dvh', width: '100%', position: 'relative' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />

      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          maxWidth: 560,
          margin: '0 auto',
        }}
      >
        <div style={ui.panel}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={ui.title}>Alkoholfri öl - karta</div>
              <div style={ui.subtitle}>Klicka på en bar för pris. Uppdatera när du ser en meny.</div>
            </div>

            <button onClick={loadBarsAndPrices} style={ui.btnGhost}>
              Uppdatera
            </button>
          </div>

          {legend}

          <div style={ui.hr} />

          <div>
            <div style={ui.label}>Lägg till bar (MVP)</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <input
                placeholder="Namn"
                value={barName}
                onChange={(e) => setBarName(e.target.value)}
                style={ui.input}
              />
            </div>

            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <input
                inputMode="decimal"
                placeholder="Lat"
                value={barLat}
                onChange={(e) => setBarLat(e.target.value)}
                style={ui.input}
              />
              <input
                inputMode="decimal"
                placeholder="Lng"
                value={barLng}
                onChange={(e) => setBarLng(e.target.value)}
                style={ui.input}
              />
              <button onClick={addBar} style={ui.btn}>
                Lägg till
              </button>
            </div>
          </div>

          <div style={ui.hr} />

          {!selectedBar ? (
            <div style={{ color: '#111827', fontWeight: 700 }}>Välj en bar på kartan.</div>
          ) : (
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: '#111827' }}>{selectedBar.name}</div>

              <div style={{ marginTop: 4, fontSize: 13, color: '#111827' }}>
                Senast pris:{' '}
                <span style={{ fontWeight: 900 }}>
                  {latestPriceForSelected ? `${latestPriceForSelected.price_sek} kr` : 'saknas'}
                </span>
                {latestPriceForSelected ? (
                  <span style={{ color: '#6B7280' }}>
                    {' '}
                    ({new Date(latestPriceForSelected.created_at).toLocaleDateString('sv-SE')})
                  </span>
                ) : null}
              </div>

              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <input
                  inputMode="numeric"
                  placeholder="Nytt pris (kr)"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  style={ui.input}
                />
                <button onClick={savePrice} style={ui.btn}>
                  Spara
                </button>
              </div>
            </div>
          )}

          {status ? <div style={{ marginTop: 10, ...ui.muted }}>{status}</div> : null}
        </div>
      </div>
    </div>
  );
}