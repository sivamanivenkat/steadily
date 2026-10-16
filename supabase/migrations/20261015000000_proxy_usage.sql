-- Counters for the claude-proxy edge function (D-011, D-018).
-- Stores only an anonymous auth user id, a UTC day, a request type and counts.
-- No request content, personal or financial data. Clients have no access at all:
-- RLS is enabled with no policies and only the service role can call the functions.

create table public.proxy_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('categorize', 'ask')),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, day, kind)
);

alter table public.proxy_usage enable row level security;
revoke all on table public.proxy_usage from anon, authenticated;

-- Global estimated spend per UTC day, in micro-USD.
create table public.proxy_spend (
  day date primary key,
  spend_micro_usd bigint not null default 0 check (spend_micro_usd >= 0)
);

alter table public.proxy_spend enable row level security;
revoke all on table public.proxy_spend from anon, authenticated;

-- Atomically increments and returns the caller's count for the day and type.
create function public.proxy_increment_usage(p_user_id uuid, p_day date, p_kind text)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.proxy_usage as u (user_id, day, kind, request_count)
  values (p_user_id, p_day, p_kind, 1)
  on conflict (user_id, day, kind)
  do update set request_count = u.request_count + 1
  returning u.request_count;
$$;

create function public.proxy_get_spend(p_day date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select spend_micro_usd from public.proxy_spend where day = p_day), 0);
$$;

create function public.proxy_add_spend(p_day date, p_micro_usd bigint)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.proxy_spend as s (day, spend_micro_usd)
  values (p_day, greatest(p_micro_usd, 0))
  on conflict (day)
  do update set spend_micro_usd = s.spend_micro_usd + greatest(p_micro_usd, 0)
  returning s.spend_micro_usd;
$$;

-- Counters are only needed for the current day; keep a short window and drop the rest.
create function public.proxy_prune_usage(p_keep_days integer default 7)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.proxy_usage where day < current_date - p_keep_days;
  delete from public.proxy_spend where day < current_date - greatest(p_keep_days, 31);
$$;

revoke execute on function public.proxy_increment_usage(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.proxy_get_spend(date) from public, anon, authenticated;
revoke execute on function public.proxy_add_spend(date, bigint) from public, anon, authenticated;
revoke execute on function public.proxy_prune_usage(integer) from public, anon, authenticated;

grant execute on function public.proxy_increment_usage(uuid, date, text) to service_role;
grant execute on function public.proxy_get_spend(date) to service_role;
grant execute on function public.proxy_add_spend(date, bigint) to service_role;
grant execute on function public.proxy_prune_usage(integer) to service_role;
