'use strict';
/**
 * Demo seed data: 2 Srinagar schools, 4 buses, 1 RTO account, 4 parents.
 * Runs only when the database is empty. All credentials are listed in README.md.
 */
const { db } = require('./db');
const { hashPassword } = require('./auth');

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM schools').get().n;
  if (count > 0) return false;

  const insSchool = db.prepare(
    'INSERT INTO schools (username,password_hash,name,lat,lng,contact_phone) VALUES (?,?,?,?,?,?)'
  );
  const insBus = db.prepare(
    `INSERT INTO buses (plate,password_hash,school_id,driver_name,driver_phone,dest_name,dest_lat,dest_lng)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insUser = db.prepare(
    `INSERT INTO users (role,username,password_hash,name,school_id,bus_id,pickup_lat,pickup_lng)
     VALUES (?,?,?,?,?,?,?,?)`
  );

  const school = hashPassword('school123');
  const driver = hashPassword('driver123');
  const parent = hashPassword('parent123');
  const rto = hashPassword('rto123');

  const gvs = insSchool.run('gvs', school, 'Green Valley Educational Institute, Srinagar', 34.0651, 74.8188, '0194-2400001').lastInsertRowid;
  const tbs = insSchool.run('tyndale', school, 'Tyndale Biscoe School, Srinagar', 34.0748, 74.809, '0194-2400002').lastInsertRowid;

  const b1 = insBus.run('JK01A1111', driver, gvs, 'Bashir Ahmad', '9906000001', 'Green Valley School', 34.0651, 74.8188).lastInsertRowid;
  const b2 = insBus.run('JK01B2222', driver, gvs, 'Mushtaq Lone', '9906000002', 'Green Valley School', 34.0651, 74.8188).lastInsertRowid;
  const b3 = insBus.run('JK05C3333', driver, tbs, 'Imran Khan', '9906000003', 'Tyndale Biscoe School', 34.0748, 74.809).lastInsertRowid;
  insBus.run('JK05D4444', driver, tbs, 'Fayaz Mir', '9906000004', 'Tyndale Biscoe School', 34.0748, 74.809);

  insUser.run('rto', 'rto', rto, 'RTO Kashmir', null, null, null, null);
  insUser.run('parent', 'parent1', parent, 'Parent of Aisha (GVS)', gvs, b1, 34.089, 74.797);
  insUser.run('parent', 'parent2', parent, 'Parent of Zaid (GVS)', gvs, b2, 34.0805, 74.8425);
  insUser.run('parent', 'parent3', parent, 'Parent of Sana (TBS)', tbs, b3, 34.0912, 74.8087);
  insUser.run('parent', 'parent4', parent, 'Parent of Omar (TBS)', tbs, b3, 34.0862, 74.8021);

  console.log('[seed] Demo data created (2 schools, 4 buses, 1 RTO, 4 parents).');
  return true;
}

module.exports = { seedIfEmpty };
