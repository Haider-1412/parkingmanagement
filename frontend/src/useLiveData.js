import { useEffect, useState } from "react";

export function useLiveData(request, url, paused = false, intervalMs = 10000) {
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let timer;

    async function refresh() {
      try {
        const data = await request(url);
        if (stopped) return;
        setResult({ url, data });
        setFailure(null);
      } catch (error) {
        if (!stopped) setFailure({ url, message: error.message });
      } finally {
        if (!stopped) timer = setTimeout(refresh, intervalMs);
      }
    }

    refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [request, url, paused, intervalMs]);

  return {
    data: result?.url === url ? result.data : null,
    error: failure?.url === url ? failure.message : "",
  };
}
