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

export default function Page() {
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef(new globalThis.Map<number, Marker>());

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState(() => new globalThis.Map<number, LatestPrice>());

  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);
  const [priceInput, setPriceInput] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // NYTT: lägga till bar
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
      center: [18.065, 59.333], // Stockholm
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
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.25)';
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

  // NYTT: lägga till bar
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

  return (
    <div style={{ height: '100dvh', width: '100%', position: 'relative' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />

      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          background: 'white',
          borderRadius: 12,
          padding: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          maxWidth: 520,
          margin: '0 auto',
        }}
      >
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700 }}>Alkoholfri öl - karta</div>
          <button
            onClick={loadBarsAndPrices}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#F9FAFB' }}
          >
            Uppdatera
          </button>
        </div>

        {/* NYTT: lägga till bar */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #E5E7EB' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Lägg till bar (MVP)</div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              placeholder="Namn"
              value={barName}
              onChange={(e) => setBarName(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #E5E7EB' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              inputMode="decimal"
              placeholder="Lat (t.ex. 59.333)"
              value={barLat}
              onChange={(e) => setBarLat(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #E5E7EB' }}
            />
            <input
              inputMode="decimal"
              placeholder="Lng (t.ex. 18.065)"
              value={barLng}
              onChange={(e) => setBarLng(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #E5E7EB' }}
            />
            <button
              onClick={addBar}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #111827',
                background: '#111827',
                color: 'white',
                fontWeight: 700,
              }}
            >
              Lägg till
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: '#374151' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#16A34A', display: 'inline-block' }} />
            ≤ 45 kr
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#F59E0B', display: 'inline-block' }} />
            46-59 kr
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#DC2626', display: 'inline-block' }} />
            ≥ 60 kr
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#9CA3AF', display: 'inline-block' }} />
            Saknar pris
          </span>
        </div>

        {!selectedBar ? (
          <div style={{ marginTop: 10 }}>Klicka på en bar på kartan.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700 }}>{selectedBar.name}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Senast pris:{' '}
              {latestPriceForSelected ? `${latestPriceForSelected.price_sek} kr` : 'saknas'}
              {latestPriceForSelected ? ` (${new Date(latestPriceForSelected.created_at).toLocaleDateString('sv-SE')})` : ''}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                inputMode="numeric"
                placeholder="Pris (kr)"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #E5E7EB' }}
              />
              <button
                onClick={savePrice}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #111827',
                  background: '#111827',
                  color: 'white',
                  fontWeight: 700,
                }}
              >
                Spara
              </button>
            </div>

            {status ? <div style={{ marginTop: 8, fontSize: 13 }}>{status}</div> : null}
          </div>
        )}

        {!selectedBar && status ? <div style={{ marginTop: 8, fontSize: 13 }}>{status}</div> : null}
      </div>
    </div>
  );
}