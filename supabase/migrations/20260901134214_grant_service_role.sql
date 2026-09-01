-- M5: applicerades tomt av misstag (skript-fel vid filskrivning) och är
-- redan registrerad som körd i remote-historiken. Innehållet får därför
-- inte ändras till något verksamt — de riktiga grantsen ligger i M6
-- (20260901135021_explicit_dml_grants.sql). Behålls som no-op så att
-- lokal och remote migrationshistorik matchar.
select 1;
