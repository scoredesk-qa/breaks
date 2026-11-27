-- Bonus audit: the numbers an admin types in (QA pass rate, corrections) and the month's working days. Run once in the Supabase SQL Editor. Safe to run again.
-- Admin only (user_metadata.role = 'admin', same as the rest of the app).

create or replace function public.bt_is_admin() returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', false)
$$;

create table if not exists public.bt_bonus_inputs (
  month           text        not null,                 -- '2026-10'
  agent_name      text        not null,                 -- the agent, or '__month__' for the settings of the month
  qa_rate         numeric     check (qa_rate is null or (qa_rate >= 0 and qa_rate <= 1)),   -- 0.9 = 90 %
  absent_override int         check (absent_override is null or absent_override >= 0),      -- replaces the days absent worked out by the page
  punct_adj       int         not null default 0,       -- added to the punctuality events (negative to forgive some)
  workdays        text,                                 -- month row only: weekdays worked, e.g. '12345' (1 = Monday ... 7 = Sunday)
  holidays        text,                                 -- month row only: days nobody works, e.g. '2026-10-06,2026-10-20'
  leave_counts    boolean     not null default false,   -- month row only: do approved time-off days count as absent
  updated_at      timestamptz not null default now(),
  primary key (month, agent_name)
);

alter table public.bt_bonus_inputs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bt_bonus_inputs' and policyname = 'bonus admin') then
    create policy "bonus admin" on public.bt_bonus_inputs for all to authenticated using (public.bt_is_admin()) with check (public.bt_is_admin());
  end if;
end $$;

grant select, insert, update on public.bt_bonus_inputs to authenticated;

notify pgrst, 'reload schema';
