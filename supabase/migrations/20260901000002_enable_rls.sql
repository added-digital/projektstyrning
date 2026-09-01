-- M2: RLS på, utan policies. Anon- och authenticated-rollerna får noll
-- rader; all åtkomst går genom route handlers med service-role-nyckeln
-- (som passerar förbi RLS). Lägg till policies först om/när klienten
-- pratar direkt med Supabase istället för via /api.

alter table customers enable row level security;

revoke all on customers from anon, authenticated;
