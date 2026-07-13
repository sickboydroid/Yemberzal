'use strict';
/**
 * SQLite data layer. One file (data/yemberzal.db), zero external services.
 * The schema is created on first run and seeded with demo data (see seed.js).
 * Swap-friendly: everything goes through prepared statements in this module,
 * so replacing SQLite with MongoDB later only touches this layer.
 */
const path = require('path');
const fs = require('fs');
// Built-in SQLite (Node >= 22.13) — no native compilation, no install headaches.
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'yemberzal.db'));
try { db.exec('PRAGMA journal_mode = WAL;'); } catch { /* WAL unsupported on some filesystems - default journal still works */ }
db.exec('PRAGMA foreign_keys = ON;');

/** Run fn inside a transaction (rolls back on error). */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  contact_phone TEXT
);

CREATE TABLE IF NOT EXISTS buses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  driver_name TEXT NOT NULL,
  driver_phone TEXT,
  dest_name TEXT NOT NULL,
  dest_lat REAL NOT NULL,
  dest_lng REAL NOT NULL,
  on_trip INTEGER NOT NULL DEFAULT 0,
  current_trip_id INTEGER,
  last_lat REAL, last_lng REAL,
  last_speed REAL,
  last_heading REAL,
  last_battery REAL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('rto','parent')),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  school_id INTEGER REFERENCES schools(id),
  bus_id INTEGER REFERENCES buses(id),
  pickup_lat REAL, pickup_lng REAL,
  kid_picked_up INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  max_speed REAL DEFAULT 0,
  avg_speed REAL DEFAULT 0,
  distance_m REAL DEFAULT 0,
  violation_count INTEGER DEFAULT 0,
  end_lat REAL, end_lng REAL
);
CREATE INDEX IF NOT EXISTS idx_trips_bus ON trips(bus_id, started_at);

CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  speed REAL NOT NULL,
  heading REAL, accuracy REAL, battery REAL
);
CREATE INDEX IF NOT EXISTS idx_points_trip ON points(trip_id, ts);

CREATE TABLE IF NOT EXISTS stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  lat REAL NOT NULL, lng REAL NOT NULL,
  started_at INTEGER NOT NULL,
  duration_s INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  ts INTEGER NOT NULL,
  speed REAL NOT NULL,
  threshold REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_violations_bus ON violations(bus_id, ts);

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES users(id),
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved','resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolve_message TEXT
);

CREATE TABLE IF NOT EXISTS complaint_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('parent','school')),
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bus_id INTEGER NOT NULL REFERENCES buses(id),
  school_id INTEGER NOT NULL REFERENCES schools(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, String(value));
}

module.exports = { db, transaction, getSetting, setSetting };
