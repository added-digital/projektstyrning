-- M6: DML-grants till service_role. All åtkomst går via route handlers
-- med service-role-nyckeln; anon/authenticated förblir utan rättigheter
-- (M2). Uttryckliga privilegier hellre än `grant all` så att avsikten
-- syns i historiken.

grant select, insert, update, delete on table public.customers to service_role;
grant execute on function public.append_task(text, text, jsonb) to service_role;
