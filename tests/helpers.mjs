// Deterministic synthetic bars for tests only.
export function makeBars(n, { seed = 7, start = 100, drift = 0.0005, vol = 0.02, t0 = Date.UTC(2024, 0, 2) / 1000 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const bars = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(0.5, o * (1 + drift + (rnd() - 0.5) * 2 * vol));
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.5);
    const l = Math.min(o, c) * (1 - rnd() * vol * 0.5);
    bars.push({ time: t0 + i * 86400, open: o, high: h, low: l, close: c, volume: Math.round(1e6 * (0.5 + rnd())) });
    p = c;
  }
  return bars;
}
export const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
