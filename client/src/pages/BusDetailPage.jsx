import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import MapView from '../components/MapView';
import SpeedChart from '../components/SpeedChart';
import ComplaintsPanel from '../components/ComplaintsPanel';
import { StatusPill, StatCard } from '../components/Shared';
import { fmtDateTime, fmtDuration, fmtAgo } from '../lib/geo';

/**
 * Bus detail, opened from the Overview table. Content is split into tabs to
 * keep each screen focused:
 *   School: Live · Trip history · Complaints
 *   RTO:    Summary · Trip history            (no live location — policy)
 */
export default function BusDetailPage({ role, config }) {
  const { id } = useParams();
  const busId = Number(id);
  const navigate = useNavigate();
  const isRto = role === 'rto';

  const [bus, setBus] = useState(null);
  const [livePoints, setLivePoints] = useState([]);
  const [trips, setTrips] = useState([]);
  const [selTrip, setSelTrip] = useState(null);
  const [tab, setTab] = useState(isRto ? 'summary' : 'live');
  const [threshold, setThreshold] = useState(config.speedLimitKmh);
  const [error, setError] = useState('');

  useEffect(() => setThreshold(config.speedLimitKmh), [config.speedLimitKmh]);

  useEffect(() => {
    setSelTrip(null); setLivePoints([]);
    api(`/buses/${busId}`).then(setBus).catch((e) => setError(e.message));
    api(`/buses/${busId}/trips`).then(setTrips).catch(() => {});
    api(`/buses/${busId}/live`).then((d) => setLivePoints(d.points || [])).catch(() => {});
  }, [busId]);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    if (!isRto) s.emit('watch:bus', busId, () => {});
    const onBus = (b) => { if (b.id === busId) setBus((prev) => ({ ...prev, ...b })); };
    const onPoints = (msg) => { if (msg.busId === busId) setLivePoints((prev) => [...prev, ...msg.points].slice(-1800)); };
    const onStart = () => { setLivePoints([]); api(`/buses/${busId}/trips`).then(setTrips); };
    const onEnd = () => api(`/buses/${busId}/trips`).then(setTrips);
    s.on('bus:update', onBus);
    s.on('rto:update', onBus);
    s.on('trip:points', onPoints);
    s.on('trip:started', onStart);
    s.on('trip:ended', onEnd);
    return () => {
      if (!isRto) s.emit('unwatch:bus', busId);
      s.off('bus:update', onBus); s.off('rto:update', onBus);
      s.off('trip:points', onPoints); s.off('trip:started', onStart); s.off('trip:ended', onEnd);
    };
  }, [busId, isRto]);

  const openTrip = (tripId) => api(`/trips/${tripId}`).then(setSelTrip).catch((e) => setError(e.message));

  if (!bus) return <p className="empty">{error || 'Loading bus…'}</p>;

  const thresholdControl = (
    <div className="threshold-slider">
      <span>Threshold <strong>{threshold} km/h</strong></span>
      <input type="range" min="10" max="90" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Chart threshold" />
    </div>
  );

  const lastTripCard = bus.lastTrip ? (
    <div className="card">
      <div className="card-title">Last trip</div>
      <p className="muted small">
        {fmtDateTime(bus.lastTrip.started_at)} → {bus.lastTrip.ended_at ? fmtDateTime(bus.lastTrip.ended_at) : 'ongoing'}
        {' · '}{(bus.lastTrip.distance_m / 1000).toFixed(1)} km
        {' · '}max {Math.round(bus.lastTrip.max_speed)} km/h · avg {Math.round(bus.lastTrip.avg_speed)} km/h
        {' · '}{bus.lastTrip.violation_count} violation(s)
        {' — '}<a className="link" onClick={() => { setTab('trips'); openTrip(bus.lastTrip.id); }}>view details</a>
      </p>
    </div>
  ) : (
    <div className="card"><div className="card-title">Last trip</div><p className="empty">No trips recorded yet.</p></div>
  );

  return (
    <div>
      <div className="detail-head">
        <button className="back" onClick={() => navigate('/dashboard')} aria-label="Back">←</button>
        <div>
          <h1 className="plate">{bus.plate}</h1>
          <p className="meta-line">
            {bus.driverName}{bus.driverPhone ? ` · ${bus.driverPhone}` : ''}{isRto ? ` · ${bus.schoolName}` : ''}
            {bus.lastBattery != null ? ` · battery ${Math.round(bus.lastBattery)}%` : ''} · updated {fmtAgo(bus.lastSeen)}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}><StatusPill onTrip={bus.onTrip} /></div>
      </div>

      <div className="tabs" role="tablist">
        {isRto
          ? <button role="tab" className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Summary</button>
          : <button role="tab" className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>Live</button>}
        <button role="tab" className={tab === 'trips' ? 'active' : ''} onClick={() => setTab('trips')}>Trip history ({trips.length})</button>
        {role === 'school' && <button role="tab" className={tab === 'complaints' ? 'active' : ''} onClick={() => setTab('complaints')}>Complaints</button>}
      </div>

      {/* ---------- LIVE (school) ---------- */}
      {tab === 'live' && !isRto && (
        <div className="stack">
          {!bus.onTrip && lastTripCard}
          <MapView
            apiKey={config.mapsApiKey}
            follow={bus.onTrip}
            height={380}
            path={livePoints.filter((p) => p.lat != null)}
            markers={[
              bus.lastLat != null && { id: 'bus', lat: bus.lastLat, lng: bus.lastLng, color: bus.onTrip ? '#1a7f4b' : '#98a2b3', title: bus.plate },
              bus.destLat != null && { id: 'dest', lat: bus.destLat, lng: bus.destLng, color: '#24459c', title: bus.destName },
            ].filter(Boolean)}
          />
          <div className="card">
            <div className="row spread wrap">
              <div className="card-title" style={{ margin: 0 }}>{bus.onTrip ? 'Speed — live' : 'Speed — waiting for a trip'}</div>
              {thresholdControl}
            </div>
            {livePoints.length > 1
              ? <div style={{ marginTop: 10 }}><SpeedChart points={livePoints} limit={threshold} height={230} /></div>
              : <p className="empty">The chart fills in live once the driver starts moving.</p>}
            {bus.onTrip && bus.lastSpeed != null && (
              <p className="live-speed">Current speed <strong className={bus.lastSpeed > threshold ? 'speed-bad' : ''}>{Math.round(bus.lastSpeed)} km/h</strong></p>
            )}
          </div>
        </div>
      )}

      {/* ---------- SUMMARY (rto) ---------- */}
      {tab === 'summary' && isRto && (
        <div className="stack">
          <div className="stats-row">
            <StatCard label="Current speed" value={bus.lastSpeed != null ? `${Math.round(bus.lastSpeed)} km/h` : '—'} />
            <StatCard label="Violations · 7 days" value={bus.violationsWeek ?? 0} tone={(bus.violationsWeek || 0) > 0 ? 'bad' : 'good'} />
            <StatCard label="Open complaints" value={bus.openComplaints ?? 0} tone={(bus.openComplaints || 0) > 0 ? 'warn' : ''} />
          </div>
          {lastTripCard}
          <div className="card">
            <div className="row spread wrap">
              <div className="card-title" style={{ margin: 0 }}>Speed — current trip</div>
              {thresholdControl}
            </div>
            {livePoints.length > 1
              ? <div style={{ marginTop: 10 }}><SpeedChart points={livePoints} limit={threshold} height={230} /></div>
              : <p className="empty">No ongoing trip data. Open Trip history for past speed graphs.</p>}
          </div>
          <p className="kbd-note">RTO view shows speed and compliance data only — live location is not shared.</p>
        </div>
      )}

      {/* ---------- TRIP HISTORY ---------- */}
      {tab === 'trips' && (
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)' }}>
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-title">Trips (last {trips.length})</div>
            <ul className="trip-list">
              {trips.map((t) => (
                <li key={t.id} className={selTrip?.trip?.id === t.id ? 'active' : ''} onClick={() => openTrip(t.id)}>
                  <b>{fmtDateTime(t.started_at)}</b>
                  <div className="sub">
                    {t.ended_at ? fmtDuration(t.ended_at - t.started_at) : 'ongoing'} · {(t.distance_m / 1000).toFixed(1)} km · max {Math.round(t.max_speed)} km/h
                    {t.violation_count > 0 && <span className="pill pill-red" style={{ marginLeft: 6 }}>{t.violation_count}×</span>}
                  </div>
                </li>
              ))}
              {trips.length === 0 && <p className="empty">No trips yet.</p>}
            </ul>
          </div>

          <div className="stack">
            {!selTrip && <div className="card"><p className="empty">Select a trip to see its speed profile{isRto ? '' : ', route'} and stops.</p></div>}
            {selTrip && (
              <>
                <div className="card">
                  <div className="card-title">Trip of {fmtDateTime(selTrip.trip.started_at)}</div>
                  <p className="muted small">
                    {fmtDuration((selTrip.trip.ended_at || Date.now()) - selTrip.trip.started_at)} · {(selTrip.trip.distance_m / 1000).toFixed(1)} km ·
                    max {Math.round(selTrip.trip.max_speed)} km/h · {selTrip.violations.length} violation(s) · {selTrip.stops.length} stop(s)
                  </p>
                </div>
                {!isRto && (
                  <MapView
                    apiKey={config.mapsApiKey}
                    height={320}
                    path={selTrip.points.filter((p) => p.lat != null)}
                    stops={selTrip.stops}
                    markers={[
                      selTrip.trip.end_lat != null && { id: 'trip-end', lat: selTrip.trip.end_lat, lng: selTrip.trip.end_lng, color: '#ba2525', title: 'Trip end' },
                      bus.destLat != null && { id: 'dest', lat: bus.destLat, lng: bus.destLng, color: '#24459c', title: bus.destName },
                    ].filter(Boolean)}
                  />
                )}
                <div className="card">
                  <div className="row spread wrap">
                    <div className="card-title" style={{ margin: 0 }}>Speed over the trip</div>
                    {thresholdControl}
                  </div>
                  <div style={{ marginTop: 10 }}><SpeedChart points={selTrip.points} limit={threshold} height={220} /></div>
                </div>
                <div className="card">
                  <div className="card-title">Stops ({selTrip.stops.length})</div>
                  {selTrip.stops.length === 0 && <p className="empty">No stops longer than the minimum were recorded.</p>}
                  <ul className="rank-list">
                    {selTrip.stops.map((s, i) => (
                      <li key={i}>
                        <span className="grow">{fmtDateTime(s.started_at)} — stopped for <b>{fmtDuration(s.duration_s * 1000)}</b></span>
                        {s.lat != null && <span className="muted small mono">{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- COMPLAINTS (school) ---------- */}
      {tab === 'complaints' && role === 'school' && (
        <div style={{ maxWidth: 760 }}>
          <ComplaintsPanel role="school" busId={busId} />
        </div>
      )}

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
