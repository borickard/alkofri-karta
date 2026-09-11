export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  // API key auth — key is optional; if unset the endpoint is open (data is public anyway)
  const exportKey = process.env.EXPORT_API_KEY;
  if (exportKey) {
    const provided = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^bearer\s+/i, '');
    if (!provided || provided !== exportKey) {
      return jsonError('Unauthorized', 401);
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return jsonError('Server env saknas.', 500);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Fetch all bars that have at least one active price
  const { data: barsData, error: barsErr } = await supabase
    .from('bars')
    .select('id,name,lat,lng,google_place_id');

  if (barsErr) return jsonError(`DB: ${barsErr.message}`, 500);

  // Fetch all active (non-deleted) prices
  const { data: pricesData, error: pricesErr } = await supabase
    .from('prices')
    .select('id,bar_id,price_sek,beverage_name,created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (pricesErr) return jsonError(`DB: ${pricesErr.message}`, 500);

  // Only include bars that have at least one active price
  const barIdsWithPrices = new Set((pricesData ?? []).map(p => (p as { bar_id: number }).bar_id));

  const places = (barsData ?? [])
    .filter(b => barIdsWithPrices.has((b as { id: number }).id))
    .map(b => {
      const bb = b as { id: number; name: string; lat: number; lng: number; google_place_id: string | null };
      return {
        id: bb.id,
        name: bb.name,
        google_place_id: bb.google_place_id ?? null,
        lat: bb.lat,
        lng: bb.lng,
      };
    });

  const prices = (pricesData ?? []).map(p => {
    const pp = p as { id: number; bar_id: number; price_sek: number; beverage_name: string | null; created_at: string };
    return {
      id: pp.id,
      place_id: pp.bar_id,
      price: pp.price_sek,
      name: pp.beverage_name ?? null,
      volume_cl: null, // not collected
      updated_at: pp.created_at,
    };
  });

  return NextResponse.json(
    { places, prices },
    {
      headers: {
        // Allow any origin — this is a public data feed
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}
