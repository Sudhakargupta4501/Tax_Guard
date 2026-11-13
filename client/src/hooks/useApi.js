import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with loading / error / reload handling.
 * `fetcher` is re-run whenever `deps` change. Stale responses are ignored.
 */
export function useApi(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ body: null, loading: enabled, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const body = await fetcherRef.current();
      if (id === seq.current) setState({ body, loading: false, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ body: s.body, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    if (enabled) run();
    return () => { seq.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { body: state.body, data: state.body?.data, pagination: state.body?.pagination, loading: state.loading, error: state.error, reload: run };
}
