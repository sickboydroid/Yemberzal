/** Tiny fetch wrapper with auth. Base URL is same-origin (server serves the app). */

export function getAuth() {
  try {
    return JSON.parse(localStorage.getItem('yz_auth')) || null;
  } catch {
    return null;
  }
}

export function setAuth(auth) {
  if (auth) localStorage.setItem('yz_auth', JSON.stringify(auth));
  else localStorage.removeItem('yz_auth');
}

export async function api(path, { method = 'GET', body } = {}) {
  const auth = getAuth();
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setAuth(null);
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
