'use strict';
/** REST API. All routes are mounted under /api (see index.js). */
const express = require('express');
const { db, getSetting, setSetting } = require('./db');
const { login, authRequired } = require('./auth');
const trips = require('./tripService');
const { downsample } = require('./util');

const router = express.Router();

// ---------- public ----------
router.post('/auth/login', (req, res) => {
  const { role, username, password } = req.body || {};
  if (!role || !username || !password) return res.status(400).json({ error: 'role, username, password required' });
  const result = login(role, username, password);
  if (!result) return res.status(401).json({ error: 'Invalid credentials' });
  res.json(result);
});

router.get('/config', (_req, res) => {
  res.json({
    mapsApiKey: process.env.MAPS_API_KEY || '',
    speedLimitKmh: trips.speedLimit(),
  });
});

// ---------- me ----------
router.get('/me', authRequired(), (req, res) => {
  if (req.user.role === 'parent') {
    const u = db.prepare('SELECT pickup_lat, pickup_lng, kid_picked_up FROM users WHERE id=?').get(req.user.id);
    return res.json({ ...req.user, pickupLat: u?.pickup_lat, pickupLng: u?.pickup_lng, kidPickedUp: !!u?.kid_picked_up });
  }
  res.json(req.user);
});

// ---------- buses ----------
function busRowsForUser(user) {
  const all = db.prepare('SELECT b.*, s.name AS school_name FROM buses b JOIN schools s ON s.id=b.school_id ORDER BY b.plate').all();
  if (user.role === 'rto') return all.map(trips.busForRto);
  if (user.role === 'school') return all.filter((b) => b.school_id === user.schoolId).map(trips.busPublic);
  if (user.role === 'parent' || user.role === 'driver') return all.filter((b) => b.id === user.busId).map(trips.busPublic);
  return [];
}

router.get('/buses', authRequired(), (req, res) => res.json(busRowsForUser(req.user)));

function assertBusAccess(req, res) {
  const bus = trips.getBus(Number(req.params.id));
  if (!bus) { res.status(404).json({ error: 'Bus not found' }); return null; }
  const u = req.user;
  const ok =
    u.role === 'rto' ||
    (u.role === 'school' && bus.school_id === u.schoolId) ||
    ((u.role === 'parent' || u.role === 'driver') && bus.id === u.busId);
  if (!ok) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return bus;
}

router.get('/buses/:id', authRequired(), (req, res) => {
  const bus = assertBusAccess(req, res);
  if (!bus) return;
  const view = req.user.role === 'rto' ? trips.busForRto(bus) : trips.busPublic(bus);
  const lastTrip = db.prepare('SELECT * FROM trips WHERE bus_id=? ORDER BY started_at DESC LIMIT 1').get(bus.id);
  res.json({ ...view, lastTrip: lastTrip || null });
});

// Trip list for a bus (RTO allowed: summaries only, no coordinates included here)
router.get('/buses/:id/trips', authRequired(), (req, res) => {
  const bus = assertBusAccess(req, res);
  if (!bus) return;
  const rows = db.prepare(
    `SELECT id, started_at, ended_at, max_speed, avg_speed, distance_m, violation_count
     FROM trips WHERE bus_id=? ORDER BY started_at DESC LIMIT 100`
  ).all(bus.id);
  res.json(rows);
});

// Live points of the current trip (for chart bootstrap when opening a bus page)
router.get('/buses/:id/live', authRequired(), (req, res) => {
  const bus = assertBusAccess(req, res);
  if (!bus) return;
  if (!bus.on_trip || !bus.current_trip_id) return res.json({ trip: null, points: [] });
  const trip = db.prepare('SELECT * FROM trips WHERE id=?').get(bus.current_trip_id);
  let pts = db.prepare('SELECT ts, lat, lng, speed FROM points WHERE trip_id=? ORDER BY ts').all(trip.id);
  if (req.user.role === 'rto') pts = pts.map(({ ts, speed }) => ({ ts, speed })); // strip location for RTO
  res.json({ trip, points: downsample(pts, 900) });
});

