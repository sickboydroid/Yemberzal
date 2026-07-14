# Yemberzal — Architecture

## Overview

```
┌─────────────┐   HTTPS/WSS (same WiFi)   ┌──────────────────────────────┐
│ Driver phone │ ─── trip:points ────────▶ │  Node.js server               │
│ (web app)    │ ◀── acks ──────────────── │  Express REST + Socket.IO     │
└─────────────┘                            │  trip engine (tripService)    │
┌─────────────┐                            │  SQLite (node:sqlite, 1 file) │
│ Parent phone │ ◀── bus:update/points ─── │                              │
└─────────────┘                            └──────────────┬───────────────┘
┌─────────────┐  bus:update (own school)                  │ serves
│ School web   │ ◀────────────────────────                │ client/dist
└─────────────┘                                           ▼
┌─────────────┐  rto:update (sanitized, NO location)  React SPA (Vite)
│ RTO web      │ ◀────────────────────────             one app, 4 role UIs
└─────────────┘
```

**One server, one web app.** The React app renders a different UI per role after login.
Phones use the same app over LAN HTTPS (self-signed cert generated at first run —
geolocation requires a secure context on mobile browsers).

## Key decisions

| Decision | Why |
|---|---|
| Web app for driver/parent instead of React Native | Zero-install demo on any phone via WiFi; the socket protocol is identical for a future native app |
| Built-in `node:sqlite` instead of MongoDB | Zero setup on the demo machine, no native compilation. All DB access is confined to `db.js` + prepared statements, so a Mongo swap touches one layer |
| Socket.IO (not raw WebSocket) | Rooms, acks (needed for offline buffering), auto-reconnect, polling fallback |
| Self-signed HTTPS on :8443 | Mobile browsers only expose GPS on secure origins; cert includes the LAN IPs as SANs |
| Straight-line ETA (haversine ÷ recent speed, 12 km/h floor) | No Directions API quota burned every second; labeled "approx" in the UI. Swap point: `client/src/lib/geo.js#etaMinutes` |
| JWT auth | Stateless, works for both REST (`Authorization: Bearer`) and socket handshake (`auth.token`) |

## Privacy model (matches the RTO one-pager)

- Parents see **only their assigned bus**; auto-joined to exactly that bus room.
- Schools see only their own buses (`school:<id>` room, server-validated).
- **RTO never receives coordinates.** `busForRto()` strips location; RTO REST responses
  drop lat/lng from points and stops; RTO cannot join bus rooms. It gets speed, trips,
  violations, complaints — enough for risk-based inspection, nothing for live surveillance.
- Viewer streams start on `watch:bus` and stop on `unwatch:bus` (page leave).
- Retention: max 100 trips per bus **and** 7-day pruning of trips/violations/alerts.

## Data model (SQLite)

```
schools(id, username, password_hash, name, lat, lng, contact_phone)
buses(id, plate*, password_hash, school_id→, driver_name, driver_phone,
      dest_name, dest_lat, dest_lng, on_trip, current_trip_id,
      last_lat, last_lng, last_speed, last_heading, last_battery, last_seen)
users(id, role[rto|parent], username, password_hash, name, school_id→, bus_id→,
      pickup_lat, pickup_lng, kid_picked_up)          -- parents & RTO
trips(id, bus_id→, started_at, ended_at, max_speed, avg_speed, distance_m,
      violation_count, end_lat, end_lng)
points(id, trip_id→, ts, lat, lng, speed, heading, accuracy, battery)  -- 1/sec
stops(id, trip_id→, lat, lng, started_at, duration_s)
violations(id, bus_id→, trip_id→, ts, speed, threshold)
complaints(id, parent_id→, bus_id→, school_id→, title, status, created_at,
           resolved_at, resolve_message)
complaint_messages(id, complaint_id→, sender_role, sender_name, text, ts)
alerts(id, bus_id→, school_id→, type, message, ts)
settings(key, value)                                   -- e.g. speed_limit_kmh
```
`*` = unique; `→` = foreign key. The driver logs in with the bus **plate** — driver ≡ bus.

## Trip engine (`server/src/tripService.js`)

