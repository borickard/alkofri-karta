'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
  venue_type: string | null;
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
  venue_type: VenueType;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRICE_TEXT_ZOOM = 13;

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

type PriceTier = 'green' | 'yellow' | 'red';
type VenueType = 'bar' | 'food' | 'hotel' | 'other';

function priceTierOf(price: number): PriceTier {
  if (price <= 35) return 'green';
  if (price <= 45) return 'yellow';
  return 'red';
}

function classifyByName(name: string): VenueType {
  const n = name.toLowerCase();
  if (/hotell|hotel\b|hostel|vandrarhem|motel/.test(n)) return 'hotel';
  if (/\bbar\b|\bpub\b|\bkrog\b|nattklubb|nightclub|\bklubb\b|\blounge\b|bryggeri|brewery|taproom/.test(n)) return 'bar';
  if (/restaurang|restaurant|bistro|brasserie|matsal|\bgrill\b|pizzeria|sushi|\bcafé\b|\bcafe\b|\bkaffe\b|coffee|konditori|bageri|bakery/.test(n)) return 'food';
  return 'other';
}

function classifyVenueType(bar: Bar): VenueType {
  if (bar.venue_type) return bar.venue_type as VenueType;
  return classifyByName(bar.name ?? '');
}

function deriveVenueType(
  amenity: string, tourism: string, leisure: string,
  subclass: string, entertainment: string,
): VenueType {
  if (['hotel', 'hostel', 'motel', 'guest_house'].some(v => tourism === v || subclass === v)) return 'hotel';
  if (['restaurant', 'cafe', 'fast_food'].some(v => amenity === v || subclass === v)) return 'food';
  if (['bar', 'pub', 'nightclub'].some(v => amenity === v || subclass === v) ||
      ['music_venue', 'dance'].some(v => leisure === v || subclass === v) ||
      ['nightclub', 'music_venue', 'concert_hall', 'event_venue'].some(v => entertainment === v)) return 'bar';
  return 'other';
}

function applyFilters(
  allBars: Bar[],
  pricesMap: Map<number, LatestPrice>,
  colors: Set<PriceTier>,
  types: Set<VenueType>,
): Bar[] {
  return allBars.filter(b => {
    if (!types.has(classifyVenueType(b))) return false;
    const lp = pricesMap.get(b.id);
    if (lp && !colors.has(priceTierOf(lp.price_sek))) return false;
    return true;
  });
}

