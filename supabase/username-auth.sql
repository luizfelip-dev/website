-- Limites de cadastro e bloqueio da criação pública fora do endpoint do Nivela.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role, supabase_auth_admin;

create table if not exists private.signup_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists signup_attempts_ip_created_idx
  on private.signup_attempts (ip_hash, created_at desc);
create index if not exists signup_attempts_browser_created_idx
  on private.signup_attempts (browser_hash, created_at desc);
create index if not exists signup_attempts_created_idx
  on private.signup_attempts (created_at);

alter table private.signup_attempts enable row level security;
alter table private.signup_attempts force row level security;
revoke all on private.signup_attempts from public, anon, authenticated, service_role;
grant select, insert, delete on private.signup_attempts to service_role;

create or replace function public.reserve_nivela_signup(p_ip_hash text, p_browser_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_until timestamptz;
  v_retry integer := 0;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_browser_hash is null or p_browser_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Identificadores de limite inválidos.';
  end if;

  -- A cota global exige que contagem e reserva compartilhem o mesmo lock.
  perform pg_catalog.pg_advisory_xact_lock(6022307001::bigint);
  v_now := pg_catalog.clock_timestamp();
  delete from private.signup_attempts where created_at <= v_now - interval '24 hours';

  select created_at + interval '60 minutes' into v_until
    from private.signup_attempts
    where ip_hash = p_ip_hash and created_at > v_now - interval '60 minutes'
    order by created_at desc, id desc offset 4 limit 1;
  if v_until is not null then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_until - v_now))::integer, 1);
  end if;

  select created_at + interval '24 hours' into v_until
    from private.signup_attempts
    where ip_hash = p_ip_hash and created_at > v_now - interval '24 hours'
    order by created_at desc, id desc offset 19 limit 1;
  if v_until is not null then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_until - v_now))::integer, 1);
  end if;

  select created_at + interval '24 hours' into v_until
    from private.signup_attempts
    where browser_hash = p_browser_hash and created_at > v_now - interval '24 hours'
    order by created_at desc, id desc offset 2 limit 1;
  if v_until is not null then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_until - v_now))::integer, 1);
  end if;

  select created_at + interval '24 hours' into v_until
    from private.signup_attempts
    where created_at > v_now - interval '24 hours'
    order by created_at desc, id desc offset 199 limit 1;
  if v_until is not null then
    v_retry := greatest(v_retry, ceil(extract(epoch from v_until - v_now))::integer, 1);
  end if;

  if v_retry > 0 then
    return pg_catalog.jsonb_build_object('allowed', false, 'retryAfter', v_retry);
  end if;

  insert into private.signup_attempts (ip_hash, browser_hash, created_at)
    values (p_ip_hash, p_browser_hash, v_now);
  return pg_catalog.jsonb_build_object('allowed', true, 'retryAfter', 0);
end;
$function$;

revoke all on function public.reserve_nivela_signup(text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_nivela_signup(text, text) to service_role;

create or replace function private.enforce_nivela_signup()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_email text;
  v_confirmed_at timestamptz;
  v_registration text;
begin
  -- Admin.createUser completa os metadados e a confirmação após o INSERT.
  select u.email, u.email_confirmed_at, u.raw_app_meta_data ->> 'nivela_registration'
    into v_email, v_confirmed_at, v_registration
    from auth.users as u where u.id = new.id;

  if not found then
    return null;
  end if;

  if v_registration is distinct from 'server-v1'
    or v_email is null
    or v_email !~ '^[a-z0-9_]{3,24}@accounts\.nivela\.invalid$'
    or v_confirmed_at is null then
    raise exception using errcode = '23514',
      message = 'Crie sua conta pelo formulário de cadastro do Nivela.';
  end if;
  return null;
end;
$function$;

revoke all on function private.enforce_nivela_signup()
  from public, anon, authenticated, service_role;
grant execute on function private.enforce_nivela_signup() to supabase_auth_admin;

create constraint trigger nivela_signup_guard
  after insert on auth.users
  deferrable initially deferred
  for each row execute function private.enforce_nivela_signup();

notify pgrst, 'reload schema';
commit;
