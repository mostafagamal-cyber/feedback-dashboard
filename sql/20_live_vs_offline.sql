-- v59: Live vs Offline comparison data (public source-of-truth: live is right).
-- Columns match the sheet 1:1.
create table if not exists public.live_vs_offline (
  id uuid primary key default gen_random_uuid(),
  match_date date,
  match_id text,
  hr_code text,                    -- offline_collector_hrcode
  part_id int,
  event text,
  offline_event_type text,
  jersey text,
  qualifier text,
  live_reviewer_input text,        -- "TRUE"/"FALSE" as strings (source-fidelity)
  offline_collector_input text,
  resolution text,                 -- "Live right" | "Both are wrong"
  total_count int not null default 1,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_lvo_hr    on public.live_vs_offline (hr_code);
create index if not exists idx_lvo_date  on public.live_vs_offline (match_date);
create index if not exists idx_lvo_event on public.live_vs_offline (event);
create index if not exists idx_lvo_res   on public.live_vs_offline (resolution);

alter table public.live_vs_offline enable row level security;

drop policy if exists lvo_reviewer_all on public.live_vs_offline;
create policy lvo_reviewer_all on public.live_vs_offline
  for all using (
    exists (select 1 from public.users p where p.id=auth.uid()
      and p.role in ('Admin'::user_role,'Reviewer'::user_role,'Supervisor'::user_role))
  )
  with check (
    exists (select 1 from public.users p where p.id=auth.uid()
      and p.role in ('Admin'::user_role,'Reviewer'::user_role,'Supervisor'::user_role))
  );

drop policy if exists lvo_owner_select on public.live_vs_offline;
create policy lvo_owner_select on public.live_vs_offline
  for select using (
    exists (select 1 from public.users p where p.id=auth.uid() and p.hr_code=public.live_vs_offline.hr_code)
  );

drop policy if exists lvo_octl_team on public.live_vs_offline;
create policy lvo_octl_team on public.live_vs_offline for select using (
  exists (
    select 1 from public.users me
    join public.users c on c.hr_code = public.live_vs_offline.hr_code
    where me.id = auth.uid() and me.role = 'OCTeamLeader'::user_role
      and me.squad is not null and c.squad = me.squad
  )
);

select 'live_vs_offline ready' as status;
