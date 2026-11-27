// The only place the app talks to the backend. Components never call fetch directly.
const STORAGE_KEY = 'expenseflow.auth';

let authHeader = readStoredAuth();
let onUnauthorized = () => {};

function readStoredAuth() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function basicAuthHeader(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return `Basic ${btoa(binary)}`;
}

export function setAuth(header) {
  authHeader = header;
  try {
    if (header) sessionStorage.setItem(STORAGE_KEY, header);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode): keep credentials in memory only
  }
}

export function hasAuth() {
  return Boolean(authHeader);
}

/** Called on any 401 so the app can drop the session and show the login page. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function toError(res) {
  let message = `Request failed (${res.status})`;
  let fieldErrors = null;
  try {
    const problem = await res.json();
    message = problem.detail || problem.title || message;
    fieldErrors = problem.errors || null; // Bean Validation: { field: message }
  } catch {
    // body was not JSON
  }
  const err = new Error(message);
  err.status = res.status;
  err.fieldErrors = fieldErrors;
  return err;
}

async function request(method, path, { json, form, raw } = {}) {
  const headers = { Accept: raw ? '*/*' : 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // browser sets multipart Content-Type with boundary
  }

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body });
  } catch {
    const err = new Error('Cannot reach the server. Check that the backend is running.');
    err.status = 0;
    throw err;
  }

  if (!res.ok) {
    const err = await toError(res);
    if (res.status === 401) {
      setAuth(null);
      onUnauthorized();
    }
    throw err;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const type = res.headers.get('Content-Type') || '';
  return type.includes('json') ? res.json() : null;
}

export const apiGet = (path) => request('GET', path);
export const apiPost = (path, json) => request('POST', path, { json });
export const apiPut = (path, json) => request('PUT', path, { json });
export const apiDelete = (path) => request('DELETE', path);

export function apiUpload(path, file) {
  const form = new FormData();
  form.append('file', file);
  return request('POST', path, { form });
}

/** Authenticated binary download: returns { blob, filename, contentType }. */
export async function apiDownload(path) {
  const res = await request('GET', path, { raw: true });
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return {
    blob: await res.blob(),
    filename: match ? match[1] : 'download',
    contentType: res.headers.get('Content-Type') || '',
  };
}

/** Builds "?a=1&b=2", skipping empty values. */
export function query(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) qs.append(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}
