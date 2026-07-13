import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import MapView from '../components/MapView';
import { StatusPill } from '../components/Shared';
import { etaMinutes, fmtAgo } from '../lib/geo';

const BUFFER_KEY = 'yz_driver_buffer';

/**
 * Driver screen (phone). One job: start the trip, stream GPS, end the trip.
 * - Samples position every second, sends batches of 3 via Socket.IO with acks
 * - Offline-safe: unacked points buffer in memory + localStorage and flush on reconnect
 * - Keeps the screen awake during a trip (Wake Lock API, where supported)
 */
export default function DriverPage({ config }) {
  const [bus, setBus] = useState(null);
  const [onTrip, setOnTrip] = useState(false);
  const [pos, setPos] = useState(null);
  const [stats, setStats] = useState({ sent: 0, buffered: 0, battery: null, startedAt: null });
  const [error, setError] = useState('');
  const [gpsState, setGpsState] = useState('off');

  const watchIdRef = useRef(null);
  const queueRef = useRef([]);
  const timerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const lastPosRef = useRef(null);

  useEffect(() => {
    api('/buses').then(([b]) => { setBus(b); setOnTrip(!!b?.onTrip); }).catch((e) => setError(e.message));
    try {
      const saved = JSON.parse(localStorage.getItem(BUFFER_KEY));
      if (Array.isArray(saved) && saved.length) queueRef.current = saved;
    } catch { /* ignore */ }
    return () => stopStreaming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getBattery() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        return Math.round(b.level * 100);
      }
    } catch { /* unsupported */ }
    return null;
  }

  function onPosition(gp) {
    setGpsState('on');
    const c = gp.coords;
    const speedKmh = typeof c.speed === 'number' && c.speed >= 0 ? c.speed * 3.6 : null;
    lastPosRef.current = {
      ts: Date.now(), lat: c.latitude, lng: c.longitude,
      speedKmh: speedKmh !== null ? Math.round(speedKmh * 10) / 10 : null,
      heading: typeof c.heading === 'number' ? c.heading : null,
      accuracy: c.accuracy,
    };
    setPos(lastPosRef.current);
  }

  function startStreaming() {
    const sampler = setInterval(() => {
      if (lastPosRef.current) {
        queueRef.current.push({ ...lastPosRef.current, ts: Date.now() });
        if (queueRef.current.length > 3600) queueRef.current.splice(0, queueRef.current.length - 3600);
      }
    }, 1000);

    const flusher = setInterval(async () => {
      const socket = getSocket();
      setStats((s) => ({ ...s, buffered: queueRef.current.length }));
      localStorage.setItem(BUFFER_KEY, JSON.stringify(queueRef.current.slice(-1200)));
      if (!socket?.connected || queueRef.current.length === 0) return;
      const batch = queueRef.current.slice(0, 30);
      const battery = await getBattery();
      socket.emit('trip:points', { points: batch, battery }, (ack) => {
        if (ack?.ok) {
          queueRef.current.splice(0, batch.length);
          localStorage.setItem(BUFFER_KEY, JSON.stringify(queueRef.current));
          setStats((s) => ({ ...s, sent: s.sent + ack.accepted, buffered: queueRef.current.length, battery }));
        }
      });
    }, 3000);

    timerRef.current = [sampler, flusher];
  }

  function stopStreaming() {
    (timerRef.current || []).forEach(clearInterval);
    timerRef.current = null;
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    wakeLockRef.current?.release?.().catch(() => {});
    wakeLockRef.current = null;
  }

  const startTrip = async () => {
    setError('');
    if (!navigator.geolocation) return setError('This browser has no geolocation support.');
    if (!window.isSecureContext) {
      return setError('GPS needs a secure page. Open the HTTPS address shown in the server console (https://<laptop-ip>:8443) and accept the certificate warning.');
    }
    setGpsState('asking');
    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, (err) => {
      setGpsState('denied');
      setError('Location error: ' + err.message + '. Enable location services and allow the permission.');
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });

    const socket = getSocket();
    socket.emit('trip:start', (ack) => {
      if (!ack?.ok) return setError(ack?.error || 'Could not start trip');
      setOnTrip(true);
      setStats({ sent: 0, buffered: 0, battery: null, startedAt: Date.now() });
      startStreaming();
    });

    try { wakeLockRef.current = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  };

  const endTrip = () => {
    const socket = getSocket();
    socket.emit('trip:end', () => {
      setOnTrip(false);
      stopStreaming();
      setGpsState('off');
      localStorage.removeItem(BUFFER_KEY);
    });
  };

  if (!bus) return <p className="empty">{error || 'Loading bus…'}</p>;

  const eta = pos && etaMinutes(pos.lat, pos.lng, bus.destLat, bus.destLng, pos.speedKmh ?? 0);

  return (
    <>
      <div className="card">
        <div className="row spread">
          <div>
            <h2 className="plate">{bus.plate}</h2>
            <p className="meta-line">{bus.driverName} · {bus.schoolName}</p>
          </div>
          <StatusPill onTrip={onTrip} />
        </div>
        <div className="dest-box">
          Destination — <b>{bus.destName}</b> <span className="muted small">(assigned by the school)</span>
        </div>
      </div>

      {onTrip && (
        <div className="stats-row">
          <div className="stat"><div className="stat-value">{pos?.speedKmh ?? '–'}</div><div className="stat-label">km/h</div></div>
          <div className="stat"><div className="stat-value">{eta != null ? `~${eta}m` : '–'}</div><div className="stat-label">ETA approx</div></div>
          <div className="stat"><div className="stat-value">{stats.sent}</div><div className="stat-label">points sent</div></div>
          <div className={`stat ${stats.buffered > 5 ? 'warn' : ''}`}><div className="stat-value">{stats.buffered}</div><div className="stat-label">buffered</div></div>
        </div>
      )}

      <MapView
        apiKey={config.mapsApiKey}
        follow={onTrip}
        height={330}
        markers={[
          pos && { id: 'bus', lat: pos.lat, lng: pos.lng, color: '#1a7f4b', title: `You (${bus.plate})` },
          { id: 'dest', lat: bus.destLat, lng: bus.destLng, color: '#24459c', title: bus.destName },
        ].filter(Boolean)}
      />

      {error && <div className="card"><p className="error">{error}</p></div>}
      {gpsState === 'asking' && <p className="gps-note">Waiting for a GPS fix… allow the location permission.</p>}

      <button className={`btn xl wide ${onTrip ? 'danger' : ''}`} onClick={onTrip ? endTrip : startTrip}>
        {onTrip ? 'End trip' : 'Start trip'}
      </button>

      {onTrip && (
        <p className="gps-note">
          Keep this page open — the screen stays awake. If internet drops, points are buffered and re-sent automatically.
          Last GPS fix {fmtAgo(pos?.ts)}.
        </p>
      )}
    </>
  );
}
