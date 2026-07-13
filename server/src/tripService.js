'use strict';
/**
 * Trip engine: trip lifecycle, per-second point ingestion, speed computation,
 * stop detection, speed-violation detection, long-stop alerts, data pruning.
 *
 * Emits (via the io instance injected from sockets.js):
 *   'bus:update'   -> school room + bus room (full data, incl. location)
 *   'rto:update'   -> rto room (sanitized: NO location, summary only)
 *   'trip:started' / 'trip:ended' -> school + bus + rto rooms
 *   'alert'        -> school room + bus room + rto room
 */
const { db, transaction, getSetting } = require('./db');
const { haversineM } = require('./util');

const STOP_SPEED_KMH = 3; // below this we consider the bus stationary
const STOP_MIN_S = Number(process.env.STOP_MIN_SECONDS || 45);
const LONG_STOP_S = Number(process.env.LONG_STOP_ALERT_SECONDS || 120);
const VIOLATION_COOLDOWN_MS = 15000; // don't record a violation more than once per 15s

let io = null;
function setIo(ioInstance) { io = ioInstance; }

/** In-memory per-bus runtime state (rebuilt lazily after restart). */
const runtime = new Map();

function state(busId) {
  if (!runtime.has(busId)) runtime.set(busId, { lastPoint: null, stopStart: null, lastViolationTs: 0, longStopAlerted: false, lastListEmit: 0 });
  return runtime.get(busId);
}

function speedLimit() {
  return Number(getSetting('speed_limit_kmh', process.env.SPEED_LIMIT_KMH || 40));
}

function getBus(busId) {
  return db.prepare('SELECT b.*, s.name AS school_name FROM buses b JOIN schools s ON s.id=b.school_id WHERE b.id=?').get(busId);
}

/** Public view of a bus for school/parent (includes location). */
function busPublic(bus) {
  return {
    id: bus.id, plate: bus.plate, schoolId: bus.school_id, schoolName: bus.school_name,
    driverName: bus.driver_name, driverPhone: bus.driver_phone,
    destName: bus.dest_name, destLat: bus.dest_lat, destLng: bus.dest_lng,
    onTrip: !!bus.on_trip, currentTripId: bus.current_trip_id,
    lastLat: bus.last_lat, lastLng: bus.last_lng, lastSpeed: bus.last_speed,
    lastHeading: bus.last_heading, lastBattery: bus.last_battery, lastSeen: bus.last_seen,
  };
}

/** Sanitized view for RTO: summary + speed, but NO location (per policy). */
function busForRto(bus) {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const v = db.prepare('SELECT COUNT(*) n FROM violations WHERE bus_id=? AND ts>?').get(bus.id, weekAgo).n;
  const c = db.prepare("SELECT COUNT(*) n FROM complaints WHERE bus_id=? AND status='unresolved'").get(bus.id).n;
  return {
    id: bus.id, plate: bus.plate, schoolId: bus.school_id, schoolName: bus.school_name,
    driverName: bus.driver_name, driverPhone: bus.driver_phone,
    onTrip: !!bus.on_trip, lastSpeed: bus.last_speed, lastBattery: bus.last_battery,
    lastSeen: bus.last_seen, violationsWeek: v, openComplaints: c,
  };
}

function emitBusUpdate(bus, { throttleList = true } = {}) {
  if (!io) return;
  const st = state(bus.id);
  const full = busPublic(bus);
  io.to(`bus:${bus.id}`).emit('bus:update', full);
  const now = Date.now();
  if (!throttleList || now - st.lastListEmit > 2000) {
    st.lastListEmit = now;
    io.to(`school:${bus.school_id}`).emit('bus:update', full);
    io.to('rto').emit('rto:update', busForRto(bus));
  }
}

function pushAlert(bus, type, message) {
  const ts = Date.now();
  db.prepare('INSERT INTO alerts (bus_id,school_id,type,message,ts) VALUES (?,?,?,?,?)').run(bus.id, bus.school_id, type, message, ts);
  const alert = { busId: bus.id, plate: bus.plate, schoolName: bus.school_name, type, message, ts };
  if (io) {
    io.to(`school:${bus.school_id}`).emit('alert', alert);
    io.to(`bus:${bus.id}`).emit('alert', alert);
    io.to('rto').emit('alert', alert);
  }
}

