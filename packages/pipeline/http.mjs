// Polite HTTP helpers: minimum spacing between requests and retry with backoff.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function throttle(minIntervalMs) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + minIntervalMs;
    if (wait) await sleep(wait);
  };
}

/** Retries network errors, 429 and 5xx. Returns the final Response (caller checks .ok). */
export async function fetchRetry(url, init = {}, { retries = 4, baseDelayMs = 1000, fetchImpl = fetch, wait = sleep } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      if (attempt === retries) return res;
      const ra = Number(res.headers.get('retry-after'));
      await wait(Number.isFinite(ra) && ra > 0 ? ra * 1000 : baseDelayMs * 2 ** attempt);
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw e;
      await wait(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
