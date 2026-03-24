import React, { useEffect, useMemo, useState } from 'react';
import {
  getMyThemePreference,
  getUser,
  logoutRequest,
  sendPresenceHeartbeat,
  updateMyThemePreference
} from './api.js';
import {
  clearAuthState,
  getAccessToken,
  getAuthedFlag,
  getDisplayName,
  getRefreshToken,
  getStoredUsername,
  setAccessToken,
  setAuthedFlag,
  setDisplayName,
  setRefreshToken,
  setStoredUsername
} from './utils/authStorage.js';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import TutorialDialog from './components/TutorialDialog.jsx';
import Login from './pages/Login.jsx';
import FirstLoginSetup from './pages/FirstLoginSetup.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Areas from './pages/Areas.jsx';
import Intake from './pages/Intake.jsx';
import Leads from './pages/Leads.jsx';
import Users from './pages/Users.jsx';
import Customer from './pages/Customer.jsx';
import CustomerFiles from './pages/CustomerFiles.jsx';
import CustomerPictures from './pages/CustomerPictures.jsx';
import NotFound from './pages/NotFound.jsx';

const ROUTE_TITLES = {
  '/pipeline': 'Dashboard',
  '/areas': 'Areas',
  '/intake': 'Project Intake',
  '/leads': 'Leads',
  '/users': 'Manage Users',
  '/customer/files': 'Files for Review',
  '/customer/pictures': 'Project Pictures',
  '/customer': 'Progress',
  '/first-login-setup': 'Complete Setup'
};

const TEST_ROLE_PRESETS = {
  auto: { bison: null, contractor: null, customer: null },
  bison: { bison: true, contractor: false, customer: false },
  contractor: { bison: false, contractor: true, customer: false },
  customer: { bison: false, contractor: false, customer: true },
  bison_contractor: { bison: true, contractor: true, customer: false }
};

const DEFAULT_TESTING_OVERRIDE = { rolePreset: 'auto', areas: '' };
const DEFAULT_FIRST_LOGIN_STATE = {
  required: false,
  usernameNeedsSetup: false,
  suggestedUsername: '',
  suggestedFullName: '',
  email: ''
};

const TUTORIAL_PREFERENCE_PREFIX = 'bw_tutorial_dont_show:';
const TUTORIAL_SESSION_PREFIX = 'bw_tutorial_seen:';

function titleForPath(pathname) {
  if (!pathname) return 'BisonWorks';
  const match = Object.keys(ROUTE_TITLES).find((route) => pathname.startsWith(route));
  return match ? ROUTE_TITLES[match] : 'BisonWorks';
}

function normalizeTheme(value) {
  return String(value || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';
}

function normalizeListValues(value) {
  const raw = Array.isArray(value) ? value : [value];
  const values = [];
  raw.forEach((item) => {
    const text = String(item || '').trim();
    if (!text) return;
    text
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => values.push(entry));
  });
  return Array.from(new Set(values));
}

function normalizeAreaKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['admin', 'admin area', 'administrator'].includes(normalized)) return 'admin';
  if (['management', 'manager'].includes(normalized)) return 'management';
  return normalized;
}

function decodeBase64Url(value) {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return atob(padded);
  } catch (_error) {
    return '';
  }
}

function usernameFromAccessToken(token) {
  if (!token) return '';
  const parts = String(token).split('.');
  if (parts.length < 2) return '';
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return String(payload?.sub || '').trim();
  } catch (_error) {
    return '';
  }
}

function tutorialStorageKey(prefix, userKey) {
  const normalized = String(userKey || '').trim().toLowerCase();
  if (!normalized) return '';
  return `${prefix}${normalized}`;
}

function readTutorialPreference(userKey) {
  const key = tutorialStorageKey(TUTORIAL_PREFERENCE_PREFIX, userKey);
  if (!key || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch (_error) {
    return false;
  }
}

function writeTutorialPreference(userKey, value) {
  const key = tutorialStorageKey(TUTORIAL_PREFERENCE_PREFIX, userKey);
  if (!key || typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, '1');
      return;
    }
    window.localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage write failures.
  }
}

