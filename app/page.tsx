'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
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
  address: string | null;
  google_place_id: string | null;
};

type Category = 'na_beer' | 'soda' | 'na_wine' | 'other';

const CATEGORY_ORDER: Category[] = ['na_beer', 'soda', 'na_wine', 'other'];
const CATEGORY_LABELS: Record<Category, string> = {
  na_beer: 'Alkoholfri öl',
  soda: 'Läsk',
  na_wine: 'Alkoholfritt vin',
  other: 'Övrigt',
};
const CATEGORY_CHIPS: { value: Category; label: string }[] = [
  { value: 'na_beer', label: 'Öl' },
  { value: 'soda', label: 'Läsk' },
  { value: 'na_wine', label: 'Vin' },
  { value: 'other', label: 'Övrigt' },
];

type LatestPrice = {
  id: number;
  bar_id: number;
  price_sek: number;
  created_at: string;
  beverage_name: string | null;
  category: Category;
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

function track(event: string, props?: Record<string, string>) {
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: event, url: window.location.href, props }),
    }).catch(() => {});
  } catch {}
}

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

async function fetchHouseNumberOverpass(lat: number, lng: number, road: string): Promise<string | null> {
  const roadPattern = road.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const q = `[out:json][timeout:5];(node["addr:housenumber"]["addr:street"~"^${roadPattern}$",i](around:60,${lat},${lng});way["addr:housenumber"]["addr:street"~"^${roadPattern}$",i](around:60,${lat},${lng}););out center;`;
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data = await r.json() as { elements?: { tags?: { 'addr:housenumber'?: string }; lat?: number; lon?: number; center?: { lat: number; lon: number } }[] };
      let bestNum: string | null = null;
      let bestDist = Infinity;
      for (const el of data.elements ?? []) {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        const num = el.tags?.['addr:housenumber'];
        if (!num || elLat == null || elLon == null) continue;
        const dlat = (elLat - lat) * 111000;
        const dlng = (elLon - lng) * 111000 * Math.cos(lat * Math.PI / 180);
        const dist = Math.sqrt(dlat * dlat + dlng * dlng);
        if (dist < bestDist) { bestDist = dist; bestNum = num; }
      }
      return bestNum;
    } catch {
      // try next endpoint
    }
  }
  return null;
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

function isInSweden(lat: number, lng: number): boolean {
  // Rough bounding box pre-filter only — not used for accurate country detection
  return lat >= 54.5 && lat <= 70 && lng >= 9 && lng <= 25;
}

