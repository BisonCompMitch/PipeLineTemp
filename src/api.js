import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken
} from './utils/authStorage.js';

const LOCAL_API_FALLBACK = '/api';
const PRODUCTION_API_FALLBACK = 'https://api.scottsdaleutah.com';
const ALLOW_API_OVERRIDE =
  String(import.meta.env.VITE_ALLOW_API_OVERRIDE || '')
    .trim()
    .toLowerCase() === 'true';
const ENFORCE_SECURE_API =
  String(import.meta.env.VITE_ENFORCE_SECURE_API || 'true')
    .trim()
    .toLowerCase() !== 'false';
let refreshPromise = null;

function isIpAddress(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function assertSecureApiBase(baseUrl) {
  if (String(baseUrl || '').startsWith('/')) return;
  if (!ENFORCE_SECURE_API) return;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_error) {
    throw new Error('Invalid API base URL.');
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return;
  throw new Error('Blocked insecure API URL. Use HTTPS or localhost.');
}

function normalizeApiBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_error) {
    return '';
  }
}

export function getApiBase() {
  const envBase = normalizeApiBase(import.meta.env.VITE_API_URL || import.meta.env.VITE_PIPELINE_API_URL);
  if (envBase) return envBase;
  if (import.meta.env.DEV) {
    return LOCAL_API_FALLBACK;
  }
  if (ALLOW_API_OVERRIDE) {
    const stored = normalizeApiBase(localStorage.getItem('bw_api_url'));
    if (stored) return stored;
  }
  const { hostname, origin } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return LOCAL_API_FALLBACK;
  }
  if (isIpAddress(hostname)) {
    return `http://${hostname}:8000`;
  }
  const lowerHost = String(hostname || '').toLowerCase();
  if (lowerHost.endsWith('github.io') || lowerHost === 'pipeline.scottsdaleutah.com') {
    return PRODUCTION_API_FALLBACK;
  }
  return origin;
}

export function setApiBase(url) {
  if (!ALLOW_API_OVERRIDE) return;
  const normalized = normalizeApiBase(url);
  if (!normalized) return;
  localStorage.setItem('bw_api_url', normalized);
}

export function getAuthHeader() {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }
  const response = await fetch(`${getApiBase()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  if (payload?.access_token) {
    setAccessToken(payload.access_token);
  }
  if (payload?.refresh_token) {
    setRefreshToken(payload.refresh_token);
  }
  return payload?.access_token || null;
}

async function refreshAccessTokenOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    signal,
    retryOnAuth = true
  } = options;
  const finalHeaders = { ...headers };
  if (auth) {
    Object.assign(finalHeaders, getAuthHeader());
  }
  const isBinaryBody = body instanceof Blob || body instanceof FormData;
  let payload = body;
  if (body && !isBinaryBody) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const apiBase = getApiBase();
  assertSecureApiBase(apiBase);
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: finalHeaders,
    body: payload,
    signal
  });
  if (
    response.status === 401 &&
    auth &&
    retryOnAuth &&
    !path.startsWith('/auth/refresh') &&
    !path.startsWith('/auth/login')
  ) {
    const nextToken = await refreshAccessTokenOnce();
    if (nextToken) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${nextToken}` };
      if (body && !(body instanceof FormData)) {
        retryHeaders['Content-Type'] = 'application/json';
      }
      return fetch(`${apiBase}${path}`, {
        method,
        headers: retryHeaders,
        body: payload,
        signal
      });
    }
  }
  return response;
}

export async function loginRequest(username, password) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: { username, password },
    auth: false
  });
}

export async function logoutRequest(refreshToken) {
  if (!refreshToken) return null;
  return apiRequest('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false
  });
}

export async function completeFirstLogin(payload) {
  const response = await apiRequest('/auth/first-login/complete', {
    method: 'POST',
    body: payload
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        message = data.detail.trim();
      }
    } catch (_error) {
      // Ignore non-JSON error payloads
    }
    throw new Error(message);
  }
  return response.json();
}

