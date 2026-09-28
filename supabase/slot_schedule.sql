-- Scheduled break slots: one-time setup. Run in the Supabase SQL Editor.
-- Before running it, turn on the pg_cron extension (Database > Extensions).

alter table bt_settings add column if not exists lunch_start int default 12;
alter table bt_settings add column if not exists slot_schedule jsonb default '[]'::jsonb;
alter table bt_settings add column if not exists slot_tz text;
alter table bt_settings add column if not exists slot_applied text;

-- Sets max_concurrent_breaks from the latest schedule entry that has started today.
-- Each entry fires once, so manual changes from the app stay until the next entry.
create or replace function bt_apply_slot_schedule(at_ts timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare
  s        bt_settings%rowtype;
  loc      timestamp;
  today    date;
  hm       text;
  r        jsonb;
  ls       record;
  lh       int;
  first    text;
  a_size   int;
  b_size   int;
  best_t   text;
  best_n   int;
  ev_t     text;
  ev_n     int;
  k        text;
begin
  select * into s from bt_settings where id = 1;
  if not found or s.slot_schedule is null or jsonb_array_length(s.slot_schedule) = 0 then return; end if;
  loc   := at_ts at time zone coalesce(nullif(s.slot_tz, ''), 'UTC');
  today := loc::date;
  hm    := to_char(loc, 'HH24:MI');
  lh    := coalesce(s.lunch_start, 12);

  select * into ls from bt_lunch_schedule where date = today limit 1;
  if found then
    a_size := coalesce(jsonb_array_length(to_jsonb(ls.group_a)), 0);
    b_size := coalesce(jsonb_array_length(to_jsonb(ls.group_b)), 0);
    first  := coalesce(ls.group_first, case when extract(day from today)::int % 2 = 0 then 'A' else 'B' end);
  end if;

  for r in select * from jsonb_array_elements(s.slot_schedule) loop
    for ev_t, ev_n in
      select t, n from (
        -- fixed time: {"time":"09:00","slots":4}
        select r->>'time' as t, (r->>'slots')::int as n where r ? 'time'
        -- lunch: {"lunch":true,"extra":1,"after":3}; group times come from lunch_start
        union all select lpad(lh::text, 2, '0') || ':00',
               (case when first = 'A' then a_size else b_size end) + coalesce((r->>'extra')::int, 0)
          where r ? 'lunch' and first is not null
        union all select lpad((lh + 1)::text, 2, '0') || ':00',
               (case when first = 'A' then b_size else a_size end) + coalesce((r->>'extra')::int, 0)
          where r ? 'lunch' and first is not null
        union all select lpad((lh + 2)::text, 2, '0') || ':00', (r->>'after')::int
          where r ? 'lunch' and r->>'after' is not null
      ) e
    loop
      if ev_t <= hm and (best_t is null or ev_t >= best_t) then
        best_t := ev_t; best_n := ev_n;
      end if;
    end loop;
  end loop;

  if best_t is null then return; end if;
  k := today::text || ' ' || best_t;
  if k is distinct from s.slot_applied then
    update bt_settings
       set max_concurrent_breaks = greatest(0, best_n), slot_applied = k, updated_at = now()
     where id = 1;
  end if;
end $$;

revoke execute on function bt_apply_slot_schedule(timestamptz) from public, anon, authenticated;

-- Run it every minute.
select cron.unschedule('bt-slot-schedule') where exists (select 1 from cron.job where jobname = 'bt-slot-schedule');
select cron.schedule('bt-slot-schedule', '* * * * *', 'select bt_apply_slot_schedule()');
