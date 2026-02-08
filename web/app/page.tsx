'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { Marker } from 'maplibre-gl';
import type { Map as MLMap, MapMouseEvent } from 'maplibre-gl';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState } from 'react';

type Bar = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  source?: string | null;
  source_id?: string | null;
  no_na_beer?: boolean | null;
  no_na_reported_at?: string | null;
};

type LatestPrice = { id?: number; bar_id: number; price_sek: number; created_at: string };
type PriceRow = { id?: number; price_sek: number; created_at: string };

type CandidatePlace = {
  name: string;
  lat: number;
  lng: number;
  kind: string;
  source: 'maptiler';
  source_id: string | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ====== Pricing color buckets ======
function colorForPrice(price?: number) {
  if (!price) return '#9CA3AF';
  if (price <= 35) return '#16A34A';
  if (price <= 45) return '#F59E0B';
  return '#DC2626';
}
function bgForPrice(price?: number) {
  if (!price) return '#F3F4F6';
  if (price <= 35) return '#E9F9EF';
  if (price <= 45) return '#FFF4DF';
  return '#FFE4E4';
}

// ====== Retro “hard shadow” tokens (opak) ======
const retro = {
  borderColor: '#111827',
  borderW: 2,
  radius: 16,
  shadowOffset: 2, // same as borderW => 45deg hard shadow
  bg: '#FFFFFF',
};

function hardShadowBox(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: retro.bg,
    border: `${retro.borderW}px solid ${retro.borderColor}`,
    borderRadius: retro.radius,
    boxShadow: `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`,
    ...extra,
  };
}

