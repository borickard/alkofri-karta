'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Marker } from 'maplibre-gl';
import type { Map as MLMap, MapMouseEvent } from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';

type Bar = { id: number; name: string; lat: number; lng: number };
type LatestPrice = { bar_id: number; price_sek: number; created_at: string };

type CandidatePlace = {
  name: string;
  lat: number;
  lng: number;
  kind: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function colorForPrice(price?: number) {
  if (!price) return '#9CA3AF';
  if (price <= 45) return '#16A34A';
  if (price <= 59) return '#F59E0B';
  return '#DC2626';
}
function bgForPrice(price?: number) {
  if (!price) return '#F3F4F6';
  if (price <= 45) return '#E9F9EF';
  if (price <= 59) return '#FFF4DF';
  return '#FFE4E4';
}

const ui = {
  panel: {
    background: 'rgba(255,255,255,0.98)',
    border: '1px solid rgba(17,24,39,0.08)',
    borderRadius: 16,
    padding: 14,
    boxShadow: '0 18px 50px rgba(0,0,0,0.18)',
  } as React.CSSProperties,
  title: { fontWeight: 900, fontSize: 16, color: '#111827', letterSpacing: -0.2 } as React.CSSProperties,
  subtitle: { fontSize: 13, color: '#374151', marginTop: 2 } as React.CSSProperties,
  label: { fontSize: 12, fontWeight: 800, color: '#111827' } as React.CSSProperties,
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
    fontWeight: 900,
    fontSize: 14,
  } as React.CSSProperties,
  btnDanger: {
    padding: '11px 12px',
    borderRadius: 12,
    border: '1px solid #B91C1C',
    background: '#B91C1C',
    color: 'white',
    fontWeight: 900,
    fontSize: 14,
  } as React.CSSProperties,
  btnGhost: {
    padding: '9px 10px',
    borderRadius: 12,
    border: '1px solid #E5E7EB',
    background: '#F9FAFB',
    color: '#111827',
    fontWeight: 800,
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
      fontWeight: 800,
      color: '#111827',
      border: '1px solid rgba(17,24,39,0.06)',
    }) as React.CSSProperties,
};

function pickCandidateFromFeatures(features: any[], fallbackLngLat: { lng: number; lat: number }): CandidatePlace | null {
  const wanted = new Set(['bar', 'cafe', 'restaurant', 'pub', 'fast_food', 'biergarten']);

  for (const f of features) {
    const props = (f && f.properties) || {};
    const layerId = f?.layer?.id ? String(f.layer.id) : '';
    const cls = String(props.class ?? props.category ?? props.type ?? props.kind ?? '').toLowerCase();
    const name = String(props.name ?? props['name:sv'] ?? props['name:en'] ?? '').trim();

    const looksLikePoi =
      layerId.toLowerCase().includes('poi') ||
      layerId.toLowerCase().includes('place') ||
      layerId.toLowerCase().includes('label');

    const kind = wanted.has(cls) ? cls : '';

    if (looksLikePoi && (kind || /bar|cafe|kafé|café|restaurant|pub/i.test(cls)) && name) {
      let lng = fallbackLngLat.lng;
      let lat = fallbackLngLat.lat;

      if (f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
        lng = f.geometry.coordinates[0];
        lat = f.geometry.coordinates[1];
      }

      return { name, lat, lng, kind: kind || cls || 'place' };
    }
  }
  return null;
}