function startTrip(busId) {
  const bus = getBus(busId);
  if (!bus) throw new Error('Bus not found');
  if (bus.on_trip && bus.current_trip_id) return db.prepare('SELECT * FROM trips WHERE id=?').get(bus.current_trip_id);

  const ts = Date.now();
  const tripId = db.prepare('INSERT INTO trips (bus_id, started_at) VALUES (?,?)').run(busId, ts).lastInsertRowid;
  db.prepare('UPDATE buses SET on_trip=1, current_trip_id=? WHERE id=?').run(tripId, busId);
  runtime.delete(busId);

  const updated = getBus(busId);
  pushAlert(updated, 'trip_started', `Trip started by ${updated.driver_name} (${updated.plate})`);
  emitBusUpdate(updated, { throttleList: false });
  if (io) io.to(`bus:${busId}`).emit('trip:started', { busId, tripId, startedAt: ts });
  return { id: tripId, bus_id: busId, started_at: ts };
}

/**
 * Ingest a batch of points from the driver device.
 * points: [{ts, lat, lng, speedKmh|null, heading, accuracy}], battery: 0..100
 */
function ingestPoints(busId, points, battery) {
  const bus = getBus(busId);
  if (!bus || !bus.on_trip || !bus.current_trip_id) return { accepted: 0 };
  const tripId = bus.current_trip_id;
  const st = state(busId);
  const limit = speedLimit();

  const ins = db.prepare('INSERT INTO points (trip_id,ts,lat,lng,speed,heading,accuracy,battery) VALUES (?,?,?,?,?,?,?,?)');
  const insMany = (rows) => transaction(() => rows.forEach((r) => ins.run(...r)));

  const rows = [];
  const chartPoints = [];
  let addedDistance = 0;

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  for (const p of sorted) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || !p.ts) continue;
    if (st.lastPoint && p.ts <= st.lastPoint.ts) continue; // dedupe/out-of-order

    // Speed: prefer device-reported; else derive from previous point.
    let speed = typeof p.speedKmh === 'number' && p.speedKmh >= 0 ? p.speedKmh : null;
    if (speed === null && st.lastPoint) {
      const dt = (p.ts - st.lastPoint.ts) / 1000;
      if (dt > 0 && dt < 30) speed = (haversineM(st.lastPoint.lat, st.lastPoint.lng, p.lat, p.lng) / dt) * 3.6;
    }
    if (speed === null) speed = 0;
    speed = Math.min(speed, 160); // sanity clamp against GPS glitches

    if (st.lastPoint) addedDistance += haversineM(st.lastPoint.lat, st.lastPoint.lng, p.lat, p.lng);

    rows.push([tripId, p.ts, p.lat, p.lng, speed, p.heading ?? null, p.accuracy ?? null, battery ?? null]);
    chartPoints.push({ ts: p.ts, lat: p.lat, lng: p.lng, speed: Math.round(speed * 10) / 10 });

    // --- violation detection ---
    if (speed > limit && p.ts - st.lastViolationTs > VIOLATION_COOLDOWN_MS) {
      st.lastViolationTs = p.ts;
      db.prepare('INSERT INTO violations (bus_id,trip_id,ts,speed,threshold) VALUES (?,?,?,?,?)').run(busId, tripId, p.ts, speed, limit);
      db.prepare('UPDATE trips SET violation_count=violation_count+1 WHERE id=?').run(tripId);
      pushAlert(bus, 'overspeed', `${bus.plate} crossed ${limit} km/h (${Math.round(speed)} km/h)`);
    }

    // --- stop detection ---
    if (speed < STOP_SPEED_KMH) {
      if (!st.stopStart) { st.stopStart = p.ts; st.stopLat = p.lat; st.stopLng = p.lng; st.longStopAlerted = false; }
      const dur = (p.ts - st.stopStart) / 1000;
      if (dur >= LONG_STOP_S && !st.longStopAlerted) {
        st.longStopAlerted = true;
        pushAlert(bus, 'long_stop', `${bus.plate} has been stopped for ${Math.round(dur / 60)}+ min`);
      }
    } else if (st.stopStart) {
      const dur = (p.ts - st.stopStart) / 1000;
      if (dur >= STOP_MIN_S) {
        db.prepare('INSERT INTO stops (trip_id,lat,lng,started_at,duration_s) VALUES (?,?,?,?,?)').run(tripId, st.stopLat, st.stopLng, st.stopStart, Math.round(dur));
      }
      st.stopStart = null; st.longStopAlerted = false;
    }

    st.lastPoint = { ts: p.ts, lat: p.lat, lng: p.lng, speed };
  }

  if (rows.length) {
    insMany(rows);
    const last = st.lastPoint;
    db.prepare('UPDATE trips SET distance_m=distance_m+? WHERE id=?').run(addedDistance, tripId);
    db.prepare('UPDATE buses SET last_lat=?, last_lng=?, last_speed=?, last_heading=?, last_battery=?, last_seen=? WHERE id=?')
      .run(last.lat, last.lng, last.speed, sorted[sorted.length - 1].heading ?? null, battery ?? null, last.ts, busId);

    const updated = getBus(busId);
    emitBusUpdate(updated);
    // Stream chart points to whoever is watching this bus (parents/school detail page)
    if (io) io.to(`bus:${busId}`).emit('trip:points', { busId, tripId, points: chartPoints, battery: battery ?? null });
  }
  return { accepted: rows.length };
}