Per incoming batch of points (driver sends 3 points every 3 s; each point = 1 s):

1. **Dedupe/order** — drop points older than the last processed one.
2. **Speed** — device speed if present, else derived (haversine ÷ Δt), clamped ≤160.
3. **Violation** — speed > limit ⇒ row + alert, ≥15 s apart (cooldown).
4. **Stop detection** — <3 km/h opens a candidate stop; ≥45 s when movement resumes ⇒
   `stops` row; ≥120 s while still stationary ⇒ one `long_stop` alert.
5. **Persist + broadcast** — points in one transaction; bus snapshot updated; full update
   to `bus:<id>` + `school:<id>` (throttled to 2 s for lists), sanitized to `rto`.
6. **End trip** — aggregates max/avg/distance, then pruning (100 trips / 7 days).

## Socket protocol

Handshake: `io(url, { auth: { token } })` — JWT verified in middleware.

| Direction | Event | Payload | Who |
|---|---|---|---|
| driver → server | `trip:start` (ack) | — | starts trip |
| driver → server | `trip:points` (ack) | `{points:[{ts,lat,lng,speedKmh,heading,accuracy}], battery}` | ack ⇒ client clears its offline buffer |
| driver → server | `trip:end` (ack) | — | finalizes trip |
| viewer → server | `watch:bus` / `unwatch:bus` | busId | school/parent only (validated) |
| viewer → server | `watch:complaint` / `unwatch:complaint` | complaintId | parent/school |
| server → viewer | `bus:update` | full bus snapshot | bus + school rooms |
| server → RTO | `rto:update` | sanitized snapshot (no location) | `rto` room |
| server → viewer | `trip:points` | chart/path points of the live trip | bus room |
| server → viewer | `trip:started` / `trip:ended` | ids + timestamps | bus room |
| server → viewer | `alert` | `{type, message, plate, ts}` | school + bus + rto |
| server → school | `complaint:new` | id/title/plate | school room |
| server → thread | `complaint:message` / `complaint:resolved` | message / closing note | complaint room |

## Offline resilience (driver)

Points are queued in memory each second and mirrored to `localStorage`. The flusher sends up
to 30 points per batch only while the socket is connected and removes them **only after the
server acks**. If the connection drops (or the page reloads), nothing is lost — the buffer
drains automatically on reconnect. The dashboard shows a red banner whenever its own live
connection is lost.

## REST API (all under `/api`)

```
POST /auth/login {role, username, password}      → {token, user}
GET  /config                                     → {mapsApiKey, speedLimitKmh}
GET  /me
GET  /buses                                      role-filtered list
GET  /buses/:id                                  detail + lastTrip
GET  /buses/:id/trips                            last 100 trip summaries
GET  /buses/:id/live                             current trip points (chart bootstrap)
GET  /trips/:id                                  points + stops + violations (RTO: no coords)
GET  /alerts                                     recent alerts, role-scoped
GET  /rto/summary                                violations/complaints leaderboards (RTO)
PUT  /settings/speed-limit {value}               school/RTO
PUT  /parent/pickup {lat, lng}                   pickup pin
PUT  /parent/kid-state {pickedUp}                ETA target toggle
GET/POST /complaints, GET /complaints/:id
POST /complaints/:id/messages, POST /complaints/:id/resolve
```

## Extension roadmap

1. **Native Android driver app** — reuse the exact socket protocol; add a foreground service
   for background tracking + a persistent notification (the web driver page is the spec).
2. **Push notifications** — the alert pipeline already centralizes events in `pushAlert()`;
   add FCM there for the 30/20/10-min ETA milestones and long-stop alerts.
3. **Route deviation** — store a reference polyline per bus; flag distance-from-route in
   `ingestPoints()` step 3.
4. **MongoDB** — reimplement `db.js` (and the few inline queries in `routes.js`) against
   Mongoose; the REST/socket contracts don't change.
5. **Hosting online** — deploy the server to any Node host with a real TLS cert; remove the
   self-signed cert block in `index.js`. Clients only need the URL changed.
6. **Hardening** — bcrypt, rate limiting, refresh tokens, input validation middleware.