// Full detail of one (past or current) trip: points + stops + violations
router.get('/trips/:id', authRequired(), (req, res) => {
  const trip = db.prepare('SELECT * FROM trips WHERE id=?').get(Number(req.params.id));
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  req.params.id = String(trip.bus_id);
  const bus = assertBusAccess(req, res);
  if (!bus) return;

  let points = db.prepare('SELECT ts, lat, lng, speed FROM points WHERE trip_id=? ORDER BY ts').all(trip.id);
  let stops = db.prepare('SELECT * FROM stops WHERE trip_id=? ORDER BY started_at').all(trip.id);
  const violations = db.prepare('SELECT ts, speed, threshold FROM violations WHERE trip_id=? ORDER BY ts').all(trip.id);
  if (req.user.role === 'rto') {
    points = points.map(({ ts, speed }) => ({ ts, speed }));
    stops = stops.map(({ started_at, duration_s }) => ({ started_at, duration_s }));
  }
  res.json({ trip, points: downsample(points, 1200), stops, violations });
});

// ---------- alerts ----------
router.get('/alerts', authRequired(), (req, res) => {
  const limit = 50;
  let rows;
  if (req.user.role === 'rto') {
    rows = db.prepare(`SELECT a.*, b.plate, s.name school_name FROM alerts a JOIN buses b ON b.id=a.bus_id JOIN schools s ON s.id=a.school_id ORDER BY ts DESC LIMIT ?`).all(limit);
  } else if (req.user.role === 'school') {
    rows = db.prepare(`SELECT a.*, b.plate, s.name school_name FROM alerts a JOIN buses b ON b.id=a.bus_id JOIN schools s ON s.id=a.school_id WHERE a.school_id=? ORDER BY ts DESC LIMIT ?`).all(req.user.schoolId, limit);
  } else if (req.user.role === 'parent') {
    rows = db.prepare(`SELECT a.*, b.plate, s.name school_name FROM alerts a JOIN buses b ON b.id=a.bus_id JOIN schools s ON s.id=a.school_id WHERE a.bus_id=? ORDER BY ts DESC LIMIT ?`).all(req.user.busId, limit);
  } else rows = [];
  res.json(rows);
});

// ---------- RTO summary ----------
router.get('/rto/summary', authRequired('rto'), (_req, res) => {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const topViolators = db.prepare(
    `SELECT b.id, b.plate, s.name school_name, COUNT(v.id) n
     FROM violations v JOIN buses b ON b.id=v.bus_id JOIN schools s ON s.id=b.school_id
     WHERE v.ts>? GROUP BY b.id ORDER BY n DESC LIMIT 10`
  ).all(weekAgo);
  const topComplaints = db.prepare(
    `SELECT b.id, b.plate, s.name school_name,
            COUNT(c.id) total, SUM(CASE WHEN c.status='unresolved' THEN 1 ELSE 0 END) open
     FROM complaints c JOIN buses b ON b.id=c.bus_id JOIN schools s ON s.id=b.school_id
     GROUP BY b.id ORDER BY total DESC LIMIT 10`
  ).all();
  const tripsWeek = db.prepare('SELECT COUNT(*) n FROM trips WHERE started_at>?').get(weekAgo).n;
  const violationsWeek = db.prepare('SELECT COUNT(*) n FROM violations WHERE ts>?').get(weekAgo).n;
  const busesOnTrip = db.prepare('SELECT COUNT(*) n FROM buses WHERE on_trip=1').get().n;
  res.json({ topViolators, topComplaints, tripsWeek, violationsWeek, busesOnTrip, speedLimitKmh: trips.speedLimit() });
});

// ---------- settings ----------
router.put('/settings/speed-limit', authRequired('rto', 'school'), (req, res) => {
  const v = Number(req.body?.value);
  if (!Number.isFinite(v) || v < 5 || v > 120) return res.status(400).json({ error: 'value must be 5–120 km/h' });
  setSetting('speed_limit_kmh', v);
  res.json({ ok: true, speedLimitKmh: v });
});

// ---------- parent ----------
router.put('/parent/pickup', authRequired('parent'), (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'lat/lng required' });
  db.prepare('UPDATE users SET pickup_lat=?, pickup_lng=? WHERE id=?').run(lat, lng, req.user.id);
  res.json({ ok: true });
});

router.put('/parent/kid-state', authRequired('parent'), (req, res) => {
  const pickedUp = req.body?.pickedUp ? 1 : 0;
  db.prepare('UPDATE users SET kid_picked_up=? WHERE id=?').run(pickedUp, req.user.id);
  res.json({ ok: true, kidPickedUp: !!pickedUp });
});

