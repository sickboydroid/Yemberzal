import { useState } from 'react';
import { api } from '../lib/api';

/** Shared settings for School and RTO. */
export default function SettingsPage({ config, onConfig }) {
  const [limit, setLimit] = useState(config.speedLimitKmh);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError(''); setSaved(false);
    try {
      const r = await api('/settings/speed-limit', { method: 'PUT', body: { value: Number(limit) } });
      onConfig?.({ ...config, speedLimitKmh: r.speedLimitKmh });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e.message); }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>System-wide configuration for violation detection and data retention.</p>
        </div>
      </div>

      <div className="stack" style={{ maxWidth: 620 }}>
        <div className="card">
          <div className="card-title">Speed limit</div>
          <p className="muted small">Buses exceeding this speed are recorded as violations, flagged in red on dashboards, and trigger an instant overspeed alert.</p>
          <div className="row" style={{ marginTop: 14 }}>
            <input type="number" min="5" max="120" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Speed limit km/h" />
            <span className="muted small">km/h</span>
            <button className="btn" onClick={save}>Save</button>
            {saved && <span className="pill pill-green">Saved</span>}
          </div>
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
        </div>

        <div className="card">
          <div className="card-title">Data retention</div>
          <p className="muted small">
            Trip data is pruned automatically: at most the last 100 trips are kept per bus, and nothing older
            than 7 days is retained (including violation and alert records). This matches the pilot policy of
            a defined retention period for detailed trip records.
          </p>
        </div>
      </div>
    </div>
  );
}
