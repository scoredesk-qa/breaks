-- Agent view: break allowance, shared 3CX limits, and each agent's own call stats.
-- Run once in the Supabase SQL Editor. Safe to run again. Needs the 3CX status_log table (3CX setup) to exist.

-- 1. settings the admin page saves and every agent's page reads
alter table public.bt_settings add column if not exists break_allowance_min int     not null default 105;   -- break minutes for a full shift
alter table public.bt_settings add column if not exists full_shift_hours    numeric not null default 8;     -- hours that count as a full shift
alter table public.bt_settings add column if not exists cx_config           jsonb   not null default '{}'::jsonb;   -- the 3CX limits from Settings

-- 2. "Doe, Jane" and "Jane Doe" are the same person (ignores order, case and accents)
create or replace function public.cx_name_key(t text) returns text language sql immutable as $$
  select coalesce(string_agg(w, ' ' order by w), '') from (
    select unnest(regexp_split_to_array(regexp_replace(translate(lower(coalesce(t, '')),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]+', ' ', 'g'), ' ')) as w) s
  where w <> ''
$$;

-- 3. what an agent may read of the 3CX log: their own status changes, plus everyone else's WITHOUT names or extensions
--    (so the page can compare calls per hour with the team average, and can tell a call a colleague picked up from an ignored one)
create or replace function public.cx_team_day(p_from timestamptz, p_to timestamptz, p_name text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k text := public.cx_name_key(p_name);
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_to - p_from > interval '3 days' then p_to := p_from + interval '3 days'; end if;
  return jsonb_build_object(
    'mine', case when k = '' then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('changed_at', changed_at, 'extension', extension, 'agent', agent,
                                            'old_status', old_status, 'new_status', new_status) order by changed_at)
        from public.status_log
        where changed_at >= p_from and changed_at < p_to and extension <> '000' and public.cx_name_key(agent) = k), '[]'::jsonb) end,
    'team', coalesce((
        select jsonb_agg(jsonb_build_object('changed_at', s.changed_at, 'extension', 'x' || s.rk, 'agent', 'Colleague ' || s.rk,
                                            'old_status', s.old_status, 'new_status', s.new_status) order by s.changed_at)
        from (select changed_at, old_status, new_status, dense_rank() over (order by extension) as rk
              from public.status_log
              where changed_at >= p_from and changed_at < p_to and extension <> '000' and public.cx_name_key(agent) <> k) s), '[]'::jsonb));
end $$;
revoke all on function public.cx_team_day(timestamptz, timestamptz, text) from public;
grant execute on function public.cx_team_day(timestamptz, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