function endTrip(busId) {
  const bus = getBus(busId);
  if (!bus || !bus.current_trip_id) return null;
  const tripId = bus.current_trip_id;
  const ts = Date.now();
  const st = state(busId);

  // flush an ongoing stop
  if (st.stopStart && st.lastPoint) {
    const dur = (st.lastPoint.ts - st.stopStart) / 1000;
    if (dur >= STOP_MIN_S) {
      db.prepare('INSERT INTO stops (trip_id,lat,lng,started_at,duration_s) VALUES (?,?,?,?,?)').run(tripId, st.stopLat, st.stopLng, st.stopStart, Math.round(dur));
    }
  }

  const agg = db.prepare('SELECT MAX(speed) mx, AVG(speed) avg FROM points WHERE trip_id=?').get(tripId);
  db.prepare('UPDATE trips SET ended_at=?, max_speed=?, avg_speed=?, end_lat=?, end_lng=? WHERE id=?')
    .run(ts, agg.mx || 0, agg.avg || 0, bus.last_lat, bus.last_lng, tripId);
  db.prepare('UPDATE buses SET on_trip=0, current_trip_id=NULL WHERE id=?').run(busId);
  runtime.delete(busId);

  const updated = getBus(busId);
  pushAlert(updated, 'trip_ended', `Trip ended for ${updated.plate}`);
  emitBusUpdate(updated, { throttleList: false });
  if (io) io.to(`bus:${busId}`).emit('trip:ended', { busId, tripId, endedAt: ts });

  pruneOldData(busId);
  return tripId;
}

/** Retention policy: keep at most 100 trips per bus AND nothing older than 7 days. */
function pruneOldData(busId) {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  db.prepare('DELETE FROM trips WHERE bus_id=? AND started_at<?').run(busId, weekAgo);
  db.prepare(`DELETE FROM trips WHERE bus_id=? AND id NOT IN
      (SELECT id FROM trips WHERE bus_id=? ORDER BY started_at DESC LIMIT 100)`).run(busId, busId);
  db.prepare('DELETE FROM alerts WHERE ts<?').run(weekAgo);
  db.prepare('DELETE FROM violations WHERE ts<?').run(weekAgo);
}

module.exports = { setIo, startTrip, ingestPoints, endTrip, busPublic, busForRto, getBus, speedLimit, pruneOldData };