function pickCandidateFromClick(map: MLMap, e: MapMouseEvent): Candidate | null {
  const feats = map.queryRenderedFeatures(e.point);
  if (!feats || feats.length === 0) return null;

  type FeatureLike = {
    id?: string | number | null;
    layer?: { id?: string };
    properties?: Record<string, unknown> | null;
  };

  const get = (p: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) {
      const v = p[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    }
    return '';
  };

  const lower = (s: string) => (s || '').toString().trim().toLowerCase();

  const ALLOWED_AMENITY = new Set([
    'bar', 'pub', 'restaurant', 'cafe', 'nightclub',
    'theatre', 'cinema', 'arts_centre', 'fast_food',
  ]);

  const ALLOWED_LEISURE = new Set(['music_venue', 'dance']);
  const ALLOWED_TOURISM = new Set(['hotel', 'hostel', 'motel', 'guest_house']);
  const ALLOWED_SHOPS = new Set<string>([]);

  const DISALLOWED_SHOPS = new Set([
    'clothes', 'fashion', 'shoes', 'jewelry',
    'department_store', 'bag', 'boutique',
  ]);

  const ALLOWED_SUBCLASS = new Set([
    'nightclub', 'music_venue', 'concert_hall', 'event_venue',
    'arts_centre', 'theatre', 'hotel', 'hostel', 'guest_house',
    'bar', 'pub', 'restaurant', 'cafe',
  ]);

  for (const f of feats as unknown as FeatureLike[]) {
    const props: Record<string, unknown> = f?.properties ?? {};
    const name = get(props, 'name', 'Name');
    if (!name) continue;

    const clazz = lower(get(props, 'class', 'category'));
    const subclass = lower(get(props, 'subclass'));
    const amenity = lower(get(props, 'amenity'));
    const shop = lower(get(props, 'shop'));
    const tourism = lower(get(props, 'tourism'));
    const leisure = lower(get(props, 'leisure'));
    const entertainment = lower(get(props, 'entertainment'));

    if (shop && DISALLOWED_SHOPS.has(shop)) continue;

    const isAmenityOk =
      (amenity && ALLOWED_AMENITY.has(amenity)) ||
      (clazz === 'amenity' && subclass && (ALLOWED_AMENITY.has(subclass) || ALLOWED_SUBCLASS.has(subclass))) ||
      (subclass && ALLOWED_AMENITY.has(subclass));

    const isTourismOk =
      (tourism && ALLOWED_TOURISM.has(tourism)) ||
      (clazz === 'tourism' && subclass && (ALLOWED_TOURISM.has(subclass) || ALLOWED_SUBCLASS.has(subclass))) ||
      (subclass && ALLOWED_TOURISM.has(subclass));

    const isShopOk =
      (shop && ALLOWED_SHOPS.has(shop)) ||
      (clazz === 'shop' && shop && ALLOWED_SHOPS.has(shop));

    const isLeisureOk =
      (leisure && ALLOWED_LEISURE.has(leisure)) ||
      (clazz === 'leisure' && subclass && ALLOWED_SUBCLASS.has(subclass)) ||
      (subclass && ALLOWED_SUBCLASS.has(subclass));

    const isEntertainmentOk =
      (entertainment && ALLOWED_SUBCLASS.has(entertainment)) ||
      (clazz === 'entertainment' && subclass && ALLOWED_SUBCLASS.has(subclass));

    if (!isAmenityOk && !isTourismOk && !isShopOk && !isLeisureOk && !isEntertainmentOk) continue;

    const fid =
      f?.id !== undefined && f?.id !== null
        ? String(f.id)
        : `${f?.layer?.id || 'layer'}:${String(name).trim()}`;

    return {
      name: String(name).trim(),
      lat: e.lngLat.lat,
      lng: e.lngLat.lng,
      source_id: `mt:${fid}`,
      venue_type: deriveVenueType(amenity, tourism, leisure, subclass, entertainment),
    };
  }

  return null;
}

