-- Northern Highlands participatory GIS — run in Supabase SQL Editor
-- Dashboard → SQL → New query → paste and run

create table if not exists public.submissions (
  id text primary key,
  participant text not null default 'Anonymous',
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists submissions_updated_at_idx
  on public.submissions (updated_at desc);

alter table public.submissions enable row level security;

-- Workshop app: anonymous read/write (anon key is public in the browser).
-- Anyone with the link can view and edit submissions. Do not store sensitive data.
drop policy if exists "Allow public read" on public.submissions;
create policy "Allow public read"
  on public.submissions for select
  using (true);

drop policy if exists "Allow public insert" on public.submissions;
create policy "Allow public insert"
  on public.submissions for insert
  with check (true);

drop policy if exists "Allow public update" on public.submissions;
create policy "Allow public update"
  on public.submissions for update
  using (true);

drop policy if exists "Allow public delete" on public.submissions;
create policy "Allow public delete"
  on public.submissions for delete
  using (true);
