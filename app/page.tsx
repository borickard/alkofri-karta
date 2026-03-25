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
  opening_hours: string | null;
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
  opening_hours: string | null;
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

type Thresholds = { low: number; high: number };

function calcThresholds(prices: number[]): Thresholds {
  if (prices.length < 2) return { low: 35, high: 45 };
  const s = [...prices].sort((a, b) => a - b);
  return {
    low: s[Math.floor((s.length - 1) / 3)],
    high: s[Math.floor(2 * (s.length - 1) / 3)],
  };
}

function priceTierColor(price: number, t: Thresholds) {
  if (price <= t.low) return { bg: '#D1FAE5', border: '#6EE7B7' };
  if (price <= t.high) return { bg: '#FEF3C7', border: '#FCD34D' };
  return { bg: '#FEE2E2', border: '#FCA5A5' };
}

type PriceTier = 'green' | 'yellow' | 'red';
type VenueType = 'bar' | 'food' | 'hotel' | 'other';

function priceTierOf(price: number, t: Thresholds): PriceTier {
  if (price <= t.low) return 'green';
  if (price <= t.high) return 'yellow';
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
  t: Thresholds,
  openNow = false,
): Bar[] {
  return allBars.filter(b => {
    if (!types.has(classifyVenueType(b))) return false;
    const lp = pricesMap.get(b.id);
    if (lp && !colors.has(priceTierOf(lp.price_sek, t))) return false;
    if (openNow) {
      const status = getOpenStatus(b.opening_hours);
      if (!status || !status.open) return false;
    }
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

    const opening_hours_raw = props['opening_hours'] ?? props['opening_hours:signed'] ?? null;
    const opening_hours = opening_hours_raw ? String(opening_hours_raw).trim() : null;

    return {
      name: String(name).trim(),
      lat: e.lngLat.lat,
      lng: e.lngLat.lng,
      source_id: `mt:${fid}`,
      venue_type: deriveVenueType(amenity, tourism, leisure, subclass, entertainment),
      opening_hours,
    };
  }

  return null;
}

function ohToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function ohDayActive(days: string, todayJS: number): boolean {
  // todayJS: 0=Sun, 1=Mon, ..., 6=Sat
  const map: Record<string, number> = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0 };
  for (const part of days.split(',')) {
    const p = part.trim().toLowerCase();
    const range = p.match(/^([a-z]{2})-([a-z]{2})$/);
    if (range) {
      const a = map[range[1]] ?? -1;
      const b = map[range[2]] ?? -1;
      if (a === -1 || b === -1) continue;
      if (a <= b) { if (todayJS >= a && todayJS <= b) return true; }
      else { if (todayJS >= a || todayJS <= b) return true; }
    } else if (map[p] !== undefined) {
      if (map[p] === todayJS) return true;
    }
  }
  return false;
}

type OpenStatus =
  | { open: true }
  | { open: false; opensLaterToday: boolean; nextDay: number | null; nextTime: string | null }
  | null;

const SV_DAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];

