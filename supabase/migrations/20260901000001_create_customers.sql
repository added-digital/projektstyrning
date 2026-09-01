-- M1: customers-tabellen.
-- UUID som primärnyckel, slug som unik adresserbar kolumn: namnbyten blir
-- en vanlig UPDATE istället för en rad-flytt. `doc` håller hela kund-
-- dokumentet ({ projects, activeProjectId }) — all normalisering och
-- legacy-migrering bor i lib/storage.ts, inte i databasen.

create table customers (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  client     text not null,
  doc        jsonb not null default '{"projects":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create index customers_updated_at_idx on customers (updated_at desc);

-- updated_at sätts av databasen, aldrig av klienten: det är den som
-- optimistisk låsning och Realtime vilar på.
create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger customers_touch before update on customers
  for each row execute function touch_updated_at();
