/** Geo helpers shared across pages. */

export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Straight-line ETA estimate in minutes (marked "approx" in the UI).
 * Uses recent speed with a floor so a bus at a stop doesn't show ETA = ∞.
 */
export function etaMinutes(fromLat, fromLng, toLat, toLng, speedKmh) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => typeof v !== 'number')) return null;
  const distKm = haversineM(fromLat, fromLng, toLat, toLng) / 1000;
  const effSpeed = Math.max(speedKmh || 0, 12); // 12 km/h floor for city traffic
  return Math.round((distKm / effSpeed) * 60);
}

/** Color scale used everywhere: green = slow, blue = mid, red = above limit. */
export function speedColor(speed, limit) {
  if (speed >= limit) return '#ba2525';
  if (speed >= limit * 0.6) return '#3555b8';
  return '#1a7f4b';
}

export function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
