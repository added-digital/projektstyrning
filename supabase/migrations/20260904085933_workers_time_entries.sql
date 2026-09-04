-- M8: medarbetare + spegel av Fortnox tidregistreringar.
--
-- Riktning: Fortnox → oss, strikt. time_entries är en spegel; inget i
-- appen redigerar rader här. fortnox_id är idempotensnyckeln — den
-- nattliga synken upsertar på den och tar bort rader i fönstret som
-- försvunnit ur Fortnox.
--
-- Fortnox API har inget users-endpoint, så userId → medarbetare mappas
-- manuellt (workers.fortnox_user_id). Kopplingen sker i en trigger så
-- att den gäller både vid synk och retroaktivt när ett id fylls i.

create table workers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  fortnox_user_id text unique,
  active          boolean not null default true,
  sort            integer not null default 0,
  created_at      timestamptz not null default now()
);

create table time_entries (
  fortnox_id           text primary key,
  worked_date          date not null,
  worked_hours         numeric(8,2) not null default 0,
  charge_hours         numeric(8,2) not null default 0,
  -- TID = arbetad tid. SEM/VAB/SJK m.fl. = frånvaro; lagras men filtreras
  -- bort i graferna som standard.
  registration_code    text not null,
  fortnox_user_id      text,
  worker_id            uuid references workers (id) on delete set null,
  fortnox_customer_id  text,
  fortnox_customer_name text,
  fortnox_project_id   text,
  fortnox_project_name text,
  fortnox_service_id   text,
  fortnox_service_name text,
  invoice_text         text,
  note                 text,
  non_invoiceable      boolean not null default false,
  invoice_basis_id     bigint,
  document_id          bigint,
  document_type        text,
  unit_cost            numeric(12,2),
  unit_price           numeric(12,2),
  fortnox_created_at   timestamptz,
  fortnox_updated_by   text,
  -- Hela payloaden — inget går förlorat om vi vill ha ett fält senare.
  raw                  jsonb not null,
  synced_at            timestamptz not null default now()
);

create index time_entries_worked_date_idx  on time_entries (worked_date);
create index time_entries_worker_date_idx  on time_entries (worker_id, worked_date);
create index time_entries_fortnox_user_idx on time_entries (fortnox_user_id);

-- Koppla rad → medarbetare utifrån fortnox_user_id vid varje skrivning.
create function attach_worker_to_entry() returns trigger language plpgsql as $$
begin
  new.worker_id := (
    select id from workers where fortnox_user_id = new.fortnox_user_id
  );
  return new;
end $$;

create trigger time_entries_attach_worker
  before insert or update of fortnox_user_id on time_entries
  for each row execute function attach_worker_to_entry();

-- När ett Fortnox-id fylls i/ändras på en medarbetare: koppla om historiken.
create function remap_worker_entries() returns trigger language plpgsql as $$
begin
  if new.fortnox_user_id is distinct from old.fortnox_user_id then
    update time_entries set worker_id = null where worker_id = new.id;
    if new.fortnox_user_id is not null then
      update time_entries set worker_id = new.id
        where fortnox_user_id = new.fortnox_user_id;
    end if;
  end if;
  return new;
end $$;

create trigger workers_remap_entries
  after update of fortnox_user_id on workers
  for each row execute function remap_worker_entries();

-- RLS: teamet läser, service_role skriver. Samma modell som customers.
alter table workers      enable row level security;
alter table time_entries enable row level security;

grant select on workers, time_entries to authenticated;
grant select, insert, update, delete on workers, time_entries to service_role;

create policy team_can_read on workers
  for select to authenticated using (true);
create policy team_can_read on time_entries
  for select to authenticated using (true);

-- Realtime på workers (mappningar) — inte på time_entries: en backfill
-- ger tusentals events; klienten lyssnar på sync_runs istället (M9).
alter publication supabase_realtime add table workers;

-- Seed: teamet ur lib/sections.ts. Fortnox-id fylls i via UI:t.
insert into workers (name, sort) values
  ('Per Albin Wilhelmsson', 1),
  ('David Saupe',           2),
  ('Oliver Lundkvist',      3),
  ('Albin Herbst',          4),
  ('Gustav Lindwall',       5)
on conflict (name) do nothing;
