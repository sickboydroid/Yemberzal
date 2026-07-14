import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, getAuth, setAuth } from './lib/api';
import { resetSocket } from './lib/socket';
import { ConnectionBanner } from './components/Shared';
import Login from './pages/Login';
import DriverPage from './pages/DriverPage';
import ParentPage from './pages/ParentPage';
import DashboardPage from './pages/DashboardPage';
import BusDetailPage from './pages/BusDetailPage';
import ComplaintsPage from './pages/ComplaintsPage';
import FleetPage from './pages/FleetPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

const HOME = { driver: '/driver', parent: '/parent', school: '/dashboard', rto: '/dashboard' };

/** /phone and /desktop force + remember the device type (handy demo URLs). */
function ForceDevice({ type }) {
  localStorage.setItem('yz_device', type);
  return <Navigate to="/login" replace />;
}

const I = {
  grid: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  bus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9H4z"/><path d="M4 15h16v2a1 1 0 0 1-1 1h-1"/><path d="M6 18H5a1 1 0 0 1-1-1"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/><path d="M4 10h16"/></svg>,
  chat: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  chart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  gear: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

function Sidebar({ user, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="brand-mark">🚌</div>
        <div>
          <strong>Yemberzal</strong>
          <span>SAFE SCHOOL BUS · KASHMIR</span>
        </div>
      </div>
      <nav className="side-nav">
        <NavLink to="/dashboard">{I.grid} Overview</NavLink>
        {user.role === 'school' && <NavLink to="/fleet">{I.bus} Fleet & students</NavLink>}
        {user.role === 'school' && <NavLink to="/complaints">{I.chat} Complaints</NavLink>}
        {user.role === 'rto' && <NavLink to="/reports">{I.chart} Reports</NavLink>}
        <NavLink to="/settings">{I.gear} Settings</NavLink>
      </nav>
      <div className="side-foot">
        <div className="who">
          <b>{user.name}</b>
          <span>{user.role === 'rto' ? 'RTO Kashmir' : user.role}</span>
        </div>
        <button className="logout" onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}

export default function App() {
  const [auth, setAuthState] = useState(getAuth());
  const [config, setConfig] = useState({ mapsApiKey: '', speedLimitKmh: 40 });
  const navigate = useNavigate();

  useEffect(() => {
    api('/config').then(setConfig).catch(() => {});
  }, []);

  const handleLogin = (result) => {
    setAuth(result);
    setAuthState(result);
    navigate(HOME[result.user.role] || '/');
  };

  const logout = () => {
    setAuth(null);
    setAuthState(null);
    resetSocket();
    navigate('/login');
  };

  if (!auth) {
    return (
      <Routes>
        <Route path="/phone" element={<ForceDevice type="phone" />} />
        <Route path="/desktop" element={<ForceDevice type="pc" />} />
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const { user } = auth;

  // Desktop shell (school / RTO): sidebar navigation
  if (user.role === 'school' || user.role === 'rto') {
    return (
      <div className="shell">
        <Sidebar user={user} onLogout={logout} />
        <div>
          <ConnectionBanner />
          <div className="content">
            <Routes>
              <Route path="/dashboard" element={<DashboardPage config={config} role={user.role} />} />
              <Route path="/bus/:id" element={<BusDetailPage config={config} role={user.role} />} />
              {user.role === 'school' && <Route path="/fleet" element={<FleetPage />} />}
              {user.role === 'school' && <Route path="/complaints" element={<ComplaintsPage />} />}
              {user.role === 'rto' && <Route path="/reports" element={<ReportsPage />} />}
              <Route path="/settings" element={<SettingsPage config={config} onConfig={setConfig} />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    );
  }

  // Mobile shell (driver / parent)
  return (
    <div className="m-shell">
      <header className="m-top">
        <div className="side-brand">
          <div className="brand-mark">🚌</div>
          <div>
            <strong>Yemberzal</strong>
            <span>{user.role === 'driver' ? 'DRIVER' : 'PARENT'} · {user.name}</span>
          </div>
        </div>
        <button className="logout" onClick={logout}>Sign out</button>
      </header>
      <ConnectionBanner />
      <main className="m-body">
        <Routes>
          {user.role === 'driver' && <Route path="/driver" element={<DriverPage config={config} />} />}
          {user.role === 'parent' && <Route path="/parent" element={<ParentPage config={config} />} />}
          <Route path="*" element={<Navigate to={HOME[user.role]} replace />} />
        </Routes>
      </main>
    </div>
  );
}
