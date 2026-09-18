# NearTime Cost Monitor

Local Windows development monitor for the Supabase search-cost ledger.

Run `start-cost-monitor.bat`. It refreshes every 3 seconds and makes no TomTom calls.
The embedded Supabase key is publishable only; the database exposes only the read-only
`neartime_cost_monitor` RPC to the anon role. Estimated costs use NearTime's conservative
cost model and should be reconciled against TomTom billing.
