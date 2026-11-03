-- Fingerprint clock: run once in the Supabase SQL Editor (safe to run again).
-- Agents have no accounts. The scanner app writes punches; agents look themselves up with their badge number + a personal code;
-- ONE admin account (marked with app_metadata fp_admin) can see and manage everything and download reports.

create table if not exists public.fp_agents (
  badge_id   text primary key check (badge_id ~ '^[0-9A-Za-z_-]{1,20}$'),   -- the user ID on the fingerprint scanner
  name       text not null,
  code_hash  text,                                                           -- the agent's personal code (stored hashed, set by the admin)
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.fp_punches (
  id         bigint generated always as identity primary key,
  badge_id   text not null check (badge_id ~ '^[0-9A-Za-z_-]{1,20}$'),
  punched_at timestamptz not null,
  punch_type text check (punch_type in ('in', 'out', 'break_start', 'break_end')),   -- leave empty if the scanner does not say; the page works it out from the order
  device     text,
  created_at timestamptz not null default now(),
  unique (badge_id, punched_at)                                              -- the same scan sent twice is stored once
);
create index if not exists fp_punches_time on public.fp_punches (punched_at);
create index if not exists fp_punches_badge_time on public.fp_punches (badge_id, punched_at);
create table if not exists public.fp_attempts (badge_id text primary key, fails int not null default 0, last_fail timestamptz);

alter table public.fp_agents   enable row level security;
alter table public.fp_punches  enable row level security;
alter table public.fp_attempts enable row level security;     -- no policies: only the functions below touch it

create or replace function public.is_fp_admin() returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'fp_admin') = 'true', false)
$$;

-- the scanner app (public key): may add punches, nothing else
do $$ begin create policy "scanner adds punches" on public.fp_punches for insert to anon with check (true);
exception when duplicate_object then null; end $$;
-- the one admin: everything
do $$ begin create policy "fp admin punches" on public.fp_punches for all to authenticated using (public.is_fp_admin()) with check (public.is_fp_admin());
exception when duplicate_object then null; end $$;
do $$ begin create policy "fp admin agents" on public.fp_agents for all to authenticated using (public.is_fp_admin()) with check (public.is_fp_admin());
exception when duplicate_object then null; end $$;

grant insert on public.fp_punches to anon;
grant usage, select on sequence public.fp_punches_id_seq to anon;
grant select, insert, update, delete on public.fp_punches, public.fp_agents to authenticated;

-- an agent looks at their own punches: badge number + code. 5 wrong codes lock that badge for 15 minutes.
create or replace function public.fp_agent_view(p_badge text, p_code text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.fp_agents; f public.fp_attempts;
begin
  select * into a from public.fp_agents where badge_id = p_badge and active;
  if a.badge_id is null then return jsonb_build_object('ok', false, 'error', 'bad_code'); end if;
  select * into f from public.fp_attempts where badge_id = p_badge;
  if f.fails >= 5 and f.last_fail > now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if a.code_hash is null or a.code_hash <> encode(sha256(convert_to(p_badge || ':' || coalesce(p_code, ''), 'UTF8')), 'hex') then
    insert into public.fp_attempts (badge_id, fails, last_fail) values (p_badge, 1, now())
      on conflict (badge_id) do update set fails = case when public.fp_attempts.last_fail < now() - interval '15 minutes' then 1 else public.fp_attempts.fails + 1 end, last_fail = now();
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;
  delete from public.fp_attempts where badge_id = p_badge;
  if p_to - p_from > interval '45 days' then p_to := p_from + interval '45 days'; end if;
  return jsonb_build_object('ok', true, 'name', a.name, 'punches', coalesce((
    select jsonb_agg(jsonb_build_object('punched_at', punched_at, 'punch_type', punch_type) order by punched_at)
    from public.fp_punches where badge_id = p_badge and punched_at >= p_from and punched_at < p_to), '[]'::jsonb));
end $$;

-- admin only: add / change an agent and (re)set their code
create or replace function public.fp_upsert_agent(p_badge text, p_name text, p_code text, p_active boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_fp_admin() then raise exception 'not allowed'; end if;
  if p_code is not null and p_code !~ '^[0-9]{4,8}$' then raise exception 'the code must be 4 to 8 digits'; end if;
  insert into public.fp_agents (badge_id, name, code_hash, active) values (p_badge, p_name,
      case when p_code is null then null else encode(sha256(convert_to(p_badge || ':' || p_code, 'UTF8')), 'hex') end, p_active)
    on conflict (badge_id) do update set name = excluded.name, active = excluded.active,
      code_hash = coalesce(excluded.code_hash, public.fp_agents.code_hash);
  if p_code is not null then delete from public.fp_attempts where badge_id = p_badge; end if;
end $$;

revoke all on function public.fp_agent_view(text, text, timestamptz, timestamptz) from public;
revoke all on function public.fp_upsert_agent(text, text, text, boolean) from public;
grant execute on function public.fp_agent_view(text, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.fp_upsert_agent(text, text, text, boolean) to authenticated;

-- live updates on the admin page
do $$ begin alter publication supabase_realtime add table public.fp_punches;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- Make ONE account the fingerprint admin (create it first under Authentication > Users, then put its email here):
--   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"fp_admin": true}' where email = 'admin@yourcompany.com';
-- Sign out and in again afterwards so the new setting is in the login token.

notify pgrst, 'reload schema';
