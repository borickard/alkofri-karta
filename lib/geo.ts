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

// Extract the city token from a Google formattedAddress string.
// Example: "Götgatan 78, 118 30 Stockholm, Sweden" → "Stockholm".
// Returns null when the address doesn't match the Swedish postal layout.
export function parseCityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.match(/,\s*\d{3}\s*\d{2}\s+([^,]+)\s*,\s*Sweden\s*$/i);
  return match ? match[1].trim() : null;
}

// Assign a lat/lng to the nearest Swedish county centroid. Uses an
// equirectangular approximation — accurate enough at Sweden's latitudes and
// inter-centroid distances.
export function countyForLatLng(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Okänd';
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = 'Okänd';
  let bestDist = Infinity;
  for (const c of COUNTY_CENTROIDS) {
    const dLat = (c.lat - lat) * 111;
    const dLng = (c.lng - lng) * 111 * cosLat;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      best = c.name;
    }
  }
  return best;
}
