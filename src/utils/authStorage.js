const AUTH_KEYS = {
  authed: 'bw_authed',
  user: 'bw_user',
  displayName: 'bw_display_name',
  accessToken: 'bw_token',
  refreshToken: 'bw_refresh_token'
};

const LEGACY_KEYS = ['bw_first_login_current_username'];

const inMemoryAuthStore = new Map();

function getSessionStore() {
  if (typeof window === 'undefined') return null;
  try {
    const key = '__bw_session_storage_probe__';
    window.sessionStorage.setItem(key, '1');
    window.sessionStorage.removeItem(key);
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
}

const sessionStore = getSessionStore();

function readKey(key) {
  if (sessionStore) return sessionStore.getItem(key);
  return inMemoryAuthStore.has(key) ? inMemoryAuthStore.get(key) : null;
}

function writeKey(key, value) {
  if (value === null || value === undefined || value === '') {
    removeKey(key);
    return;
  }
  const normalized = String(value);
  if (sessionStore) {
    sessionStore.setItem(key, normalized);
    return;
  }
  inMemoryAuthStore.set(key, normalized);
}

function removeKey(key) {
  if (sessionStore) {
    sessionStore.removeItem(key);
    return;
  }
  inMemoryAuthStore.delete(key);
}

let migrationComplete = false;

export function migrateLegacyAuthState() {
  if (migrationComplete || typeof window === 'undefined') return;
  migrationComplete = true;
  let localStore = null;
  try {
    localStore = window.localStorage;
  } catch (_error) {
    localStore = null;
  }
  if (!localStore) return;

  Object.values(AUTH_KEYS).forEach((key) => {
    const localValue = localStore.getItem(key);
    if (localValue !== null && readKey(key) === null) {
      writeKey(key, localValue);
    }
    localStore.removeItem(key);
  });

  LEGACY_KEYS.forEach((key) => localStore.removeItem(key));
}

export function getAuthedFlag() {
  return readKey(AUTH_KEYS.authed) === 'true';
}

export function setAuthedFlag(value) {
  if (value) {
    writeKey(AUTH_KEYS.authed, 'true');
    return;
  }
  removeKey(AUTH_KEYS.authed);
}

export function getStoredUsername() {
  return String(readKey(AUTH_KEYS.user) || '').trim();
}

export function setStoredUsername(value) {
  writeKey(AUTH_KEYS.user, String(value || '').trim());
}

export function getDisplayName() {
  return String(readKey(AUTH_KEYS.displayName) || '').trim();
}

export function setDisplayName(value) {
  writeKey(AUTH_KEYS.displayName, String(value || '').trim());
}

export function getAccessToken() {
  return String(readKey(AUTH_KEYS.accessToken) || '').trim();
}

export function setAccessToken(token) {
  writeKey(AUTH_KEYS.accessToken, String(token || '').trim());
}

export function getRefreshToken() {
  return String(readKey(AUTH_KEYS.refreshToken) || '').trim();
}

export function setRefreshToken(token) {
  writeKey(AUTH_KEYS.refreshToken, String(token || '').trim());
}

export function clearAuthState() {
  Object.values(AUTH_KEYS).forEach((key) => removeKey(key));
}

migrateLegacyAuthState();
