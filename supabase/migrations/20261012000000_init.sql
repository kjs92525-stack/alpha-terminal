-- ALPHA TERMINAL — initial schema.
-- Per-user data is protected by row-level security. Shared market data tables
-- are read-only for clients and written only by the service role (server jobs).

create extension if not exists pgcrypto;

-- Watchlist (used by the web app today)
create table if not exists public.watchlist_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
alter table public.watchlist_items enable row level security;
create policy "watchlist: owner read" on public.watchlist_items for select using (auth.uid() = user_id);
create policy "watchlist: owner insert" on public.watchlist_items for insert with check (auth.uid() = user_id);
create policy "watchlist: owner update" on public.watchlist_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlist: owner delete" on public.watchlist_items for delete using (auth.uid() = user_id);

-- Saved screening universes
create table if not exists public.universes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  symbols text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.universes enable row level security;
create policy "universes: owner all" on public.universes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Event alert rules (e.g. notify on DILUTION filings for a symbol)
create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  categories text[] not null default '{}',
  min_importance text not null default 'high' check (min_importance in ('low','medium','high','critical')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.alert_rules enable row level security;
create policy "alerts: owner all" on public.alert_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Shared: point-in-time score snapshots written by a scheduled server job.
-- Keeping as_of + model version lets rankings be audited/backtested without look-ahead.
create table if not exists public.score_snapshots (
  symbol text not null,
  as_of date not null,
  model text not null,
  score numeric,
  coverage int,
  factors jsonb not null,
  metrics jsonb not null,
  price_source text not null,
  created_at timestamptz not null default now(),
  primary key (symbol, as_of, model)
);
alter table public.score_snapshots enable row level security;
create policy "snapshots: public read" on public.score_snapshots for select using (true);

-- Shared: classified SEC filings cache
create table if not exists public.sec_filings (
  accession text primary key,
  cik text not null,
  symbol text,
  form text not null,
  items text,
  category text not null,
  importance text not null,
  label text,
  filing_date date,
  accepted_at timestamptz,
  url text not null,
  fetched_at timestamptz not null default now()
);
create index if not exists sec_filings_symbol_accepted on public.sec_filings (symbol, accepted_at desc);
create index if not exists sec_filings_category on public.sec_filings (category, accepted_at desc);
alter table public.sec_filings enable row level security;
create policy "filings: public read" on public.sec_filings for select using (true);
