import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { AlertsFeed, StatCard, StatusPill } from '../components/Shared';
import { fmtAgo } from '../lib/geo';

/**
 * Overview — the landing page for School and RTO.
 *   School: its own fleet, with live location available per bus.
 *   RTO:    every registered bus + school + contacts, summaries only (no location).
 * Complaints, reports and the speed-limit setting live in their own sidebar pages.
 */
export default function DashboardPage({ role, config }) {
  const [buses, setBuses] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('plate');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const limit = config.speedLimitKmh;

  useEffect(() => {
    api('/buses').then(setBuses).catch((e) => setError(e.message));
    api('/alerts').then((rows) => setAlerts(rows.map((a) => ({ type: a.type, message: a.message, ts: a.ts })))).catch(() => {});
  }, [role]);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const upsert = (b) => setBuses((prev) => {
      const i = prev.findIndex((x) => x.id === b.id);
      if (i === -1) return [...prev, b];
      const copy = [...prev];
      copy[i] = { ...copy[i], ...b };
      return copy;
    });
    const ev = role === 'rto' ? 'rto:update' : 'bus:update';
    s.on(ev, upsert);
    return () => s.off(ev, upsert);
  }, [role]);

  const filtered = useMemo(() => {
    const rows = buses.filter((b) => {
      const text = `${b.plate} ${b.schoolName || ''} ${b.driverName || ''}`.toLowerCase();
      if (q && !text.includes(q.toLowerCase())) return false;
      if (status === 'ontrip' && !b.onTrip) return false;
      if (status === 'idle' && b.onTrip) return false;
      return true;
    });
    const by = {
      plate: (a, b) => a.plate.localeCompare(b.plate),
      speed: (a, b) => (b.lastSpeed || 0) - (a.lastSpeed || 0),
      violations: (a, b) => (b.violationsWeek || 0) - (a.violationsWeek || 0),
    };
    return rows.sort(by[sort] || by.plate);
  }, [buses, q, status, sort]);

  const onTripCount = buses.filter((b) => b.onTrip).length;
  const violationsWeek = role === 'rto' ? buses.reduce((s, b) => s + (b.violationsWeek || 0), 0) : null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{role === 'rto' ? 'Registered fleet' : 'Fleet overview'}</h1>
          <p>{role === 'rto'
            ? 'All school buses across Kashmir — trip summaries, violations and complaints. Live locations are not shared with RTO.'
            : 'Live status of your buses. Click a bus for the live map, speed graph and trip history.'}</p>
        </div>
        <AlertsFeed initial={alerts} />
      </div>

      <div className="stats-row">
        <StatCard label="Buses" value={buses.length} />
        <StatCard label="On trip now" value={onTripCount} tone={onTripCount ? 'good' : ''} />
        {role === 'rto' && <StatCard label="Violations · 7 days" value={violationsWeek ?? '—'} tone={violationsWeek ? 'bad' : ''} />}
        <StatCard label="Speed limit" value={`${limit} km/h`} hint="Change in Settings" />
      </div>

      <div className="filters">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
          <input placeholder={role === 'rto' ? 'Search plate, school or driver…' : 'Search plate or driver…'} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="all">All buses</option>
          <option value="ontrip">On trip</option>
          <option value="idle">Not on trip</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="plate">Sort · plate</option>
          <option value="speed">Sort · speed</option>
          {role === 'rto' && <option value="violations">Sort · violations</option>}
        </select>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Plate</th>
                {role === 'rto' && <th>School</th>}
                <th>Driver</th>
                {role === 'rto' && <th>Contact</th>}
                <th>Status</th>
                <th>Speed</th>
                {role === 'rto' ? <th>Violations · 7d</th> : <th>Battery</th>}
                {role === 'rto' && <th>Open complaints</th>}
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const speeding = (b.lastSpeed || 0) > Number(limit) && b.onTrip;
                const flagged = speeding || (role === 'rto' && (b.violationsWeek || 0) > 0);
                return (
                  <tr key={b.id} className={flagged ? 'row-bad' : ''} onClick={() => navigate(`/bus/${b.id}`)}>
                    <td className="plate-cell">{b.plate}</td>
                    {role === 'rto' && <td>{b.schoolName}</td>}
                    <td>{b.driverName}</td>
                    {role === 'rto' && <td className="small muted">{b.driverPhone || '—'}</td>}
                    <td><StatusPill onTrip={b.onTrip} /></td>
                    <td className={`num ${speeding ? 'speed-bad' : ''}`}>{b.lastSpeed != null ? `${Math.round(b.lastSpeed)} km/h` : '—'}</td>
                    {role === 'rto'
                      ? <td className={`num ${(b.violationsWeek || 0) > 0 ? 'speed-bad' : ''}`}>{b.violationsWeek ?? 0}</td>
                      : <td className="num">{b.lastBattery != null ? `${Math.round(b.lastBattery)}%` : '—'}</td>}
                    {role === 'rto' && <td className="num">{b.openComplaints ?? 0}</td>}
                    <td className="small muted">{fmtAgo(b.lastSeen)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan="9"><p className="empty">No buses match the current filters.</p></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
