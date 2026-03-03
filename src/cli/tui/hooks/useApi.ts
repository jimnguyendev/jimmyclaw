import { useState, useEffect } from 'react';
import { ApiClient } from '../../shared/api-client.js';

const client = new ApiClient();

export function useApi<T>(path: string, intervalMs = 2000): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await client.get(path);
        setData(result as T);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    fetch();
    const iv = setInterval(fetch, intervalMs);
    return () => clearInterval(iv);
  }, [path, intervalMs]);

  return { data, error, loading };
}

export { client };
