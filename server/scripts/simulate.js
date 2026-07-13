'use strict';
/**
 * GPS simulator — replays realistic Srinagar bus routes through the REAL
 * pipeline (REST login + Socket.IO driver events), so everything downstream
 * (dashboard, parent view, charts, alerts, violations) behaves exactly as it
 * would with a phone. Great as a demo fallback if stage WiFi/GPS misbehaves.
 *
 * Usage:
 *   npm run simulate                          # simulates JK01A1111 + JK05C3333
 *   node scripts/simulate.js --bus JK01A1111  # one specific bus
 *   node scripts/simulate.js --speedup 4      # 4x faster playback
 *   node scripts/simulate.js --url http://localhost:8080
 */
const { io } = require('socket.io-client');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
}
const URL = arg('url', 'http://localhost:8080');
const SPEEDUP = Number(arg('speedup', 3));
const ONLY_BUS = arg('bus', null);

/**
 * Routes: waypoints [lat, lng] roughly following real Srinagar roads,
 * plus a speed profile. Segments between waypoints are interpolated at 1 Hz.
 * targetKmh > 40 on some segments intentionally triggers overspeed alerts;
 * dwellS creates stops (one long enough to trigger the long-stop alert).
 */
const ROUTES = {
  // Hazratbal -> Foreshore Road -> Nishat -> Boulevard -> Dalgate -> school area
  JK01A1111: [
    { lat: 34.1279, lng: 74.8378, targetKmh: 0, dwellS: 5 },
    { lat: 34.1215, lng: 74.8455, targetKmh: 32 },
    { lat: 34.1148, lng: 74.8554, targetKmh: 38 },
    { lat: 34.1088, lng: 74.8635, targetKmh: 55 },  // overspeed burst on Foreshore Rd
    { lat: 34.1010, lng: 74.8672, targetKmh: 48 },
    { lat: 34.0921, lng: 74.8681, targetKmh: 30, dwellS: 150 }, // pickup stop -> long-stop alert
    { lat: 34.0838, lng: 74.8623, targetKmh: 35 },
    { lat: 34.0800, lng: 74.8480, targetKmh: 42 },
    { lat: 34.0757, lng: 74.8356, targetKmh: 30, dwellS: 40 },  // short pickup
    { lat: 34.0742, lng: 74.8264, targetKmh: 28 },
    { lat: 34.0693, lng: 74.8221, targetKmh: 25 },
    { lat: 34.0651, lng: 74.8188, targetKmh: 15 }, // Green Valley school
  ],
  // Lal Chowk -> Residency Rd -> Dalgate -> Gupkar -> Tyndale Biscoe area
  JK05C3333: [
    { lat: 34.0715, lng: 74.8090, targetKmh: 0, dwellS: 5 },
    { lat: 34.0741, lng: 74.8151, targetKmh: 25 },
    { lat: 34.0748, lng: 74.8230, targetKmh: 35 },
    { lat: 34.0779, lng: 74.8318, targetKmh: 50 },  // overspeed
    { lat: 34.0817, lng: 74.8385, targetKmh: 33, dwellS: 60 },
    { lat: 34.0838, lng: 74.8330, targetKmh: 30 },
    { lat: 34.0801, lng: 74.8203, targetKmh: 38 },
    { lat: 34.0770, lng: 74.8125, targetKmh: 25 },
    { lat: 34.0748, lng: 74.8090, targetKmh: 12 }, // Tyndale Biscoe school
  ],
};

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
function distM(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function headingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Expand waypoints into a 1 Hz stream of {lat,lng,speedKmh,heading}. */
function buildTicks(route) {
  const ticks = [];
  let speed = 0;
  for (let i = 0; i < route.length; i++) {
    const wp = route[i];
    if (wp.dwellS) for (let s = 0; s < wp.dwellS; s++) ticks.push({ lat: wp.lat, lng: wp.lng, speedKmh: 0, heading: 0 });
    const next = route[i + 1];
    if (!next) break;
    const target = next.targetKmh ?? 30;
    const d = distM(wp, next);
    const hdg = headingDeg(wp, next);
    let covered = 0;
    let pos = { ...wp };
    while (covered < d) {
      // ease toward target speed with a little noise
      speed += Math.max(-6, Math.min(6, target - speed)) * 0.35 + (Math.random() - 0.5) * 3;
      speed = Math.max(0, speed);
      const step = (speed / 3.6); // meters this second
      covered = Math.min(d, covered + step);
      const f = covered / d;
      pos = { lat: wp.lat + (next.lat - wp.lat) * f, lng: wp.lng + (next.lng - wp.lng) * f };
      ticks.push({ lat: pos.lat, lng: pos.lng, speedKmh: Math.round(speed * 10) / 10, heading: hdg });
      if (ticks.length > 100000) return ticks; // safety
    }
  }
  return ticks;
}

async function loginDriver(plate) {
  const res = await fetch(`${URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'driver', username: plate, password: 'driver123' }),
  });
  if (!res.ok) throw new Error(`login failed for ${plate}: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function simulateBus(plate, route) {
  const token = await loginDriver(plate);
  const socket = io(URL, { auth: { token }, transports: ['websocket'] });
  await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
  console.log(`[${plate}] connected, starting trip (speedup x${SPEEDUP})`);

  const started = await new Promise((res) => socket.emit('trip:start', res));
  if (!started?.ok) throw new Error(`[${plate}] trip:start failed: ${started?.error}`);

  const ticks = buildTicks(route);
  let battery = 78 + Math.random() * 15;
  let i = 0;
  const t0 = Date.now();

  while (i < ticks.length) {
    // send a batch of 3 simulated seconds per message (like the real client)
    const batch = [];
    for (let k = 0; k < 3 && i < ticks.length; k++, i++) {
      const t = ticks[i];
      batch.push({ ts: t0 + i * 1000, lat: t.lat, lng: t.lng, speedKmh: t.speedKmh, heading: t.heading, accuracy: 5 });
    }
    battery -= 0.002 * batch.length;
    const ack = await emitAck(socket, 'trip:points', { points: batch, battery: Math.round(battery) });
    if (!ack?.ok) console.warn(`[${plate}] batch rejected:`, ack?.error);
    if (i % 60 === 0) console.log(`[${plate}] ${i}/${ticks.length}s  speed=${ticks[Math.min(i, ticks.length - 1)].speedKmh} km/h`);
    await new Promise((r) => setTimeout(r, 3000 / SPEEDUP));
  }

  await emitAck(socket, 'trip:end');
  console.log(`[${plate}] trip ended.`);
  socket.close();
}

(async () => {
  const plates = ONLY_BUS ? [ONLY_BUS] : Object.keys(ROUTES);
  try {
    await Promise.all(plates.map((p) => {
      if (!ROUTES[p]) throw new Error(`No route defined for ${p}. Available: ${Object.keys(ROUTES).join(', ')}`);
      return simulateBus(p, ROUTES[p]);
    }));
    console.log('Simulation complete.');
    process.exit(0);
  } catch (e) {
    console.error('Simulation failed:', e.message);
    process.exit(1);
  }
})();