// ---------- complaints ----------
function complaintView(c) {
  return {
    id: c.id, title: c.title, status: c.status, busId: c.bus_id, plate: c.plate,
    parentName: c.parent_name, createdAt: c.created_at, resolvedAt: c.resolved_at, resolveMessage: c.resolve_message,
  };
}

router.get('/complaints', authRequired('parent', 'school'), (req, res) => {
  const base = `SELECT c.*, b.plate, u.name parent_name FROM complaints c JOIN buses b ON b.id=c.bus_id JOIN users u ON u.id=c.parent_id`;
  const rows = req.user.role === 'parent'
    ? db.prepare(`${base} WHERE c.parent_id=? ORDER BY c.created_at DESC`).all(req.user.id)
    : db.prepare(`${base} WHERE c.school_id=? ORDER BY c.status DESC, c.created_at DESC`).all(req.user.schoolId);
  res.json(rows.map(complaintView));
});

router.post('/complaints', authRequired('parent'), (req, res) => {
  const { title, text } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const bus = db.prepare('SELECT * FROM buses WHERE id=?').get(req.user.busId);
  if (!bus) return res.status(400).json({ error: 'No bus assigned to this parent' });
  const ts = Date.now();
  const id = db.prepare('INSERT INTO complaints (parent_id,bus_id,school_id,title,created_at) VALUES (?,?,?,?,?)')
    .run(req.user.id, bus.id, bus.school_id, title.trim(), ts).lastInsertRowid;
  if (text?.trim()) {
    db.prepare('INSERT INTO complaint_messages (complaint_id,sender_role,sender_name,text,ts) VALUES (?,?,?,?,?)')
      .run(id, 'parent', req.user.name, text.trim(), ts);
  }
  const io = req.app.get('io');
  io?.to(`school:${bus.school_id}`).emit('complaint:new', { id, title: title.trim(), busId: bus.id, plate: bus.plate });
  res.json({ ok: true, id });
});

function assertComplaintAccess(req, res) {
  const c = db.prepare('SELECT c.*, b.plate, u.name parent_name FROM complaints c JOIN buses b ON b.id=c.bus_id JOIN users u ON u.id=c.parent_id WHERE c.id=?').get(Number(req.params.id));
  if (!c) { res.status(404).json({ error: 'Complaint not found' }); return null; }
  const ok = (req.user.role === 'parent' && c.parent_id === req.user.id) || (req.user.role === 'school' && c.school_id === req.user.schoolId);
  if (!ok) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return c;
}

router.get('/complaints/:id', authRequired('parent', 'school'), (req, res) => {
  const c = assertComplaintAccess(req, res);
  if (!c) return;
  const messages = db.prepare('SELECT sender_role, sender_name, text, ts FROM complaint_messages WHERE complaint_id=? ORDER BY ts').all(c.id);
  res.json({ ...complaintView(c), messages });
});

router.post('/complaints/:id/messages', authRequired('parent', 'school'), (req, res) => {
  const c = assertComplaintAccess(req, res);
  if (!c) return;
  if (c.status === 'resolved') return res.status(400).json({ error: 'Complaint is resolved — chat is closed' });
  const text = req.body?.text?.trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const ts = Date.now();
  db.prepare('INSERT INTO complaint_messages (complaint_id,sender_role,sender_name,text,ts) VALUES (?,?,?,?,?)')
    .run(c.id, req.user.role, req.user.name, text, ts);
  const msg = { complaintId: c.id, senderRole: req.user.role, senderName: req.user.name, text, ts };
  req.app.get('io')?.to(`complaint:${c.id}`).emit('complaint:message', msg);
  res.json({ ok: true, message: msg });
});

router.post('/complaints/:id/resolve', authRequired('school'), (req, res) => {
  const c = assertComplaintAccess(req, res);
  if (!c) return;
  if (c.status === 'resolved') return res.status(400).json({ error: 'Already resolved' });
  const message = req.body?.message?.trim() || 'Resolved';
  const ts = Date.now();
  db.prepare("UPDATE complaints SET status='resolved', resolved_at=?, resolve_message=? WHERE id=?").run(ts, message, c.id);
  db.prepare('INSERT INTO complaint_messages (complaint_id,sender_role,sender_name,text,ts) VALUES (?,?,?,?,?)')
    .run(c.id, 'school', req.user.name, `[RESOLVED] ${message}`, ts);
  req.app.get('io')?.to(`complaint:${c.id}`).emit('complaint:resolved', { complaintId: c.id, message, ts });
  res.json({ ok: true });
});


