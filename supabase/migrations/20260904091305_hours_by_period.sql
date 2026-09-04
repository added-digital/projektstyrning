-- M11: aggregering för tidsgrafen — timmar per medarbetare och period.
--
-- Görs i databasen (inte i klienten) så att vecka/månad/år är samma
-- bucket-logik överallt. date_trunc('week') är ISO-vecka (måndag), vilket
-- är det svensk tidrapportering utgår från.
--
-- Okopplade Fortnox-användare (worker_id null) syns som egen serie
-- "Okopplad (<id>)" istället för att tyst försvinna — det är signalen
-- att mappningen behöver fyllas i.

create function hours_by_period(
  p_period text,
  p_from   date,
  p_to     date,
  p_codes  text[] default array['TID']
)
returns table (
  period_start date,
  worker_id    uuid,
  worker_name  text,
  hours        numeric
)
language sql
stable
as $$
  select
    date_trunc(
      case when p_period in ('week', 'month', 'year') then p_period
           else 'month' end,
      t.worked_date
    )::date                                             as period_start,
    w.id                                                as worker_id,
    coalesce(w.name, 'Okopplad (' || t.fortnox_user_id || ')') as worker_name,
    sum(t.worked_hours)                                 as hours
  from time_entries t
  left join workers w on w.id = t.worker_id
  where t.worked_date between p_from and p_to
    and t.registration_code = any (p_codes)
  group by 1, 2, 3
  order by 1, 3;
$$;

revoke all on function hours_by_period(text, date, date, text[]) from public, anon;
grant execute on function hours_by_period(text, date, date, text[]) to authenticated, service_role;
