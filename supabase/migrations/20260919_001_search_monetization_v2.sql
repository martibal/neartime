-- NearTime monetization v2 product policy and schema baseline.
-- Production also contains the matching RPC definitions installed in the applied
-- Supabase migration named search_monetization_v2.

alter table public.logical_search_reservations
  add column if not exists quota_source text not null default 'included';

create table if not exists public.logical_search_topup_policy (
  platform text not null check (platform in ('ios','android')),
  product_id text not null,
  searches integer not null check (searches > 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (platform, product_id)
);

create table if not exists public.logical_search_topup_purchases (
  purchase_hash text primary key check (length(purchase_hash) between 32 and 128),
  entitlement_hash text not null references public.wallet(entitlement_hash) on delete cascade,
  platform text not null check (platform in ('ios','android')),
  product_id text not null,
  searches_granted integer not null check (searches_granted > 0),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

update public.logical_search_trial_policy
set enabled = true, max_successful_searches = 5, max_attempts = 5, updated_at = now()
where singleton = true;

insert into public.logical_search_plan_policy(platform, product_id, included_searches, enabled)
values ('android','neartime_monthly',30,true), ('ios','neartime_monthly',30,true)
on conflict (platform, product_id) do update
set included_searches = excluded.included_searches, enabled = true, updated_at = now();

update public.logical_search_plan_policy
set enabled = false, updated_at = now()
where product_id in ('neartime_trip_3d','neartime_trip_7d');

insert into public.logical_search_topup_policy(platform, product_id, searches, enabled)
values
  ('android','neartime_search_pack_20',20,true),
  ('ios','neartime_search_pack_20',20,true)
on conflict (platform, product_id) do update
set searches = excluded.searches, enabled = true, updated_at = now();

-- Trial quota must match the five-search launch policy. Older schema versions
-- capped successful_searches at 3 even after max_attempts was raised to 5.
alter table public.logical_search_trial_state
  drop constraint if exists logical_search_trial_state_successful_searches_check;

alter table public.logical_search_trial_state
  add constraint logical_search_trial_state_successful_searches_check
  check (successful_searches >= 0 and successful_searches <= 5);
