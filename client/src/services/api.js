/**
 * Centralised API client built on the native Fetch API.
 * - Base URL from VITE_API_URL
 * - Session lives in an HTTP-only cookie (sent with credentials: 'include'); the JWT is never readable by JS.
 * - The CSRF token returned by login/me is kept in memory only (never localStorage) and sent on state-changing calls.
 * - JSON parsing, HTTP errors, network errors and 401 handling are normalised into ApiError.
 */
const BASE = (import.meta.env?.VITE_API_URL || '/api').replace(/\/$/, '');

let csrfToken = null;
let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, { status = 0, errors, code, network = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.code = code;
    this.network = network;
  }
}

export const setCsrfToken = (token) => { csrfToken = token || null; };
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

const AUTH_PATHS = ['/auth/login', '/auth/register'];

function buildQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.append(k, v);
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { body, params, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(params)}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: raw ? '*/*' : 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', { network: true });
  }

  if (raw && res.ok) return res;

  let payload = null;
  try {
    const text = await res.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = new ApiError(payload?.message || `Request failed (${res.status})`, { status: res.status, errors: payload?.errors, code: payload?.code });
    if (res.status === 401 && !AUTH_PATHS.includes(path) && unauthorizedHandler) unauthorizedHandler(err);
    throw err;
  }
  return payload;
}

/** Downloads a binary/text response (PDF, CSV) through the authenticated session. */
async function download(path, fallbackName, params) {
  const res = await request('GET', path, { raw: true, params });
  const blob = await res.blob();
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
  patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
  delete: (path) => request('DELETE', path),
  download,
};

/** Maps server-side field errors ({field, message}[]) onto React Hook Form fields. */
export function applyServerErrors(error, setError) {
  if (!error?.errors?.length) return false;
  error.errors.forEach((e) => e.field && setError(e.field, { type: 'server', message: e.message }));
  return true;
}
