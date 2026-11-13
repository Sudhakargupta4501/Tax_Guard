import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, onUnauthorized, setCsrfToken, applyServerErrors } from '../services/api';

const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  beforeEach(() => { setCsrfToken(null); onUnauthorized(null); });
  afterEach(() => vi.restoreAllMocks());

  it('sends credentials and parses JSON', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(200, { success: true, data: { ok: 1 } }));
    const body = await api.get('/customers', { search: 'abc', empty: '' });
    expect(body.data.ok).toBe(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toMatch(/\/customers\?search=abc$/);
    expect(init.credentials).toBe('include');
  });

  it('sends the in-memory CSRF token only on state-changing calls', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonRes(200, {}));
    setCsrfToken('tok123');
    await api.get('/x');
    await api.post('/x', { a: 1 });
    expect(spy.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();
    expect(spy.mock.calls[1][1].headers['X-CSRF-Token']).toBe('tok123');
  });

  it('turns HTTP errors into ApiError with server message and field errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(422, { message: 'Validation failed', errors: [{ field: 'email', message: 'Taken' }] }));
    await expect(api.post('/customers', {})).rejects.toMatchObject({ name: 'ApiError', status: 422, message: 'Validation failed' });
  });

  it('reports network failures distinctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed'));
    const err = await api.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.network).toBe(true);
  });

  it('calls the unauthorized handler on 401 (but not for login attempts)', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(401, { message: 'Session expired' }));
    await api.get('/invoices').catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
    await api.post('/auth/login', {}).catch(() => {});
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('maps server field errors onto form fields', () => {
    const setError = vi.fn();
    const handled = applyServerErrors(new ApiError('x', { errors: [{ field: 'email', message: 'Taken' }] }), setError);
    expect(handled).toBe(true);
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Taken' });
    expect(applyServerErrors(new ApiError('x'), setError)).toBe(false);
  });
});
