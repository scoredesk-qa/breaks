-- Scheduled break slots: one-time setup. Run in the Supabase SQL Editor.
-- Safe to run again. Re-run it whenever the app tells you the setup is out of date.
-- For the every-minute background job, turn on pg_cron first (Database > Extensions).
-- Without pg_cron the schedule still applies while anyone has the app open.

alter table bt_settings add column if not exists lunch_start int default 12;
alter table bt_settings add column if not exists slot_schedule jsonb default '[]'::jsonb;
alter table bt_settings add column if not exists slot_tz text;
alter table bt_settings add column if not exists slot_applied text;

drop function if exists bt_apply_slot_schedule(timestamptz);

-- Sets max_concurrent_breaks from the latest schedule entry that has started today.
-- Each entry fires once, so manual changes from the app stay until the next entry.
create function bt_apply_slot_schedule(at_ts timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        bt_settings%rowtype;
  tz       text;
  loc      timestamp;
  today    date;
  hm       text;
  r        jsonb;
  lsj      jsonb;
  lh       int;
  first    text;
  a_size   int := 0;
  b_size   int := 0;
  best_t   text;
  best_n   int;
  ev_t     text;
  ev_n     int;
  k        text;
  changed  boolean := false;
begin
  select * into s from bt_settings where id = 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bt_settings has no row with id 1');
  end if;
  if s.slot_schedule is null or jsonb_array_length(s.slot_schedule) = 0 then
    return jsonb_build_object('ok', true, 'reason', 'No schedule saved yet');
  end if;
  tz    := coalesce(nullif(s.slot_tz, ''), 'UTC');
  loc   := at_ts at time zone tz;
  today := loc::date;
  hm    := to_char(loc, 'HH24:MI');
  lh    := coalesce(s.lunch_start, 12);

  -- Read today's lunch groups as JSON so a different column layout can't break the schedule.
  select to_jsonb(l) into lsj from bt_lunch_schedule l where l.date = today limit 1;
  if lsj is not null then
    if jsonb_typeof(lsj->'group_a') = 'array' then a_size := jsonb_array_length(lsj->'group_a'); end if;
    if jsonb_typeof(lsj->'group_b') = 'array' then b_size := jsonb_array_length(lsj->'group_b'); end if;
    first := coalesce(nullif(lsj->>'group_first', ''),
                      case when extract(day from today)::int % 2 = 0 then 'A' else 'B' end);
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

  if best_t is null then
    return jsonb_build_object('ok', true, 'reason', 'No scheduled time has started yet today', 'now', hm, 'tz', tz);
  end if;
  k := today::text || ' ' || best_t;
  if k is distinct from s.slot_applied then
    update bt_settings
       set max_concurrent_breaks = greatest(0, best_n), slot_applied = k, updated_at = now()
     where id = 1;
    changed := true;
  end if;
  return jsonb_build_object('ok', true, 'changed', changed, 'slots', greatest(0, best_n),
                            'rule', best_t, 'now', hm, 'tz', tz);
end $$;

-- Called by the app (every 30s from any open screen, and by the Check now button).
-- It only applies what the admin saved, so it is safe for any signed-in user to call.
create or replace function bt_slot_sync() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  res      jsonb;
  cron_on  boolean := false;
  last_run text;
begin
  res := bt_apply_slot_schedule();
  begin
    execute $q$select exists(select 1 from cron.job where jobname = 'bt-slot-schedule')$q$ into cron_on;
  exception when others then cron_on := false;
  end;
  begin
    execute $q$select d.status || coalesce(' - ' || d.return_message, '')
               from cron.job_run_details d join cron.job j using (jobid)
               where j.jobname = 'bt-slot-schedule' order by d.start_time desc limit 1$q$ into last_run;
  exception when others then last_run := null;
  end;
  return res || jsonb_build_object('cron', cron_on, 'cron_last_run', last_run);
end $$;

revoke all on function bt_apply_slot_schedule(timestamptz) from public, anon, authenticated;
revoke all on function bt_slot_sync() from public, anon;
grant execute on function bt_slot_sync() to authenticated;

-- Background job: every minute, even when nobody has the app open.
do $$
begin
  perform cron.unschedule('bt-slot-schedule') where exists (select 1 from cron.job where jobname = 'bt-slot-schedule');
  perform cron.schedule('bt-slot-schedule', '* * * * *', 'select bt_apply_slot_schedule()');
exception when others then
  raise notice 'pg_cron is not enabled, so the background job was skipped: %', sqlerrm;
end $$;
