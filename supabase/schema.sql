-- Execute no Supabase: SQL Editor > New query > Run. Pode ser executado mais de uma vez.
-- Cada pessoa só enxerga as próprias linhas (RLS). updated_at é sempre definido pelo servidor.

create table if not exists public.entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  meal text not null check (char_length(meal) <= 40),
  food_name text not null check (char_length(food_name) <= 120),
  qty numeric not null check (qty >= 0 and qty <= 100000),
  unit text not null check (unit in ('g','ml','unid')),
  kcal numeric not null check (kcal >= 0 and kcal <= 20000),
  p numeric not null default 0 check (p >= 0 and p <= 2000),
  c numeric not null default 0 check (c >= 0 and c <= 2000),
  g numeric not null default 0 check (g >= 0 and g <= 2000),
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists entries_user_date on public.entries (user_id, date);
create index if not exists entries_user_upd on public.entries (user_id, updated_at);

create table if not exists public.days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  tipo text not null default '' check (tipo in ('','Treino','Descanso')),
  treino text not null default '' check (char_length(treino) <= 80),
  peso numeric check (peso is null or (peso > 20 and peso < 500)),
  gasto numeric check (gasto is null or (gasto >= 0 and gasto < 20000)),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
create index if not exists days_user_upd on public.days (user_id, updated_at);

create table if not exists public.user_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}' check (pg_column_size(data) < 200000),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$ begin if not exists (select 1 from pg_trigger where tgname='entries_touch') then create trigger entries_touch before insert or update on public.entries for each row execute function public.touch_updated_at(); end if; end $$;
do $$ begin if not exists (select 1 from pg_trigger where tgname='days_touch') then create trigger days_touch before insert or update on public.days for each row execute function public.touch_updated_at(); end if; end $$;
do $$ begin if not exists (select 1 from pg_trigger where tgname='state_touch') then create trigger state_touch before insert or update on public.user_state for each row execute function public.touch_updated_at(); end if; end $$;

alter table public.entries enable row level security;
alter table public.days enable row level security;
alter table public.user_state enable row level security;

do $$ begin if not exists (select 1 from pg_policies where policyname='entries_own') then create policy "entries_own" on public.entries for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid())); end if; end $$;
do $$ begin if not exists (select 1 from pg_policies where policyname='days_own') then create policy "days_own" on public.days for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid())); end if; end $$;
do $$ begin if not exists (select 1 from pg_policies where policyname='state_own') then create policy "state_own" on public.user_state for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid())); end if; end $$;
