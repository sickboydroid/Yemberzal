'use strict';
/**
 * Socket.IO layer. Clients authenticate with their JWT in the handshake:
 *   io(url, { auth: { token } })
 *
 * Rooms:
 *   school:<id>   dashboard list updates + alerts for one school
 *   rto           sanitized updates (no location) for the RTO dashboard
 *   bus:<id>      full live stream for one bus (parents / school detail page)
 *   complaint:<id> live complaint chat
 *
 * Driver events: trip:start, trip:points (ack'd — enables offline buffering), trip:end
 * Viewer events: watch:bus / unwatch:bus, watch:complaint / unwatch:complaint
 */
const { verifyToken } = require('./auth');
const { db } = require('./db');
const trips = require('./tripService');

function canSeeBus(user, busId) {
  const bus = db.prepare('SELECT * FROM buses WHERE id=?').get(busId);
  if (!bus) return false;
  if (user.role === 'school') return bus.school_id === user.schoolId;
  if (user.role === 'parent') return user.busId === bus.id;
  if (user.role === 'driver') return user.busId === bus.id;
  return false; // RTO gets summaries via the 'rto' room, never a live bus room
}

function canSeeComplaint(user, complaintId) {
  const c = db.prepare('SELECT * FROM complaints WHERE id=?').get(complaintId);
  if (!c) return false;
  if (user.role === 'parent') return c.parent_id === user.id;
  if (user.role === 'school') return c.school_id === user.schoolId;
  return false;
}

function attachSockets(io) {
  trips.setIo(io);

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    // Auto-join role rooms
    if (user.role === 'school') socket.join(`school:${user.schoolId}`);
    if (user.role === 'rto') socket.join('rto');
    if (user.role === 'parent') {
      socket.join(`bus:${user.busId}`);
      const bus = db.prepare('SELECT school_id FROM buses WHERE id=?').get(user.busId);
      if (bus) socket.join(`school-alerts-ro:${bus.school_id}`); // reserved for future use
    }

    // --- Viewer subscriptions (data streams only while someone is watching) ---
    socket.on('watch:bus', (busId, ack) => {
      if (canSeeBus(user, busId)) {
        socket.join(`bus:${busId}`);
        ack?.({ ok: true });
      } else ack?.({ ok: false, error: 'forbidden' });
    });
    socket.on('unwatch:bus', (busId) => {
      if (user.role !== 'parent' || user.busId !== busId) socket.leave(`bus:${busId}`);
    });

    socket.on('watch:complaint', (complaintId, ack) => {
      if (canSeeComplaint(user, complaintId)) {
        socket.join(`complaint:${complaintId}`);
        ack?.({ ok: true });
      } else ack?.({ ok: false, error: 'forbidden' });
    });
    socket.on('unwatch:complaint', (complaintId) => socket.leave(`complaint:${complaintId}`));

    // --- Driver events ---
    if (user.role === 'driver') {
      socket.on('trip:start', (ack) => {
        try {
          const trip = trips.startTrip(user.busId);
          ack?.({ ok: true, tripId: trip.id, startedAt: trip.started_at });
        } catch (e) {
          ack?.({ ok: false, error: e.message });
        }
      });

      // Batch of points; ack lets the driver client clear its offline buffer.
      socket.on('trip:points', (payload, ack) => {
        try {
          const { accepted } = trips.ingestPoints(user.busId, payload?.points || [], payload?.battery);
          ack?.({ ok: true, accepted });
        } catch (e) {
          ack?.({ ok: false, error: e.message });
        }
      });

      socket.on('trip:end', (ack) => {
        try {
          const tripId = trips.endTrip(user.busId);
          ack?.({ ok: true, tripId });
        } catch (e) {
          ack?.({ ok: false, error: e.message });
        }
      });
    }
  });
}

module.exports = { attachSockets };
