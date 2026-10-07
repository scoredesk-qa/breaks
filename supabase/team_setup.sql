-- Trainees and shift end: one-time setup. Run in the Supabase SQL Editor. Safe to run again.

alter table bt_settings add column if not exists trainees jsonb default '[]'::jsonb;
alter table bt_settings add column if not exists trainee_lunch text default '12:00';
alter table bt_settings add column if not exists shift_end text default '16:30';

-- Break slot limit, now aware of trainees: a trainee can always start a break,
-- and trainees' open breaks don't count toward the limit for everyone else.
create or replace function public.enforce_max_concurrent_breaks()
 returns trigger
 language plpgsql
as $function$
declare
  cap int;
  v_trainees jsonb;
  current_count int;
begin
  -- Lock the settings row for the duration of this transaction. This is
  -- what makes the check atomic: if two breaks try to start at the same
  -- moment, the second one waits here until the first has fully committed,
  -- then sees the up-to-date count that includes the first break.
  select max_concurrent_breaks, coalesce(trainees, '[]'::jsonb)
    into cap, v_trainees
    from bt_settings where id = 1 for update;

  if cap is null then
    return new; -- no cap configured yet, don't block anything
  end if;

  if jsonb_typeof(v_trainees) is distinct from 'array' then
    v_trainees := '[]'::jsonb;
  end if;

  -- Trainees have no slot limit
  if exists (select 1 from jsonb_array_elements_text(v_trainees) t
              where lower(regexp_replace(trim(t), '[[:space:]]+', ' ', 'g'))
                  = lower(regexp_replace(trim(coalesce(new.agent_name, '')), '[[:space:]]+', ' ', 'g'))) then
    return new;
  end if;

  -- Trainees' open breaks don't use up slots for the rest of the team
  select count(*) into current_count
    from bt_logs l
   where l.end_time is null
     and not exists (select 1 from jsonb_array_elements_text(v_trainees) t
                      where lower(regexp_replace(trim(t), '[[:space:]]+', ' ', 'g'))
                          = lower(regexp_replace(trim(coalesce(l.agent_name, '')), '[[:space:]]+', ' ', 'g')));

  if current_count >= cap then
    raise exception 'All % break slots are taken. Please wait.', cap;
  end if;

  return new;
end;
$function$;
