-- NearTime launch product policy.
-- Canonical product identifiers are seeded for both stores, but remain disabled
-- until the corresponding App Store / Google Play products exist and their
-- server-side verification path has been validated end-to-end.
--
-- Logical searches are customer-visible quota. Wallet units are provider-call
-- coverage at the current hard maximum of 3 Google calls per logical search.

insert into public.logical_search_plan_policy (platform, product_id, included_searches, enabled)
values
  ('ios', 'neartime_trip_3d', 5, false),
  ('android', 'neartime_trip_3d', 5, false),
  ('ios', 'neartime_monthly', 9, false),
  ('android', 'neartime_monthly', 9, false),
  ('ios', 'neartime_trip_7d', 11, false),
  ('android', 'neartime_trip_7d', 11, false)
on conflict (platform, product_id) do update
set included_searches = excluded.included_searches,
    enabled = false,
    updated_at = now();

insert into public.wallet_plan_policy (platform, product_id, included_units, enabled)
values
  ('ios', 'neartime_trip_3d', 15, false),
  ('android', 'neartime_trip_3d', 15, false),
  ('ios', 'neartime_monthly', 27, false),
  ('android', 'neartime_monthly', 27, false),
  ('ios', 'neartime_trip_7d', 33, false),
  ('android', 'neartime_trip_7d', 33, false)
on conflict (platform, product_id) do update
set included_units = excluded.included_units,
    enabled = false,
    updated_at = now();