const ui = {
  panel: hardShadowBox({ padding: 14 }),
  modal: hardShadowBox({ padding: 16, maxWidth: 560, width: '100%' }),
  label: { fontSize: 12, fontWeight: 900, color: '#111827' } as React.CSSProperties,
  muted: { fontSize: 12, color: '#374151' } as React.CSSProperties,
  hr: { height: 2, background: '#111827', marginTop: 12, marginBottom: 12 } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '11px 12px',
    borderRadius: 12,
    border: `2px solid ${retro.borderColor}`,
    background: '#FFFFFF',
    color: '#111827',
    fontSize: 14,
    outline: 'none',
  } as React.CSSProperties,
  btn: {
    padding: '11px 12px',
    borderRadius: 12,
    border: `2px solid ${retro.borderColor}`,
    background: retro.borderColor,
    color: 'white',
    fontWeight: 900,
    fontSize: 14,
    boxShadow: `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`,
    cursor: 'pointer',
  } as React.CSSProperties,
  btnGhost: {
    padding: '9px 10px',
    borderRadius: 12,
    border: `2px solid ${retro.borderColor}`,
    background: '#FFFFFF',
    color: '#111827',
    fontWeight: 900,
    fontSize: 13,
    boxShadow: `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`,
    cursor: 'pointer',
  } as React.CSSProperties,
  btnDanger: {
    padding: '11px 12px',
    borderRadius: 12,
    border: `2px solid ${retro.borderColor}`,
    background: '#B91C1C',
    color: 'white',
    fontWeight: 900,
    fontSize: 14,
    boxShadow: `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`,
    cursor: 'pointer',
  } as React.CSSProperties,
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: `2px solid ${retro.borderColor}`,
    background: '#FFFFFF',
    boxShadow: `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  } as React.CSSProperties,
  chip: (border: string, text: string, bg = '#FFFFFF') =>
    ({
      display: 'inline-flex',
      alignItems: 'center',
      padding: '6px 10px',
      borderRadius: 999,
      border: `2px solid ${border}`,
      color: text,
      background: bg,
      fontSize: 12,
      fontWeight: 900,
      pointerEvents: 'none',
      boxShadow: `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`,
    }) as React.CSSProperties,
};

function extractStableIdFromFeature(props: any, feature: any): string | null {
  const raw =
    props.osm_id ??
    props.osmId ??
    props.id ??
    props.feature_id ??
    props.featureId ??
    props['@id'] ??
    feature?.id ??
    null;
  return raw === null || raw === undefined ? null : String(raw);
}

function pickBestPoi(features: any[], map: MLMap, clickPoint: { x: number; y: number }): CandidatePlace | null {
  const wanted = new Set(['bar', 'cafe', 'restaurant', 'pub', 'fast_food', 'biergarten']);
  let best: { cand: CandidatePlace; dist2: number } | null = null;

  for (const f of features) {
    const props = (f && f.properties) || {};
    const layerId = String(f?.layer?.id ?? '').toLowerCase();

    const name = String(props.name ?? props['name:sv'] ?? props['name:en'] ?? '').trim();
    if (!name) continue;

    const cls = String(props.class ?? props.category ?? props.type ?? props.kind ?? '').toLowerCase();
    const subclass = String(props.subclass ?? '').toLowerCase();
    const maki = String(props.maki ?? '').toLowerCase();

    const looksLikePoiLayer =
      layerId.includes('poi') || layerId.includes('poi_label') || layerId.includes('points-of-interest');

    const looksLikeFoodDrink =
      wanted.has(cls) ||
      wanted.has(subclass) ||
      wanted.has(maki) ||
      /bar|cafe|kafé|café|restaurant|pub|bistro|brasserie|tap|brew/i.test(`${cls} ${subclass} ${maki} ${name}`);

    if (!looksLikePoiLayer && !looksLikeFoodDrink) continue;
    if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) continue;

    const [lng, lat] = f.geometry.coordinates as [number, number];
    const pr = map.project([lng, lat]);
    const dx = pr.x - clickPoint.x;
    const dy = pr.y - clickPoint.y;
    const dist2 = dx * dx + dy * dy;

    const rawId = extractStableIdFromFeature(props, f);

    const kind =
      wanted.has(cls)
        ? cls
        : wanted.has(subclass)
        ? subclass
        : wanted.has(maki)
        ? maki
        : cls || subclass || maki || 'place';

    const cand: CandidatePlace = { name, kind, source: 'maptiler', source_id: rawId, lat, lng };
    if (!best || dist2 < best.dist2) best = { cand, dist2 };
  }

  return best?.cand ?? null;
}

function relTimeSv(iso?: string | null) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - t);
  const minutes = Math.round(diff / 60000);
  if (minutes < 2) return 'nyss';
  if (minutes < 60) return `${minutes} min sen`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} tim sen`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'igår';
  return `${days} dagar sen`;
}

function formatDateSv(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE');
}