export default function Page() {
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef(new globalThis.Map<number, Marker>());

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState(() => new globalThis.Map<number, LatestPrice>());

  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);
  const [candidate, setCandidate] = useState<CandidatePlace | null>(null);

  const [priceInput, setPriceInput] = useState('');
  const [status, setStatus] = useState('');

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const maptilerStatus = maptilerKey ? `MapTiler: ON (${maptilerKey.slice(0, 6)}...)` : 'MapTiler: OFF';


  const latestPriceForSelected = useMemo(() => {
    if (!selectedBar) return undefined;
    return latestPrices.get(selectedBar.id);
  }, [selectedBar, latestPrices]);

  useEffect(() => {
    const style = maptilerKey
      ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${maptilerKey}`
      : 'https://demotiles.maplibre.org/style.json';

    const map = new maplibregl.Map({
      container: 'map',
      style,
      center: [18.065, 59.333],
      zoom: 12,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    const onClick = (e: MapMouseEvent) => {
      const m = mapRef.current;
      if (!m) return;

      const features = m.queryRenderedFeatures(e.point) as any[];
      const cand = pickCandidateFromFeatures(features, e.lngLat);

      if (cand) {
        setCandidate(cand);
        setSelectedBar(null);
        setPriceInput('');
        setStatus('');
      } else {
        setCandidate(null);
      }
    };

    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, [maptilerKey]);

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
      .limit(1000);

    if (pricesErr) return setStatus(`Fel: ${pricesErr.message}`);

    const m = new globalThis.Map<number, LatestPrice>();
    for (const p of pricesData ?? []) {
      if (!m.has(p.bar_id)) m.set(p.bar_id, p as LatestPrice);
    }
    setLatestPrices(m);
  }

  function renderMarkers(onlyPricedBars: Bar[], pricesMap: globalThis.Map<number, LatestPrice>) {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const b of onlyPricedBars) {
      const lp = pricesMap.get(b.id);
      const price = lp?.price_sek;
      if (!price) continue;

      const ringColor = colorForPrice(price);
      const bg = bgForPrice(price);

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.textContent = String(price);

      pill.style.display = 'inline-flex';
      pill.style.alignItems = 'center';
      pill.style.justifyContent = 'center';
      pill.style.minWidth = '44px';
      pill.style.height = '28px';
      pill.style.padding = '0 10px';
      pill.style.borderRadius = '999px';
      pill.style.border = `2px solid ${ringColor}`;
      pill.style.background = bg;
      pill.style.boxShadow = '0 8px 20px rgba(0,0,0,0.18)';
      pill.style.cursor = 'pointer';
      pill.style.fontWeight = '900';
      pill.style.fontSize = '12px';
      pill.style.color = '#111827';
      pill.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      pill.style.userSelect = 'none';

      const tip = document.createElement('div');
      tip.style.position = 'absolute';
      tip.style.left = '50%';
      tip.style.bottom = '-7px';
      tip.style.width = '10px';
      tip.style.height = '10px';
      tip.style.background = bg;
      tip.style.transform = 'translateX(-50%) rotate(45deg)';
      tip.style.borderRight = `2px solid ${ringColor}`;
      tip.style.borderBottom = `2px solid ${ringColor}`;
      tip.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';

      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      wrap.appendChild(pill);
      wrap.appendChild(tip);

      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
        .setLngLat([b.lng, b.lat])
        .addTo(map);

      wrap.onclick = () => {
        setSelectedBar(b);
        setCandidate(null);
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

  async function ensureBarForCandidate(c: CandidatePlace): Promise<Bar | null> {
    const { data, error } = await supabase
      .from('bars')
      .insert({ name: c.name, lat: c.lat, lng: c.lng })
      .select('id,name,lat,lng')
      .single();

    if (error) {
      setStatus(`Fel: ${error.message}`);
      return null;
    }
    return data as Bar;
  }

  async function savePriceForCandidate() {
    if (!candidate) return;

    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p <= 0) return setStatus('Skriv ett giltigt pris.');

    setStatus('Sparar...');

    const bar = await ensureBarForCandidate(candidate);
    if (!bar) return;

    const { error } = await supabase.from('prices').insert({
      bar_id: bar.id,
      price_sek: p,
    });

    if (error) return setStatus(`Fel: ${error.message}`);

    setStatus('Sparat.');
    setCandidate(null);
    setSelectedBar(bar);
    setPriceInput('');
    await loadBarsAndPrices();
  }

  async function savePriceForSelected() {
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
    setPriceInput('');
    await loadBarsAndPrices();
  }

  async function resetSelected() {
    if (!selectedBar) return;

    setStatus('Tar bort pris...');

    const { error: e1 } = await supabase.from('prices').delete().eq('bar_id', selectedBar.id);
    if (e1) return setStatus(`Fel: ${e1.message}`);

    const { error: e2 } = await supabase.from('bars').delete().eq('id', selectedBar.id);
    if (e2) return setStatus(`Fel: ${e2.message}`);

    setStatus('Reset klar.');
    setSelectedBar(null);
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

      <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, maxWidth: 560, margin: '0 auto' }}>
        <div style={ui.panel}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={ui.title}>Alkoholfri öl - karta</div>
                <div style={ui.subtitle}>
                  {maptilerStatus}
                </div>
            </div>
            <button onClick={loadBarsAndPrices} style={ui.btnGhost}>
              Uppdatera
            </button>
          </div>

          {legend}
          <div style={ui.hr} />

          {candidate ? (
            <div>
              <div style={ui.label}>Lägg till pris</div>
              <div style={{ marginTop: 6, fontWeight: 900, color: '#111827' }}>{candidate.name}</div>
              <div style={{ marginTop: 2, ...ui.muted }}>Typ: {candidate.kind || 'place'}</div>

              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <input
                  inputMode="numeric"
                  placeholder="Pris (kr)"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  style={ui.input}
                />
                <button onClick={savePriceForCandidate} style={ui.btn}>
                  Spara
                </button>
              </div>

              <div style={{ marginTop: 10, ...ui.muted }}>
                Tips: zooma in och klicka på själva namnet/ikonen för stället.
              </div>
            </div>
          ) : !selectedBar ? (
            <div style={{ color: '#111827', fontWeight: 800 }}>Klicka på en bar/café i kartan.</div>
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
                  placeholder="Uppdatera pris (kr)"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  style={ui.input}
                />
                <button onClick={savePriceForSelected} style={ui.btn}>
                  Spara
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                <button onClick={resetSelected} style={ui.btnDanger}>
                  Reset (ta bort pris)
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