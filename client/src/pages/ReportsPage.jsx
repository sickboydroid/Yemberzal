import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { StatCard } from '../components/Shared';

/** RTO: weekly compliance summaries — the risk-based inspection view. */
export default function ReportsPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api('/rto/summary').then(setSummary).catch((e) => setError(e.message));
  }, []);

  if (!summary) return <p className="empty">{error || 'Loading reports…'}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Compliance reports</h1>
          <p>Last 7 days across all registered schools. Use this to prioritise inspections — repeated violators appear first.</p>
        </div>
      </div>

      <div className="stats-row">
        <StatCard label="Trips · 7 days" value={summary.tripsWeek} />
        <StatCard label="Speed violations · 7 days" value={summary.violationsWeek} tone={summary.violationsWeek ? 'bad' : 'good'} />
        <StatCard label="Buses on trip now" value={summary.busesOnTrip} tone={summary.busesOnTrip ? 'good' : ''} />
        <StatCard label="Speed limit" value={`${summary.speedLimitKmh} km/h`} hint="Change in Settings" />
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title">Repeated overspeeding</div>
          {summary.topViolators.length === 0 && <p className="empty">No violations recorded this week.</p>}
          <ul className="rank-list">
            {summary.topViolators.map((v) => (
              <li key={v.id}>
                <span className="plate-cell link" onClick={() => navigate(`/bus/${v.id}`)}>{v.plate}</span>
                <span className="grow muted small">{v.school_name}</span>
                <span className="pill pill-red">{v.n}× over limit</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-title">Most complained-about vehicles</div>
          {summary.topComplaints.length === 0 && <p className="empty">No complaints on record.</p>}
          <ul className="rank-list">
            {summary.topComplaints.map((c) => (
              <li key={c.id}>
                <span className="plate-cell link" onClick={() => navigate(`/bus/${c.id}`)}>{c.plate}</span>
                <span className="grow muted small">{c.school_name}</span>
                <span className="pill pill-amber">{c.total} total · {c.open} open</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="kbd-note" style={{ marginTop: 14 }}>
        Privacy safeguard: RTO receives trip summaries, speed data and violation records — never live bus locations.
      </p>
    </div>
  );
}
