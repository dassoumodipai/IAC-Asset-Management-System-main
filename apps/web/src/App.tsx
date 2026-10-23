import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, resetCsrf } from './api';
import { useSession, hasRole, isStaff } from './session';
import { AuthScreen, AccessScreen, SecurityScreen } from './components/Auth';
import { AssetList, AssetDetail, AssetEditor, AssignmentForm } from './components/Assets';
import { TicketForm, TicketList, TicketDetail } from './components/Tickets';
import { UserDashboard } from './components/Dashboards';
import { UserAdmin, AuditView, ImportsView, NotificationSettings } from './components/Admin';
import { Empty, ErrorNotice, Loading } from './components/ui';
import { BrandMark } from './components/BrandMark';
import { MasterControl } from './components/MasterControl';
function Guard({ admin = false }: { admin?: boolean }) {
  const { user, loading, error } = useSession();
  if (loading) return <Loading />;
  if (error) return <ErrorNotice error={error} retry={() => window.location.reload()} />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.enrollmentOnly || user.mfaRequired || user.mfaEnrollmentRequired)
    return <Navigate to="/security" replace />;
  if (
    !user.emailVerifiedAt ||
    !user.portalAcceptedAt ||
    user.portalNoticeVersion !== (user.currentNoticeVersion ?? '1')
  )
    return <Navigate to="/access" replace />;
  if (admin && !hasRole(user, 'ADMIN'))
    return (
      <Empty title="Admin access required">Your account does not have access to this area.</Empty>
    );
  return <Outlet />;
}
type NavIconName =
  | 'overview'
  | 'assets'
  | 'tickets'
  | 'master'
  | 'people'
  | 'imports'
  | 'audit'
  | 'notifications'
  | 'menu';
