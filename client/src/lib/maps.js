/**
 * Google Maps JS API loader. The key comes from the server (/api/config),
 * so it lives in server/.env — never hardcoded in the client bundle.
 */
let loadPromise = null;

export function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error('no-key'));
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const cb = '__yzMapsReady';
    window[cb] = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error('maps-load-failed'));
    document.head.appendChild(s);
  });
  return loadPromise;
}
