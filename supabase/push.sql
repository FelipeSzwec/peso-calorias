-- Avisos com o app fechado. Execute no Supabase: SQL Editor > New query > Run. Pode ser executado mais de uma vez.
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  tz text not null default 'America/Sao_Paulo' check (char_length(tz) <= 60),
  last_sent jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;
do $$ begin if not exists (select 1 from pg_policies where policyname='push_own') then create policy "push_own" on public.push_subs for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid())); end if; end $$;
