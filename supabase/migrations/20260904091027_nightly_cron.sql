-- M10: nattlig Fortnox-synk via pg_cron + pg_net.
--
-- Kör edge-funktionen fortnox-sync varje natt 02:00 UTC (04:00 svensk
-- sommartid) med standardfönstret idag − 31 dagar, eftersom folk inte
-- rapporterar tid varje dag och eftersläpande registreringar måste hämtas.
--
-- Hemligheterna ligger i Vault (inte i den här filen):
--   project_url       https://<ref>.supabase.co
--   service_role_key  service-role-nyckeln (edge-funktionen kräver den)
-- De skapas out-of-band med vault.create_secret(); jobbet felar tyst tills
-- de finns, och lyckas därefter utan omdeploy.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'fortnox-sync-nightly',
  '0 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/fortnox-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"trigger":"nightly"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