function hasTutorialBeenShownThisSession(userKey) {
  const key = tutorialStorageKey(TUTORIAL_SESSION_PREFIX, userKey);
  if (!key || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch (_error) {
    return false;
  }
}

function markTutorialShownThisSession(userKey) {
  const key = tutorialStorageKey(TUTORIAL_SESSION_PREFIX, userKey);
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, '1');
  } catch (_error) {
    // Ignore session storage write failures.
  }
}

function clearTutorialSessionFlags() {
  if (typeof window === 'undefined') return;
  try {
    const keys = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith(TUTORIAL_SESSION_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (_error) {
    // Ignore session storage cleanup failures.
  }
}

function tutorialRoleLabel({ hasBison, hasAdminArea, hasContractor, hasCustomer }) {
  if (hasBison && hasAdminArea) return 'Bison Admin';
  if (hasBison) return 'Bison';
  if (hasContractor) return 'Contractor';
  if (hasCustomer) return 'Customer';
  return 'User';
}

function buildTutorialSteps({
  canAccessDashboard,
  hasBison,
  hasAdminArea,
  hasContractor,
  hasCustomer
}) {
  const steps = [
    {
      id: 'help-entry',
      title: 'Help Menu',
      description:
        'Open the user menu in the top-right corner and click Help to start this tutorial again at any time.'
    }
  ];

  if (canAccessDashboard) {
    steps.push({
      id: 'dashboard',
      title: 'Dashboard',
      description:
        'Track projects by project number and current stage. Open project details from the table to review stage progress, notes, and files.',
      route: '/pipeline',
      routeLabel: 'Dashboard'
    });
  }

  if (hasBison) {
    steps.push({
      id: 'areas',
      title: 'Areas',
      description:
        'Work projects in each area queue, review countdown status, and hand off projects to the next stage when the work is complete.',
      route: '/areas',
      routeLabel: 'Areas'
    });
  }

  if (hasBison && hasAdminArea) {
    steps.push({
      id: 'intake',
      title: 'Project Intake',
      description:
        'Create projects, capture requester details, mark required docs, set slab work, and upload initial files or photos during intake.',
      route: '/intake',
      routeLabel: 'Project Intake'
    });
  }

  if (hasContractor || hasAdminArea) {
    steps.push({
      id: 'leads',
      title: 'Leads',
      description:
        'Create and manage leads, track lead status, and keep lead notes and uploads in one place.',
      route: '/leads',
      routeLabel: 'Leads'
    });
  }

  if (hasBison && hasAdminArea) {
    steps.push({
      id: 'users',
      title: 'Manage Users',
      description:
        'Create users, update usernames, assign roles and areas, and maintain account settings for your team.',
      route: '/users',
      routeLabel: 'Manage Users'
    });
  }

  if (hasCustomer) {
    steps.push({
      id: 'customer-progress',
      title: 'Progress',
      description:
        'Follow the current project stage and progress timeline so customers can see where their project is right now.',
      route: '/customer',
      routeLabel: 'Progress'
    });
    steps.push({
      id: 'customer-files',
      title: 'Files For Review',
      description:
        'Open shared project files, preview supported file types, and download documents for review.',
      route: '/customer/files',
      routeLabel: 'Files for Review'
    });
    steps.push({
      id: 'customer-pictures',
      title: 'Project Pictures',
      description:
        'Review customer-visible project photos and open them in the preview viewer for full detail.',
      route: '/customer/pictures',
      routeLabel: 'Project Pictures'
    });
  }

  if (!steps.length) {
    steps.push({
      id: 'welcome',
      title: 'Workspace',
      description: 'Use the side navigation to open your available workspaces and manage your active items.'
    });
  }

  return steps;
}

function Protected({ authed, allowed, fallback, loading = false, children }) {
  if (!authed) {
    return <Navigate to="/login" replace />;
  }
  if (loading) {
    return null;
  }
  if (allowed === false) {
    return <Navigate to={fallback || '/pipeline'} replace />;
  }
  return children;
}

function PageShell({
  title,
  displayName,
  onSignOut,
  onOpenHelp,
  theme,
  onToggleTheme,
  testingOverride,
  onTestingOverrideChange,
  showNavToggle = false,
  onToggleNav,
  children
}) {
  return (
    <div className="page">
      <TopBar
        title={title}
        displayName={displayName}
        onSignOut={onSignOut}
        onOpenHelp={onOpenHelp}
        theme={theme}
        onToggleTheme={onToggleTheme}
        testingOverride={testingOverride}
        onTestingOverrideChange={onTestingOverrideChange}
        showNavToggle={showNavToggle}
        onToggleNav={onToggleNav}
      />
      {children}
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialAuthed = getAuthedFlag();
  const [authed, setAuthed] = useState(initialAuthed);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(initialAuthed);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('bw_theme');
    return normalizeTheme(savedTheme);
  });
  const sessionId = useMemo(() => {
    let stored = sessionStorage.getItem('bw_session_id');
    if (!stored) {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        stored = window.crypto.randomUUID();
      } else {
        stored = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      sessionStorage.setItem('bw_session_id', stored);
    }
    return stored;
  }, []);
  const [testingOverride, setTestingOverride] = useState(() => {
    try {
      const raw = localStorage.getItem('bw_testing_override');
      if (!raw) return { rolePreset: 'auto', areas: '' };
      const parsed = JSON.parse(raw);
      return {
        rolePreset: parsed.rolePreset || 'auto',
        areas: parsed.areas || ''
      };
    } catch (_error) {
      return { rolePreset: 'auto', areas: '' };
    }
  });
  const [firstLoginState, setFirstLoginState] = useState(DEFAULT_FIRST_LOGIN_STATE);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialDontShowAgain, setTutorialDontShowAgain] = useState(false);
  const [tutorialUserKey, setTutorialUserKey] = useState('');

  const handleLogin = (username, tokenPayload) => {
    clearTutorialSessionFlags();
    const canonicalUsername = String(
      tokenPayload?.username || tokenPayload?.login_username || username || ''
    ).trim();
    setAuthedFlag(true);
    if (canonicalUsername) {
      setStoredUsername(canonicalUsername);
      setDisplayName(canonicalUsername);
    }
    if (tokenPayload?.access_token) {
      setAccessToken(tokenPayload.access_token);
    }
    if (tokenPayload?.refresh_token) {
      setRefreshToken(tokenPayload.refresh_token);
    }
    const mustResetPassword = Boolean(tokenPayload?.must_reset_password);
    const suggestedUsername = String(
      tokenPayload?.login_username || tokenPayload?.username || tokenPayload?.email || canonicalUsername
    ).trim();
    setFirstLoginState({
      required: mustResetPassword,
      usernameNeedsSetup: Boolean(tokenPayload?.username_needs_setup),
      suggestedUsername,
      suggestedFullName: String(tokenPayload?.full_name || '').trim(),
      email: String(tokenPayload?.email || '').trim()
    });
    setProfileLoading(true);
    setAuthed(true);
    navigate(mustResetPassword ? '/first-login-setup' : '/pipeline');
  };

  const handleLogout = () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      logoutRequest(refreshToken).catch(() => null);
    }
    clearAuthState();
    clearTutorialSessionFlags();
    setAuthed(false);
    setFirstLoginState(DEFAULT_FIRST_LOGIN_STATE);
    setProfileLoading(false);
    setTutorialOpen(false);
    navigate('/login');
  };

  useEffect(() => {
    if (!authed) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    const storedUsername = getStoredUsername();
    const tokenUsername = usernameFromAccessToken(getAccessToken());
    const candidates = Array.from(new Set([storedUsername, tokenUsername].filter(Boolean)));
    if (!candidates.length) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    let active = true;
    setProfileLoading(true);
    (async () => {
      for (const candidate of candidates) {
        try {
          const user = await getUser(candidate);
          if (!active) return;
          setProfile(user);
          if (user?.username) {
            setStoredUsername(user.username);
          }
          if (user?.full_name) {
            setDisplayName(user.full_name);
          }
          setFirstLoginState({
            required: Boolean(user?.must_reset_password),
            usernameNeedsSetup: !String(user?.login_username || '').trim(),
            suggestedUsername: String(user?.login_username || user?.email || user?.username || '').trim(),
            suggestedFullName: String(user?.full_name || '').trim(),
            email: String(user?.email || '').trim()
          });
          setProfileLoading(false);
          return;
        } catch (_error) {
          // Try next identifier
        }
      }
      if (active) {
        setProfile(null);
        setProfileLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return undefined;
    let active = true;
    const refreshProfile = async () => {
      const storedUsername = getStoredUsername();
      const tokenUsername = usernameFromAccessToken(getAccessToken());
      const candidates = Array.from(new Set([storedUsername, tokenUsername].filter(Boolean)));
      for (const candidate of candidates) {
        try {
          const user = await getUser(candidate);
          if (!active) return;
          setProfile(user);
          if (user?.username) {
            setStoredUsername(user.username);
          }
          if (user?.full_name) {
            setDisplayName(user.full_name);
          }
          return;
        } catch (_error) {
          // Try next identifier
        }
      }
    };
    const timer = window.setInterval(refreshProfile, 30000);
    window.addEventListener('focus', refreshProfile);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshProfile);
    };
  }, [authed]);

  const roles = normalizeListValues(profile?.roles);
  const profileAreas = normalizeListValues(profile?.areas);
  const normalizedProfileAreas = profileAreas.map((area) => normalizeAreaKey(area)).filter(Boolean);
  const normalizedRoles = roles.map((role) => String(role || '').trim().toLowerCase());
  const hasAdminRole = normalizedRoles.some((role) => role === 'admin' || role.includes('admin'));
  const canUseTestingOverride = hasAdminRole || normalizedProfileAreas.includes('admin');
  const activeTestingOverride = canUseTestingOverride ? testingOverride : DEFAULT_TESTING_OVERRIDE;
  const baseHasCustomer = normalizedRoles.some((role) => role.includes('customer'));
  const baseHasContractor = normalizedRoles.some((role) => role.includes('contractor'));
  const baseHasBison =
    normalizedRoles.some((role) => role && !role.includes('customer') && !role.includes('contractor')) ||
    profileAreas.length > 0 ||
    normalizedRoles.length === 0;
  const preset = TEST_ROLE_PRESETS[activeTestingOverride.rolePreset] || TEST_ROLE_PRESETS.auto;
  const hasCustomer = preset.customer === null ? baseHasCustomer : preset.customer;
  const hasContractor = preset.contractor === null ? baseHasContractor : preset.contractor;
  const hasBison = preset.bison === null ? baseHasBison : preset.bison;
  const effectiveAreas = activeTestingOverride.areas
    ? normalizeListValues(activeTestingOverride.areas)
    : profileAreas;
  const normalizedAreas = effectiveAreas.map((area) => normalizeAreaKey(area)).filter(Boolean);
  const hasAdminArea = normalizedAreas.includes('admin');
  const hasManagementArea = normalizedAreas.includes('management');
  const canEditProjects = hasAdminArea;
  const canEditProjectDetails = hasAdminArea;
  const canViewAllAreas = hasAdminArea || hasManagementArea;
  const canAccessDashboard = hasContractor || hasBison;
  const tutorialTitle = useMemo(
    () => `${tutorialRoleLabel({ hasBison, hasAdminArea, hasContractor, hasCustomer })} quick tour`,
    [hasBison, hasAdminArea, hasContractor, hasCustomer]
  );
  const tutorialSteps = useMemo(
    () =>
      buildTutorialSteps({
        canAccessDashboard,
        hasBison,
        hasAdminArea,
        hasContractor,
        hasCustomer
      }),
    [canAccessDashboard, hasBison, hasAdminArea, hasContractor, hasCustomer]
  );
  const accessLoading = authed && profileLoading;
  const firstLoginRequired = authed && firstLoginState.required;

  const defaultRoute = hasContractor
    ? '/pipeline'
    : hasBison
      ? '/pipeline'
      : '/customer';
  const fallbackRoute = firstLoginRequired ? '/first-login-setup' : defaultRoute;
  const handleToggleTheme = () => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    if (!canUseTestingOverride) {
      localStorage.removeItem('bw_testing_override');
      if (testingOverride.rolePreset !== DEFAULT_TESTING_OVERRIDE.rolePreset || testingOverride.areas !== DEFAULT_TESTING_OVERRIDE.areas) {
        setTestingOverride(DEFAULT_TESTING_OVERRIDE);
      }
      return;
    }
    localStorage.setItem('bw_testing_override', JSON.stringify(testingOverride));
  }, [testingOverride, canUseTestingOverride]);

  useEffect(() => {
    localStorage.setItem('bw_theme', theme);
  }, [theme]);

  useEffect(() => {
    const appliedTheme =
      location.pathname === '/login' || location.pathname === '/first-login-setup' ? 'dark' : theme;
    document.body.setAttribute('data-theme', appliedTheme);
  }, [theme, location.pathname]);

  useEffect(() => {
    if (!authed || !firstLoginRequired || location.pathname === '/first-login-setup') return;
    navigate('/first-login-setup', { replace: true });
  }, [authed, firstLoginRequired, location.pathname, navigate]);

  useEffect(() => {
    if (!authed || profileLoading || firstLoginRequired) return;
    const key = String(profile?.username || getStoredUsername() || '').trim().toLowerCase();
    if (!key) return;
    setTutorialUserKey(key);
    const dontShowAgain = readTutorialPreference(key);
    setTutorialDontShowAgain(dontShowAgain);
    if (dontShowAgain || hasTutorialBeenShownThisSession(key)) return;
    markTutorialShownThisSession(key);
    setTutorialOpen(true);
  }, [authed, profileLoading, firstLoginRequired, profile?.username]);

  useEffect(() => {
    if (!authed) return;
    let active = true;
    getMyThemePreference()
      .then((pref) => {
        if (!active || !pref?.theme) return;
        const nextTheme = normalizeTheme(pref.theme);
        setTheme((current) => (current === nextTheme ? current : nextTheme));
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    updateMyThemePreference(theme).catch(() => null);
  }, [authed, theme]);

  useEffect(() => {
    if (!authed) return;
    const send = () => {
      sendPresenceHeartbeat({ theme, route: location.pathname, session_id: sessionId }).catch(() => null);
    };
    send();
    const timer = window.setInterval(send, 60000);
    return () => window.clearInterval(timer);
  }, [authed, theme, location.pathname, sessionId]);

  const navItems = useMemo(() => {
    const items = [];
    if (canAccessDashboard) {
      items.push({ label: 'Dashboard', path: '/pipeline' });
    }
    if (hasBison) {
      items.push({ label: 'Areas', path: '/areas' });
    }
    if (hasBison && hasAdminArea) {
      items.push({ label: 'Project Intake', path: '/intake' });
    }
    if (hasBison && hasAdminArea) {
      items.push({ label: 'Manage Users', path: '/users' });
    }
    if (hasContractor || hasAdminArea) {
      items.push({ label: 'Leads', path: '/leads' });
    }
    if (hasCustomer) {
      items.push({ label: 'Progress', path: '/customer' });
      items.push({ label: 'Files for Review', path: '/customer/files' });
      items.push({ label: 'Project Pictures', path: '/customer/pictures' });
    }
    const seen = new Set();
    return items.filter((item) => {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }, [hasBison, hasContractor, hasCustomer, canAccessDashboard, hasAdminArea]);
  const topBarDisplayName = String(
    profile?.full_name || getDisplayName() || profile?.username || getStoredUsername() || 'User'
  ).trim() || 'User';

  const showSidebar = location.pathname !== '/login' && location.pathname !== '/first-login-setup';
  const pageTitle = useMemo(() => titleForPath(location.pathname), [location.pathname]);
  const showNavToggle = showSidebar;

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1000px)');
    const syncForViewport = () => {
      if (!media.matches) {
        setNavOpen(false);
      }
    };
    syncForViewport();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncForViewport);
      return () => media.removeEventListener('change', syncForViewport);
    }
    media.addListener(syncForViewport);
    return () => media.removeListener(syncForViewport);
  }, []);

  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 1000px)').matches;
    if (!isMobile) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  const handleOpenHelp = () => {
    const key = String(profile?.username || getStoredUsername() || '').trim().toLowerCase();
    if (key) {
      setTutorialUserKey(key);
      setTutorialDontShowAgain(readTutorialPreference(key));
    }
    setTutorialOpen(true);
  };

  const handleTutorialPreferenceChange = (value) => {
    setTutorialDontShowAgain(Boolean(value));
    if (!tutorialUserKey) return;
    writeTutorialPreference(tutorialUserKey, Boolean(value));
  };

  return (
    <div className={showSidebar ? `app-shell${navOpen ? ' nav-open' : ''}` : 'app-shell no-sidebar'}>
      {showSidebar ? (
        <>
          <button
            className={`sidebar-backdrop${navOpen ? ' open' : ''}`}
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setNavOpen(false)}
          />
          <Sidebar
            currentPath={location.pathname}
            onNavigate={navigate}
            navItems={navItems}
            isOpen={navOpen}
            onClose={() => setNavOpen(false)}
          />
        </>
      ) : null}
      <main className="main">
        <Routes>
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route
            path="/first-login-setup"
            element={
              <Protected authed={authed} allowed={firstLoginRequired} fallback={defaultRoute} loading={accessLoading}>
                <FirstLoginSetup
                  initialUsername={firstLoginState.suggestedUsername}
                  initialFullName={firstLoginState.suggestedFullName}
                  email={firstLoginState.email}
                  onComplete={(result) => {
                    const nextUsername = String(result?.login_username || result?.username || '').trim();
                    const nextFullName = String(result?.full_name || '').trim();
                    if (nextUsername) {
                      setStoredUsername(nextUsername);
                    }
                    if (nextFullName) {
                      setDisplayName(nextFullName);
                    }
                    setFirstLoginState(DEFAULT_FIRST_LOGIN_STATE);
                    navigate(defaultRoute, { replace: true });
                  }}
                  onSignOut={handleLogout}
                />
              </Protected>
            }
          />
          <Route
            path="/pipeline"
            element={
              <Protected authed={authed} allowed={!firstLoginRequired && canAccessDashboard} fallback={fallbackRoute} loading={accessLoading}>
                <PageShell
                  title={pageTitle}
                  displayName={topBarDisplayName}
                  onSignOut={handleLogout}
                  onOpenHelp={handleOpenHelp}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  testingOverride={canUseTestingOverride ? testingOverride : null}
                  onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                  showNavToggle={showNavToggle}
                  onToggleNav={() => setNavOpen((open) => !open)}
                >
                  <Pipeline
                    canEditProjects={canEditProjects}
                    canEditProjectDetails={canEditProjectDetails}
                    canUploadProjectFiles={hasContractor && !hasBison}
                    applyAreaFilter={false}
                    allowedAreas={effectiveAreas}
                    canViewAllAreas={true}
                    showHoverNotes={true}
                    showRequesterFilter={!hasContractor || hasBison}
                    showArchivedFilter={!hasContractor || hasBison}
                  />
                </PageShell>
              </Protected>
            }
          />
          <Route
            path="/areas"
            element={
              <Protected authed={authed} allowed={!firstLoginRequired && hasBison} fallback={fallbackRoute} loading={accessLoading}>
                <PageShell
                  title={pageTitle}
                  displayName={topBarDisplayName}
                  onSignOut={handleLogout}
                  onOpenHelp={handleOpenHelp}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  testingOverride={canUseTestingOverride ? testingOverride : null}
                  onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                  showNavToggle={showNavToggle}
                  onToggleNav={() => setNavOpen((open) => !open)}
                >
                  <Areas
                    userAreas={effectiveAreas}
                    canEditExpectedTime={hasAdminArea}
                  />
                </PageShell>
              </Protected>
            }
          />
          <Route
            path="/intake"
            element={
              <Protected authed={authed} allowed={!firstLoginRequired && hasBison} fallback={fallbackRoute} loading={accessLoading}>
                <PageShell
                  title={pageTitle}
                  displayName={topBarDisplayName}
                  onSignOut={handleLogout}
                  onOpenHelp={handleOpenHelp}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  testingOverride={canUseTestingOverride ? testingOverride : null}
                  onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                  showNavToggle={showNavToggle}
                  onToggleNav={() => setNavOpen((open) => !open)}
                >
                  <Intake />
                </PageShell>
              </Protected>
            }
          />
          <Route
            path="/contractor"
            element={
              <Navigate to="/pipeline" replace />
            }
          />
          <Route
            path="/leads"
            element={
              <Protected authed={authed} allowed={!firstLoginRequired && (hasContractor || hasAdminArea)} fallback={fallbackRoute} loading={accessLoading}>
                <PageShell
                  title={pageTitle}
                  displayName={topBarDisplayName}
                  onSignOut={handleLogout}
                  onOpenHelp={handleOpenHelp}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  testingOverride={canUseTestingOverride ? testingOverride : null}
                  onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                  showNavToggle={showNavToggle}
                  onToggleNav={() => setNavOpen((open) => !open)}
                >
                  <Leads isAdminView={hasAdminArea} />
                </PageShell>
              </Protected>
            }
          />
          <Route
            path="/users"
            element={
              <Protected authed={authed} allowed={!firstLoginRequired && hasBison && hasAdminArea} fallback={fallbackRoute} loading={accessLoading}>
                <PageShell
                  title={pageTitle}
                  displayName={topBarDisplayName}
                  onSignOut={handleLogout}
                  onOpenHelp={handleOpenHelp}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  testingOverride={canUseTestingOverride ? testingOverride : null}
                  onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                  showNavToggle={showNavToggle}
                  onToggleNav={() => setNavOpen((open) => !open)}
                >
                  <Users />
                </PageShell>
              </Protected>
            }
          />
            <Route
              path="/customer"
              element={
                <Protected authed={authed} allowed={!firstLoginRequired && hasCustomer} fallback={fallbackRoute} loading={accessLoading}>
                  <PageShell
                    title={pageTitle}
                    displayName={topBarDisplayName}
                    onSignOut={handleLogout}
                    onOpenHelp={handleOpenHelp}
                    theme={theme}
                    onToggleTheme={handleToggleTheme}
                    testingOverride={canUseTestingOverride ? testingOverride : null}
                    onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                    showNavToggle={showNavToggle}
                    onToggleNav={() => setNavOpen((open) => !open)}
                  >
                    <Customer />
                  </PageShell>
                </Protected>
              }
            />
            <Route
              path="/customer/files"
              element={
                <Protected authed={authed} allowed={!firstLoginRequired && hasCustomer} fallback={fallbackRoute} loading={accessLoading}>
                  <PageShell
                    title={pageTitle}
                    displayName={topBarDisplayName}
                    onSignOut={handleLogout}
                    onOpenHelp={handleOpenHelp}
                    theme={theme}
                    onToggleTheme={handleToggleTheme}
                    testingOverride={canUseTestingOverride ? testingOverride : null}
                    onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                    showNavToggle={showNavToggle}
                    onToggleNav={() => setNavOpen((open) => !open)}
                  >
                    <CustomerFiles />
                  </PageShell>
                </Protected>
              }
            />
            <Route
              path="/customer/pictures"
              element={
                <Protected authed={authed} allowed={!firstLoginRequired && hasCustomer} fallback={fallbackRoute} loading={accessLoading}>
                  <PageShell
                    title={pageTitle}
                    displayName={topBarDisplayName}
                    onSignOut={handleLogout}
                    onOpenHelp={handleOpenHelp}
                    theme={theme}
                    onToggleTheme={handleToggleTheme}
                    testingOverride={canUseTestingOverride ? testingOverride : null}
                    onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                    showNavToggle={showNavToggle}
                    onToggleNav={() => setNavOpen((open) => !open)}
                  >
                    <CustomerPictures />
                  </PageShell>
                </Protected>
              }
            />
          <Route path="/" element={<Navigate to={authed ? (accessLoading ? '/pipeline' : fallbackRoute) : '/login'} replace />} />
          <Route
            path="*"
            element={
              <Protected authed={authed} allowed={!profileLoading && !firstLoginRequired} fallback={fallbackRoute} loading={accessLoading}>
                <PageShell
                  title="Not Found"
                  displayName={topBarDisplayName}
                  onSignOut={handleLogout}
                  onOpenHelp={handleOpenHelp}
                  theme={theme}
                  onToggleTheme={handleToggleTheme}
                  testingOverride={canUseTestingOverride ? testingOverride : null}
                  onTestingOverrideChange={canUseTestingOverride ? setTestingOverride : undefined}
                  showNavToggle={showNavToggle}
                  onToggleNav={() => setNavOpen((open) => !open)}
                >
                  <NotFound />
                </PageShell>
              </Protected>
            }
          />
        </Routes>
      </main>
      <TutorialDialog
        open={tutorialOpen && authed && !firstLoginRequired}
        title={tutorialTitle}
        steps={tutorialSteps}
        dontShowAgain={tutorialDontShowAgain}
        onDontShowAgainChange={handleTutorialPreferenceChange}
        onNavigate={(path) => navigate(path)}
        onClose={() => setTutorialOpen(false)}
      />
    </div>
  );
}
