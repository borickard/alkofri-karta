export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

type NominatimResult = {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  class?: string;
  type?: string;
  address?: { road?: string; house_number?: string };
};

const ALLOWED_CLASSES = new Set(['amenity', 'tourism', 'leisure']);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const lat = Number(searchParams.get('lat') || 59.3326);
  const lng = Number(searchParams.get('lng') || 18.0649);

  if (!q || q.length < 2) return NextResponse.json({ ok: true, results: [] });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    // Soft-bias toward current map area but don't restrict globally
    const delta = 0.4;
    const viewbox = `${lng - delta},${lat + delta * 0.6},${lng + delta},${lat - delta * 0.6}`;

    // Append * to every word for prefix matching (e.g. "Vill fridhem" → "Vill* fridhem*")
    const qWild = q.replace(/(\S+)/g, '$1*');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(qWild)}&format=json&limit=10&addressdetails=1&countrycodes=se&viewbox=${viewbox}&bounded=0`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'nollkartan.se/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!r.ok) return NextResponse.json({ ok: false, error: `Nominatim: ${r.status}` }, { status: 502 });

    const data = await r.json() as NominatimResult[];

    const results = data
      .filter(p => ALLOWED_CLASSES.has(p.class ?? '') && p.lat && p.lon)
      .map(p => {
        const elLat = Number(p.lat);
        const elLng = Number(p.lon);
        const dlat = (elLat - lat) * 111000;
        const dlng = (elLng - lng) * 111000 * Math.cos((lat * Math.PI) / 180);
        const dist = Math.sqrt(dlat * dlat + dlng * dlng);
        const road = p.address?.road;
        const num = p.address?.house_number;
        const address = road ? (num ? `${road} ${num}` : road) : null;
        return {
          google_place_id: p.osm_type && p.osm_id ? `osm-${p.osm_type}-${p.osm_id}` : null,
          name: p.name || p.display_name?.split(',')[0] || q,
          address,
          lat: elLat,
          lng: elLng,
          dist,
        };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 8)
      .map(({ dist: _dist, ...rest }) => rest);

    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ ok: false, error: 'Sökning misslyckades' }, { status: 502 });
  }
}