export default function Page() {
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef(new globalThis.Map<number, Marker>());

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState(() => new globalThis.Map<number, LatestPrice>());
  const [history, setHistory] = useState<PriceRow[]>([]);

  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);
  const [candidate, setCandidate] = useState<CandidatePlace | null>(null);

  const [priceInput, setPriceInput] = useState('');
  const [status, setStatus] = useState('');

  const [showWelcome, setShowWelcome] = useState(true);

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

  const latestPriceForSelected = useMemo(() => {
    if (!selectedBar) return undefined;
    return latestPrices.get(selectedBar.id);
  }, [selectedBar, latestPrices]);

  const resetPanel = () => {
    setSelectedBar(null);
    setCandidate(null);
    setPriceInput('');
    setStatus('');
    setHistory([]);
    const u = new URL(window.location.href);
    u.searchParams.delete('bar');
    window.history.replaceState({}, '', u.toString());
  };

  // Init map
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

      const p = e.point;
      const pad = 30;
      const features = m.queryRenderedFeatures(
        [
          [p.x - pad, p.y - pad],
          [p.x + pad, p.y + pad],
        ] as any
      ) as any[];

      const cand = pickBestPoi(features, m, p);

      if (cand) {
        setCandidate(cand);
        setSelectedBar(null);
        setHistory([]);
        setPriceInput('');
        setStatus('');
      } else {
        resetPanel();
      }
    };

    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maptilerKey]);

  // Escape closes panel
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (showWelcome) setShowWelcome(false);
        else resetPanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWelcome]);

  async function centerOnMe() {
    const map = mapRef.current;
    if (!map) return;

    if (!('geolocation' in navigator)) return setStatus('Din webbläsare stödjer inte geolokalisering.');

    setStatus('Hämtar din position...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14, essential: true });
        setStatus('');
      },
      (err) => setStatus(`Kunde inte hämta position: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function loadBarsAndPrices() {
    setStatus('');

    const { data: barsData, error: barsErr } = await supabase
      .from('bars')
      .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at') // <-- måste vara med
      .order('id', { ascending: true });

    if (barsErr) return setStatus(`Fel: ${barsErr.message}`);
    setBars((barsData ?? []) as Bar[]);

    const { data: pricesData, error: pricesErr } = await supabase
      .from('prices')
      .select('id,bar_id,price_sek,created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (pricesErr) return setStatus(`Fel: ${pricesErr.message}`);

    const m = new globalThis.Map<number, LatestPrice>();
    for (const p of pricesData ?? []) {
      if (!m.has(p.bar_id)) m.set(p.bar_id, p as LatestPrice);
    }
    setLatestPrices(m);
  }

  async function loadHistory(barId: number) {
    const { data, error } = await supabase
      .from('prices')
      .select('id,price_sek,created_at')
      .eq('bar_id', barId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      setHistory([]);
      return;
    }
    setHistory((data ?? []) as PriceRow[]);
  }

  // Render map markers
  function renderMarkers(allBars: Bar[], pricesMap: globalThis.Map<number, LatestPrice>) {
    const map = mapRef.current;
    if (!map) return;

    for (const marker of markersRef.current.values()) marker.remove();
    markersRef.current.clear();

    for (const b of allBars) {
      const lp = pricesMap.get(b.id);
      const noNa = Boolean(b.no_na_beer);
      if (!lp && !noNa) continue;

      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      wrap.style.pointerEvents = 'auto';

      const name = document.createElement('div');
      name.textContent = b.name;
      name.style.maxWidth = '160px';
      name.style.padding = '4px 8px';
      name.style.borderRadius = '10px';
      name.style.background = '#FFFFFF';
      name.style.border = `2px solid ${retro.borderColor}`;
      name.style.fontSize = '11px';
      name.style.fontWeight = '900';
      name.style.color = '#111827';
      name.style.boxShadow = `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`;
      name.style.textAlign = 'center';
      name.style.whiteSpace = 'nowrap';
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.opacity = '0';
      name.style.transform = 'translateY(4px)';
      name.style.transition = 'opacity 120ms ease, transform 120ms ease';
      name.style.pointerEvents = 'none';

      const showName = () => {
        name.style.opacity = '1';
        name.style.transform = 'translateY(0px)';
      };
      const hideName = () => {
        name.style.opacity = '0';
        name.style.transform = 'translateY(4px)';
      };

      const pill = document.createElement('button');
      pill.type = 'button';
      pill.style.display = 'inline-flex';
      pill.style.alignItems = 'center';
      pill.style.justifyContent = 'center';
      pill.style.minWidth = '54px';
      pill.style.height = '30px';
      pill.style.padding = '0 12px';
      pill.style.borderRadius = '999px';
      pill.style.fontSize = '12px';
      pill.style.fontWeight = '900';
      pill.style.userSelect = 'none';
      pill.style.cursor = 'pointer';
      pill.style.border = `2px solid ${retro.borderColor}`;
      pill.style.boxShadow = `${retro.shadowOffset}px ${retro.shadowOffset}px 0 ${retro.borderColor}`;

      // Priority: no_na_beer => black X (even if price exists)
      if (noNa) {
        pill.textContent = '✕';
        pill.style.background = '#111827';
        pill.style.color = 'white';
      } else {
        const price = lp!.price_sek;
        pill.textContent = `${price} kr`;
        pill.style.background = bgForPrice(price);
        pill.style.color = '#111827';
        pill.style.border = `2px solid ${colorForPrice(price)}`;
      }

      pill.addEventListener('mouseenter', showName);
      pill.addEventListener('mouseleave', hideName);

      pill.addEventListener('click', async (ev) => {
        ev.stopPropagation();

        setSelectedBar(b);
        setCandidate(null);
        setPriceInput('');
        setStatus('');
        await loadHistory(b.id);

        const u = new URL(window.location.href);
        u.searchParams.set('bar', String(b.id));
        window.history.replaceState({}, '', u.toString());

        showName();
        window.setTimeout(() => hideName(), 2500);
      });

      wrap.appendChild(name);
      wrap.appendChild(pill);

      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
        .setLngLat([b.lng, b.lat])
        .addTo(map);

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

  // Open from share link ?bar=ID
  useEffect(() => {
    const run = async () => {
      const u = new URL(window.location.href);
      const barId = u.searchParams.get('bar');
      if (!barId) return;

      const id = parseInt(barId, 10);
      if (!Number.isFinite(id)) return;

      const { data, error } = await supabase
        .from('bars')
        .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at')
        .eq('id', id)
        .single();

      if (error || !data) return;

      const map = mapRef.current;
      if (map) map.flyTo({ center: [data.lng, data.lat], zoom: 15, essential: true });

      setSelectedBar(data as Bar);
      setCandidate(null);
      setPriceInput('');
      setStatus('');
      await loadHistory(id);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validatePrice(p: number) {
    return Number.isFinite(p) && p >= 10 && p <= 150;
  }

  async function ensureBarForCandidate(c: CandidatePlace): Promise<Bar | null> {
    const payload: any = {
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      source: 'maptiler',
      source_id: c.source_id ?? `fallback-${c.name}-${c.lat.toFixed(6)}-${c.lng.toFixed(6)}`,
    };

    const { data, error } = await supabase
      .from('bars')
      .upsert(payload, { onConflict: 'source,source_id' })
      .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at')
      .single();

    if (error) {
      setStatus(`Fel: ${error.message}`);
      return null;
    }
    return data as Bar;
  }

  // Save price for a candidate POI (new bar)
  async function savePriceForCandidate() {
    if (!candidate) return;

    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p < 10 || p > 150) return setStatus('Pris måste vara 10-150 kr.');

    setStatus('Sparar...');

    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: candidate.name,
        lat: candidate.lat,
        lng: candidate.lng,
        source_id: candidate.source_id,
        price_sek: p,
      }),
    });

    const j = await r.json();
    if (!j.ok) return setStatus(`Fel: ${j.error || 'okänt fel'}`);

    setStatus('Sparat.');
    setCandidate(null);
    setPriceInput('');

    await loadBarsAndPrices(); // gör att ✕ försvinner och pris-pill kommer (om den var ✕ innan)
  }

  // Save price for an existing bar
  async function savePriceForSelected() {
    if (!selectedBar) return;

    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p < 10 || p > 150) return setStatus('Pris måste vara 10-150 kr.');

    setStatus('Sparar...');

    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id, price_sek: p }),
    });
    const j = await r.json();
    if (!j.ok) return setStatus(`Fel: ${j.error || 'okänt fel'}`);

    setStatus('Sparat.');
    setPriceInput('');

    // Viktigt: detta gör att ✕ och pills uppdateras direkt
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  }

  // Report “no NA beer” for candidate
  async function reportNoNaForCandidate() {
    if (!candidate) return;
    setStatus('Sparar...');

    const r = await fetch('/api/no-na', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: candidate.name,
        lat: candidate.lat,
        lng: candidate.lng,
        source_id: candidate.source_id,
      }),
    });

    const j = await r.json();
    if (!j.ok) return setStatus(`Fel: ${j.error || 'okänt fel'}`);

    setStatus('Sparat.');
    setCandidate(null);
    setPriceInput('');

    await loadBarsAndPrices(); // viktigt för att ✕ ska renderas
  }

  // Report “no NA beer” for selected
  async function reportNoNaForSelected() {
    if (!selectedBar) return;
    setStatus('Sparar...');

    const r = await fetch('/api/no-na', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id }),
    });
    const j = await r.json();
    if (!j.ok) return setStatus(`Fel: ${j.error || 'okänt fel'}`);

    setStatus('Sparat.');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  }

  // Report wrong price: delete latest price, limited to 1/hr per bar (MVP: localStorage)
  async function reportWrongPrice() {
    if (!selectedBar) return;

    setStatus('Tar bort pris...');

    const r = await fetch('/api/report-wrong-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id }),
    });
    const j = await r.json();
    if (!j.ok) return setStatus(`Fel: ${j.error || 'okänt fel'}`);

    setStatus('Tack, borttagen.');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  } 

  async function shareSelected() {
    if (!selectedBar) return;

    const u = new URL(window.location.href);
    u.searchParams.set('bar', String(selectedBar.id));
    const url = u.toString();

    try {
      if ((navigator as any).share) {
        await (navigator as any).share({ title: selectedBar.name, text: 'Kolla priset här:', url });
        setStatus('Delat.');
        return;
      }
    } catch {
      // ignore
    }

    try {
      await navigator.clipboard.writeText(url);
      setStatus('Länk kopierad.');
    } catch {
      setStatus('Kunde inte kopiera länk.');
    }
  }

  const handlePriceKey = (ev: React.KeyboardEvent<HTMLInputElement>, mode: 'candidate' | 'selected') => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      resetPanel();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (mode === 'candidate') savePriceForCandidate();
      else savePriceForSelected();
    }
  };

  // Legend (removed “saknar pris”)
  const legend = (
    <div style={{ position: 'absolute', left: 12, top: 12, zIndex: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <span style={ui.chip('#16A34A', '#065F46')}>≤ 35 kr</span>
      <span style={ui.chip('#F59E0B', '#92400E')}>36-45 kr</span>
      <span style={ui.chip('#DC2626', '#7F1D1D')}>≥ 46 kr</span>
      <span style={ui.chip('#111827', '#111827')}>✕ saknas</span>
    </div>
  );

  const isExpanded = Boolean(candidate || selectedBar);

  const panelContent = (() => {
    if (candidate) {
      return (
        <>
          <div style={ui.label}>Ange pris</div>
          <div style={{ marginTop: 6, fontWeight: 900, color: '#111827' }}>{candidate.name}</div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <input
              inputMode="numeric"
              placeholder="Pris (kr)"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onKeyDown={(e) => handlePriceKey(e, 'candidate')}
              style={ui.input}
              autoFocus
            />
            <button onClick={savePriceForCandidate} style={ui.btn}>
              Spara
            </button>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={reportNoNaForCandidate} style={ui.btnGhost}>
              Saknar alkoholfri öl
            </button>
          </div>

          <div style={{ marginTop: 8, ...ui.muted }}>Enter sparar, Esc stänger. Pris måste vara 10-150 kr.</div>
          <div style={{ marginTop: 6, ...ui.muted }}>Källa: användarrapporterat. Kan vara fel.</div>
        </>
      );
    }

    if (selectedBar) {
      const lp = latestPriceForSelected;
      const lastUpdated = lp?.created_at ?? selectedBar.no_na_reported_at ?? null;
      const lastText = lastUpdated ? `${relTimeSv(lastUpdated)} (${formatDateSv(lastUpdated)})` : '';

      return (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 900, color: '#111827' }}>{selectedBar.name}</div>
              {lastText ? <div style={{ marginTop: 4, ...ui.muted }}>Senast uppdaterad: {lastText}</div> : null}
              <div style={{ marginTop: 4, ...ui.muted }}>Källa: användarrapporterat. Kan vara fel.</div>
            </div>
            <button onClick={shareSelected} style={ui.btnGhost}>
              Tipsa
            </button>
          </div>

          <div style={ui.hr} />

          <div style={ui.label}>{selectedBar.no_na_beer ? 'Markerad som “saknar alkoholfri öl”' : 'Uppdatera pris'}</div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <input
              inputMode="numeric"
              placeholder="Pris (kr)"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onKeyDown={(e) => handlePriceKey(e, 'selected')}
              style={ui.input}
              autoFocus
            />
            <button onClick={savePriceForSelected} style={ui.btn}>
              Spara
            </button>
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!selectedBar.no_na_beer ? (
              <button onClick={reportNoNaForSelected} style={ui.btnGhost}>
                Saknar alkoholfri öl
              </button>
            ) : null}

            {lp ? (
              <button onClick={reportWrongPrice} style={ui.btnGhost}>
                Rapportera fel pris
              </button>
            ) : null}
          </div>

          <div style={{ marginTop: 8, ...ui.muted }}>Enter sparar, Esc stänger. Pris måste vara 10-150 kr.</div>

          {history.length ? (
            <>
              <div style={ui.hr} />
              <div style={ui.label}>Senaste priser</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {history.map((h, i) => (
                  <div
                    key={`${h.created_at}-${i}`}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 10, ...ui.muted }}
                  >
                    <span style={{ fontWeight: i === 0 ? 900 : 700, color: '#111827' }}>{h.price_sek} kr</span>
                    <span>{formatDateSv(h.created_at)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      );
    }

    return null;
  })();

  // Welcome modal shows every visit (no localStorage)
  const WelcomeModal = () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        pointerEvents: 'auto',
      }}
      onClick={() => setShowWelcome(false)}
    >
      <div style={ui.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 1000, color: '#111827' }}>Välkommen!</div>
        <div style={{ marginTop: 10, color: '#111827', fontWeight: 800 }}>
          Här ser du vad alkoholfri öl kostar på barer och restauranger i Sverige.
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontWeight: 1000 }}>1.</span>
            <span style={{ color: '#111827', fontWeight: 800 }}>Tryck på en plats i kartan</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontWeight: 1000 }}>2.</span>
            <span style={{ color: '#111827', fontWeight: 800 }}>Fyll i priset (10-150 kr)</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontWeight: 1000 }}>3.</span>
            <span style={{ color: '#111827', fontWeight: 800 }}>
              Ser du <b>✕</b> betyder det “saknar alkoholfri öl”
            </span>
          </div>
          <div style={{ marginTop: 4, ...ui.muted }}>Källa: användarrapporterat. Kan vara fel.</div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={() => setShowWelcome(false)} style={ui.btn}>
            Ok, jag fattar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100dvh', width: '100%', position: 'relative' }}>
      <div id="map" style={{ height: '100%', width: '100%' }} />

      {legend}

      {/* Min plats ikon under zoomkontroller (top-right) */}
      <div style={{ position: 'absolute', right: 12, top: 140, zIndex: 30 }}>
        <button onClick={centerOnMe} style={ui.iconBtn} aria-label="Min plats" title="Min plats">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#111827" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="6" stroke="#111827" strokeWidth="2" />
            <circle cx="12" cy="12" r="1.5" fill="#111827" />
          </svg>
        </button>
      </div>

      {/* Bottom panel: only show when expanded (no default "click a place" panel) */}
      {isExpanded ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            maxWidth: 560,
            margin: '0 auto',
            zIndex: 10,
          }}
        >
          <div style={ui.panel}>
            {panelContent}
            {status ? <div style={{ marginTop: 10, ...ui.muted }}>{status}</div> : null}
          </div>
        </div>
      ) : null}

      {showWelcome ? <WelcomeModal /> : null}
    </div>
  );
}