function minToStr(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function getOpenStatus(oh: string | null | undefined): OpenStatus {
  if (!oh) return null;
  const s = oh.trim();
  if (s === '24/7') return { open: true };

  const now = new Date();
  const todayJS = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  type Rule = { days: string; times: { start: number; end: number }[] };
  const rules: Rule[] = [];
  for (const rule of s.split(';').map(r => r.trim()).filter(Boolean)) {
    const m = rule.match(/^([A-Za-z,\-]+)\s+(.+)$/);
    if (!m) continue;
    if (/\bPH\b/.test(m[1])) continue; // skip public holiday rules
    const times: { start: number; end: number }[] = [];
    for (const tr of m[2].split(',')) {
      const tm = tr.trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
      if (tm) times.push({ start: ohToMinutes(tm[1]), end: ohToMinutes(tm[2]) });
    }
    if (times.length) rules.push({ days: m[1], times });
  }
  if (!rules.length) return null;

  // Check if open now
  for (const rule of rules) {
    if (!ohDayActive(rule.days, todayJS)) continue;
    for (const { start, end } of rule.times) {
      if (end <= start ? (nowMin >= start || nowMin < end) : (nowMin >= start && nowMin < end)) {
        return { open: true };
      }
    }
  }

  // Find next opening slot within 7 days
  for (let daysAhead = 0; daysAhead <= 6; daysAhead++) {
    const dayJS = (todayJS + daysAhead) % 7;
    let earliest: number | null = null;
    for (const rule of rules) {
      if (!ohDayActive(rule.days, dayJS)) continue;
      for (const { start } of rule.times) {
        if (daysAhead === 0 && start <= nowMin) continue; // already passed today
        if (earliest === null || start < earliest) earliest = start;
      }
    }
    if (earliest !== null) {
      return {
        open: false,
        opensLaterToday: daysAhead === 0,
        nextDay: daysAhead === 0 ? null : dayJS,
        nextTime: minToStr(earliest),
      };
    }
  }

  return { open: false, opensLaterToday: false, nextDay: null, nextTime: null };
}

function isOpenNow(oh: string | null | undefined): boolean | null {
  const s = getOpenStatus(oh);
  if (s === null) return null;
  return s.open;
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
  const [omOpen, setOmOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [googleResults, setGoogleResults] = useState<{ google_place_id: string | null; name: string; address: string | null; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedBarId, setSelectedBarId] = useState<number | null>(null);
  const selectedBar = useMemo(() => (selectedBarId ? bars.find(b => b.id === selectedBarId) ?? null : null), [bars, selectedBarId]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState<LatestPrice[]>([]);
  const [priceView, setPriceView] = useState<'confirm' | 'edit'>('confirm');
  const [undoAction, setUndoAction] = useState<{ type: 'price'; price_id: number; bar_id: number } | { type: 'no_na'; bar_id: number } | null>(null);
  const [ohLoading, setOhLoading] = useState(false);
  const [ohChecked, setOhChecked] = useState(false);
  const [ohSourceName, setOhSourceName] = useState<string | null>(null);
  const [ohSource, setOhSource] = useState<'google' | 'osm' | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const [activeColors, setActiveColors] = useState<Set<PriceTier>>(() => {
    const param = searchParams.get('colors');
    if (!param) return new Set<PriceTier>(['green', 'yellow', 'red']);
    const all = new Set<PriceTier>(['green', 'yellow', 'red']);
    const parsed = param.split(',').filter((v): v is PriceTier => all.has(v as PriceTier));
    return parsed.length ? new Set(parsed) : new Set<PriceTier>(['green', 'yellow', 'red']);
  });
  const [activeTypes, setActiveTypes] = useState<Set<VenueType>>(() => new Set(['bar', 'food', 'hotel', 'other']));
  const activeColorsRef = useRef<Set<PriceTier>>(new Set(['green', 'yellow', 'red']));
  const activeTypesRef = useRef<Set<VenueType>>(new Set(['bar', 'food', 'hotel', 'other']));
  const [filterOpenNow, setFilterOpenNow] = useState(() => searchParams.has('open'));
  const [filterExpanded, setFilterExpanded] = useState(false);
  const filterOpenNowRef = useRef(searchParams.has('open'));
  const [thresholds, setThresholds] = useState<Thresholds>({ low: 35, high: 45 });
  const [visiblePriceCount, setVisiblePriceCount] = useState(0);
  const [tierRanges, setTierRanges] = useState<Record<PriceTier, { min: number; max: number } | null>>({ green: null, yellow: null, red: null });
  const thresholdsRef = useRef<Thresholds>({ low: 35, high: 45 });

  function fetchAddress(lat: number, lng: number) {
    setAddress(null);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
      headers: { 'Accept-Language': 'sv' },
    }).then(r => r.json()).then((data: { address?: { road?: string; house_number?: string } }) => {
      const road = data?.address?.road;
      const num = data?.address?.house_number;
      if (road) setAddress(num ? `${road} ${num}` : road);
    }).catch(() => {});
  }

  function fetchAndStoreOH(lat: number, lng: number, barId: number | null, name: string | null | undefined, onResult: (oh: string | null) => void) {
    setOhLoading(true);
    setOhChecked(false);
    fetch('/api/patch-bar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, ...(name ? { name } : {}), ...(barId ? { bar_id: barId, demo: isDemoMode } : {}) }),
    }).then(r => r.json()).then(data => {
      // Only mark as checked (and show "ej tillgängliga") when the request succeeded
      // — even if no opening_hours was found in OSM
      onResult(data.ok && data.opening_hours ? String(data.opening_hours) : null);
      setOhSourceName(data.osm_name ?? null);
      setOhSource(data.source ?? null);
      setOhChecked(true);
    }).catch(() => {
      // Network/timeout error — don't show "ej tillgängliga", just stop the spinner
    }).finally(() => {
      setOhLoading(false);
    });
  }

  async function loadBarsAndPrices() {
    console.log('loadBarsAndPrices, isDemoMode =', isDemoMode);
    const barsTable = isDemoMode ? 'bars_demo' : 'bars';
    const pricesTable = isDemoMode ? 'prices_demo' : 'prices';
    console.log('använder tabeller:', barsTable, pricesTable);

    const { data: barsData, error: barsErr } = await supabase
      .from(barsTable)
      .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at,venue_type,opening_hours')
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
        opening_hours?: unknown;
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
        opening_hours: (rr.opening_hours as string | null | undefined) ?? null,
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
    refreshMap(barsRows, latest);
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

  function renderMarkers(allBars: Bar[], pricesMap: Map<number, LatestPrice>, t: Thresholds) {
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
        setOhChecked(false);
        setOhLoading(false);
        setOhSourceName(null);
        setOhSource(null);
        setAddress(null);
        setCandidate(null);
        setUndoAction(null);
        setSelectedBarId(b.id);
        setPanelOpen(true);
        setStatus('');
        setPriceInput('');
        setPriceView('confirm');
        window.history.replaceState(null, '', buildBarUrl(b.id));
        loadHistory(b.id).catch(console.error);
        focusPoint(b.lng, b.lat);
        fetchAddress(b.lat, b.lng);

        if (!b.opening_hours) {
          fetchAndStoreOH(b.lat, b.lng, b.id, b.name, oh => {
            if (oh) setBars(prev => prev.map(bar => bar.id === b.id ? { ...bar, opening_hours: oh } : bar));
          });
        } else {
          setOhLoading(false);
          setOhChecked(true);
        }
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
        const c = priceTierColor(price, t);
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

  function refreshMap(
    bars = barsRef.current,
    prices = latestPricesRef.current,
    colors = activeColorsRef.current,
    types = activeTypesRef.current,
    openNow = filterOpenNowRef.current,
  ) {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    const cosLat = Math.cos(center.lat * Math.PI / 180);
    const RADIUS_M = 30_000;
    const visiblePrices: number[] = [];
    for (const b of bars) {
      const dlat = (b.lat - center.lat) * 111_000;
      const dlng = (b.lng - center.lng) * 111_000 * cosLat;
      if (dlat * dlat + dlng * dlng <= RADIUS_M * RADIUS_M) {
        const lp = prices.get(b.id);
        if (lp) visiblePrices.push(lp.price_sek);
      }
    }
    const t = calcThresholds(visiblePrices);
    thresholdsRef.current = t;
    setThresholds(t);
    setVisiblePriceCount(visiblePrices.length);
    const ranges: Record<PriceTier, { min: number; max: number } | null> = { green: null, yellow: null, red: null };
    for (const p of visiblePrices) {
      const tier = priceTierOf(p, t);
      const r = ranges[tier];
      ranges[tier] = r ? { min: Math.min(r.min, p), max: Math.max(r.max, p) } : { min: p, max: p };
    }
    setTierRanges(ranges);
    renderMarkers(applyFilters(bars, prices, colors, types, t, openNow), prices, t);
  }

  function toggleColor(tier: PriceTier) {
    const next = new Set(activeColors);
    if (next.has(tier)) next.delete(tier); else next.add(tier);
    activeColorsRef.current = next;
    setActiveColors(next);
    refreshMap(barsRef.current, latestPricesRef.current, next, activeTypesRef.current);
    window.history.replaceState(null, '', buildBarUrl(selectedBarId, next));
  }

  function toggleOpenNow() {
    const next = !filterOpenNowRef.current;
    filterOpenNowRef.current = next;
    setFilterOpenNow(next);
    refreshMap(barsRef.current, latestPricesRef.current, activeColorsRef.current, activeTypesRef.current, next);
    window.history.replaceState(null, '', buildBarUrl(selectedBarId, activeColorsRef.current, next));
  }

  function toggleType(vtype: VenueType) {
    const next = new Set(activeTypes);
    if (next.has(vtype)) next.delete(vtype); else next.add(vtype);
    activeTypesRef.current = next;
    setActiveTypes(next);
    refreshMap(barsRef.current, latestPricesRef.current, activeColorsRef.current, next);
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
    setStatus('');
    setPriceInput('');
    setUndoAction({ type: 'price', price_id: j.price.id, bar_id: selectedBar.id });
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
    setStatus('');
    setPriceInput('');
    await loadBarsAndPrices();
    if (j.bar_id) {
      setUndoAction({ type: 'price', price_id: j.price.id, bar_id: j.bar_id });
      setSelectedBarId(j.bar_id);
      window.history.replaceState(null, '', buildBarUrl(j.bar_id));
      await loadHistory(j.bar_id);
      setPriceView('confirm');
    }
    setCandidate(null);
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
    setStatus('');
    setPriceInput('');
    setUndoAction({ type: 'no_na', bar_id: selectedBar.id });
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
    setStatus('');
    setPriceInput('');
    await loadBarsAndPrices();
    if (j.bar_id) {
      setUndoAction({ type: 'no_na', bar_id: j.bar_id });
      setSelectedBarId(j.bar_id);
      window.history.replaceState(null, '', buildBarUrl(j.bar_id));
    }
    setCandidate(null);
  }

  async function undoLast() {
    if (!undoAction) return;
    setUndoAction(null);
    const endpoint = undoAction.type === 'price' ? '/api/undo-price' : '/api/undo-no-na';
    const body = undoAction.type === 'price'
      ? { price_id: undoAction.price_id, demo: isDemoMode }
      : { bar_id: undoAction.bar_id, demo: isDemoMode };
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Ångra misslyckades: ${j.error}`); return; }
    await loadBarsAndPrices();
    const barId = undoAction.bar_id;
    await loadHistory(barId);
    setPriceView('confirm');
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

  function buildBarUrl(barId: number | null, colors?: Set<PriceTier>, openNow?: boolean) {
    const c = colors ?? activeColorsRef.current;
    const on = openNow ?? filterOpenNowRef.current;
    const parts: string[] = [];
    if (isDemoMode) parts.push('demo');
    if (barId !== null) parts.push(`bar=${barId}`);
    if (c.size < 3) parts.push(`colors=${(['green', 'yellow', 'red'] as PriceTier[]).filter(t => c.has(t)).join(',')}`);
    if (on) parts.push('open');
    return parts.length ? `?${parts.join('&')}` : window.location.pathname;
  }

  function normalizeSearch(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  const searchResults = searchQuery.trim().length > 0
    ? bars.filter(b => normalizeSearch(b.name).includes(normalizeSearch(searchQuery.trim()))).slice(0, 5)
    : [];

  const dbNames = new Set(searchResults.map(b => normalizeSearch(b.name)));
  const deduplicatedGoogleResults = googleResults.filter(p => !dbNames.has(normalizeSearch(p.name)));

  function handleSearchInput(q: string) {
    setSearchQuery(q);
    setGoogleResults([]);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (q.trim().length < 2) { setSearchLoading(false); return; }
    setSearchLoading(true);
    const center = mapRef.current?.getCenter();
    const lng = center?.lng ?? 18.0649;
    const lat = center?.lat ?? 59.3326;
    searchDebounceRef.current = setTimeout(() => {
      fetch(`/api/search-places?q=${encodeURIComponent(q.trim())}&lat=${lat}&lng=${lng}`)
        .then(r => r.json())
        .then(data => { if (data.ok) setGoogleResults(data.results ?? []); })
        .catch(() => {})
        .finally(() => setSearchLoading(false));
    }, 350);
  }

  function openGoogleResult(place: { google_place_id: string | null; name: string; address: string | null; lat: number; lng: number }) {
    setSearchOpen(false);
    setSearchQuery('');
    setGoogleResults([]);
    fetch('/api/register-bar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        source: 'osm',
        source_id: place.google_place_id,
        demo: isDemoMode,
      }),
    }).then(r => r.json()).then(j => {
      if (!j.ok || !j.bar_id) return;
      setOhChecked(false);
      setOhLoading(false);
      setOhSourceName(null);
      setOhSource(null);
      setAddress(place.address);
      setCandidate(null);
      setUndoAction(null);
      setSelectedBarId(j.bar_id);
      setPanelOpen(true);
      setStatus('');
      setHistory([]);
      setPriceInput('');
      setPriceView('confirm');
      window.history.replaceState(null, '', buildBarUrl(j.bar_id));
      loadHistory(j.bar_id).catch(console.error);
      focusPoint(place.lng, place.lat);
      loadBarsAndPrices().catch(console.error);
      fetchAndStoreOH(place.lat, place.lng, j.bar_id, place.name, oh => {
        if (oh) setBars(prev => prev.map(b => b.id === j.bar_id ? { ...b, opening_hours: oh } : b));
      });
    }).catch(console.error);
  }

  function openBarFromSearch(b: Bar) {
    setSearchOpen(false);
    setSearchQuery('');
    setOhChecked(false);
    setOhLoading(false);
    setOhSourceName(null);
    setOhSource(null);
    setAddress(null);
    setCandidate(null);
    setSelectedBarId(b.id);
    setPanelOpen(true);
    setStatus('');
    setHistory([]);
    setPriceInput('');
    setPriceView('confirm');
    setUndoAction(null);
    window.history.replaceState(null, '', buildBarUrl(b.id));
    loadHistory(b.id).catch(console.error);
    focusPoint(b.lng, b.lat);
    fetchAddress(b.lat, b.lng);
    if (!b.opening_hours) {
      fetchAndStoreOH(b.lat, b.lng, b.id, b.name, oh => {
        if (oh) setBars(prev => prev.map(bar => bar.id === b.id ? { ...bar, opening_hours: oh } : bar));
      });
    } else {
      setOhChecked(true);
    }
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
    setUndoAction(null);
    setOhLoading(false);
    setOhChecked(false);
    setOhSourceName(null);
    setOhSource(null);
    setAddress(null);
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
      refreshMap();
    };

    const onMoveEnd = () => { refreshMap(); };

    const onClick = (e: MapMouseEvent) => {
      const cand = pickCandidateFromClick(map, e);
      if (!cand) { closePanel(); return; }
      setOhChecked(false);
      setOhLoading(false);
      setOhSourceName(null);
      setOhSource(null);
      setAddress(null);
      setUndoAction(null);
      setSelectedBarId(null);
      setCandidate(cand);
      setPanelOpen(true);
      setStatus('');
      setHistory([]);
      setPriceInput('');
      setPriceView('confirm');
      focusPoint(cand.lng, cand.lat);
      fetchAddress(cand.lat, cand.lng);

      // Register bar immediately so it gets an id and becomes linkable, then fetch OH
      fetch('/api/register-bar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cand, demo: isDemoMode }),
      }).then(r => r.json()).then(j => {
        if (!j.ok || !j.bar_id) return;
        setSelectedBarId(j.bar_id);
        setCandidate(null);
        window.history.replaceState(null, '', buildBarUrl(j.bar_id));
        loadBarsAndPrices().catch(console.error);
        fetchAndStoreOH(cand.lat, cand.lng, j.bar_id, cand.name, oh => {
          if (oh) setBars(prev => prev.map(b => b.id === j.bar_id ? { ...b, opening_hours: oh } : b));
        });
      }).catch(console.error);
    };

    map.on('zoom', onZoom);
    map.on('load', onZoom);
    map.on('moveend', onMoveEnd);
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
            fetchAddress(bar.lat, bar.lng);
            if (!bar.opening_hours) {
              fetchAndStoreOH(bar.lat, bar.lng, bar.id, bar.name, oh => {
                if (oh) setBars(prev => prev.map(b => b.id === bar.id ? { ...b, opening_hours: oh } : b));
              });
            } else {
              setOhChecked(true);
            }
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
      map.off('moveend', onMoveEnd);
      map.off('click', onClick);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/android-chrome-512x512.png" alt="" className={styles.iqLogo} />
          <span className={styles.siteTitle}>Vad kostar nollan?</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={styles.searchBtn}
            onClick={() => { setSearchOpen(v => !v); setSearchQuery(''); setTimeout(() => searchInputRef.current?.focus(), 50); }}
            aria-label="Sök"
            title="Sök"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="18" y2="18"/></svg>
          </button>
          <button
            className={styles.hamburgerBtn}
            onClick={() => setOmOpen(true)}
            aria-label="Om projektet"
            title="Om projektet"
          >
            <span className={styles.hamburgerLine} />
            <span className={styles.hamburgerLine} />
            <span className={styles.hamburgerLine} />
          </button>
        </div>
      </header>
      {searchOpen && (
        <div className={styles.searchBar}>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            placeholder="Sök ställe…"
            value={searchQuery}
            onChange={e => handleSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); setGoogleResults([]); } }}
          />
          {(searchResults.length > 0 || deduplicatedGoogleResults.length > 0 || searchLoading) && (
            <ul className={styles.searchResults}>
              {searchResults.map(b => (
                <li key={b.id} className={styles.searchResultItem} onClick={() => openBarFromSearch(b)}>
                  {b.name}
                </li>
              ))}
              {deduplicatedGoogleResults.length > 0 && (
                <>
                  {searchResults.length > 0 && <li className={styles.searchResultDivider}>Fler platser</li>}
                  {deduplicatedGoogleResults.map((p, i) => (
                    <li key={p.google_place_id ?? i} className={styles.searchResultItem} onClick={() => openGoogleResult(p)}>
                      <span>{p.name}</span>
                      {p.address && <span className={styles.searchResultSub}>{p.address}</span>}
                    </li>
                  ))}
                </>
              )}
              {searchLoading && <li className={styles.searchResultDivider}>Söker…</li>}
            </ul>
          )}
          {searchQuery.trim().length > 0 && !searchLoading && searchResults.length === 0 && googleResults.length === 0 && (
            <div className={styles.searchEmpty}>Inga resultat</div>
          )}
        </div>
      )}

      <div className={styles.mapWrap}>
        <div ref={mapContainerRef} className={styles.map} />

        <button className={styles.locateBtn} onClick={locateMe} aria-label="Hitta min plats" title="Hitta min plats">
          ⌖
        </button>

        {/* Admin + demo — left edge, vertically centered */}
        <div className={styles.leftPanel}>
          {process.env.NODE_ENV === 'development' && (
            <a href="/admin" className={styles.devBtn}>Admin</a>
          )}
          {isDemoMode && (
            <div style={{
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
              height: 44,
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
        </div>

        {/* Filter module — collapsed: labels only. expanded: ranges + Öppet nu */}
        <div className={styles.filterBar}>
          {([
            { tier: 'green' as PriceTier, bg: '#D1FAE5', border: '#6EE7B7', label: 'Billigt' },
            { tier: 'yellow' as PriceTier, bg: '#FEF3C7', border: '#FCD34D', label: 'Medel' },
            { tier: 'red' as PriceTier, bg: '#FEE2E2', border: '#FCA5A5', label: 'Dyrt' },
          ]).map(({ tier, bg, border, label }) => {
            const few = visiblePriceCount < 3;
            const r = tierRanges[tier];
            const rangeLabel = r ? (r.min === r.max ? `${r.min} kr` : `${r.min}–${r.max} kr`) : '–';
            return (
              <button
                key={tier}
                className={`${styles.filterBtn} ${!few && activeColors.has(tier) ? styles.filterBtnOn : styles.filterBtnOff}`}
                style={!few && activeColors.has(tier) ? { background: bg, borderColor: border, color: '#111827' } : undefined}
                onClick={() => !few && toggleColor(tier)}
                disabled={few}
              >
                <span className={styles.filterBtnLabel}>{label}</span>
                {filterExpanded && <span className={styles.filterBtnRange}>{rangeLabel}</span>}
              </button>
            );
          })}
          {filterExpanded && (
            <>
              <div style={{ width: 1, background: '#d1d5db', alignSelf: 'stretch', margin: '2px 0' }} />
              <button
                className={`${styles.filterBtn} ${filterOpenNow ? styles.filterBtnOn : styles.filterBtnOff}`}
                style={filterOpenNow ? { background: '#D1FAE5', borderColor: '#6EE7B7', color: '#111827' } : { color: '#111827' }}
                onClick={toggleOpenNow}
              >
                <span className={styles.filterBtnLabel}>Öppet</span>
                <span className={styles.filterBtnRange} style={{ color: 'inherit', opacity: 1 }}>nu</span>
              </button>
            </>
          )}
          <div style={{ width: 1, background: '#d1d5db', alignSelf: 'stretch', margin: '2px 0' }} />
          <button
            className={styles.filterBtn}
            onClick={() => setFilterExpanded(v => !v)}
            aria-label={filterExpanded ? 'Minimera filter' : 'Expandera filter'}
            style={{ padding: '5px 8px', color: '#6b7280' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="1" y1="4" x2="13" y2="4" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="1" y1="10" x2="13" y2="10" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="4" cy="4" r="1.5" fill="#ffffff" stroke="#6b7280" strokeWidth="1.5"/>
              <circle cx="10" cy="10" r="1.5" fill="#ffffff" stroke="#6b7280" strokeWidth="1.5"/>
            </svg>
          </button>
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
                flexDirection: 'column' as const,
                display: 'flex',
              }}>
                {selectedBar ? selectedBar.name : candidate?.name}
                {(() => {
                  const oh = selectedBar?.opening_hours ?? candidate?.opening_hours ?? null;
                  if (ohLoading) return <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Hämtar öppettider…</div>;
                  if (ohChecked && !oh) return <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#9ca3af', marginTop: 2 }}>Öppettider ej tillgängliga</div>;
                  const status = getOpenStatus(oh);
                  if (!status) return null;
                  if (status.open) return (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#059669', marginTop: 2 }}>● Öppet nu</div>
                  );
                  let closedLabel = 'Stängt';
                  if (status.nextTime) {
                    if (status.opensLaterToday) {
                      closedLabel = `Stängt, öppnar kl ${status.nextTime}`;
                    } else if (status.nextDay !== null) {
                      const todayJS = new Date().getDay();
                      const tomorrowJS = (todayJS + 1) % 7;
                      closedLabel = status.nextDay === tomorrowJS
                        ? `Stängt, öppnar imorgon kl ${status.nextTime}`
                        : `Stängt, öppnar på ${SV_DAYS[status.nextDay]} kl ${status.nextTime}`;
                    }
                  }
                  return <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: '#DC2626', marginTop: 2 }}>● {closedLabel}</div>;
                })()}
                {address && (() => {
                  const name = selectedBar?.name ?? candidate?.name ?? '';
                  const query = name ? `${name}, ${address}` : address;
                  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query!)}`;
                  return (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#6b7280', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}
                    >
                      {address}
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#6b7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3"/><line x1="11" y1="1" x2="5.5" y2="6.5"/></svg>
                    </a>
                  );
                })()}
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
                    <div className={styles.fieldRow} style={{ flexWrap: 'nowrap', width: '100%' }}>
                      <input
                        className={styles.input}
                        style={{ flex: 1, width: 'auto', minWidth: 0 }}
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
                    <div className={styles.btnRow}>
                      <button
                        className={`${styles.btn} ${styles.btnDark}`}
                        style={{ flex: 1 }}
                        onClick={() => { setPriceView('edit'); setStatus(''); }}
                      >
                        Uppdatera pris
                      </button>
                      {!selectedBar?.no_na_beer && (
                        <button
                          className={styles.btn}
                          style={{ flex: 1 }}
                          onClick={() => (selectedBar ? reportNoNaSelected() : reportNoNaCandidate())}
                        >
                          ✕ Alkoholfri öl saknas
                        </button>
                      )}
                    </div>
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
                  <div className={styles.fieldRow} style={{ flexWrap: 'nowrap', width: '100%' }}>
                    <input
                      className={styles.input}
                      style={{ flex: 1, width: 'auto', minWidth: 0 }}
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

            {/* No NA beer button — only when bar has no price */}
            {!(selectedBar ? !!latestPrices.get(selectedBar.id) : false) && !selectedBar?.no_na_beer && (
              <button
                className={styles.btn}
                onClick={() => (selectedBar ? reportNoNaSelected() : reportNoNaCandidate())}
                style={{ width: '100%', textAlign: 'left' }}
              >
                ✕ Alkoholfri öl saknas här
              </button>
            )}

            {undoAction && (
              <button
                className={styles.btn}
                onClick={undoLast}
                style={{ width: '100%', color: '#6b7280', fontSize: 13 }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ marginRight: 5, verticalAlign: 'middle', flexShrink: 0 }}>
                  <path d="M4.5 2.5 L1.5 5.5 L4.5 8.5" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M1.5 5.5 H8.5 C10.16 5.5 11.5 6.84 11.5 8.5 V9.5" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Ångra
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

        {omOpen ? (
          <div className={styles.welcomeOverlay} onClick={() => setOmOpen(false)}>
            <div
              className={styles.welcomeCard}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#ffffff',
                maxWidth: 500,
                padding: '32px 28px',
                borderRadius: 16,
                border: '1px solid #e5e7eb',
                boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 26, color: '#111827', lineHeight: 1.2 }}>
                  Om projektet
                </div>
                <button
                  onClick={() => setOmOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6B7280', padding: '0 0 0 12px', lineHeight: 1 }}
                  aria-label="Stäng"
                >✕</button>
              </div>

              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.7, color: '#374151', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ margin: 0 }}>
                  <strong>Vad kostar nollan?</strong> är en öppen karta som visar priser på alkoholfri öl på barer, restauranger och andra serveringsställen runt om i Sverige.
                </p>

                <div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, color: '#111827', marginBottom: 6 }}>Hur samlas data in?</div>
                  <p style={{ margin: 0 }}>
                    All data i kartan rapporteras av besökare som du. När du besöker ett ställe och vill dela priset du betalat, klickar du på platsen och lägger till priset. Det finns ingen redaktion eller kvalitetskontroll — vi litar på att communityn bidrar med korrekta uppgifter.
                  </p>
                </div>

                <div style={{ background: '#FEF3C7', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400E' }}>
                  Observera att uppgifterna kan vara inaktuella eller felaktiga. Priser ändras och vi kan inte garantera att informationen stämmer vid ditt besök.
                </div>

                <div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, color: '#111827', marginBottom: 6 }}>Varför?</div>
                  <p style={{ margin: 0 }}>
                    Att dricka alkoholfri öl ska inte behöva kosta skjortan. Det här projektet vill göra det enklare att hitta ställen där du kan njuta av ett gott alkoholfritt alternativ till ett rimligt pris — oavsett om du väljer att inte dricka alkohol av hälsoskäl, kör bil, är gravid, eller helt enkelt föredrar det.
                  </p>
                </div>

                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
                  <p style={{ margin: 0, color: '#6B7280', fontSize: 13 }}>
                    Projektet drivs av{' '}
                    <a href="https://www.iq.se" target="_blank" rel="noopener noreferrer" style={{ color: '#111827', fontWeight: 600 }}>IQ</a>
                    {' '}— en organisation som arbetar för ett sundare förhållande till alkohol i Sverige.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}