export async function apiJson(path, options = {}) {
  const response = await apiRequest(path, options);
  if (!response.ok) {
    const message = `Request failed (${response.status})`;
    throw new Error(message);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

export async function getUser(username) {
  return apiJson(`/users/${encodeURIComponent(username)}`);
}

export async function listUsers() {
  return apiJson('/users');
}

export async function updateUser(username, payload) {
  return apiJson(`/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: payload
  });
}

export async function getMyThemePreference() {
  return apiJson('/users/preferences/me');
}

export async function updateMyThemePreference(theme) {
  return apiJson('/users/preferences/me', {
    method: 'PATCH',
    body: { theme }
  });
}

export async function sendPresenceHeartbeat(payload = {}) {
  return apiJson('/users/presence/heartbeat', {
    method: 'POST',
    body: payload
  });
}

export async function listUserActivity(params = '') {
  const suffix = params ? `?${params}` : '';
  return apiJson(`/activity${suffix}`);
}

export async function createUser(payload) {
  return apiJson('/users', { method: 'POST', body: payload });
}

export async function deleteUser(username) {
  return apiJson(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

export async function forceLogoutUser(username) {
  return apiJson(`/users/${encodeURIComponent(username)}/force-logout`, { method: 'POST', body: {} });
}

export async function listProjects(params = '') {
  const suffix = params ? `?${params}` : '';
  return apiJson(`/projects${suffix}`);
}

export async function createProject(payload) {
  return apiJson('/projects', { method: 'POST', body: payload });
}

export async function getProject(projectId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}`);
}

export async function updateProject(projectId, payload) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: payload
  });
}

export async function archiveProject(projectId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}/delete`, {
    method: 'POST'
  });
}

export async function restoreProject(projectId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}/restore`, {
    method: 'POST'
  });
}

export async function deleteProject(projectId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE'
  });
}

