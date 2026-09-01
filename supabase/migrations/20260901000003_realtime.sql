-- M3: Realtime-publikation. Ersätter klientens 2-sekunderspolling.
-- Utan REPLICA IDENTITY FULL innehåller update-payloaden bara PK — det
-- räcker, eftersom klienten använder eventet som en signal att ladda om,
-- inte som datakälla.

alter publication supabase_realtime add table customers;