export default function Page() {

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);

  const zoomRef = useRef<number>(12);
  const [zoomLevel, setZoomLevel] = useState(12);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());

  const searchParams = useSearchParams();
  const isDemoMode = searchParams.has('demo');

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState<Map<number, LatestPrice>>(new Map());

  const panelRef = useRef<HTMLDivElement | null>(null);

  const barsRef = useRef<Bar[]>([]);
  const latestPricesRef = useRef<Map<number, LatestPrice>>(new Map());
  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { latestPricesRef.current = latestPrices; }, [latestPrices]);

  const [welcomeOpen, setWelcomeOpen] = useState(!searchParams.has('bar'));
  const [selectedBarId, setSelectedBarId] = useState<number | null>(null);
  const selectedBar = useMemo(() => (selectedBarId ? bars.find(b => b.id === selectedBarId) ?? null : null), [bars, selectedBarId]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState<LatestPrice[]>([]);
  const [priceView, setPriceView] = useState<'confirm' | 'edit'>('confirm');

  const [activeColors, setActiveColors] = useState<Set<PriceTier>>(() => new Set(['green', 'yellow', 'red']));
  const [activeTypes, setActiveTypes] = useState<Set<VenueType>>(() => new Set(['bar', 'food', 'hotel', 'other']));
  const activeColorsRef = useRef<Set<PriceTier>>(new Set(['green', 'yellow', 'red']));
  const activeTypesRef = useRef<Set<VenueType>>(new Set(['bar', 'food', 'hotel', 'other']));

  async function loadBarsAndPrices() {
    console.log('loadBarsAndPrices, isDemoMode =', isDemoMode);
    const barsTable = isDemoMode ? 'bars_demo' : 'bars';
    const pricesTable = isDemoMode ? 'prices_demo' : 'prices';
    console.log('använder tabeller:', barsTable, pricesTable);

    const { data: barsData, error: barsErr } = await supabase
      .from(barsTable)
      .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at,venue_type')
      .order('id', { ascending: true });

    console.log('barsData:', barsData?.length, barsErr);
    if (barsErr) throw barsErr;

    const barsRows: Bar[] = (barsData ?? []).map((r) => {
      const rr = r as {
        id: unknown;
        name: unknown;
        lat: unknown;
        lng: unknown;
        source?: unknown;
        source_id?: unknown;
        no_na_beer?: unknown;
        no_na_reported_at?: unknown;
        venue_type?: unknown;
      };

      return {
        id: Number(rr.id),
        name: String(rr.name),
        lat: Number(rr.lat),
        lng: Number(rr.lng),
        source: (rr.source as string | undefined) ?? null,
        source_id: (rr.source_id as string | undefined) ?? null,
        no_na_beer: (rr.no_na_beer as boolean | null | undefined) ?? false,
        no_na_reported_at: (rr.no_na_reported_at as string | null | undefined) ?? null,
        venue_type: (rr.venue_type as string | null | undefined) ?? null,
      };
    });

    const { data: pricesData, error: pricesErr } = await supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,created_at,deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (pricesErr) throw pricesErr;

    const latest = new Map<number, LatestPrice>();
    for (const p of pricesData ?? []) {
      const bar_id = Number((p as { bar_id: unknown }).bar_id);
      if (!latest.has(bar_id)) {
        latest.set(bar_id, {
          bar_id,
          price_sek: Number((p as { price_sek: unknown }).price_sek),
          created_at: String((p as { created_at: unknown }).created_at),
        });
      }
    }

    setBars(barsRows);
    setLatestPrices(latest);
    renderMarkers(applyFilters(barsRows, latest, activeColorsRef.current, activeTypesRef.current), latest);
    console.log('pricesData latest map size:', latest.size);
    return barsRows;
  }

  async function loadHistory(barId: number) {
    const pricesTable = isDemoMode ? 'prices_demo' : 'prices';
    const { data, error } = await supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,created_at,deleted_at')
      .eq('bar_id', barId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    setHistory(
      (data ?? []).map((r) => ({
        bar_id: Number((r as { bar_id: unknown }).bar_id),
        price_sek: Number((r as { price_sek: unknown }).price_sek),
        created_at: String((r as { created_at: unknown }).created_at),
      })),
    );
  }

  function clearMarkers() {
    for (const m of markersRef.current.values()) m.remove();
    markersRef.current.clear();
  }

  function renderMarkers(allBars: Bar[], pricesMap: Map<number, LatestPrice>) {
    const map = mapRef.current;
    if (!map) return;

    clearMarkers();

    function makeMarkerEl(text: string, bg: string, borderColor: string, small: boolean): HTMLElement {
      const el = document.createElement('div');
      el.style.display = 'inline-flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.borderRadius = '999px';
      el.style.background = bg;
      el.style.border = `1.5px solid ${borderColor}`;
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.18)';
      el.style.cursor = 'pointer';
      el.style.fontWeight = '700';
      el.style.lineHeight = '1';
      el.style.whiteSpace = 'nowrap';
      el.style.color = '#111827';
      el.style.fontFamily = 'var(--font-body)';
      el.style.fontSize = small ? '11px' : '13px';
      el.style.padding = small ? '3px 7px' : '4px 10px';
      el.textContent = text;
      return el;
    }

    function addListeners(el: HTMLElement, nameEl: HTMLElement, b: Bar) {
      el.addEventListener('mouseenter', () => {
        nameEl.style.display = 'block';
        el.style.zIndex = '999';
        const parent = el.closest('.maplibregl-marker') as HTMLElement | null;
        if (parent) parent.style.zIndex = '999';
      });
      el.addEventListener('mouseleave', () => {
        nameEl.style.display = 'none';
        el.style.zIndex = '';
        const parent = el.closest('.maplibregl-marker') as HTMLElement | null;
        if (parent) parent.style.zIndex = '';
      });
      el.addEventListener('touchstart', () => {
        nameEl.style.display = 'block';
        el.style.zIndex = '999';
        const parent = el.closest('.maplibregl-marker') as HTMLElement | null;
        if (parent) parent.style.zIndex = '999';
        setTimeout(() => {
          nameEl.style.display = 'none';
          el.style.zIndex = '';
          if (parent) parent.style.zIndex = '';
        }, 1500);
      }, { passive: true });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setCandidate(null);
        setSelectedBarId(b.id);
        setPanelOpen(true);
        setStatus('');
        setPriceInput('');
        setPriceView('confirm');
        window.history.replaceState(null, '', buildBarUrl(b.id));
        loadHistory(b.id).catch(console.error);
        focusPoint(b.lng, b.lat);
      });
    }

    for (const b of allBars) {
      const lp = pricesMap.get(b.id);
      const noNa = Boolean(b.no_na_beer);
      const small = (zoomRef.current ?? map.getZoom()) < PRICE_TEXT_ZOOM;

      if (!lp && !noNa) continue;
      if (noNa && small) continue;

      const wrap = document.createElement('div');
      wrap.style.pointerEvents = 'auto';
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      wrap.style.userSelect = 'none';

      const name = document.createElement('div');
      name.textContent = b.name;
      name.style.fontWeight = '600';
      name.style.fontSize = '12px';
      name.style.color = '#111827';
      name.style.padding = '3px 8px';
      name.style.border = '1px solid #d1d5db';
      name.style.boxShadow = '0 1px 3px rgba(0,0,0,0.10)';
      name.style.borderRadius = '999px';
      name.style.background = '#ffffff';
      name.style.display = 'none';
      name.style.whiteSpace = 'nowrap';

      let markerEl: HTMLElement;
      if (noNa) {
        markerEl = makeMarkerEl('✕', '#f9fafb', '#9ca3af', small);
      } else {
        const price = lp!.price_sek;
        const c = colorsForPrice(price);
        markerEl = makeMarkerEl(small ? `${price}` : `${price} kr`, c.bg, c.border, small);
      }

      addListeners(wrap, name, b);
      wrap.appendChild(name);
      wrap.appendChild(markerEl);

      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' })
        .setLngLat([b.lng, b.lat])
        .addTo(map);
      markersRef.current.set(b.id, marker);
    }
  }

  function reRenderWithFilters(colors: Set<PriceTier>, types: Set<VenueType>) {
    renderMarkers(applyFilters(barsRef.current, latestPricesRef.current, colors, types), latestPricesRef.current);
  }

  function toggleColor(tier: PriceTier) {
    const next = new Set(activeColors);
    if (next.has(tier)) next.delete(tier); else next.add(tier);
    activeColorsRef.current = next;
    setActiveColors(next);
    reRenderWithFilters(next, activeTypesRef.current);
  }

  function toggleType(vtype: VenueType) {
    const next = new Set(activeTypes);
    if (next.has(vtype)) next.delete(vtype); else next.add(vtype);
    activeTypesRef.current = next;
    setActiveTypes(next);
    reRenderWithFilters(activeColorsRef.current, next);
  }

  function focusPoint(lng: number, lat: number) {
    const map = mapRef.current;
    if (!map) return;
    const h = map.getContainer().clientHeight || 800;
    // Negative offset: bar appears above screen center, visible above the centered panel
    map.easeTo({ center: [lng, lat], offset: [0, -Math.round(h / 5)], duration: 350 });
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
    if (!Number.isFinite(p) || p < 10 || p > 150) { setStatus('Pris måste vara 10-150 kr.'); return; }
    setStatus('Sparar...');
    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id, price_sek: p, demo: isDemoMode }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }
    setStatus('Sparat.');
    setPriceInput('');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
    setPriceView('confirm');
  }

  async function savePriceCandidate() {
    if (!candidate) return;
    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p < 10 || p > 150) { setStatus('Pris måste vara 10-150 kr.'); return; }
    setStatus('Sparar...');
    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...candidate, price_sek: p, demo: isDemoMode }),
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
      body: JSON.stringify({ bar_id: selectedBar.id, demo: isDemoMode }),
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
      body: JSON.stringify({ ...candidate, demo: isDemoMode }),
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
      body: JSON.stringify({ bar_id: selectedBar.id, demo: isDemoMode }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }
    setStatus('Borttagen.');
    await loadBarsAndPrices();
    await loadHistory(selectedBar.id);
  }

  function buildBarUrl(barId: number | null) {
    const parts: string[] = [];
    if (isDemoMode) parts.push('demo');
    if (barId !== null) parts.push(`bar=${barId}`);
    return parts.length ? `?${parts.join('&')}` : window.location.pathname;
  }

  function closePanel() {
    window.history.replaceState(null, '', buildBarUrl(null));
    setPanelOpen(false);
    setSelectedBarId(null);
    setCandidate(null);
    setStatus('');
    setHistory([]);
    setPriceInput('');
    setPriceView('confirm');
  }

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (selectedBar) savePriceSelected();
      else if (candidate) savePriceCandidate();
    }
    if (e.key === 'Escape') closePanel();
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!panelOpen) {
      map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      return;
    }
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    if (selectedBar) focusPoint(selectedBar.lng, selectedBar.lat);
    else if (candidate) focusPoint(candidate.lng, candidate.lat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, selectedBarId, candidate?.source_id]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelOpen]);

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
    setZoomLevel(map.getZoom());

    const onZoom = () => {
      const z = map.getZoom();
      zoomRef.current = z;
      setZoomLevel(z);
      renderMarkers(applyFilters(barsRef.current, latestPricesRef.current, activeColorsRef.current, activeTypesRef.current), latestPricesRef.current);
    };

    const onClick = (e: MapMouseEvent) => {
      const cand = pickCandidateFromClick(map, e);
      if (!cand) { closePanel(); return; }
      setSelectedBarId(null);
      setCandidate(cand);
      setPanelOpen(true);
      setStatus('');
      setHistory([]);
      setPriceInput('');
      setPriceView('confirm');
      focusPoint(cand.lng, cand.lat);
    };

    map.on('zoom', onZoom);
    map.on('load', onZoom);
    map.on('click', onClick);

    // Some external MapTiler styles reference sprite images that may be missing.
    // This keeps dev console noise down by registering a 1x1 transparent placeholder.
    map.on('styleimagemissing', (e) => {
      const id = (e as { id?: unknown }).id;
      if (!id) return;
      const key = String(id).trim();
      if (!key) return;
      if (map.hasImage(key)) return;

      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 1, 1);
      const imgData = ctx.getImageData(0, 0, 1, 1);
      map.addImage(key, imgData, { pixelRatio: 1 });
    });

    (async () => {
      try {
        const loaded = await loadBarsAndPrices();
        const barIdParam = searchParams.get('bar');
        if (barIdParam) {
          const barId = Number(barIdParam);
          const bar = loaded?.find(b => b.id === barId);
          if (bar) {
            setSelectedBarId(bar.id);
            setPanelOpen(true);
            setPriceView('confirm');
            await loadHistory(bar.id);
            focusPoint(bar.lng, bar.lat);
          }
        }
      } catch (err: unknown) {
        console.error(err);
        setStatus(err instanceof Error ? err.message : 'Kunde inte ladda data.');
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
        <div className={styles.topLeftBrand}>
          <a href="https://www.iq.se" target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/iq_logotype.svg" alt="IQ" className={styles.iqLogo} />
          </a>
        </div>
        <div ref={mapContainerRef} className={styles.map} />
      </div>

      {isDemoMode && (
        <div style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          background: '#ffffff',
          border: '1px solid #d1d5db',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
          borderRadius: 4,
          padding: '0 10px 0 14px',
          fontWeight: 600,
          fontSize: 13,
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 36,
          whiteSpace: 'nowrap',
        }}>
          Demo-läge
          <button
            onClick={() => { window.location.href = '/'; }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af', padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}
            aria-label="Avsluta demo-läge"
            title="Avsluta demo-läge"
          >✕</button>
        </div>
      )}

      <button className={styles.locateBtn} onClick={locateMe} aria-label="Hitta min plats" title="Hitta min plats">
        ⌖
      </button>

      {process.env.NODE_ENV === 'development' && (
        <a href="/admin" className={styles.devBtn}>Admin</a>
      )}

      {/* Filter toolbar */}
      <div className={styles.filterBar}>
        {/* Row 1: price tier toggles */}
        <div className={styles.filterRow}>
          {([
            { tier: 'green' as PriceTier, bg: '#D1FAE5', border: '#065F46', label: '≤35' },
            { tier: 'yellow' as PriceTier, bg: '#FEF3C7', border: '#92400E', label: '36–45' },
            { tier: 'red' as PriceTier, bg: '#FEE2E2', border: '#991B1B', label: '46+' },
          ]).map(({ tier, bg, border, label }) => (
            <button
              key={tier}
              className={`${styles.filterBtn} ${!activeColors.has(tier) ? styles.filterBtnOff : ''}`}
              onClick={() => toggleColor(tier)}
              title={label}
            >
              <span className={styles.filterDot} style={{ background: bg, borderColor: border }} />
              {label}
            </button>
          ))}
        </div>

        <div className={styles.filterRowSep} />

        {/* Row 2: venue type toggles */}
        <div className={styles.filterRow}>
          {([
            { vtype: 'bar' as VenueType, icon: '🍺', label: 'Bar' },
            { vtype: 'food' as VenueType, icon: '🍴', label: 'Mat' },
            { vtype: 'hotel' as VenueType, icon: '🛏️', label: 'Hotell' },
            { vtype: 'other' as VenueType, icon: '🎭', label: 'Övrigt' },
          ]).map(({ vtype, icon, label }) => (
            <button
              key={vtype}
              className={`${styles.filterBtn} ${!activeTypes.has(vtype) ? styles.filterBtnOff : ''}`}
              onClick={() => toggleType(vtype)}
              title={label}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 30, display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <button
          className={styles.mapBtn}
          onClick={() => setWelcomeOpen(true)}
          aria-label="Om kartan"
          title="Om kartan"
        >?</button>
        {zoomLevel < PRICE_TEXT_ZOOM && (
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
        )}
      </div>

      {panelOpen ? (
        <div ref={panelRef} className={styles.panel}>
          {/* Title row */}
          <div className={styles.panelTitleRow}>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 22,
              lineHeight: 1.2,
              color: '#111827',
              flex: 1,
              minWidth: 0,
            }}>
              {selectedBar ? selectedBar.name : candidate?.name}
            </div>
            <button
              onClick={closePanel}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 20,
                lineHeight: 1,
                color: '#6B7280',
                padding: '0 4px',
                flexShrink: 0,
              }}
              aria-label="Stäng"
            >✕</button>
          </div>

          {status ? <div className={styles.status}>{status}</div> : null}

          {/* Price section */}
          {(() => {
            const lp = selectedBar ? latestPrices.get(selectedBar.id) : null;
            const hasPrice = !!lp;
            const isNoNa = selectedBar?.no_na_beer;

            if (isNoNa) {
              // Already marked as no NA beer — show state + allow price correction
              return (
                <>
                  <div style={{
                    background: '#FEF2F2',
                    border: '2px solid #FECACA',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14,
                    color: '#991B1B',
                    fontWeight: 700,
                  }}>
                    ✕ Alkoholfri öl uppges saknas här
                  </div>
                  <div className={styles.fieldRow}>
                    <input
                      className={styles.input}
                      inputMode="numeric"
                      placeholder="Pris (10–150 kr)"
                      value={priceInput}
                      onChange={(e) => setPriceInput(e.target.value)}
                      onKeyDown={onPanelKeyDown}
                    />
                    <button
                      className={`${styles.btn} ${styles.btnDark}`}
                      onClick={() => (selectedBar ? savePriceSelected() : savePriceCandidate())}
                    >
                      Lägg till pris
                    </button>
                  </div>
                </>
              );
            }

            if (hasPrice && priceView === 'confirm') {
              return (
                <>
                  <div style={{
                    background: '#f3f4f6',
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 5,
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-heading)',
                      fontSize: 30,
                      fontWeight: 700,
                      color: '#111827',
                      lineHeight: 1,
                    }}>{lp!.price_sek}</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#111827', fontWeight: 600 }}>kr</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9CA3AF', marginLeft: 'auto' }}>{fmtShort(lp!.created_at)}</span>
                  </div>
                  <button
                    className={styles.btn}
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => { setPriceView('edit'); setStatus(''); }}
                  >
                    Uppdatera pris
                  </button>
                </>
              );
            }

            // No price, or edit mode
            return (
              <>
                {!hasPrice && (
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#6B7280' }}>
                    Inga priser rapporterade än.
                  </div>
                )}
                <div className={styles.fieldRow}>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    placeholder="Pris (10–150 kr)"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    onKeyDown={onPanelKeyDown}
                  />
                  <button
                    className={`${styles.btn} ${styles.btnDark}`}
                    onClick={() => (selectedBar ? savePriceSelected() : savePriceCandidate())}
                  >
                    {hasPrice ? 'Spara nytt pris' : 'Lägg till pris'}
                  </button>
                  {hasPrice && (
                    <button
                      className={styles.btn}
                      onClick={() => { setPriceView('confirm'); setStatus(''); setPriceInput(''); }}
                    >
                      Avbryt
                    </button>
                  )}
                </div>
                {selectedBar && history.length > 0 && (
                  <div className={styles.history}>
                    <div className={styles.hint}>Senaste {history.length} priser</div>
                    {history.map((h, idx) => (
                      <div key={`${h.created_at}-${idx}`} className={styles.historyItem}>
                        <div className={styles.historyLeft}>{h.price_sek} kr</div>
                        <div className={styles.historyRight}>{fmtShort(h.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}

          {/* No NA beer button — only show if not already marked */}
          {!selectedBar?.no_na_beer && (
            <button
              className={styles.btn}
              onClick={() => (selectedBar ? reportNoNaSelected() : reportNoNaCandidate())}
              style={{ width: '100%', textAlign: 'left' }}
            >
              ✕ Alkoholfri öl saknas här
            </button>
          )}
        </div>
      ) : null}

      {welcomeOpen ? (
        <div className={styles.welcomeOverlay} onClick={() => setWelcomeOpen(false)}>
          <div
            className={styles.welcomeCard}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#242f55',
              color: '#fff',
              maxWidth: 480,
              padding: '40px 36px 32px',
              borderRadius: 16,
              border: '2px solid #111827',
              boxShadow: '4px 4px 0 #111827',
            }}
          >
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 'clamp(28px, 5vw, 40px)',
              lineHeight: 1.15,
              marginBottom: 16,
              color: '#fff',
            }}>
              Vad kostar alkoholfri öl?
            </div>

            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              lineHeight: 1.6,
              color: '#fff',
              marginBottom: 20,
            }}>
              En karta över priser på alkoholfri öl på barer och restauranger i Sverige.
              Datan samlas in av besökare som du.
            </div>

            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              lineHeight: 1.8,
              color: '#fff',
              marginBottom: 28,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              <div>→ Klicka på en plats för att se eller lägga till pris</div>
              <div>→ Saknar stället alkoholfri öl? Markera det</div>
              <div>→ Alla kan bidra – ju fler, desto bättre karta</div>
            </div>

            <button
              className={`${styles.btn} ${styles.btnDark}`}
              style={{
                background: '#fff',
                color: '#242f55',
                border: '2px solid #fff',
                fontWeight: 900,
                fontSize: 15,
                padding: '10px 24px',
                width: '100%',
                marginBottom: 28,
              }}
              onClick={() => setWelcomeOpen(false)}
            >
              Utforska kartan
            </button>

            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.3)',
              paddingTop: 20,
            }}>
              <a
                href="https://www.iq.se"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  textDecoration: 'none',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/iq_logotype_darkblueyellow.svg"
                  alt="IQ"
                  style={{ height: 28 }}
                />
                <span style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  color: '#fff',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}>
                  Ett initiativ av IQ
                </span>
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}