export async function listProjectFiles(projectId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}/files`);
}

export async function listProjectAreaNotes(projectId, params = '') {
  const suffix = params ? `?${params}` : '';
  return apiJson(`/projects/${encodeURIComponent(projectId)}/area-notes${suffix}`);
}

export async function uploadProjectFile(projectId, file, options = {}) {
  const filename = options.filename || file?.name || 'file';
  const params = new URLSearchParams({ filename });
  if (options.content_type) {
    params.set('content_type', options.content_type);
  }
  if (typeof options.customer_visible === 'boolean') {
    params.set('customer_visible', options.customer_visible ? 'true' : 'false');
  }
  if (typeof options.contractor_visible === 'boolean') {
    params.set('contractor_visible', options.contractor_visible ? 'true' : 'false');
  }
  const response = await apiRequest(`/projects/${encodeURIComponent(projectId)}/files/upload?${params.toString()}`, {
    method: 'POST',
    body: file
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        message = data.detail.trim();
      }
    } catch (_error) {
      // ignore body parsing errors on non-JSON failures
    }
    throw new Error(message);
  }
  return response.json();
}

export async function updateProjectFile(projectId, fileId, payload) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    body: payload
  });
}

export async function setProjectFileVisibility(projectId, fileId, visibilityOrCustomerVisible, maybeContractorVisible) {
  const visibility =
    typeof visibilityOrCustomerVisible === 'object' && visibilityOrCustomerVisible !== null
      ? {
          customer_visible:
            typeof visibilityOrCustomerVisible.customer_visible === 'boolean'
              ? visibilityOrCustomerVisible.customer_visible
              : undefined,
          contractor_visible:
            typeof visibilityOrCustomerVisible.contractor_visible === 'boolean'
              ? visibilityOrCustomerVisible.contractor_visible
              : undefined
        }
      : {
          customer_visible:
            typeof visibilityOrCustomerVisible === 'boolean'
              ? Boolean(visibilityOrCustomerVisible)
              : undefined,
          contractor_visible:
            typeof maybeContractorVisible === 'boolean' ? Boolean(maybeContractorVisible) : undefined
        };
  const payload = {};
  if (typeof visibility.customer_visible === 'boolean') payload.customer_visible = visibility.customer_visible;
  if (typeof visibility.contractor_visible === 'boolean') payload.contractor_visible = visibility.contractor_visible;
  if (!Object.keys(payload).length) {
    throw new Error('No visibility update provided.');
  }
  const path = `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/visibility`;
  const response = await apiRequest(path, {
    method: 'POST',
    body: payload
  });
  if (response.status === 404 || response.status === 405) {
    return updateProjectFile(projectId, fileId, payload);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        message = data.detail.trim();
      }
    } catch (_error) {
      // ignore body parsing errors on non-JSON failures
    }
    throw new Error(message);
  }
  return response.json();
}

export async function deleteProjectFile(projectId, fileId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE'
  });
}

export async function compressProjectFiles(projectId) {
  return apiJson(`/projects/${encodeURIComponent(projectId)}/compress`, {
    method: 'POST'
  });
}

export async function downloadProjectFile(projectId, fileId) {
  const response = await apiRequest(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        message = data.detail.trim();
      }
    } catch (_error) {
      // ignore body parsing errors on non-JSON failures
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function updateStage(projectId, stageId, payload) {
  return apiJson(`/projects/${projectId}/stages/${stageId}`, {
    method: 'PATCH',
    body: payload
  });
}

export async function updateMoneySubstage(projectId, stageId, payload) {
  return apiJson(`/projects/${projectId}/stages/${stageId}/money-substage`, {
    method: 'PATCH',
    body: payload
  });
}

export async function handoffStage(projectId, stageId) {
  return apiJson(`/projects/${projectId}/handoff/${stageId}`, { method: 'POST' });
}

export async function listLeads() {
  return apiJson('/leads');
}

export async function createLead(payload) {
  return apiJson('/leads', { method: 'POST', body: payload });
}

export async function updateLead(leadId, payload) {
  return apiJson(`/leads/${leadId}`, { method: 'PATCH', body: payload });
}

export async function requestLeadQuote(leadId, payload) {
  return apiJson(`/leads/${encodeURIComponent(leadId)}/request-quote`, {
    method: 'POST',
    body: payload
  });
}

export async function convertLeadToProject(leadId) {
  return apiJson(`/leads/${encodeURIComponent(leadId)}/convert-to-project`, {
    method: 'POST'
  });
}

export async function deleteLead(leadId) {
  return apiJson(`/leads/${leadId}`, { method: 'DELETE' });
}

export async function listLeadFiles(leadId) {
  return apiJson(`/leads/${encodeURIComponent(leadId)}/files`);
}

export async function uploadLeadFile(leadId, file, options = {}) {
  const filename = options.filename || file?.name || 'file';
  const params = new URLSearchParams({ filename });
  if (options.content_type) {
    params.set('content_type', options.content_type);
  }
  const response = await apiRequest(`/leads/${encodeURIComponent(leadId)}/files/upload?${params.toString()}`, {
    method: 'POST',
    body: file
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        message = data.detail.trim();
      }
    } catch (_error) {
      // ignore body parsing errors on non-JSON failures
    }
    throw new Error(message);
  }
  return response.json();
}

export async function downloadLeadFile(leadId, fileId) {
  const response = await apiRequest(`/leads/${encodeURIComponent(leadId)}/files/${encodeURIComponent(fileId)}/download`);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === 'string' && data.detail.trim()) {
        message = data.detail.trim();
      }
    } catch (_error) {
      // ignore body parsing errors on non-JSON failures
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function deleteLeadFile(leadId, fileId) {
  return apiJson(`/leads/${encodeURIComponent(leadId)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

export async function listCustomers() {
  return apiJson('/customers');
}

export async function createCustomer(payload) {
  return apiJson('/customers', { method: 'POST', body: payload });
}

export async function updateCustomer(email, payload) {
  return apiJson(`/customers/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: payload
  });
}

export async function deleteCustomer(email) {
  return apiJson(`/customers/${encodeURIComponent(email)}`, { method: 'DELETE' });
}

export async function listContractors() {
  return apiJson('/contractors');
}

export async function createContractor(payload) {
  return apiJson('/contractors', { method: 'POST', body: payload });
}

export async function updateContractor(email, payload) {
  return apiJson(`/contractors/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: payload
  });
}

export async function deleteContractor(email) {
  return apiJson(`/contractors/${encodeURIComponent(email)}`, { method: 'DELETE' });
}

export async function sendNotification(payload) {
  return apiJson('/notifications/send', { method: 'POST', body: payload });
}
