import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { StatusPill } from '../components/Shared';
import { Modal, IconBtn, icons } from '../components/Ui';

/**
 * Fleet management (school):
 *   Buses    — add / edit driver & password / remove
 *   Students — add / assign to a bus / remove
 *   CSV import for both (upsert), so schools can onboard real data in one step.
 */
export default function FleetPage() {
  const [tab, setTab] = useState('buses');
  const [buses, setBuses] = useState([]);
  const [students, setStudents] = useState([]);
  const [modal, setModal] = useState(null); // {kind: 'add-bus'|'edit-bus'|'add-student'|'import'|'confirm-delete', ...}
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // {tone:'ok'|'err', text}

  const refresh = () => Promise.all([
    api('/buses').then(setBuses),
    api('/school/parents').then(setStudents),
  ]).catch((e) => setNotice({ tone: 'err', text: e.message }));

  useEffect(() => { refresh(); }, []);

  const flash = (text, tone = 'ok') => {
    setNotice({ tone, text });
    setTimeout(() => setNotice(null), 4000);
  };

  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setModal(null);
      if (successMsg) flash(successMsg);
    } catch (e) {
      flash(e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const assignBus = (student, busId) =>
    run(() => api(`/school/parents/${student.id}`, { method: 'PUT', body: { busId: busId ? Number(busId) : null } }),
      `${student.name} ${busId ? 'assigned to ' + buses.find((b) => b.id === Number(busId))?.plate : 'unassigned'}`);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Fleet & students</h1>
          <p>Register buses, manage drivers, and control which bus each student is assigned to.</p>
        </div>
        <div className="row">
          <button className="btn secondary sm" onClick={() => setModal({ kind: 'import' })}>{icons.upload} Import CSV</button>
          {tab === 'buses'
            ? <button className="btn sm" onClick={() => setModal({ kind: 'add-bus' })}>{icons.plus} Add bus</button>
            : <button className="btn sm" onClick={() => setModal({ kind: 'add-student' })}>{icons.plus} Add student</button>}
        </div>
      </div>

      {notice && <p className={notice.tone === 'ok' ? 'flash-ok' : 'flash-err'}>{notice.text}</p>}

      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'buses' ? 'active' : ''} onClick={() => setTab('buses')}>Buses ({buses.length})</button>
        <button role="tab" className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>Students ({students.length})</button>
      </div>

      {tab === 'buses' && (
        <div className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Plate</th><th>Driver</th><th>Phone</th><th>Status</th><th>Students</th><th style={{ width: 90 }} /></tr>
              </thead>
              <tbody>
                {buses.map((b) => (
                  <tr key={b.id} className="static-row">
                    <td className="plate-cell">{b.plate}</td>
                    <td>{b.driverName}</td>
                    <td className="muted">{b.driverPhone || '—'}</td>
                    <td><StatusPill onTrip={b.onTrip} /></td>
                    <td className="num">{students.filter((s) => s.busId === b.id).length}</td>
                    <td>
                      <div className="actions">
                        <IconBtn label="Edit bus" onClick={() => setModal({ kind: 'edit-bus', bus: b })}>{icons.edit}</IconBtn>
                        <IconBtn label="Remove bus" danger onClick={() => setModal({ kind: 'confirm-delete', what: 'bus', item: b })}>{icons.trash}</IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {buses.length === 0 && <tr className="static-row"><td colSpan="6"><p className="empty">No buses yet — add one or import a CSV.</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'students' && (
        <div className="card table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Student</th><th>Parent username</th><th>Assigned bus</th><th style={{ width: 60 }} /></tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="static-row">
                    <td>{s.name}</td>
                    <td className="mono small">{s.username}</td>
                    <td>
                      <select className="inline-select" value={s.busId || ''} onChange={(e) => assignBus(s, e.target.value)} disabled={busy}>
                        <option value="">— unassigned —</option>
                        {buses.map((b) => <option key={b.id} value={b.id}>{b.plate} · {b.driverName}</option>)}
                      </select>
                    </td>
                    <td>
                      <div className="actions">
                        <IconBtn label="Remove student" danger onClick={() => setModal({ kind: 'confirm-delete', what: 'student', item: s })}>{icons.trash}</IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && <tr className="static-row"><td colSpan="4"><p className="empty">No students yet — add one or import a CSV.</p></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal?.kind === 'add-bus' && <BusModal busy={busy} onClose={() => setModal(null)}
        onSave={(f) => run(() => api('/school/buses', { method: 'POST', body: f }), `Bus ${f.plate} added`)} />}
      {modal?.kind === 'edit-bus' && <BusModal bus={modal.bus} busy={busy} onClose={() => setModal(null)}
        onSave={(f) => run(() => api(`/school/buses/${modal.bus.id}`, { method: 'PUT', body: f }), `Bus ${modal.bus.plate} updated`)} />}
      {modal?.kind === 'add-student' && <StudentModal buses={buses} busy={busy} onClose={() => setModal(null)}
        onSave={(f) => run(() => api('/school/parents', { method: 'POST', body: f }), `${f.name} added`)} />}
      {modal?.kind === 'import' && <ImportModal tab={tab} busy={busy} onClose={() => setModal(null)}
        onImport={(type, rows) => run(async () => {
          const r = await api('/school/import', { method: 'POST', body: { type, rows } });
          flash(`Imported: ${r.created} created, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} error(s): ${r.errors[0]}` : ''}`,
            r.errors.length ? 'err' : 'ok');
        })} />}
      {modal?.kind === 'confirm-delete' && (
        <Modal title={`Remove ${modal.what === 'bus' ? modal.item.plate : modal.item.name}?`} onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn secondary sm" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn danger sm" disabled={busy}
                onClick={() => run(() => api(modal.what === 'bus' ? `/school/buses/${modal.item.id}` : `/school/parents/${modal.item.id}`, { method: 'DELETE' }), 'Removed')}>
                Remove permanently
              </button>
            </>
          }>
          <p className="muted small">
            {modal.what === 'bus'
              ? 'This deletes the bus with its trip history and complaints, and unassigns its students. This cannot be undone.'
              : 'This deletes the parent account and its complaint threads. This cannot be undone.'}
          </p>
        </Modal>
      )}
    </div>
  );
}

function BusModal({ bus, busy, onClose, onSave }) {
  const [f, setF] = useState({ plate: bus?.plate || '', driverName: bus?.driverName || '', driverPhone: bus?.driverPhone || '', password: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={bus ? `Edit ${bus.plate}` : 'Add bus'} onClose={onClose}
      footer={
        <>
          <button className="btn secondary sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || (!bus && (!f.plate.trim() || !f.driverName.trim()))} onClick={() => onSave(f)}>
            {bus ? 'Save changes' : 'Add bus'}
          </button>
        </>
      }>
      {!bus && (<><label>Plate number</label><input value={f.plate} onChange={set('plate')} placeholder="JK01A0000" autoCapitalize="characters" /></>)}
      <label>Driver name</label><input value={f.driverName} onChange={set('driverName')} placeholder="Full name" />
      <label>Driver phone</label><input value={f.driverPhone} onChange={set('driverPhone')} placeholder="Optional" />
      <label>{bus ? 'New driver password (leave blank to keep current)' : 'Driver password'}</label>
      <input value={f.password} onChange={set('password')} placeholder={bus ? '••••••••' : 'Defaults to driver123'} />
      {!bus && <p className="kbd-note" style={{ marginTop: 10 }}>The driver signs in with the plate number and this password. Destination is set to your school.</p>}
    </Modal>
  );
}

function StudentModal({ buses, busy, onClose, onSave }) {
  const [f, setF] = useState({ name: '', username: '', password: '', busId: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add student" onClose={onClose}
      footer={
        <>
          <button className="btn secondary sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !f.name.trim() || !f.username.trim()}
            onClick={() => onSave({ ...f, busId: f.busId ? Number(f.busId) : null })}>Add student</button>
        </>
      }>
      <label>Student name</label><input value={f.name} onChange={set('name')} placeholder="e.g. Aisha Khan" />
      <label>Parent username</label><input value={f.username} onChange={set('username')} placeholder="Used by the parent to sign in" autoCapitalize="none" />
      <label>Parent password</label><input value={f.password} onChange={set('password')} placeholder="Defaults to parent123" />
      <label>Assigned bus</label>
      <select value={f.busId} onChange={set('busId')}>
        <option value="">— assign later —</option>
        {buses.map((b) => <option key={b.id} value={b.id}>{b.plate} · {b.driverName}</option>)}
      </select>
    </Modal>
  );
}

/** Minimal CSV parser — enough for comma-separated files without quoted commas. */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return { head: [], rows: [] };
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).filter((l) => l.trim()).map((l) => {
    const cells = l.split(',').map((c) => c.trim());
    const o = {};
    head.forEach((h, i) => { o[h] = cells[i] ?? ''; });
    return o;
  });
  return { head, rows };
}

const CSV_SPECS = {
  buses: { label: 'Buses', headers: 'plate, driver, phone, password', required: ['plate', 'driver'], example: 'plate,driver,phone,password\nJK01E5555,Ali Mohammad,9906000005,driver123' },
  students: { label: 'Students', headers: 'username, name, plate, password', required: ['username', 'name'], example: 'username,name,plate,password\nparent9,Aisha Khan,JK01A1111,parent123' },
};

function ImportModal({ tab, busy, onClose, onImport }) {
  const [type, setType] = useState(tab === 'students' ? 'students' : 'buses');
  const [parsed, setParsed] = useState(null); // {rows, fileName, problem}
  const spec = CSV_SPECS[type];

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { head, rows } = parseCsv(String(reader.result));
      const missing = spec.required.filter((r) => !head.includes(r));
      setParsed({
        fileName: file.name,
        rows,
        problem: missing.length ? `Missing column(s): ${missing.join(', ')}` : rows.length === 0 ? 'No data rows found' : null,
      });
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([spec.example], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yemberzal-${type}-template.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Modal title="Import from CSV" onClose={onClose}
      footer={
        <>
          <button className="btn secondary sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !parsed || !!parsed.problem} onClick={() => onImport(type, parsed.rows)}>
            Import {parsed && !parsed.problem ? `${parsed.rows.length} row(s)` : ''}
          </button>
        </>
      }>
      <label>What are you importing?</label>
      <select value={type} onChange={(e) => { setType(e.target.value); setParsed(null); }}>
        <option value="buses">Buses</option>
        <option value="students">Students</option>
      </select>
      <label>CSV file</label>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      <p className="kbd-note" style={{ marginTop: 10 }}>
        Expected columns: <span className="mono">{spec.headers}</span>. Existing {type === 'buses' ? 'plates' : 'usernames'} are updated, new ones are created.
        {' '}<a className="link" onClick={downloadTemplate}>Download template</a>
      </p>
      {parsed && (
        parsed.problem
          ? <p className="error" style={{ marginTop: 10 }}>{parsed.fileName}: {parsed.problem}</p>
          : <p className="flash-ok" style={{ marginTop: 10 }}>{parsed.fileName}: {parsed.rows.length} row(s) ready to import.</p>
      )}
    </Modal>
  );
}