// ---------- school fleet & student management ----------
const { hashPassword } = require('./auth');
const { transaction } = require('./db');

function ownBus(req, res) {
  const bus = db.prepare('SELECT * FROM buses WHERE id=?').get(Number(req.params.id));
  if (!bus || bus.school_id !== req.user.schoolId) { res.status(404).json({ error: 'Bus not found in your school' }); return null; }
  return bus;
}
function ownParent(req, res) {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role='parent'").get(Number(req.params.id));
  if (!u || u.school_id !== req.user.schoolId) { res.status(404).json({ error: 'Student not found in your school' }); return null; }
  return u;
}
function deleteBusDeep(busId) {
  transaction(() => {
    db.prepare('DELETE FROM violations WHERE bus_id=?').run(busId);
    db.prepare('DELETE FROM alerts WHERE bus_id=?').run(busId);
    db.prepare('DELETE FROM complaints WHERE bus_id=?').run(busId); // messages cascade
    db.prepare('DELETE FROM trips WHERE bus_id=?').run(busId);      // points/stops cascade
    db.prepare('UPDATE users SET bus_id=NULL WHERE bus_id=?').run(busId);
    db.prepare('DELETE FROM buses WHERE id=?').run(busId);
  });
}

// Parents/students of this school, with their assigned bus
router.get('/school/parents', authRequired('school'), (req, res) => {
  const rows = db.prepare(
    `SELECT u.id, u.username, u.name, u.bus_id, b.plate
     FROM users u LEFT JOIN buses b ON b.id=u.bus_id
     WHERE u.role='parent' AND u.school_id=? ORDER BY u.name`
  ).all(req.user.schoolId);
  res.json(rows.map((r) => ({ id: r.id, username: r.username, name: r.name, busId: r.bus_id, plate: r.plate })));
});

