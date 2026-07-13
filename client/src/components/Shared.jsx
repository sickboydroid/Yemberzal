import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import { fmtDateTime } from '../lib/geo';

/** Slim banner whenever the live connection to the server is lost. */
export function ConnectionBanner() {
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    setConnected(s.connected);
    s.on('connect', up);
    s.on('disconnect', down);
    s.on('connect_error', down);
    return () => { s.off('connect', up); s.off('disconnect', down); s.off('connect_error', down); };
  }, []);
  if (connected) return null;
  return <div className="conn-banner" role="alert">Connection lost — reconnecting… data on screen may be stale</div>;
}

const ALERT_META = {
  overspeed: { label: 'Overspeed', tone: 'danger' },
  long_stop: { label: 'Long stop', tone: 'warn' },
  trip_started: { label: 'Trip started', tone: 'ok' },
  trip_ended: { label: 'Trip ended', tone: 'neutral' },
};

function useLiveAlerts(initial) {
  const [alerts, setAlerts] = useState(initial);
  useEffect(() => setAlerts(initial), [initial]);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onAlert = (a) => setAlerts((prev) => [a, ...prev].slice(0, 50));
    s.on('alert', onAlert);
    return () => s.off('alert', onAlert);
  }, []);
  return alerts;
}

/** Plain list of alerts (used on the parent Alerts tab). */
export function AlertsList({ initial = [] }) {
  const alerts = useLiveAlerts(initial);
  if (alerts.length === 0) return <p className="empty">No alerts yet. Overspeed and long-stop events will appear here instantly.</p>;
  return (
    <ul className="alert-items">
      {alerts.map((a, i) => {
        const meta = ALERT_META[a.type] || { label: a.type, tone: 'neutral' };
        return (
          <li key={i} className={`alert-item tone-${meta.tone}`}>
            <span className="alert-dot" aria-hidden="true" />
            <div>
              <div className="alert-msg">{a.message}</div>
              <div className="alert-time">{meta.label} · {fmtDateTime(a.ts)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Bell button + dropdown panel (dashboard top bar). */
export function AlertsFeed({ initial = [] }) {
  const alerts = useLiveAlerts(initial);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const urgent = alerts.filter((a) => a.type === 'overspeed' || a.type === 'long_stop').length;

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="alerts" ref={ref}>
      <button type="button" className={`bell ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Alerts">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {urgent > 0 && <span className="bell-badge">{urgent > 9 ? '9+' : urgent}</span>}
      </button>
      {open && (
        <div className="alert-pop">
          <div className="alert-pop-head">Recent alerts</div>
          <div className="alert-pop-body">
            <AlertsList initial={alerts} />
          </div>
        </div>
      )}
    </div>
  );
}

export function StatCard({ label, value, tone, hint }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function StatusPill({ onTrip }) {
  return (
    <span className={`status ${onTrip ? 'status-on' : 'status-off'}`}>
      <span className="status-dot" aria-hidden="true" />
      {onTrip ? 'On trip' : 'Idle'}
    </span>
  );
}
