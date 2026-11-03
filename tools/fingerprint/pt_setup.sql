-- Part-time clock pages: run once in the Supabase SQL Editor (safe to run again).
-- Your clock server already writes public.pt_punches with the service_role key (that key bypasses row security, so it needs no policy).
-- This keeps your existing table and admin rule, and adds: a code for each agent (agents have no accounts), a locked-down lookup so an
-- agent can see ONLY their own punches, and live updates for the admin page.

create table if not exists public.pt_punches (
  emp  int         not null,
  ts   timestamptz not null,
  day  text        not null,
  name text        not null,
  kind text        not null check (kind in ('shift', 'break')),
  dir  text        not null check (dir  in ('IN', 'OUT')),
  primary key (emp, ts));
create index if not exists pt_punches_name_ts on public.pt_punches (lower(name), ts);
alter table public.pt_punches enable row level security;
drop policy if exists "pt admins read" on public.pt_punches;
create policy "pt admins read" on public.pt_punches for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'pt_admin') = 'true');

grant select on public.pt_punches to authenticated;

create or replace function public.is_pt_admin() returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'pt_admin') = 'true', false)
$$;

-- one row per agent: the name must be the name on the scanner without "(PT)" / "(PT break)", e.g. "Sara"
create table if not exists public.pt_agents (
  name_key  text primary key,                 -- lower-case name
  name      text not null,
  code_hash text,                             -- the agent's personal code, stored hashed
  active    boolean not null default true,
  created_at timestamptz not null default now());
create table if not exists public.pt_attempts (name_key text primary key, fails int not null default 0, last_fail timestamptz);
alter table public.pt_agents   enable row level security;
alter table public.pt_attempts enable row level security;      -- no policies: only the functions below use it
drop policy if exists "pt admin agents" on public.pt_agents;
create policy "pt admin agents" on public.pt_agents for all to authenticated using (public.is_pt_admin()) with check (public.is_pt_admin());
grant select, insert, update, delete on public.pt_agents to authenticated;

-- an agent looks at their own punches: name + code. 5 wrong codes lock that name for 15 minutes.
create or replace function public.pt_agent_view(p_name text, p_code text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.pt_agents; f public.pt_attempts; k text := lower(btrim(coalesce(p_name, '')));
begin
  select * into a from public.pt_agents where name_key = k and active;
  if a.name_key is null then return jsonb_build_object('ok', false, 'error', 'bad_code'); end if;
  select * into f from public.pt_attempts where name_key = k;
  if f.fails >= 5 and f.last_fail > now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if a.code_hash is null or a.code_hash <> encode(sha256(convert_to(k || ':' || coalesce(p_code, ''), 'UTF8')), 'hex') then
    insert into public.pt_attempts (name_key, fails, last_fail) values (k, 1, now())
      on conflict (name_key) do update set fails = case when public.pt_attempts.last_fail < now() - interval '15 minutes' then 1 else public.pt_attempts.fails + 1 end, last_fail = now();
    return jsonb_build_object('ok', false, 'error', 'bad_code');
  end if;
  delete from public.pt_attempts where name_key = k;
  if p_to - p_from > interval '45 days' then p_to := p_from + interval '45 days'; end if;
  return jsonb_build_object('ok', true, 'name', a.name, 'punches', coalesce((
    select jsonb_agg(jsonb_build_object('ts', ts, 'kind', kind, 'dir', dir) order by ts)
    from public.pt_punches where lower(name) = k and ts >= p_from and ts < p_to), '[]'::jsonb));
end $$;

-- admin only: add / change an agent and (re)set their code (4 to 8 digits; leave null to keep the current one)
create or replace function public.pt_upsert_agent(p_name text, p_code text, p_active boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare k text := lower(btrim(coalesce(p_name, '')));
begin
  if not public.is_pt_admin() then raise exception 'not allowed'; end if;
  if k = '' then raise exception 'name is empty'; end if;
  if p_code is not null and p_code !~ '^[0-9]{4,8}$' then raise exception 'the code must be 4 to 8 digits'; end if;
  insert into public.pt_agents (name_key, name, code_hash, active) values (k, btrim(p_name),
      case when p_code is null then null else encode(sha256(convert_to(k || ':' || p_code, 'UTF8')), 'hex') end, p_active)
    on conflict (name_key) do update set name = excluded.name, active = excluded.active,
      code_hash = coalesce(excluded.code_hash, public.pt_agents.code_hash);
  if p_code is not null then delete from public.pt_attempts where name_key = k; end if;
end $$;

revoke all on function public.pt_agent_view(text, text, timestamptz, timestamptz) from public;
revoke all on function public.pt_upsert_agent(text, text, boolean) from public;
grant execute on function public.pt_agent_view(text, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.pt_upsert_agent(text, text, boolean) to authenticated;

-- live updates on the admin page
do $$ begin alter publication supabase_realtime add table public.pt_punches;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- Give ONE admin access (replace the email; they log out and in again). Your page already uses this flag for the Part-time tab:
--   update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"pt_admin": true}'::jsonb where email = 'admin@example.com';

notify pgrst, 'reload schema';
