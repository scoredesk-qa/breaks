-- Requests (time off and other) with a message thread. Run once in the Supabase SQL Editor. Safe to run again.
-- Agents create and see only their own requests; admins (user_metadata.role = 'admin', same as the rest of the app) see everything and decide.

create or replace function public.bt_is_admin() returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', false)
$$;

create table if not exists public.bt_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid(),
  agent_name  text        not null,
  kind        text        not null default 'pto' check (kind in ('pto', 'sick', 'shift', 'other')),
  start_date  date,
  end_date    date,
  note        text        check (note is null or length(note) <= 2000),
  status      text        not null default 'pending' check (status in ('pending', 'approved', 'denied', 'cancelled')),
  admin_note  text        check (admin_note is null or length(admin_note) <= 2000),
  decided_by  text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists bt_requests_user   on public.bt_requests (user_id, created_at desc);
create index if not exists bt_requests_status on public.bt_requests (status, start_date);

create table if not exists public.bt_request_msgs (
  id          bigint generated always as identity primary key,
  request_id  bigint      not null references public.bt_requests (id) on delete cascade,
  user_id     uuid        not null default auth.uid(),
  author_name text        not null,
  is_admin    boolean     not null default false,
  body        text        not null check (length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists bt_request_msgs_req on public.bt_request_msgs (request_id, created_at);

alter table public.bt_requests     enable row level security;
alter table public.bt_request_msgs enable row level security;

-- requests
drop policy if exists "requests read"   on public.bt_requests;
drop policy if exists "requests insert" on public.bt_requests;
drop policy if exists "requests update" on public.bt_requests;
create policy "requests read"   on public.bt_requests for select to authenticated using (user_id = auth.uid() or public.bt_is_admin());
create policy "requests insert" on public.bt_requests for insert to authenticated with check (user_id = auth.uid() and status = 'pending' and decided_at is null);
create policy "requests update" on public.bt_requests for update to authenticated
  using (public.bt_is_admin() or (user_id = auth.uid() and status = 'pending'))
  with check (public.bt_is_admin() or (user_id = auth.uid() and status in ('pending', 'cancelled')));

-- an agent can only cancel their own pending request; they cannot touch the decision fields
create or replace function public.bt_requests_guard() returns trigger language plpgsql as $$
begin
  if public.bt_is_admin() then
    if new.status is distinct from old.status then new.decided_at := now(); end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.admin_note is distinct from old.admin_note
     or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    raise exception 'not allowed';
  end if;
  return new;
end $$;
drop trigger if exists bt_requests_guard on public.bt_requests;
create trigger bt_requests_guard before update on public.bt_requests for each row execute function public.bt_requests_guard();

-- messages: the agent and the admins can read and write the thread of the agent's own requests
drop policy if exists "msgs read"   on public.bt_request_msgs;
drop policy if exists "msgs insert" on public.bt_request_msgs;
create policy "msgs read" on public.bt_request_msgs for select to authenticated
  using (public.bt_is_admin() or exists (select 1 from public.bt_requests r where r.id = request_id and r.user_id = auth.uid()));
create policy "msgs insert" on public.bt_request_msgs for insert to authenticated
  with check (user_id = auth.uid()
    and (public.bt_is_admin() or (is_admin = false and exists (select 1 from public.bt_requests r where r.id = request_id and r.user_id = auth.uid())))
    and (is_admin = false or public.bt_is_admin()));

grant select, insert, update on public.bt_requests to authenticated;
grant select, insert on public.bt_request_msgs to authenticated;

-- live updates
do $$ begin alter publication supabase_realtime add table public.bt_requests;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bt_request_msgs;
exception when duplicate_object then null; when undefined_object then null; end $$;

notify pgrst, 'reload schema';
