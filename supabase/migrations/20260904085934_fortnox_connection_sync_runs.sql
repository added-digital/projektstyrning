-- M9: Fortnox-koppling (service account) + synklogg.
--
-- fortnox_connection är en singleton-rad med tenant_id från det
-- engångs-samtycke en Fortnox-systemadministratör ger (account_type=
-- service). Därefter hämtas access tokens med client_credentials +
-- TenantId-header — inga refresh tokens att rotera eller tappa.
-- Raden nås BARA av service_role; tenant_id ska aldrig nå webbläsaren.
--
-- sync_runs ger synlig systemstatus ("synkar från Fortnox…") och är
-- det klienten lyssnar på via Realtime.

create table fortnox_connection (
  -- boolean-PK med check = max en rad.
  id            boolean primary key default true check (id),
  tenant_id     text not null,
  scopes        text[] not null default '{}',
  consented_at  timestamptz not null default now(),
  consented_by  text,
  last_sync_at  timestamptz,
  last_sync_status text
);

create table sync_runs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  from_date        date not null,
  to_date          date not null,
  trigger          text not null check (trigger in ('nightly', 'manual')),
  entries_upserted integer not null default 0,
  entries_deleted  integer not null default 0,
  status           text not null default 'running'
                   check (status in ('running', 'ok', 'error')),
  error            text
);

create index sync_runs_started_at_idx on sync_runs (started_at desc);

alter table fortnox_connection enable row level security;
alter table sync_runs          enable row level security;

-- fortnox_connection: inga policies, inga grants till anon/authenticated.
revoke all on fortnox_connection from anon, authenticated;
grant select, insert, update, delete on fortnox_connection to service_role;

grant select on sync_runs to authenticated;
grant select, insert, update, delete on sync_runs to service_role;

create policy team_can_read on sync_runs
  for select to authenticated using (true);

alter publication supabase_realtime add table sync_runs;