router.post('/school/buses', authRequired('school'), (req, res) => {
  const { plate, driverName, driverPhone, password } = req.body || {};
  if (!plate?.trim() || !driverName?.trim()) return res.status(400).json({ error: 'Plate and driver name are required' });
  if (db.prepare('SELECT id FROM buses WHERE plate=? COLLATE NOCASE').get(plate.trim())) {
    return res.status(400).json({ error: 'A bus with this plate already exists' });
  }
  const school = db.prepare('SELECT * FROM schools WHERE id=?').get(req.user.schoolId);
  const id = db.prepare(
    `INSERT INTO buses (plate,password_hash,school_id,driver_name,driver_phone,dest_name,dest_lat,dest_lng)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(plate.trim().toUpperCase(), hashPassword(password?.trim() || 'driver123'), school.id,
        driverName.trim(), driverPhone?.trim() || null, school.name, school.lat, school.lng).lastInsertRowid;
  res.json({ ok: true, id });
});

router.put('/school/buses/:id', authRequired('school'), (req, res) => {
  const bus = ownBus(req, res);
  if (!bus) return;
  const { driverName, driverPhone, password } = req.body || {};
  if (driverName?.trim()) db.prepare('UPDATE buses SET driver_name=? WHERE id=?').run(driverName.trim(), bus.id);
  if (driverPhone !== undefined) db.prepare('UPDATE buses SET driver_phone=? WHERE id=?').run(driverPhone?.trim() || null, bus.id);
  if (password?.trim()) db.prepare('UPDATE buses SET password_hash=? WHERE id=?').run(hashPassword(password.trim()), bus.id);
  res.json({ ok: true });
});

router.delete('/school/buses/:id', authRequired('school'), (req, res) => {
  const bus = ownBus(req, res);
  if (!bus) return;
  if (bus.on_trip) return res.status(400).json({ error: 'Bus is on a trip — end the trip before removing it' });
  deleteBusDeep(bus.id);
  res.json({ ok: true });
});

router.post('/school/parents', authRequired('school'), (req, res) => {
  const { username, name, password, busId } = req.body || {};
  if (!username?.trim() || !name?.trim()) return res.status(400).json({ error: 'Username and student name are required' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username.trim())) {
    return res.status(400).json({ error: 'This username is already taken' });
  }
  if (busId) {
    const b = db.prepare('SELECT * FROM buses WHERE id=?').get(busId);
    if (!b || b.school_id !== req.user.schoolId) return res.status(400).json({ error: 'Invalid bus' });
  }
  const id = db.prepare(
    `INSERT INTO users (role,username,password_hash,name,school_id,bus_id) VALUES ('parent',?,?,?,?,?)`
  ).run(username.trim(), hashPassword(password?.trim() || 'parent123'), name.trim(), req.user.schoolId, busId || null).lastInsertRowid;
  res.json({ ok: true, id });
});

router.put('/school/parents/:id', authRequired('school'), (req, res) => {
  const u = ownParent(req, res);
  if (!u) return;
  const { busId, name, password } = req.body || {};
  if (busId !== undefined) {
    if (busId) {
      const b = db.prepare('SELECT * FROM buses WHERE id=?').get(busId);
      if (!b || b.school_id !== req.user.schoolId) return res.status(400).json({ error: 'Invalid bus' });
    }
    db.prepare('UPDATE users SET bus_id=? WHERE id=?').run(busId || null, u.id);
  }
  if (name?.trim()) db.prepare('UPDATE users SET name=? WHERE id=?').run(name.trim(), u.id);
  if (password?.trim()) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password.trim()), u.id);
  res.json({ ok: true });
});

router.delete('/school/parents/:id', authRequired('school'), (req, res) => {
  const u = ownParent(req, res);
  if (!u) return;
  transaction(() => {
    db.prepare('DELETE FROM complaints WHERE parent_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  });
  res.json({ ok: true });
});

/**
 * CSV import (client parses the file and sends JSON rows).
 *   buses:    [{plate, driver, phone?, password?}]        — upsert by plate
 *   students: [{username, name, plate?, password?}]       — upsert by username
 */
router.post('/school/import', authRequired('school'), (req, res) => {
  const { type, rows } = req.body || {};
  if (!Array.isArray(rows) || !['buses', 'students'].includes(type)) {
    return res.status(400).json({ error: 'type (buses|students) and rows are required' });
  }
  const school = db.prepare('SELECT * FROM schools WHERE id=?').get(req.user.schoolId);
  let created = 0, updated = 0;
  const errors = [];

  for (const [i, r] of rows.entries()) {
    try {
      if (type === 'buses') {
        const plate = r.plate?.trim().toUpperCase();
        if (!plate || !r.driver?.trim()) throw new Error('plate and driver are required');
        const existing = db.prepare('SELECT * FROM buses WHERE plate=? COLLATE NOCASE').get(plate);
        if (existing) {
          if (existing.school_id !== school.id) throw new Error('plate belongs to another school');
          db.prepare('UPDATE buses SET driver_name=?, driver_phone=? WHERE id=?').run(r.driver.trim(), r.phone?.trim() || null, existing.id);
          if (r.password?.trim()) db.prepare('UPDATE buses SET password_hash=? WHERE id=?').run(hashPassword(r.password.trim()), existing.id);
          updated++;
        } else {
          db.prepare(`INSERT INTO buses (plate,password_hash,school_id,driver_name,driver_phone,dest_name,dest_lat,dest_lng)
                      VALUES (?,?,?,?,?,?,?,?)`)
            .run(plate, hashPassword(r.password?.trim() || 'driver123'), school.id, r.driver.trim(), r.phone?.trim() || null, school.name, school.lat, school.lng);
          created++;
        }
      } else {
        const username = r.username?.trim();
        if (!username || !r.name?.trim()) throw new Error('username and name are required');
        let busId = null;
        if (r.plate?.trim()) {
          const b = db.prepare('SELECT * FROM buses WHERE plate=? COLLATE NOCASE').get(r.plate.trim());
          if (!b || b.school_id !== school.id) throw new Error(`bus ${r.plate} not found in your school`);
          busId = b.id;
        }
        const existing = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        if (existing) {
          if (existing.role !== 'parent' || existing.school_id !== school.id) throw new Error('username belongs to another account');
          db.prepare('UPDATE users SET name=?, bus_id=? WHERE id=?').run(r.name.trim(), busId, existing.id);
          if (r.password?.trim()) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(r.password.trim()), existing.id);
          updated++;
        } else {
          db.prepare(`INSERT INTO users (role,username,password_hash,name,school_id,bus_id) VALUES ('parent',?,?,?,?,?)`)
            .run(username, hashPassword(r.password?.trim() || 'parent123'), r.name.trim(), school.id, busId);
          created++;
        }
      }
    } catch (e) {
      errors.push(`Row ${i + 2}: ${e.message}`);
    }
  }
  res.json({ ok: true, created, updated, errors });
});

module.exports = router;
