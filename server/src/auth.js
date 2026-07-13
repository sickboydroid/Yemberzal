'use strict';
/**
 * Auth: 4 roles — driver (logs in with bus plate), school, parent, rto.
 * JWT bearer tokens. Password hashing is sha256+salt (fine for a prototype;
 * swap for bcrypt before production).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const SECRET = process.env.JWT_SECRET || 'yemberzal-demo-secret';
const SALT = 'yemberzal-salt';

function hashPassword(pw) {
  return crypto.createHash('sha256').update(SALT + pw).digest('hex');
}

/** Returns {token, user} or null. */
function login(role, username, password) {
  const ph = hashPassword(password);
  let payload = null;

  if (role === 'driver') {
    const bus = db
      .prepare('SELECT b.*, s.name AS school_name FROM buses b JOIN schools s ON s.id=b.school_id WHERE b.plate=? COLLATE NOCASE')
      .get(username.trim());
    if (bus && bus.password_hash === ph) {
      payload = { role: 'driver', id: bus.id, busId: bus.id, schoolId: bus.school_id, name: bus.driver_name, plate: bus.plate, schoolName: bus.school_name };
    }
  } else if (role === 'school') {
    const school = db.prepare('SELECT * FROM schools WHERE username=?').get(username.trim());
    if (school && school.password_hash === ph) {
      payload = { role: 'school', id: school.id, schoolId: school.id, name: school.name };
    }
  } else if (role === 'parent' || role === 'rto') {
    const user = db.prepare('SELECT * FROM users WHERE username=? AND role=?').get(username.trim(), role);
    if (user && user.password_hash === ph) {
      payload = { role, id: user.id, schoolId: user.school_id, busId: user.bus_id, name: user.name };
    }
  }

  if (!payload) return null;
  const token = jwt.sign(payload, SECRET, { expiresIn: '2d' });
  return { token, user: payload };
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

/** Express middleware. Usage: authRequired() or authRequired('school','rto'). */
function authRequired(...roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token && verifyToken(token);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden for role ' + user.role });
    }
    req.user = user;
    next();
  };
}

module.exports = { login, verifyToken, authRequired, hashPassword };
