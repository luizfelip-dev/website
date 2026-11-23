-- Configuração inicial para um projeto novo do Nivela.
-- Execute somente após conferir a conta e o projeto de destino.
begin;

create type public.nivela_category as enum (
  'Moradia', 'Alimentação', 'Transporte', 'Lazer', 'Serviços', 'Outros'
);

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null,
  opening_balance_cents bigint not null default 0,
  constraint profiles_name_valid check (
    char_length(full_name) <= 80 and char_length(btrim(full_name)) >= 1
  ),
  constraint profiles_balance_safe check (
    opening_balance_cents between -99999999999 and 99999999999
  )
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer')),
  description text not null,
  amount_cents bigint not null,
  category public.nivela_category not null,
  date date not null,
  recurring boolean not null default false,
  installment integer not null default 1,
  installment_count integer not null default 1,
  series_id uuid,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  constraint transactions_description_valid check (
    char_length(description) <= 120 and char_length(btrim(description)) >= 1
  ),
  constraint transactions_amount_safe check (
    amount_cents between 1 and 99999999999
  ),
  constraint transactions_date_valid check (
    date between date '1900-01-01' and date '9999-12-31'
  ),
  constraint transactions_installments_valid check (
    installment_count between 1 and 24
    and installment between 1 and installment_count
    and (installment_count = 1 or type = 'expense')
    and not (recurring and installment_count > 1)
  )
);

create table public.budgets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category public.nivela_category not null,
  limit_cents bigint not null default 0,
  primary key (user_id, category),
  constraint budgets_limit_safe check (limit_cents between 0 and 99999999999)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  target_cents bigint not null,
  saved_cents bigint not null default 0,
  tone text not null default 'blue' check (tone in ('blue', 'purple', 'green')),
  constraint goals_name_valid check (
    char_length(name) <= 80 and char_length(btrim(name)) >= 1
  ),
  constraint goals_target_safe check (target_cents between 1 and 99999999999),
  constraint goals_saved_safe check (saved_cents between 0 and 99999999999)
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  email text,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint support_name_valid check (
    char_length(name) <= 80 and char_length(btrim(name)) >= 2
  ),
  constraint support_email_valid check (
    char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint support_subject_valid check (
    subject in ('Transações', 'Orçamentos e metas', 'Dúvidas sobre o painel', 'Sugestões', 'Outros')
  ),
  constraint support_message_valid check (
    char_length(message) <= 2000 and char_length(btrim(message)) >= 10
  )
);

create index transactions_user_date_id_idx on public.transactions (user_id, date, id);
create index goals_user_name_id_idx on public.goals (user_id, name, id);
create index support_messages_user_created_idx on public.support_messages (user_id, created_at desc, id);

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.support_messages enable row level security;

alter table public.profiles force row level security;
alter table public.transactions force row level security;
alter table public.budgets force row level security;
alter table public.goals force row level security;
alter table public.support_messages force row level security;

-- Permissões da API e políticas por proprietário são verificações distintas.
revoke all on table public.profiles, public.transactions, public.budgets,
  public.goals, public.support_messages from public, anon, authenticated;
revoke all on type public.nivela_category from public, anon;
grant usage on schema public to authenticated;
grant usage on type public.nivela_category to authenticated;

grant select on public.profiles, public.transactions, public.budgets, public.goals to authenticated;
grant insert (user_id, full_name, opening_balance_cents) on public.profiles to authenticated;
grant update (full_name, opening_balance_cents) on public.profiles to authenticated;
grant insert (id, user_id, type, description, amount_cents, category, date, recurring,
  installment, installment_count, series_id, status) on public.transactions to authenticated;
grant update (type, description, amount_cents, category, date, recurring,
  installment, installment_count, series_id, status) on public.transactions to authenticated;
grant delete on public.transactions to authenticated;
grant insert (user_id, category, limit_cents) on public.budgets to authenticated;
grant update (user_id, category, limit_cents) on public.budgets to authenticated;
grant insert (id, user_id, name, target_cents, saved_cents, tone) on public.goals to authenticated;
grant update (name, target_cents, saved_cents, tone) on public.goals to authenticated;
grant delete on public.goals to authenticated;
grant insert (id, user_id, name, email, subject, message) on public.support_messages to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy transactions_select_own on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy transactions_insert_own on public.transactions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy transactions_update_own on public.transactions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy transactions_delete_own on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy budgets_select_own on public.budgets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy budgets_insert_own on public.budgets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy budgets_update_own on public.budgets
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy goals_select_own on public.goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy goals_insert_own on public.goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy goals_update_own on public.goals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy goals_delete_own on public.goals
  for delete to authenticated using ((select auth.uid()) = user_id);

-- O formulário grava a mensagem; não concede leitura de contatos pela API.
create policy support_messages_insert_own on public.support_messages
  for insert to authenticated with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
commit;