function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    overview: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    assets: (
      <>
        <path d="M3.5 8h17v11.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />
        <path d="M2.5 4h19v4h-19z" />
        <path d="M9.5 12h5" />
      </>
    ),
    tickets: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 13h4l2 3h4l2-3h4" />
      </>
    ),
    master: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
        <path d="M16 5a3 3 0 0 1 0 6" />
        <path d="M18 20c0-2.5-1-4.2-2.5-5.2" />
      </>
    ),
    imports: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </>
    ),
    audit: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    notifications: (
      <>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2.5h-15z" />
        <path d="M10 20.5a2 2 0 0 0 4 0" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
function Shell() {
  const { user } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>();
  const [signingOut, setSigningOut] = useState(false);
  const client = useQueryClient();

  async function logout() {
    setSigningOut(true);
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
      resetCsrf();
      client.clear();
      window.location.assign('/login');
    } catch (error) {
      setLogoutError(error);
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside id="mobile-nav" className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
        <Link to="/dashboard" className="brand">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-org">IAC Patrons Foundation</span>
            <strong>Asset workspace</strong>
          </span>
        </Link>
        <p className="nav-label">Workspace</p>
        <nav aria-label="Main navigation" onClick={() => setMenuOpen(false)}>
          <NavLink to="/dashboard">
            <span className="nav-icon">
              <NavIcon name="overview" />
            </span>
            Overview
          </NavLink>
          <NavLink to="/assets">
            <span className="nav-icon">
              <NavIcon name="assets" />
            </span>
            {hasRole(user, 'ADMIN') ? 'Asset catalog' : 'Assets'}
          </NavLink>
          <NavLink to="/tickets">
            <span className="nav-icon">
              <NavIcon name="tickets" />
            </span>
            {isStaff(user) ? 'Support desk' : 'My tickets'}
          </NavLink>
          {hasRole(user, 'ADMIN') ? (
            <>
              <p className="nav-label">Administration</p>
              <NavLink to="/master-control">
                <span className="nav-icon">
                  <NavIcon name="master" />
                </span>
                Master control
              </NavLink>
              <NavLink to="/admin/users">
                <span className="nav-icon">
                  <NavIcon name="people" />
                </span>
                People &amp; access
              </NavLink>
              <NavLink to="/admin/imports">
                <span className="nav-icon">
                  <NavIcon name="imports" />
                </span>
                Import review
              </NavLink>
              <NavLink to="/admin/audit">
                <span className="nav-icon">
                  <NavIcon name="audit" />
                </span>
                Audit trail
              </NavLink>
              <NavLink to="/admin/notifications">
                <span className="nav-icon">
                  <NavIcon name="notifications" />
                </span>
                Notifications
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Secure staff portal
          <p>Asset operations · v0.1</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            <NavIcon name="menu" />
            <span className="sr-only">Toggle navigation</span>
          </button>
          <span className="topbar-caption">
            Asset operations <span>·</span> Staff portal
          </span>
          <Link to="/profile" className="profile-link">
            <span className="avatar">{user?.displayName?.slice(0, 1) ?? 'U'}</span>
            <span>
              {user?.displayName || 'My profile'}
              <small>{user?.roles.map((role) => role.replace('_', ' ')).join(' · ')}</small>
            </span>
          </Link>
          <button
            className="button text small"
            type="button"
            onClick={logout}
            disabled={signingOut}
          >
            Sign out
          </button>
        </header>
        <main id="main" tabIndex={-1}>
          {logoutError ? <ErrorNotice error={logoutError} /> : null}
          <Outlet />
          <footer className="page-footer">
            IAC Patrons Foundation<span>Asset Management Platform · v0.1</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Profile() {
  const { user } = useSession();
  const action = async () => {
    await api('/auth/logout-all', { method: 'POST', body: {} });
    window.location.assign('/login');
  };
  const [error, setError] = useState<unknown>();
  return (
    <section className="panel profile-panel">
      <h1>{user?.displayName}</h1>
      <p>{user?.email}</p>
      <p className="muted">Roles: {user?.roles.join(', ')}</p>
      <p>
        Portal notice: {user?.portalNoticeVersion ?? '1'} ·{' '}
        {user?.portalAcceptedAt ? 'Accepted' : 'Pending'}
      </p>
      <ErrorNotice error={error} />
      <Link className="button secondary" to="/security">
        Security settings
      </Link>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          void action().catch(setError);
        }}
      >
        Sign out of all sessions
      </button>
    </section>
  );
}
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthScreen key="login" mode="login" />} />
      <Route path="/register" element={<AuthScreen key="register" mode="register" />} />
      <Route path="/forgot-password" element={<AuthScreen key="forgot" mode="forgot" />} />
      <Route path="/reset-password" element={<AuthScreen key="reset" mode="reset" />} />
      <Route path="/verify-email" element={<AuthScreen key="verify" mode="verify" />} />
      <Route path="/invite" element={<AuthScreen key="invite" mode="invite" />} />
      <Route path="/access" element={<AccessScreen />} />
      <Route path="/security" element={<SecurityScreen />} />
      <Route element={<Guard />}>
        <Route element={<Shell />}>
          <Route path="/dashboard" element={<UserDashboard />} />
          <Route path="/assets" element={<AssetList />} />
          <Route path="/assets/:id" element={<AssetDetail />} />
          <Route path="/tickets" element={<TicketList />} />
          <Route path="/tickets/new" element={<TicketForm />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route element={<Guard admin />}>
            <Route
              path="/assignments/new"
              element={<AssetList key="assignment" assignmentMode />}
            />
            <Route path="/assets/new" element={<AssetEditor />} />
            <Route path="/assets/:id/edit" element={<AssetEditor />} />
            <Route path="/assets/:id/assign" element={<AssignmentForm />} />
            <Route path="/master-control" element={<MasterControl />} />
            <Route path="/admin/users" element={<UserAdmin />} />
            <Route path="/admin/imports" element={<ImportsView />} />
            <Route path="/admin/audit" element={<AuditView />} />
            <Route path="/admin/notifications" element={<NotificationSettings />} />
          </Route>
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="*"
        element={
          <Empty
            title="Page not found"
            action={
              <Link className="button" to="/dashboard">
                Back to workspace
              </Link>
            }
          >
            This page is not available.
          </Empty>
        }
      />
    </Routes>
  );
}
