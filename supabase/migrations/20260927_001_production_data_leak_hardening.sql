-- WayNear production data-leak hardening.
alter table public.neartime_search_idempotency enable row level security;
alter table public.neartime_search_cost_ledger enable row level security;
alter table public.neartime_provider_quota_usage enable row level security;
alter table public.sku_prices enable row level security;
alter table public.provider_cogs_plan_policy enable row level security;

revoke all on table public.neartime_search_idempotency from public, anon, authenticated;
revoke all on table public.neartime_search_cost_ledger from public, anon, authenticated;
revoke all on table public.neartime_provider_quota_usage from public, anon, authenticated;
revoke all on table public.sku_prices from public, anon, authenticated;
revoke all on table public.provider_cogs_plan_policy from public, anon, authenticated;

alter view public.wallet_balance set (security_invoker = true);
revoke all on table public.wallet_balance from public, anon, authenticated;

revoke all on function public.finish_provider_cogs_reservation(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.fund_provider_cogs_period(text,text) from public, anon, authenticated;
revoke all on function public.neartime_cost_monitor(integer) from public, anon, authenticated;
revoke all on function public.neartime_record_search_cost_v2(uuid,text,integer,boolean,text,integer,integer,integer,integer,integer,integer,numeric,numeric,text) from public, anon, authenticated;
revoke all on function public.neartime_record_search_cost_v3(uuid,text,integer,boolean,text,integer,integer,integer,integer,integer,integer,numeric,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.provider_cogs_available_balance(text) from public, anon, authenticated;
revoke all on function public.reserve_provider_cogs(text,text,text,integer,text,integer) from public, anon, authenticated;
revoke all on function public.set_logical_search_result_contract(uuid,text,text,integer,integer,text) from public, anon, authenticated;

grant select, insert, update, delete on public.neartime_search_idempotency to service_role;
grant select, insert, update, delete on public.neartime_search_cost_ledger to service_role;
grant select, insert, update, delete on public.neartime_provider_quota_usage to service_role;
grant select, insert, update, delete on public.sku_prices to service_role;
grant select, insert, update, delete on public.provider_cogs_plan_policy to service_role;
grant select on public.wallet_balance to service_role;

grant execute on function public.finish_provider_cogs_reservation(uuid,text,integer) to service_role;
grant execute on function public.fund_provider_cogs_period(text,text) to service_role;
grant execute on function public.neartime_cost_monitor(integer) to service_role;
grant execute on function public.neartime_record_search_cost_v2(uuid,text,integer,boolean,text,integer,integer,integer,integer,integer,integer,numeric,numeric,text) to service_role;
grant execute on function public.neartime_record_search_cost_v3(uuid,text,integer,boolean,text,integer,integer,integer,integer,integer,integer,numeric,numeric,text,text,text) to service_role;
grant execute on function public.provider_cogs_available_balance(text) to service_role;
grant execute on function public.reserve_provider_cogs(text,text,text,integer,text,integer) to service_role;
grant execute on function public.set_logical_search_result_contract(uuid,text,text,integer,integer,text) to service_role;
