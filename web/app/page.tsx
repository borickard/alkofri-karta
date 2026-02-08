'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { Map as MLMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { createClient } from '@supabase/supabase-js';
import styles from './page.module.css';

type Bar = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  source: string | null;
  source_id: string | null;
  no_na_beer: boolean | null;
  no_na_reported_at: string | null;
};

type LatestPrice = {
  bar_id: number;
  price_sek: number;
  created_at: string;
};

type Candidate = {
  name: string;
  lat: number;
  lng: number;
  source_id: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRICE_TEXT_ZOOM = 15;

function fmtShort(iso: string) {
  try {
    return new Date(iso).toLocaleString('sv-SE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function priceBucket(price: number) {
  if (price <= 35) return 'low';
  if (price <= 45) return 'mid';
  return 'high';
}

function colorsForPrice(price: number) {
  const b = priceBucket(price);
  if (b === 'low') return { bg: '#D1FAE5', border: '#065F46' };
  if (b === 'mid') return { bg: '#FEF3C7', border: '#92400E' };
  return { bg: '#FEE2E2', border: '#991B1B' };
}

function pickCandidateFromClick(map: MLMap, e: MapMouseEvent): Candidate | null {
  // Query features under cursor – MapTiler basemap har POI/features, men id-fält varierar.
  const feats = map.queryRenderedFeatures(e.point);
  if (!feats || feats.length === 0) return null;

  // Försök hitta något med namn
  const f = feats.find((x: any) => (x?.properties?.name || x?.properties?.Name)) || feats[0];
  const name = String(f?.properties?.name || f?.properties?.Name || 'Plats').trim();

  // stabilt-ish id: använd feature.id om den finns, annars en hash-ish från layer+name+coords
  const fid = f?.id !== undefined && f?.id !== null ? String(f.id) : `${f?.layer?.id || 'layer'}:${name}`;
  const source_id = `mt:${fid}`;

  const lng = e.lngLat.lng;
  const lat = e.lngLat.lat;

  return { name, lat, lng, source_id };
}

export default function Page() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);

  const zoomRef = useRef<number>(12);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState<Map<number, LatestPrice>>(new Map());

  const barsRef = useRef<Bar[]>([]);
  const latestPricesRef = useRef<Map<number, LatestPrice>>(new Map());
  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { latestPricesRef.current = latestPrices; }, [latestPrices]);
  


  const [welcomeOpen, setWelcomeOpen] = useState(true);

  const [selectedBarId, setSelectedBarId] = useState<number | null>(null);
  const selectedBar = useMemo(() => (selectedBarId ? bars.find(b => b.id === selectedBarId) ?? null : null), [bars, selectedBarId]);

  const [candidate, setCandidate] = useState<Candidate | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState<LatestPrice[]>([]);

  async function loadBarsAndPrices() {
    const { data: barsData, error: barsErr } = await supabase
      .from('bars')
      .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at')
      .order('id', { ascending: true });

    if (barsErr) throw barsErr;

    const barsRows: Bar[] = (barsData ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      source: r.source ?? null,
      source_id: r.source_id ?? null,
      no_na_beer: r.no_na_beer ?? false,
      no_na_reported_at: r.no_na_reported_at ?? null,
    }));

    const { data: pricesData, error: pricesErr } = await supabase
      .from('prices')
      .select('id,bar_id,price_sek,created_at,deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (pricesErr) throw pricesErr;

    const latest = new Map<number, LatestPrice>();
    for (const p of (pricesData ?? []) as any[]) {
      const bar_id = Number(p.bar_id);
      if (!latest.has(bar_id)) {
        latest.set(bar_id, { bar_id, price_sek: Number(p.price_sek), created_at: String(p.created_at) });
      }
    }

    setBars(barsRows);
    setLatestPrices(latest);

    renderMarkers(barsRows, latest);
  }

  async function loadHistory(barId: number) {
    const { data, error } = await supabase
      .from('prices')
      .select('id,bar_id,price_sek,created_at,deleted_at')
      .eq('bar_id', barId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    const rows = (data ?? []).map((r: any) => ({
      bar_id: Number(r.bar_id),
      price_sek: Number(r.price_sek),
      created_at: String(r.created_at),
    })) as LatestPrice[];

    setHistory(rows);
  }

  function clearMarkers() {
    for (const m of markersRef.current.values()) m.remove();
    markersRef.current.clear();
  }

  function renderMarkers(allBars: Bar[], pricesMap: Map<number, LatestPrice>) {
    const map = mapRef.current;
    if (!map) return;

    clearMarkers();

    const showText = (zoomRef.current ?? map.getZoom()) >= PRICE_TEXT_ZOOM;

    function makePin(bg: string, border: string) {
      const pin = document.createElement('div');
      pin.style.display = 'flex';
      pin.style.flexDirection = 'column';
      pin.style.alignItems = 'center';
      pin.style.pointerEvents = 'auto';

      const head = document.createElement('div');
      head.style.width = '14px';
      head.style.height = '14px';
      head.style.borderRadius = '999px';
      head.style.background = bg;
      head.style.border = `2px solid ${border}`;
      head.style.boxShadow = '1px 1px 0 #111827';

      const tip = document.createElement('div');
      tip.style.width = '0';
      tip.style.height = '0';
      tip.style.borderLeft = '6px solid transparent';
      tip.style.borderRight = '6px solid transparent';
      tip.style.borderTop = `8px solid ${border}`;
      tip.style.marginTop = '-2px';
      tip.style.filter = 'drop-shadow(1px 1px 0 #111827)';

      pin.appendChild(head);
      pin.appendChild(tip);

      return pin;
    }


    for (const b of allBars) {
      const lp = pricesMap.get(b.id);
      const noNa = Boolean(b.no_na_beer);

      if (!lp && !noNa) continue;

      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      wrap.style.userSelect = 'none';

      const name = document.createElement('div');
      name.textContent = b.name;
      name.style.fontWeight = '900';
      name.style.fontSize = '12px';
      name.style.color = '#111827';
      name.style.padding = '4px 8px';
      name.style.border = '2px solid #111827';
      name.style.boxShadow = '1px 1px 0 #111827';
      name.style.borderRadius = '999px';
      name.style.background = '#FFFFFF';
      name.style.display = 'none';

      const pill = document.createElement('div');
      pill.style.borderRadius = '999px';
      pill.style.border = '2px solid #111827';
      pill.style.boxShadow = '1px 1px 0 #111827';
      pill.style.cursor = 'pointer';

      if (noNa) {
        const showNoNaText = (zoomRef.current ?? map.getZoom()) >= PRICE_TEXT_ZOOM;

        pill.style.background = '#F9FAFB'; // extra ljus grå
        pill.style.color = '#111827';
        pill.style.border = '2px solid #000';
        pill.style.fontWeight = '900';
        pill.style.lineHeight = '1';
        pill.style.display = 'inline-flex';
        pill.style.alignItems = 'center';
        pill.style.justifyContent = 'center';

        if (showNoNaText) {
          pill.textContent = '✕';
          pill.style.padding = '4px 6px';
          pill.style.minWidth = 'unset';
          pill.style.width = 'auto';
          pill.style.height = 'auto';
        } else {
          // utzoomad: pin, inget kryss
          const pin = makePin('#F9FAFB', '#000');
          wrap.appendChild(name);
          wrap.appendChild(pin);
          // hoppa över wrap.appendChild(pill) längst ner
          // så vi behöver "continue" här:
          const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
            .setLngLat([b.lng, b.lat])
            .addTo(map);

          markersRef.current.set(b.id, marker);
          continue;
        }
      } else if (lp) {
        const price = lp.price_sek;
        const c = colorsForPrice(price);

        pill.style.background = c.bg;
        pill.style.border = `2px solid ${c.border}`;
        pill.style.color = '#111827';
        pill.style.fontWeight = '1000';
        pill.style.display = 'inline-flex';
        pill.style.alignItems = 'center';
        pill.style.justifyContent = 'center';
        pill.style.lineHeight = '1';

        if (showText) {
          pill.textContent = `${price} kr`;
          pill.style.padding = '0 12px';
          pill.style.minWidth = '54px';
          pill.style.height = '30px';
        } else {
          // utzoomad: pin (inte pill)
          const pin = makePin(c.bg, c.border);
          wrap.appendChild(name);
          wrap.appendChild(pin);

          const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
            .setLngLat([b.lng, b.lat])
            .addTo(map);

          markersRef.current.set(b.id, marker);
          continue;
        }
      }

      // show name on hover (desktop)
      wrap.addEventListener('mouseenter', () => { name.style.display = 'block'; });
      wrap.addEventListener('mouseleave', () => { name.style.display = 'none'; });

      // tap shows name briefly (mobile)
      wrap.addEventListener('touchstart', () => {
        name.style.display = 'block';
        setTimeout(() => { name.style.display = 'none'; }, 1500);
      }, { passive: true });

      // click marker opens panel for that bar
      wrap.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setCandidate(null);
        setSelectedBarId(b.id);
        setPanelOpen(true);
        setStatus('');
        setPriceInput('');
        loadHistory(b.id).catch(console.error);
      });

      wrap.appendChild(name);
      wrap.appendChild(pill);

      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
        .setLngLat([b.lng, b.lat])
        .addTo(map);

      markersRef.current.set(b.id, marker);
    }
  }

  async function locateMe() {
    const map = mapRef.current;
    if (!map) return;

    if (!navigator.geolocation) {
      setStatus('Geolocation stöds inte i denna webbläsare.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 14) });
      },
      () => setStatus('Kunde inte hämta din position.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async function savePriceSelected() {
    if (!selectedBar) return;

    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p < 10 || p > 150) {
      setStatus('Pris måste vara 10-150 kr.');
      return;
    }

    setStatus('Sparar...');
    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id, price_sek: p }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }

    setStatus('Sparat.');
    setPriceInput('');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  }

  async function savePriceCandidate() {
    if (!candidate) return;

    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p < 10 || p > 150) {
      setStatus('Pris måste vara 10-150 kr.');
      return;
    }

    setStatus('Sparar...');
    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...candidate, price_sek: p }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }

    setStatus('Sparat.');
    setPriceInput('');
    setCandidate(null);
    await loadBarsAndPrices();
  }

  async function reportNoNaSelected() {
    if (!selectedBar) return;
    setStatus('Sparar...');

    const r = await fetch('/api/no-na', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }

    setStatus('Sparat.');
    setPriceInput('');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  }

  async function reportNoNaCandidate() {
    if (!candidate) return;
    setStatus('Sparar...');

    const r = await fetch('/api/no-na', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(candidate),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }

    setStatus('Sparat.');
    setPriceInput('');
    setCandidate(null);
    await loadBarsAndPrices();
  }

  async function reportWrongPrice() {
    if (!selectedBar) return;
    setStatus('Tar bort pris...');

    const r = await fetch('/api/report-wrong-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }

    setStatus('Borttagen.');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  }

  function closePanel() {
    setPanelOpen(false);
    setSelectedBarId(null);
    setCandidate(null);
    setStatus('');
    setHistory([]);
    setPriceInput('');
  }

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (selectedBar) savePriceSelected();
      else if (candidate) savePriceCandidate();
    }
    if (e.key === 'Escape') {
      closePanel();
    }
  }


  useEffect(() => {
    if (!panelOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen]);


  // MAP init
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
      center: [18.0649, 59.3326],
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    mapRef.current = map;

    const onZoom = () => {
      zoomRef.current = map.getZoom();
      renderMarkers(barsRef.current, latestPricesRef.current);
    };

    const onClick = (e: MapMouseEvent) => {
      const cand = pickCandidateFromClick(map, e);

      // Klick på "tom karta" => stäng panelen och avmarkera
      if (!cand) {
        closePanel();
        return;
      }

      setSelectedBarId(null);
      setCandidate(cand);
      setPanelOpen(true);
      setStatus('');
      setHistory([]);
      setPriceInput('');
    };

    map.on('zoom', onZoom);
    map.on('load', onZoom);
    map.on('click', onClick);

    (async () => {
      try {
        await loadBarsAndPrices();
      } catch (err: any) {
        console.error(err);
        setStatus(err?.message || 'Kunde inte ladda data.');
      }
    })();

    return () => {
      map.off('zoom', onZoom);
      map.off('load', onZoom);
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.app}>
      <div className={styles.mapWrap}>
        <div ref={mapContainerRef} className={styles.map} />
      </div>

      {/* Locate me */}
      <button className={styles.locateBtn} onClick={locateMe} aria-label="Hitta min plats" title="Hitta min plats">
        ⦿
      </button>

      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#D1FAE5', borderColor: '#065F46' }} />
          <span className={styles.legendText}>Billigt (≤35)</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#FEF3C7', borderColor: '#92400E' }} />
          <span className={styles.legendText}>Medel (36-45)</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#FEE2E2', borderColor: '#991B1B' }} />
          <span className={styles.legendText}>Högt (46+)</span>
        </div>
      </div>

      {/* Panel */}
      {panelOpen ? (
        <div className={styles.panel}>
          <div className={styles.panelTitleRow}>
            <div>
              <div className={styles.panelTitle}>
                {selectedBar ? selectedBar.name : candidate ? candidate.name : 'Plats'}
              </div>
              <div className={styles.panelSub}>
                {selectedBar ? 'Uppdatera pris eller markera saknas' : 'Lägg till pris eller markera saknas'}
              </div>
            </div>
            <button className={styles.btn} onClick={closePanel}>Stäng</button>
          </div>

          {status ? <div className={styles.status}>{status}</div> : null}

          <div className={styles.fieldRow}>
            <input
              className={styles.input}
              inputMode="numeric"
              placeholder="Pris (10-150)"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onKeyDown={onPanelKeyDown}
            />
            <div className={styles.btnRow}>
              <button
                className={`${styles.btn} ${styles.btnDark}`}
                onClick={() => (selectedBar ? savePriceSelected() : savePriceCandidate())}
              >
                Spara pris
              </button>
              <button
                className={styles.btn}
                onClick={() => (selectedBar ? reportNoNaSelected() : reportNoNaCandidate())}
              >
                Saknar alkoholfri öl
              </button>
              {selectedBar ? (
                <button className={`${styles.btn} ${styles.btnDanger}`} onClick={reportWrongPrice}>
                  Rapportera fel pris
                </button>
              ) : null}
            </div>
          </div>

          {selectedBar && history.length ? (
            <div className={styles.history}>
              <div className={styles.hint}>Senaste 5 priser</div>
              {history.map((h, idx) => (
                <div key={`${h.created_at}-${idx}`} className={styles.historyItem}>
                  <div className={styles.historyLeft}>{h.price_sek} kr</div>
                  <div className={styles.historyRight}>{fmtShort(h.created_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.hint}>
              Tips: Enter sparar pris. Escape stänger.
            </div>
          )}
        </div>
      ) : null}

      {/* Welcome overlay (visas varje gång) */}
      {welcomeOpen ? (
        <div className={styles.welcomeOverlay} onClick={() => setWelcomeOpen(false)}>
          <div className={styles.welcomeCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.welcomeTitle}>Välkommen</div>
            <div className={styles.welcomeText}>
              Här hittar du vad alkoholfri öl kostar på barer och restauranger i Sverige.
              Klicka på en plats i kartan för att lägga till eller uppdatera ett pris.
              Om alkoholfri öl saknas kan du markera det också.
            </div>
            <div className={styles.btnRow}>
              <button className={`${styles.btn} ${styles.btnDark}`} onClick={() => setWelcomeOpen(false)}>
                Okej
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}