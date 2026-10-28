-- 3CX status log: one-time setup. Run in the Supabase SQL Editor of the project the 3CX logger uploads to.
-- If the logger's own setup SQL already created the table (insert-only for the public key), you do NOT need this file:
-- you only need the "admins read status_log" rule below (the page offers it as "Copy SQL to allow admins to read it").
-- Safe to run again. It creates the table, lets the logger add rows (with the project's public key), and lets signed-in admins read them.

create table if not exists public.status_log (
  id          bigint generated always as identity primary key,
  changed_at  timestamptz not null default now(),
  extension   text not null,
  agent       text,
  old_status  text,
  new_status  text not null,
  detail      text
);
create index if not exists status_log_changed_at_idx on public.status_log (changed_at desc);
create index if not exists status_log_extension_idx  on public.status_log (extension, changed_at desc);

alter table public.status_log enable row level security;

-- the logger: add rows only (it cannot read or change anything). Note: anyone with the project's public key could add rows.
do $$ begin
  create policy "logger can add rows" on public.status_log for insert to anon with check (true);
exception when duplicate_object then null;
end $$;

-- the app: admins can read
do $$ begin
  create policy "admins read status_log" on public.status_log for select to authenticated
    using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
exception when duplicate_object then null;
end $$;

grant insert on public.status_log to anon;
grant select on public.status_log to authenticated;

notify pgrst, 'reload schema';
