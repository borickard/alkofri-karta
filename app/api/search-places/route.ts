export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

type PlacesResult = {
  id: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
  formattedAddress?: string;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  const lat = Number(searchParams.get('lat') || 59.3326);
  const lng = Number(searchParams.get('lng') || 18.0649);

  if (!q || q.length < 2) return NextResponse.json({ ok: true, results: [] });

  const apiKey = process.env.GOOGLE_PLACES_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'API-nyckel saknas.' }, { status: 500 });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.businessStatus',
      },
      body: JSON.stringify({
        textQuery: q,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 50000 },
        },
        languageCode: 'sv',
        regionCode: 'SE',
        maxResultCount: 8,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!r.ok) return NextResponse.json({ ok: false, error: `Places: ${r.status}` }, { status: 502 });

    const data = await r.json() as { places?: PlacesResult[] };

    const results = (data.places ?? [])
      .filter(p => p.businessStatus !== 'CLOSED_PERMANENTLY' && p.location && p.displayName)
      .map(p => ({
        google_place_id: p.id,
        name: p.displayName!.text,
        address: p.formattedAddress ?? null,
        lat: p.location!.latitude,
        lng: p.location!.longitude,
      }))
      .slice(0, 8);

    return NextResponse.json({ ok: true, results });
  } catch {
    return NextResponse.json({ ok: false, error: 'Sökning misslyckades' }, { status: 502 });
  }
}
