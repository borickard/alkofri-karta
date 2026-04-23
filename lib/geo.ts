// Swedish län (county) centroids. Approximate — good enough for nearest-centroid
// bucketing of bar coordinates for aggregate rankings. Boundary cases may cross
// one län in either direction; that's acceptable for aggregate statistics.
const COUNTY_CENTROIDS: { name: string; lat: number; lng: number }[] = [
  { name: 'Stockholms län',         lat: 59.40, lng: 18.10 },
  { name: 'Uppsala län',            lat: 60.00, lng: 17.70 },
  { name: 'Södermanlands län',      lat: 59.00, lng: 16.50 },
  { name: 'Östergötlands län',      lat: 58.30, lng: 15.80 },
  { name: 'Jönköpings län',         lat: 57.40, lng: 14.50 },
  { name: 'Kronobergs län',         lat: 56.80, lng: 14.60 },
  { name: 'Kalmar län',             lat: 57.00, lng: 16.20 },
  { name: 'Gotlands län',           lat: 57.50, lng: 18.50 },
  { name: 'Blekinge län',           lat: 56.20, lng: 15.20 },
  { name: 'Skåne län',              lat: 55.90, lng: 13.50 },
  { name: 'Hallands län',           lat: 56.90, lng: 12.80 },
  { name: 'Västra Götalands län',   lat: 58.20, lng: 12.40 },
  { name: 'Värmlands län',          lat: 59.70, lng: 13.30 },
  { name: 'Örebro län',             lat: 59.30, lng: 15.10 },
  { name: 'Västmanlands län',       lat: 59.60, lng: 16.50 },
  { name: 'Dalarnas län',           lat: 60.70, lng: 14.70 },
  { name: 'Gävleborgs län',         lat: 61.40, lng: 16.50 },
  { name: 'Västernorrlands län',    lat: 62.80, lng: 17.30 },
  { name: 'Jämtlands län',          lat: 63.50, lng: 14.30 },
  { name: 'Västerbottens län',      lat: 64.70, lng: 18.50 },
  { name: 'Norrbottens län',        lat: 66.70, lng: 20.00 },
];

// Major Swedish cities — used as a nearest-centroid fallback when a bar's
// address doesn't parse. Covers tätorter with population roughly >25k.
const CITY_CENTROIDS: { name: string; lat: number; lng: number }[] = [
  { name: 'Stockholm',      lat: 59.330, lng: 18.070 },
  { name: 'Göteborg',       lat: 57.710, lng: 11.970 },
  { name: 'Malmö',          lat: 55.600, lng: 13.000 },
  { name: 'Uppsala',        lat: 59.860, lng: 17.640 },
  { name: 'Västerås',       lat: 59.610, lng: 16.550 },
  { name: 'Örebro',         lat: 59.270, lng: 15.210 },
  { name: 'Linköping',      lat: 58.410, lng: 15.620 },
  { name: 'Helsingborg',    lat: 56.050, lng: 12.700 },
  { name: 'Jönköping',      lat: 57.780, lng: 14.160 },
  { name: 'Norrköping',     lat: 58.590, lng: 16.190 },
  { name: 'Lund',           lat: 55.710, lng: 13.190 },
  { name: 'Umeå',           lat: 63.830, lng: 20.260 },
  { name: 'Gävle',          lat: 60.670, lng: 17.140 },
  { name: 'Borås',          lat: 57.720, lng: 12.940 },
  { name: 'Eskilstuna',     lat: 59.370, lng: 16.510 },
  { name: 'Södertälje',     lat: 59.200, lng: 17.630 },
  { name: 'Karlstad',       lat: 59.380, lng: 13.500 },
  { name: 'Växjö',          lat: 56.880, lng: 14.810 },
  { name: 'Halmstad',       lat: 56.670, lng: 12.860 },
  { name: 'Sundsvall',      lat: 62.390, lng: 17.310 },
  { name: 'Luleå',          lat: 65.580, lng: 22.150 },
  { name: 'Trollhättan',    lat: 58.280, lng: 12.290 },
  { name: 'Östersund',      lat: 63.180, lng: 14.640 },
  { name: 'Borlänge',       lat: 60.490, lng: 15.440 },
  { name: 'Falun',          lat: 60.610, lng: 15.630 },
  { name: 'Kalmar',         lat: 56.660, lng: 16.360 },
  { name: 'Kristianstad',   lat: 56.030, lng: 14.150 },
  { name: 'Skövde',         lat: 58.390, lng: 13.850 },
  { name: 'Karlskrona',     lat: 56.160, lng: 15.590 },
  { name: 'Skellefteå',     lat: 64.750, lng: 20.950 },
  { name: 'Uddevalla',      lat: 58.350, lng: 11.940 },
  { name: 'Lidköping',      lat: 58.510, lng: 13.160 },
  { name: 'Motala',         lat: 58.540, lng: 15.030 },
  { name: 'Piteå',          lat: 65.320, lng: 21.480 },
  { name: 'Örnsköldsvik',   lat: 63.290, lng: 18.720 },
  { name: 'Nyköping',       lat: 58.750, lng: 17.010 },
  { name: 'Varberg',        lat: 57.110, lng: 12.250 },
  { name: 'Trelleborg',     lat: 55.380, lng: 13.160 },
  { name: 'Hässleholm',     lat: 56.160, lng: 13.770 },
  { name: 'Ängelholm',      lat: 56.240, lng: 12.860 },
  { name: 'Härnösand',      lat: 62.630, lng: 17.940 },
  { name: 'Landskrona',     lat: 55.870, lng: 12.830 },
  { name: 'Vänersborg',     lat: 58.380, lng: 12.320 },
  { name: 'Visby',          lat: 57.640, lng: 18.300 },
  { name: 'Ystad',          lat: 55.430, lng: 13.820 },
];

// Extract the city token from a Google formattedAddress string.
// Example: "Götgatan 78, 118 30 Stockholm, Sweden" → "Stockholm".
// Returns null when the address doesn't match the Swedish postal layout.
export function parseCityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.match(/,\s*\d{3}\s*\d{2}\s+([^,]+)\s*,\s*Sweden\s*$/i);
  return match ? match[1].trim() : null;
}

function equirectKm2(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const cosLat = Math.cos((aLat * Math.PI) / 180);
  const dLat = (bLat - aLat) * 111;
  const dLng = (bLng - aLng) * 111 * cosLat;
  return dLat * dLat + dLng * dLng;
}

// Nearest-city lookup for bars whose address didn't parse. Returns null when
// no centroid is within `maxKm` — such venues are genuinely off-grid and
// should be bucketed separately.
export function cityForLatLng(lat: number, lng: number, maxKm = 25): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: string | null = null;
  let bestDist2 = Infinity;
  for (const c of CITY_CENTROIDS) {
    const d2 = equirectKm2(lat, lng, c.lat, c.lng);
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = c.name;
    }
  }
  if (best === null) return null;
  return bestDist2 <= maxKm * maxKm ? best : null;
}

// Assign a lat/lng to the nearest Swedish county centroid. Uses an
// equirectangular approximation — accurate enough at Sweden's latitudes and
// inter-centroid distances.
export function countyForLatLng(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Okänd';
  let best = 'Okänd';
  let bestDist2 = Infinity;
  for (const c of COUNTY_CENTROIDS) {
    const d2 = equirectKm2(lat, lng, c.lat, c.lng);
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = c.name;
    }
  }
  return best;
}
