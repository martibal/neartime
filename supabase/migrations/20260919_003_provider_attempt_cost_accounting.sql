-- Production-applied 2026-09-19.
-- Makes provider COGS accounting write-before-send and fail-conservative.

alter table public.neartime_search_cost_ledger
  add column if not exists provider_attempt_state text not null default 'legacy_unknown',
  add column if not exists error_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'neartime_search_cost_ledger_provider_attempt_state_check'
  ) then
    alter table public.neartime_search_cost_ledger
      add constraint neartime_search_cost_ledger_provider_attempt_state_check
      check (provider_attempt_state in (
        'legacy_unknown','attempted','succeeded','failed_after_attempt'
      ));
  end if;
end $$;

update public.neartime_search_cost_ledger
set provider_attempt_state='succeeded'
where provider_attempt_state='legacy_unknown'
  and (google_nearby_calls + google_text_calls + tomtom_discover_calls + tomtom_route_calls) > 0;

-- Production also creates neartime_record_search_cost_v3(), restricted to
-- service_role, and replaces neartime_cost_monitor() so attempted and
-- failed_after_attempt rows remain conservatively counted.
-- See the applied Supabase migration history for the canonical function bodies.
