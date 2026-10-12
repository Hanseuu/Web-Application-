import { config } from '../config.js';

/**
 * Pembuat tautan Google Maps untuk halaman "Fasilitas" pada sisi penyewa.
 * Kategori di luar fasilitas milik owner (laundry, minimarket, SPBU, dll)
 * akan membuka Google Maps saat diklik.
 */

/** Tautan ke satu lokasi (pakai koordinat bila ada, kalau tidak pakai teks pencarian). */
export function placeUrl({ name, address, lat, lng, maps_query: mapsQuery }) {
  // Koordinat paling akurat; nama dipakai sebagai label pencarian bila tersedia.
  if (lat && lng) {
    if (name) {
      return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;
  }
  const query = mapsQuery || [name, address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Tautan pencarian kategori di sekitar kos, mis. "laundry terdekat". */
export function nearbySearchUrl(keyword) {
  const q = `${keyword} terdekat`;
  return `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${config.kost.lat},${config.kost.lng},16z`;
}

/** Tautan rute dari kos ke lokasi tujuan. */
export function directionsUrl({ name, address, lat, lng }) {
  const origin = `${config.kost.lat},${config.kost.lng}`;
  const destination = lat && lng ? `${lat},${lng}` : [name, address].filter(Boolean).join(' ');
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}` +
    '&travelmode=walking'
  );
}

/** Kategori tempat umum di sekitar kos yang ditawarkan ke penyewa. */
export const PLACE_CATEGORIES = [
  { code: 'laundry', label: 'Laundry', icon: '🧺', keyword: 'laundry' },
  { code: 'minimarket', label: 'Minimarket', icon: '🏪', keyword: 'minimarket' },
  { code: 'spbu', label: 'SPBU / Pom Bensin', icon: '⛽', keyword: 'SPBU' },
  { code: 'warung', label: 'Warung & Rumah Makan', icon: '🍛', keyword: 'rumah makan' },
  { code: 'apotek', label: 'Apotek & Klinik', icon: '💊', keyword: 'apotek' },
  { code: 'atm', label: 'ATM & Bank', icon: '🏧', keyword: 'ATM' },
  { code: 'masjid', label: 'Masjid', icon: '🕌', keyword: 'masjid' },
  { code: 'transportasi', label: 'Transportasi', icon: '🚌', keyword: 'stasiun' },
];

export const categoryMeta = (code) =>
  PLACE_CATEGORIES.find((c) => c.code === code) || { code, label: code, icon: '📍', keyword: code };

/** Format jarak: 450 -> "450 m", 1500 -> "1,5 km" */
export const formatDistance = (meters) => {
  if (!meters) return null;
  return meters < 1000
    ? `${meters} m`
    : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
};