async function checkIsSweden(lat: number, lng: number): Promise<boolean> {
  if (!isInSweden(lat, lng)) return false;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`
    );
    if (!res.ok) return true; // fail open if API down
    const data = await res.json();
    return data?.address?.country_code === 'se';
  } catch {
    return true; // fail open
  }
}

export default function Page() {

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);

  const zoomRef = useRef<number>(5);
  const [zoomLevel, setZoomLevel] = useState(5);
  const [mapLoaded, setMapLoaded] = useState(false);
  const markersRef = useRef<Map<number, maplibregl.Marker>>(new Map());

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isDemoMode = searchParams.has('demo');

  const [bars, setBars] = useState<Bar[]>([]);
  const [latestPrices, setLatestPrices] = useState<Map<number, LatestPrice>>(new Map());

  const panelRef = useRef<HTMLDivElement | null>(null);

  const barsRef = useRef<Bar[]>([]);
  const latestPricesRef = useRef<Map<number, LatestPrice>>(new Map());
  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { latestPricesRef.current = latestPrices; }, [latestPrices]);
  useEffect(() => { track('pageview'); }, []);

  const [welcomeOpen, setWelcomeOpen] = useState(!searchParams.has('bar'));
  const [omOpen, setOmOpen] = useState(() => pathname === '/info');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [googleResults, setGoogleResults] = useState<{ google_place_id: string | null; name: string; address: string | null; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedBarId, setSelectedBarId] = useState<number | null>(null);
  const selectedBar = useMemo(() => (selectedBarId ? bars.find(b => b.id === selectedBarId) ?? null : null), [bars, selectedBarId]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const locationInSweden = selectedBar
    ? isInSweden(selectedBar.lat, selectedBar.lng)
    : candidate
    ? isInSweden(candidate.lat, candidate.lng)
    : true;
  const [panelOpen, setPanelOpen] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [beverageNameInput, setBeverageNameInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<Category>('na_beer');
  const [status, setStatus] = useState('');
  const [beverages, setBeverages] = useState<LatestPrice[]>([]);
  const [beverageSuggestions, setBeverageSuggestions] = useState<string[]>([]);
  const [editingBeverage, setEditingBeverage] = useState<LatestPrice | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (isDemoMode) params.set('demo', '');
    params.set('category', categoryInput);
    fetch(`/api/beverage-names?${params.toString()}`)
      .then(r => r.json())
      .then(j => { if (j.ok) setBeverageSuggestions(j.names); })
      .catch(() => {});
  }, [isDemoMode, categoryInput]);
  const [undoAction, setUndoAction] = useState<{ type: 'price'; price_id: number; bar_id: number } | { type: 'no_na'; bar_id: number } | null>(null);
  const [ohLoading, setOhLoading] = useState(false);
  const [ohChecked, setOhChecked] = useState(false);
  const [ohSourceName, setOhSourceName] = useState<string | null>(null);
  const [ohSource, setOhSource] = useState<'google' | 'osm' | null>(null);
  const [ohExpanded, setOhExpanded] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => { setOhExpanded(false); }, [selectedBarId]);

  const [activeColors, setActiveColors] = useState<Set<PriceTier>>(() => {
    const param = searchParams.get('colors');
    if (!param) return new Set<PriceTier>(['green', 'yellow', 'red']);
    const all = new Set<PriceTier>(['green', 'yellow', 'red']);
    const parsed = param.split(',').filter((v): v is PriceTier => all.has(v as PriceTier));
    return parsed.length ? new Set(parsed) : new Set<PriceTier>(['green', 'yellow', 'red']);
  });
  const [activeTypes, setActiveTypes] = useState<Set<VenueType>>(() => new Set(['bar', 'food', 'hotel', 'other']));
  const activeColorsRef = useRef<Set<PriceTier>>(activeColors);
  const activeTypesRef = useRef<Set<VenueType>>(new Set(['bar', 'food', 'hotel', 'other']));
  const [filterOpenNow, setFilterOpenNow] = useState(() => searchParams.has('open'));
  const filterOpenNowRef = useRef(searchParams.has('open'));
  const [thresholds, setThresholds] = useState<Thresholds>({ low: 35, high: 45 });
  const [visiblePriceCount, setVisiblePriceCount] = useState(0);
  const [tierRanges, setTierRanges] = useState<Record<PriceTier, { min: number; max: number } | null>>({ green: null, yellow: null, red: null });
  const thresholdsRef = useRef<Thresholds>({ low: 35, high: 45 });

  function fetchAddress(addr: string | null) {
    setAddress(addr ?? null);
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
      .select('id,name,lat,lng,source,source_id,no_na_beer,no_na_reported_at,venue_type,opening_hours,address,permanently_closed,google_place_id')
      .neq('permanently_closed', true)
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
        address?: unknown;
        google_place_id?: unknown;
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
        address: (rr.address as string | null | undefined) ?? null,
        google_place_id: (rr.google_place_id as string | null | undefined) ?? null,
      };
    });

    const { data: pricesData, error: pricesErr } = await supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,created_at,beverage_name,category')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (pricesErr) throw pricesErr;

    // Markers represent the cheapest NA-beer price only — non-beer rows
    // (soda, NA wine, other) live in the detail panel, not on the map.
    const latest = new Map<number, LatestPrice>();
    for (const p of pricesData ?? []) {
      const pp = p as { id: unknown; bar_id: unknown; price_sek: unknown; created_at: unknown; beverage_name: unknown; category: unknown };
      const category = (typeof pp.category === 'string' && CATEGORY_ORDER.includes(pp.category as Category))
        ? (pp.category as Category)
        : 'na_beer';
      if (category !== 'na_beer') continue;
      const bar_id = Number(pp.bar_id);
      const price_sek = Number(pp.price_sek);
      const existing = latest.get(bar_id);
      if (!existing || price_sek < existing.price_sek) {
        latest.set(bar_id, {
          id: Number(pp.id),
          bar_id,
          price_sek,
          created_at: String(pp.created_at),
          beverage_name: pp.beverage_name != null ? String(pp.beverage_name) : null,
          category,
        });
      }
    }

    setBars(barsRows);
    setLatestPrices(latest);
    refreshMap(barsRows, latest);
    console.log('pricesData latest map size:', latest.size);
    return barsRows;
  }

  async function loadBeverages(barId: number) {
    const pricesTable = isDemoMode ? 'prices_demo' : 'prices';
    const { data, error } = await supabase
      .from(pricesTable)
      .select('id,bar_id,price_sek,created_at,beverage_name,category')
      .eq('bar_id', barId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    setBeverages(
      (data ?? []).map((r) => {
        const rr = r as { id: unknown; bar_id: unknown; price_sek: unknown; created_at: unknown; beverage_name: unknown; category: unknown };
        const category = (typeof rr.category === 'string' && CATEGORY_ORDER.includes(rr.category as Category))
          ? (rr.category as Category)
          : 'na_beer';
        return {
          id: Number(rr.id),
          bar_id: Number(rr.bar_id),
          price_sek: Number(rr.price_sek),
          created_at: String(rr.created_at),
          beverage_name: rr.beverage_name != null ? String(rr.beverage_name) : null,
          category,
        };
      }),
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
        setBeverageNameInput('');
        setCategoryInput('na_beer');
        window.history.replaceState(null, '', buildBarUrl(b.id));
        track('Location Opened');
        loadBeverages(b.id).catch(console.error);
        focusPoint(b.lng, b.lat);
        fetchAddress(b.address);

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
    if (next.has(tier)) { next.delete(tier); track('Filter Toggled', { color: tier, action: 'off' }); }
    else { next.add(tier); track('Filter Toggled', { color: tier, action: 'on' }); }
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

  function focusPoint(lng: number, lat: number, zoom?: number) {
    const map = mapRef.current;
    if (!map) return;
    const h = map.getContainer().clientHeight || 800;
    // Negative offset: bar appears above screen center, visible above the centered panel
    map.easeTo({ center: [lng, lat], offset: [0, -Math.round(h / 5)], duration: 350, ...(zoom !== undefined ? { zoom } : {}) });
  }

  async function locateMe() {
    track('Locate Me Used');
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
    const hadPrice = latestPricesRef.current.has(selectedBar.id);
    setStatus('Sparar...');
    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id, price_sek: p, beverage_name: beverageNameInput.trim() || null, category: categoryInput, demo: isDemoMode }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }
    track(hadPrice ? 'Price Updated' : 'Price Added');
    setStatus('');
    setPriceInput('');
    setBeverageNameInput('');
    setCategoryInput('na_beer');
    if (editingBeverage) {
      await fetch('/api/report-wrong-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bar_id: selectedBar.id, price_id: editingBeverage.id, demo: isDemoMode }),
      });
      setEditingBeverage(null);
    } else {
      setUndoAction({ type: 'price', price_id: j.price.id, bar_id: selectedBar.id });
    }
    await loadBarsAndPrices();
    await loadBeverages(selectedBar.id);
  }

  async function savePriceCandidate() {
    if (!candidate) return;
    const p = parseInt(priceInput.trim(), 10);
    if (!Number.isFinite(p) || p < 10 || p > 150) { setStatus('Pris måste vara 10-150 kr.'); return; }
    setStatus('Sparar...');
    const r = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...candidate, price_sek: p, beverage_name: beverageNameInput.trim() || null, category: categoryInput, demo: isDemoMode }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }
    track('Price Added');
    setStatus('');
    setPriceInput('');
    setBeverageNameInput('');
    setCategoryInput('na_beer');
    await loadBarsAndPrices();
    if (j.bar_id) {
      setUndoAction({ type: 'price', price_id: j.price.id, bar_id: j.bar_id });
      setSelectedBarId(j.bar_id);
      window.history.replaceState(null, '', buildBarUrl(j.bar_id));
      await loadBeverages(j.bar_id);
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
    track('No NA Reported');
    setStatus('');
    setPriceInput('');
    setUndoAction({ type: 'no_na', bar_id: selectedBar.id });
    await loadBarsAndPrices();
    await loadBeverages(selectedBar.id);
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
    track('No NA Reported');
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
    await loadBeverages(barId);
  }

  async function reportWrongPrice(priceId?: number) {
    if (!selectedBar) return;
    const r = await fetch('/api/report-wrong-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bar_id: selectedBar.id, price_id: priceId, demo: isDemoMode }),
    });
    const j = await r.json();
    if (!j.ok) { setStatus(`Fel: ${j.error || 'okänt fel'}`); return; }
    await loadBarsAndPrices();
    await loadBeverages(selectedBar.id);
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
    const lng = center?.lng ?? 15.2134;
    const lat = center?.lat ?? 59.2741;
    searchDebounceRef.current = setTimeout(() => {
      fetch(`/api/search-places?q=${encodeURIComponent(q.trim())}&lat=${lat}&lng=${lng}`)
        .then(r => r.json())
        .then(data => { if (data.ok) setGoogleResults(data.results ?? []); })
        .catch(() => {})
        .finally(() => setSearchLoading(false));
    }, 350);
  }

  async function openGoogleResult(place: { google_place_id: string | null; name: string; address: string | null; lat: number; lng: number }) {
    if (!await checkIsSweden(place.lat, place.lng)) return;
    track('Search Used');
    track('New Bar Added');
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
        source: 'google_places',
        source_id: place.google_place_id,
        google_place_id: place.google_place_id,
        address: place.address,
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
      setBeverages([]);
      setPriceInput('');
      setBeverageNameInput('');
      setCategoryInput('na_beer');
      window.history.replaceState(null, '', buildBarUrl(j.bar_id));
      loadBeverages(j.bar_id).catch(console.error);
      focusPoint(place.lng, place.lat, 16);
      loadBarsAndPrices().catch(console.error);
      fetchAndStoreOH(place.lat, place.lng, j.bar_id, place.name, oh => {
        if (oh) setBars(prev => prev.map(b => b.id === j.bar_id ? { ...b, opening_hours: oh } : b));
      });
    }).catch(console.error);
  }

  async function openBarFromSearch(b: Bar) {
    if (!await checkIsSweden(b.lat, b.lng)) return;
    track('Search Used');
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
    setBeverages([]);
    setPriceInput('');
    setBeverageNameInput('');
    setCategoryInput('na_beer');
    setEditingBeverage(null);
    setUndoAction(null);
    window.history.replaceState(null, '', buildBarUrl(b.id));
    loadBeverages(b.id).catch(console.error);
    focusPoint(b.lng, b.lat, 16);
    fetchAddress(b.address);
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
    setBeverages([]);
    setPriceInput('');
    setBeverageNameInput('');
    setCategoryInput('na_beer');
    setEditingBeverage(null);
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
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}&language=sv`,
      center: [15.2134, 59.2741],
      zoom: 5,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('styledata', () => {
      const style = map.getStyle();
      for (const layer of style?.layers ?? []) {
        if (layer.type !== 'symbol') continue;
        const field = (layer as { layout?: Record<string, unknown> }).layout?.['text-field'];
        if (!field) continue;
        // Skip road shield layers that use 'ref', not 'name'
        if (!JSON.stringify(field).includes('name')) continue;
        map.setLayoutProperty(layer.id, 'text-field', [
          'coalesce', ['get', 'name:sv'], ['get', 'name'],
        ]);
      }
    });

    mapRef.current = map;
    setZoomLevel(map.getZoom());

    const onZoom = () => {
      const z = map.getZoom();
      zoomRef.current = z;
      setZoomLevel(z);
      refreshMap();
    };

    const onMoveEnd = () => { refreshMap(); };

    const onClick = async (e: MapMouseEvent) => {
      if ((e.originalEvent?.target as Element | null)?.closest?.('.maplibregl-marker')) return;
      const cand = pickCandidateFromClick(map, e);
      if (!cand) { closePanel(); return; }
      if (!await checkIsSweden(cand.lat, cand.lng)) return;
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
      setBeverages([]);
      setPriceInput('');
      setBeverageNameInput('');
      setCategoryInput('na_beer');
      focusPoint(cand.lng, cand.lat);
      fetchAddress(null);

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
        // Save the address that was fetched for this candidate
        setAddress(prev => {
          if (prev) {
            fetch('/api/patch-bar', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bar_id: j.bar_id, address: prev, demo: isDemoMode }),
            }).catch(() => {});
          }
          return prev;
        });
        loadBarsAndPrices().catch(console.error);
        fetchAndStoreOH(cand.lat, cand.lng, j.bar_id, cand.name, oh => {
          if (oh) setBars(prev => prev.map(b => b.id === j.bar_id ? { ...b, opening_hours: oh } : b));
        });
      }).catch(console.error);
    };

    map.on('zoom', onZoom);
    map.on('load', () => { onZoom(); setMapLoaded(true); });
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
            await loadBeverages(bar.id);
            focusPoint(bar.lng, bar.lat, 16);
            fetchAddress(bar.address);
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
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span className={styles.siteTitle}>Vad kostar nollan?</span>
            <span className={styles.siteSub}>Hitta billig alkoholfri öl på stan</span>
          </div>
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
            onClick={() => { const next = !omOpen; setOmOpen(next); window.history.replaceState(null, '', next ? '/info' : '/'); if (next) track('Info Opened'); }}
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
        {!mapLoaded && <div className={styles.mapLoadingBg} />}

        <button className={styles.locateBtn} onClick={locateMe} aria-label="Hitta min plats" title="Hitta min plats">
          ⌖
        </button>


        {/* Admin + demo — left edge, vertically centered */}
        <div className={styles.leftPanel}>
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

        {/* Filter toolbar */}
        <div className={`${styles.filterBar}${visiblePriceCount < 3 ? ` ${styles.filterBarHidden}` : ''}`}>
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
                <span className={styles.filterBtnRange}>{rangeLabel}</span>
              </button>
            );
          })}
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

            {/* Address + opening hours */}
            {(() => {
              const bar = selectedBar;
              const addr = bar?.address ?? address;
              const oh = bar?.opening_hours;
              const placeId = bar?.google_place_id;
              const mapsUrl = placeId
                ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
                : addr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}` : null;
              if (!addr && !oh) return null;
              const openStatus = getOpenStatus(oh);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-body)', fontSize: 13, color: '#6B7280' }}>
                  {addr && mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>
                      {addr} ↗
                    </a>
                  )}
                  {addr && !mapsUrl && <span>{addr}</span>}
                  {oh && openStatus !== null && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button
                        onClick={() => setOhExpanded(v => !v)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                          background: openStatus.open ? '#dcfce7' : '#fee2e2',
                          color: openStatus.open ? '#16a34a' : '#dc2626',
                        }}>
                          {openStatus.open ? 'Öppet' : 'Stängt'}
                        </span>
                        {!openStatus.open && openStatus.nextTime && (
                          <span style={{ fontSize: 12 }}>
                            {openStatus.opensLaterToday
                              ? `· öppnar ${openStatus.nextTime}`
                              : openStatus.nextDay !== null
                                ? `· öppnar ${SV_DAYS[openStatus.nextDay]} ${openStatus.nextTime}`
                                : null}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{ohExpanded ? '▲' : '▼'}</span>
                      </button>
                      {ohExpanded && (
                        <div style={{ fontSize: 12, color: '#6B7280', whiteSpace: 'pre-wrap', paddingLeft: 2 }}>
                          {oh.replace(/; /g, '\n')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {status ? <div className={styles.status}>{status}</div> : null}

            {/* Beverages section */}
            {!locationInSweden ? (
              <p className={styles.status}>
                Den här platsen är utanför Sverige och stöds inte än.
              </p>
            ) : (() => {
              const isNoNa = selectedBar?.no_na_beer;

              const addForm = (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {editingBeverage && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#6B7280' }}>
                      <span>Uppdaterar pris</span>
                      <button
                        onClick={() => { setEditingBeverage(null); setPriceInput(''); setBeverageNameInput(''); setCategoryInput('na_beer'); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 13, padding: 0 }}
                      >
                        Avbryt
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {CATEGORY_CHIPS.map(chip => {
                      const selected = categoryInput === chip.value;
                      return (
                        <button
                          key={chip.value}
                          type="button"
                          onClick={() => setCategoryInput(chip.value)}
                          style={{
                            padding: '4px 12px',
                            borderRadius: 999,
                            border: selected ? '1.5px solid #111827' : '1px solid #d1d5db',
                            background: selected ? '#111827' : '#ffffff',
                            color: selected ? '#ffffff' : '#374151',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            lineHeight: 1,
                          }}
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    list="beverage-suggestions"
                    className={styles.input}
                    style={{ width: '100%' }}
                    placeholder="Dryckens namn (valfritt)"
                    value={beverageNameInput}
                    onChange={(e) => setBeverageNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') closePanel(); }}
                  />
                  <datalist id="beverage-suggestions">
                    {beverageSuggestions.map(s => <option key={s} value={s} />)}
                  </datalist>
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
                      {editingBeverage ? 'Uppdatera' : 'Lägg till'}
                    </button>
                  </div>
                </div>
              );

              if (isNoNa) {
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
                    {addForm}
                  </>
                );
              }

              const beverageGroups = CATEGORY_ORDER
                .map(cat => ({
                  category: cat,
                  items: beverages
                    .filter(b => b.category === cat)
                    .sort((a, b) => a.price_sek - b.price_sek),
                }))
                .filter(g => g.items.length > 0);

              return (
                <>
                  {beverages.length === 0 && (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: '#6B7280' }}>
                      Inga drycker rapporterade än.
                    </div>
                  )}
                  {beverageGroups.length > 0 && (
                    <div className={styles.history}>
                      {beverageGroups.flatMap(group => [
                        <div key={`header-${group.category}`} className={styles.hint} style={{ marginTop: 4 }}>
                          {CATEGORY_LABELS[group.category]}
                        </div>,
                        ...group.items.map(bev => {
                          const isEditing = editingBeverage?.id === bev.id;
                          return (
                            <div key={bev.id} className={styles.historyItem} style={isEditing ? { background: '#eff6ff', border: '1px solid #bfdbfe' } : {}}>
                              <div>
                                <span className={styles.historyLeft}>
                                  {bev.beverage_name || CATEGORY_LABELS[bev.category]}
                                </span>
                                <span style={{ fontSize: 13, color: '#374151', marginLeft: 8, fontWeight: 600 }}>
                                  {bev.price_sek} kr
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span className={styles.historyRight}>{fmtShort(bev.created_at)}</span>
                                <button
                                  onClick={() => {
                                    setEditingBeverage(bev);
                                    setBeverageNameInput(bev.beverage_name || '');
                                    setPriceInput(String(bev.price_sek));
                                    setCategoryInput(bev.category);
                                  }}
                                  title="Ändra pris"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={() => reportWrongPrice(bev.id)}
                                  title="Rapportera fel pris"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 16, padding: '0 2px', lineHeight: 1 }}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        }),
                      ])}
                    </div>
                  )}
                  {addForm}
                </>
              );
            })()}

            {/* "No NA beer here" is independent of soda/wine entries — only
                hide it when the bar is already flagged or beer has been reported. */}
            {locationInSweden && beverages.every(b => b.category !== 'na_beer') && !selectedBar?.no_na_beer && (
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
                position: 'relative',
              }}
            >
              <button
                onClick={() => setWelcomeOpen(false)}
                aria-label="Stäng"
                style={{ position: 'absolute', top: 40, right: 36, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 20, lineHeight: 1, padding: 0 }}
              >✕</button>
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
                lineHeight: 1.3,
                color: '#fff',
                marginBottom: 20,
              }}>
                En karta över priser på alkoholfri öl på barer och restauranger i Sverige.
                Datan samlas in av besökare som du.
              </div>

              <div style={{
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                lineHeight: 1.3,
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
                    Ett projekt från IQ
                  </span>
                </a>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`${styles.omOverlay}${omOpen ? ` ${styles.omOverlayOpen}` : ''}`}
          onClick={() => { setOmOpen(false); window.history.replaceState(null, '', '/'); }}
        >
          <div
            className={`${styles.omCard}${omOpen ? ` ${styles.omCardOpen}` : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '20px'
            }}>
              <div style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '26px',
                color: '#111827',
                lineHeight: '1.2'
              }}>
                Om projektet
              </div>
              <button
                onClick={() => { setOmOpen(false); window.history.replaceState(null, '', '/'); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '20px',
                  color: '#6B7280',
                  padding: '0 0 0 12px',
                  lineHeight: '1'
                }}
                aria-label="Stäng"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: '15px',
              lineHeight: '1.6',
              color: '#374151',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}>
              <p style={{ margin: 0 }}>
                <strong>Vad kostar nollan?</strong> är en öppen karta över priser på alkoholfri öl på barer och restauranger i Sverige. All data rapporteras och uppdateras av besökare. Du bidrar till att göra det enklare att hitta alkoholfri öl till ett rimligt pris.
              </p>

              <p style={{ margin: 0, color: '#6B7280', fontSize: '13px' }}>
                ⚠️ Uppgifterna kan vara inaktuella. Priser ändras och vi kan inte
                garantera att informationen stämmer vid ditt besök.
              </p>

              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
                <p style={{ margin: 0, color: '#6B7280', fontSize: '13px' }}>
                  En tjänst från{' '}
                  <a
                    href="https://www.iq.se"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#111827', fontWeight: 600 }}
                  >
                    IQ
                  </a>
                  {', '}för ett smartare förhållande till alkohol.
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}