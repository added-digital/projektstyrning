-- M7: läsrättighet för inloggade teammedlemmar.
--
-- Två skäl:
--  1. Realtime (postgres_changes) respekterar RLS — utan SELECT-policy får
--     prenumeranter inga events alls. Inloggade klienter behöver den här
--     policyn för att live-uppdateringarna ska nå webbläsaren.
--  2. Signups är avstängda och användare bjuds in manuellt, så
--     "authenticated" == teamet. Att teamet kan läsa är per definition ok.
--
-- Skrivningar går fortfarande enbart via route handlers med service_role.
-- Anon har fortsatt noll åtkomst.

grant select on table public.customers to authenticated;

create policy "team_can_read"
  on public.customers
  for select
  to authenticated
  using (true);
