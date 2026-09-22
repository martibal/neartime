-- Keep the repository migration history aligned with the production launch policy.
-- The customer trial is five completed logical searches.

update public.logical_search_trial_policy
set enabled = true,
    max_successful_searches = 5,
    max_attempts = 5,
    updated_at = now()
where singleton = true;
