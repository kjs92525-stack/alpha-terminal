// Every minute (Cron Trigger): once per US trading weekday, right after the close, start the GitHub
// "Nightly pipeline" with workflow_dispatch. GitHub's own `schedule:` trigger is best-effort and has
// been starting 4+ hours late, which left the site on the previous day's prices all morning in Korea.
// The workflow's schedule stays as a backup; its concurrency group queues a second run behind this one.
//
// Needs the Worker secret GITHUB_DISPATCH_TOKEN: a fine-grained token on this repository with
// "Actions: Read and write". KV (TG_STATE) remembers the day already started, written once per day.

export interface KickEnv {
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  NIGHTLY_KICK_AFTER?: string; // NY local time "HH:MM", default 16:25 (close + the free feed's 15-min delay + margin)
  TG_STATE?: { get(key: string): Promise<string | null>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> };
}

const REPO = 'kjs92525-stack/alpha-terminal';
const LAST_MINUTE = 20 * 60; // stop retrying at 20:00 New York time

/** New York calendar date, weekday (0 = Sunday) and minutes since midnight. */
export function nyClock(now: number): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export async function nightlyKick(env: KickEnv, now = Date.now()): Promise<{ started: boolean; skipped?: string; status?: number }> {
  if (!env.GITHUB_DISPATCH_TOKEN || !env.TG_STATE) return { started: false, skipped: 'not configured' };
  const ny = nyClock(now);
  if (ny.weekday === 0 || ny.weekday === 6) return { started: false, skipped: 'weekend' };
  const [h, m] = (env.NIGHTLY_KICK_AFTER || '16:25').split(':').map(Number);
  if (ny.minutes < h * 60 + m || ny.minutes >= LAST_MINUTE) return { started: false, skipped: 'outside window' };
  const key = `nightly:kick:${ny.date}`;
  if (await env.TG_STATE.get(key)) return { started: false, skipped: 'already started' };
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || REPO}/actions/workflows/nightly.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'alpha-terminal-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status !== 204) return { started: false, skipped: `github ${res.status}`, status: res.status }; // retried next minute
  await env.TG_STATE.put(key, new Date(now).toISOString(), { expirationTtl: 3 * 86400 });
  return { started: true, status: 204 };
}
