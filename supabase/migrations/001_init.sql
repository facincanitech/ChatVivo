create extension if not exists pgcrypto;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null default 'general',
  author text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "anon can read messages" on public.messages;
create policy "anon can read messages"
  on public.messages for select
  to anon
  using (true);

drop policy if exists "anon can insert messages" on public.messages;
create policy "anon can insert messages"
  on public.messages for insert
  to anon
  with check (true);
