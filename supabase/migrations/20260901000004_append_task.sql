-- M4: Atomiskt tillägg av en uppgift på ett projekt. Används av
-- ingest-endpointet (Codex-flödet). En enda UPDATE-sats: kan inte skriva
-- över en samtidig redigering i webbläsaren, till skillnad från
-- läs–ändra–skriv av hela dokumentet.

create function append_task(p_slug text, p_project_id text, p_task jsonb)
returns boolean language plpgsql as $$
declare i int;
begin
  select ord - 1 into i
  from customers c,
       jsonb_array_elements(c.doc -> 'projects') with ordinality t(proj, ord)
  where c.slug = p_slug and proj ->> 'id' = p_project_id;

  if i is null then return false; end if;

  update customers set doc = jsonb_set(
    doc,
    array['projects', i::text, 'tasks'],
    coalesce(doc -> 'projects' -> i -> 'tasks', '[]'::jsonb)
      || jsonb_build_array(p_task),
    true
  ) where slug = p_slug;

  return true;
end $$;

revoke all on function append_task(text, text, jsonb) from anon, authenticated;
