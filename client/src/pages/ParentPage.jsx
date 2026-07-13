import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import MapView from '../components/MapView';
import SpeedChart from '../components/SpeedChart';
import ComplaintsPanel from '../components/ComplaintsPanel';
import { AlertsList, StatusPill } from '../components/Shared';
import { etaMinutes, fmtDateTime, fmtAgo } from '../lib/geo';

const TABS = [
  { id: 'track', label: 'Track', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
  { id: 'alerts', label: 'Alerts', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg> },
  { id: 'complaints', label: 'Complaints', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
];

/**
 * Parent app (phone). Bottom tabs keep each screen focused:
 *   Track      live map, speed, approx ETA, pickup pin, picked-up toggle
 *   Alerts     live overspeed / long-stop / trip events for the assigned bus
 *   Complaints threads with the school (chat until resolved)
 */
export default function ParentPage({ config }) {
  const [tab, setTab] = useState('track');
  const [bus, setBus] = useState(null);
  const [me, setMe] = useState(null);
  const [livePoints, setLivePoints] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [pinMode, setPinMode] = useState(false);
  const [error, setError] = useState('');
  const busRef = useRef(null);

  useEffect(() => {
    Promise.all([api('/buses'), api('/me'), api('/alerts')])
      .then(([buses, meData, alertRows]) => {
        const b = buses[0];
        setBus(b); busRef.current = b;
        setMe(meData);
        setAlerts(alertRows.map((a) => ({ type: a.type, message: a.message, ts: a.ts })));
        if (b?.onTrip) api(`/buses/${b.id}/live`).then((d) => setLivePoints(d.points));
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onBus = (b) => { if (b.id === busRef.current?.id) { setBus(b); busRef.current = b; } };
    const onPoints = ({ points }) => setLivePoints((prev) => [...prev, ...points].slice(-1800));
    const onStart = () => setLivePoints([]);
    s.on('bus:update', onBus);
    s.on('trip:points', onPoints);
    s.on('trip:started', onStart);
    return () => { s.off('bus:update', onBus); s.off('trip:points', onPoints); s.off('trip:started', onStart); };
  }, []);

  const setPickup = async ({ lat, lng }) => {
    try {
      await api('/parent/pickup', { method: 'PUT', body: { lat, lng } });
      setMe((m) => ({ ...m, pickupLat: lat, pickupLng: lng }));
      setPinMode(false);
    } catch (e) { setError(e.message); }
  };

  const toggleKid = async () => {
    const next = !me.kidPickedUp;
    await api('/parent/kid-state', { method: 'PUT', body: { pickedUp: next } });
    setMe((m) => ({ ...m, kidPickedUp: next }));
  };

  if (!bus) return <p className="empty">{error || 'Loading your bus…'}</p>;

  const target = me?.kidPickedUp
    ? { lat: bus.destLat, lng: bus.destLng, label: 'school' }
    : me?.pickupLat != null
      ? { lat: me.pickupLat, lng: me.pickupLng, label: 'pickup' }
      : null;
  const eta = bus.onTrip && target ? etaMinutes(bus.lastLat, bus.lastLng, target.lat, target.lng, bus.lastSpeed) : null;

  return (
    <>
      {tab === 'track' && (
        <>
          <div className="card">
            <div className="row spread">
              <div>
                <h2 className="plate">{bus.plate}</h2>
                <p className="meta-line">{bus.driverName} · {bus.schoolName}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <StatusPill onTrip={bus.onTrip} />
                {bus.lastBattery != null && <div className="small muted" style={{ marginTop: 4 }}>driver battery {Math.round(bus.lastBattery)}%</div>}
              </div>
            </div>
          </div>

          <div className="stats-row">
            <div className="stat"><div className="stat-value">{bus.lastSpeed != null ? Math.round(bus.lastSpeed) : '–'}</div><div className="stat-label">km/h</div></div>
            <div className="stat"><div className="stat-value">{eta != null ? `~${eta} min` : '–'}</div><div className="stat-label">ETA to {target?.label || 'pickup'}</div><div className="stat-hint">straight-line approx</div></div>
            <div className="stat"><div className="stat-value" style={{ fontSize: 16, paddingTop: 5 }}>{fmtAgo(bus.lastSeen)}</div><div className="stat-label">last update</div></div>
          </div>

          <MapView
            apiKey={config.mapsApiKey}
            follow={bus.onTrip && !pinMode}
            height={320}
            onMapClick={pinMode ? setPickup : undefined}
            path={livePoints.filter((p) => p.lat != null)}
            markers={[
              bus.lastLat != null && { id: 'bus', lat: bus.lastLat, lng: bus.lastLng, color: bus.onTrip ? '#1a7f4b' : '#98a2b3', title: bus.plate },
              { id: 'school', lat: bus.destLat, lng: bus.destLng, color: '#24459c', title: bus.destName },
              me?.pickupLat != null && { id: 'pickup', lat: me.pickupLat, lng: me.pickupLng, color: '#b45309', title: 'Pickup point' },
            ].filter(Boolean)}
          />

          <div className="card">
            <div className="stack" style={{ gap: 10 }}>
              <button className={`btn wide ${me?.kidPickedUp ? 'success' : 'secondary'}`} onClick={toggleKid}>
                {me?.kidPickedUp ? 'Kid is on the bus — tracking to school' : 'Kid not picked up — tracking to pickup point'}
              </button>
              <button className={`btn wide ${pinMode ? 'danger' : 'secondary'}`} onClick={() => setPinMode((v) => !v)}>
                {pinMode ? 'Tap the map to place the pin (tap here to cancel)' : 'Set pickup point on map'}
              </button>
            </div>
            {!bus.onTrip && bus.lastSeen && (
              <p className="muted small" style={{ marginTop: 10 }}>Bus is not on a trip. Last known position {fmtDateTime(bus.lastSeen)}.</p>
            )}
          </div>

          {bus.onTrip && livePoints.length > 1 && (
            <div className="card">
              <div className="card-title">Speed this trip</div>
              <SpeedChart points={livePoints} limit={config.speedLimitKmh} height={170} />
            </div>
          )}
        </>
      )}

      {tab === 'alerts' && (
        <div className="card">
          <div className="card-title">Alerts for {bus.plate}</div>
          <AlertsList initial={alerts} />
        </div>
      )}

      {tab === 'complaints' && <ComplaintsPanel role="parent" />}

      {error && <p className="error">{error}</p>}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
