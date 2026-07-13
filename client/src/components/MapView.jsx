import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/maps';

/**
 * Google Maps wrapper.
 * Props:
 *   apiKey            string ('' -> renders a graceful placeholder)
 *   center            {lat,lng}
 *   markers           [{id, lat, lng, label, color, title}]  (bus / school / pickup)
 *   path              [{lat,lng}]  polyline of the trip so far
 *   stops             [{lat,lng,duration_s}]
 *   onMapClick(latLng) optional — used by parents to drop their pickup pin
 *   follow            bool — keep the map centered on the first marker
 */
export default function MapView({ apiKey, center, markers = [], path = [], stops = [], onMapClick, follow = false, height = 320 }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const objRef = useRef({ markers: new Map(), polyline: null, stopMarkers: [] });
  const [status, setStatus] = useState(apiKey ? 'loading' : 'no-key');
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    if (!apiKey) { setStatus('no-key'); return; }
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((gmaps) => {
        if (cancelled || !divRef.current) return;
        mapRef.current = new gmaps.Map(divRef.current, {
          center: center || { lat: 34.0837, lng: 74.7973 }, // Srinagar
          zoom: 13,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        });
        mapRef.current.addListener('click', (e) => {
          clickRef.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // sync markers / path / stops
  useEffect(() => {
    const gmaps = window.google?.maps;
    const map = mapRef.current;
    if (status !== 'ready' || !gmaps || !map) return;
    const objs = objRef.current;

    const seen = new Set();
    for (const m of markers) {
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number') continue;
      seen.add(m.id);
      let gm = objs.markers.get(m.id);
      if (!gm) {
        gm = new gmaps.Marker({ map });
        objs.markers.set(m.id, gm);
      }
      gm.setPosition({ lat: m.lat, lng: m.lng });
      gm.setTitle(m.title || '');
      gm.setLabel(m.label ? { text: m.label, color: '#ffffff', fontSize: '11px', fontWeight: '700' } : null);
      gm.setIcon({
        path: gmaps.SymbolPath.CIRCLE,
        scale: m.id === 'bus' ? 11 : 8,
        fillColor: m.color || '#3555b8',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      });
    }
    for (const [id, gm] of objs.markers) {
      if (!seen.has(id)) { gm.setMap(null); objs.markers.delete(id); }
    }

    if (objs.polyline) objs.polyline.setMap(null);
    if (path.length > 1) {
      objs.polyline = new gmaps.Polyline({
        map, path, strokeColor: '#3555b8', strokeOpacity: 0.9, strokeWeight: 4,
      });
    }

    objs.stopMarkers.forEach((s) => s.setMap(null));
    objs.stopMarkers = stops
      .filter((s) => typeof s.lat === 'number')
      .map((s) => new gmaps.Marker({
        map,
        position: { lat: s.lat, lng: s.lng },
        title: `Stopped ${Math.round((s.duration_s || 0) / 60)} min`,
        icon: { path: gmaps.SymbolPath.CIRCLE, scale: 6, fillColor: '#d97706', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
      }));

    if (follow && markers[0] && typeof markers[0].lat === 'number') {
      map.panTo({ lat: markers[0].lat, lng: markers[0].lng });
    }
  }, [status, markers, path, stops, follow]);

  if (status === 'no-key' || status === 'error') {
    return (
      <div className="map-placeholder" style={{ height }}>
        <div>
          <strong>Map unavailable</strong>
          <p>{status === 'no-key' ? 'Add MAPS_API_KEY in server/.env to enable Google Maps.' : 'Google Maps failed to load (check key / internet).'}</p>
          {markers.map((m) => (
            typeof m.lat === 'number' && (
              <p key={m.id} className="muted small">{m.title || m.id}: {m.lat.toFixed(5)}, {m.lng.toFixed(5)}</p>
            )
          ))}
        </div>
      </div>
    );
  }
  return <div ref={divRef} className="map" style={{ height }} />;
}
