// Optional Supabase persistence (auth + watchlist). Disabled unless both env vars are set.
// Only the public anon key belongs in the browser; row-level security protects data.
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && anon ? createClient(url, anon) : null;
export type { Session };

export async function fetchWatchlist(): Promise<string[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('watchlist_items').select('symbol').order('created_at');
  if (error) throw error;
  return data.map((r: { symbol: string }) => r.symbol);
}

export async function setWatch(userId: string, symbol: string, on: boolean) {
  if (!supabase) return;
  if (on) {
    const { error } = await supabase.from('watchlist_items').upsert({ user_id: userId, symbol }, { onConflict: 'user_id,symbol' });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('watchlist_items').delete().eq('user_id', userId).eq('symbol', symbol);
    if (error) throw error;
  }
}
