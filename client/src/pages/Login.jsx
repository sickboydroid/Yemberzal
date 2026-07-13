import { useState } from 'react';
import { api } from '../lib/api';

const ALL_ROLES = [
  { id: 'driver', label: 'Driver', hint: 'Bus plate number', device: 'phone' },
  { id: 'parent', label: 'Parent', hint: 'Parent username', device: 'phone' },
  { id: 'school', label: 'School', hint: 'School username', device: 'pc' },
  { id: 'rto', label: 'RTO', hint: 'RTO username', device: 'pc' },
];

// Demo credentials (from server seed) shown to make hackathon demos painless.
const DEMO = {
  driver: [['JK01A1111', 'driver123'], ['JK01B2222', 'driver123'], ['JK05C3333', 'driver123'], ['JK05D4444', 'driver123']],
  parent: [['parent1', 'parent123'], ['parent2', 'parent123'], ['parent3', 'parent123'], ['parent4', 'parent123']],
  school: [['gvs', 'school123'], ['tyndale', 'school123']],
  rto: [['rto', 'rto123']],
};

/**
 * Device-aware login: phones see Driver + Parent, computers see School + RTO.
 * Opening /phone or /desktop forces (and remembers) the mode — handy demo URLs.
 * Auto-detection is the fallback; the link at the bottom switches manually.
 */
function detectPhone() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return true;
  if (/iPad|Android/i.test(ua)) return true;
  return (navigator.maxTouchPoints || 0) > 1 && Math.min(window.screen.width, window.screen.height) < 900;
}

function initialDevice() {
  const saved = localStorage.getItem('yz_device');
  if (saved === 'phone' || saved === 'pc') return saved;
  return detectPhone() ? 'phone' : 'pc';
}

export default function Login({ onLogin }) {
  const [device, setDevice] = useState(initialDevice);
  const roles = ALL_ROLES.filter((r) => r.device === device);
  const [role, setRole] = useState(roles[0].id);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const switchDevice = () => {
    const next = device === 'phone' ? 'pc' : 'phone';
    localStorage.setItem('yz_device', next);
    setDevice(next);
    setRole(ALL_ROLES.find((r) => r.device === next).id);
    setUsername(''); setPassword(''); setError('');
  };

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: { role, username, password } });
      onLogin(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const activeRole = ALL_ROLES.find((r) => r.id === role);

  return (
    <div className="login-wrap">
      <div className="login card">
        <div className="login-brand">
          <div className="brand-mark">🚌</div>
          <div>
            <h1>Yemberzal</h1>
            <p>Safe School Bus · Kashmir</p>
          </div>
        </div>

        <div className="seg" role="tablist">
          {roles.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={role === r.id}
              className={role === r.id ? 'active' : ''}
              onClick={() => { setRole(r.id); setError(''); }}>
              {r.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          <label htmlFor="yz-user">{role === 'driver' ? 'Bus plate number' : 'Username'}</label>
          <input id="yz-user" value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder={activeRole.hint} autoCapitalize="none" autoComplete="username" />
          <label htmlFor="yz-pass">Password</label>
          <input id="yz-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
          <button className="btn wide" style={{ marginTop: 16 }} disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <details className="demo-creds">
          <summary>Demo accounts — tap to fill</summary>
          <ul>
            {DEMO[role].map(([u, p]) => (
              <li key={u}><code onClick={() => { setUsername(u); setPassword(p); }}>{u} / {p}</code></li>
            ))}
          </ul>
        </details>

        <p className="device-switch">
          {device === 'phone' ? 'Driver & parent sign-in.' : 'School & RTO dashboards.'}
          {' '}
          <a className="link" onClick={switchDevice}>
            {device === 'phone' ? 'Not on a phone?' : 'Not on a computer?'}
          </a>
        </p>
      </div>
    </div>
  );
}
