const crypto = require('node:crypto');
const { Client } = require('pg');

const SERVICE = 'places-text-search-enterprise-atmosphere';
const ENTITLEMENT = '7d2364bbe8f7f645267ba8c0c1ccfebc7555e3b78bf16a4734d6162f9fa171f6';
const DEVICE = 'internal-live-cost-probe';
const MAX_PROVIDER_CALLS_PER_SEARCH = 3;
const SAMPLE_SEARCHES = 6;
const MAX_NEW_UNITS = SAMPLE_SEARCHES * MAX_PROVIDER_CALLS_PER_SEARCH;
const ORIGIN = { latitude: 55.6761, longitude: 12.5683 };

const QUERIES = [
  { category: 'Pharmacy', travelMode: 'Walk', maxMinutes: 5, minimumRating: 0, minimumReviews: 0, openNow: false, openForMinutes: 0 },
  { category: 'Cafe', travelMode: 'Walk', maxMinutes: 10, minimumRating: 4.2, minimumReviews: 100, openNow: false, openForMinutes: 0 },
  { category: 'Restaurant', travelMode: 'Walk', maxMinutes: 15, minimumRating: 4.4, minimumReviews: 300, openNow: false, openForMinutes: 0 },
  { category: 'Grocery', travelMode: 'Bike', maxMinutes: 10, minimumRating: 0, minimumReviews: 0, openNow: false, openForMinutes: 0 },
  { category: 'Parking', travelMode: 'Drive', maxMinutes: 10, minimumRating: 0, minimumReviews: 0, openNow: false, openForMinutes: 0 },
  { category: 'Restaurant', travelMode: 'Drive', maxMinutes: 20, minimumRating: 4.0, minimumReviews: 100, openNow: false, openForMinutes: 0 },
];

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function closeGate(db) {
  await db.query(`update public.api_cost_policy set external_calls_enabled=false, emergency_kill_switch=true,
    max_estimated_units_per_call=0, global_daily_units=0, global_monthly_units=0,
    per_device_daily_units=0, per_entitlement_daily_units=0,
    max_requests_per_minute_per_device=0, max_requests_per_minute_per_entitlement=0, updated_at=now()
    where service=$1`, [SERVICE]);
  await db.query(`update public.entitlement_sessions set revoked_at=coalesce(revoked_at,now()) where entitlement_hash=$1`, [ENTITLEMENT]);
  await db.query(`update public.wallet set status='expired', updated_at=now() where entitlement_hash=$1`, [ENTITLEMENT]);
}

async function usageBaselines(db) {
  const result = await db.query(`
    select
      coalesce(sum(case when reserved_at >= date_trunc('day', now()) then estimated_units else 0 end),0)::int as global_day,
      coalesce(sum(case when reserved_at >= date_trunc('month', now()) then estimated_units else 0 end),0)::int as global_month,
      coalesce(sum(case when device_id=$2 and reserved_at >= date_trunc('day', now()) then estimated_units else 0 end),0)::int as device_day,
      coalesce(sum(case when entitlement_hash=$3 and reserved_at >= date_trunc('day', now()) then estimated_units else 0 end),0)::int as entitlement_day
    from public.api_cost_reservations
    where service=$1 and status in ('reserved','committed')
      and (status='committed' or expires_at > now())`,
    [SERVICE, DEVICE, ENTITLEMENT]);
  return result.rows[0];
}

async function prepare(db, token, runKey) {
  const policy = await db.query(`select external_calls_enabled, emergency_kill_switch, max_estimated_units_per_call,
    global_daily_units, global_monthly_units, per_device_daily_units, per_entitlement_daily_units,
    max_requests_per_minute_per_device, max_requests_per_minute_per_entitlement
    from public.api_cost_policy where service=$1`, [SERVICE]);
  const p = policy.rows[0];
  if (!p || p.external_calls_enabled || !p.emergency_kill_switch ||
      ['max_estimated_units_per_call','global_daily_units','global_monthly_units','per_device_daily_units','per_entitlement_daily_units','max_requests_per_minute_per_device','max_requests_per_minute_per_entitlement']
        .some((key) => Number(p[key]) !== 0)) {
    throw new Error('Production policy is not in the expected fail-closed zero-cap state.');
  }

  const baseline = await usageBaselines(db);

  await db.query(`insert into public.wallet(entitlement_hash,platform,product_id,billing_period_start,billing_period_end,status)
    values($1,'android','internal.live.cost.probe',now(),now()+interval '1 day','active')
    on conflict(entitlement_hash) do update set status='active', billing_period_start=excluded.billing_period_start,
    billing_period_end=excluded.billing_period_end, updated_at=now()`, [ENTITLEMENT]);

  await db.query(`update public.wallet_entries set expires_at=now() where entitlement_hash=$1
    and kind in ('included_allocation','topup_purchase') and (expires_at is null or expires_at>now())`, [ENTITLEMENT]);

  await db.query(`insert into public.wallet_entries(entitlement_hash,kind,units,idempotency_key,expires_at)
    values($1,'included_allocation',$2,$3,now()+interval '20 minutes')`,
    [ENTITLEMENT, MAX_NEW_UNITS, `probe-allocation-${runKey}`]);

  await db.query(`insert into public.entitlement_sessions(token_hash,entitlement_hash,device_id,expires_at)
    values($1,$2,$3,now()+interval '15 minutes')
    on conflict(token_hash) do update set entitlement_hash=excluded.entitlement_hash, device_id=excluded.device_id,
    expires_at=excluded.expires_at, revoked_at=null`, [sha256(token), ENTITLEMENT, DEVICE]);

  await db.query(`update public.api_cost_policy set external_calls_enabled=true, emergency_kill_switch=false,
    max_estimated_units_per_call=$2, global_daily_units=$3, global_monthly_units=$4,
    per_device_daily_units=$5, per_entitlement_daily_units=$6,
    max_requests_per_minute_per_device=$7, max_requests_per_minute_per_entitlement=$7, updated_at=now()
    where service=$1`, [
      SERVICE,
      MAX_PROVIDER_CALLS_PER_SEARCH,
      Number(baseline.global_day) + MAX_NEW_UNITS,
      Number(baseline.global_month) + MAX_NEW_UNITS,
      Number(baseline.device_day) + MAX_NEW_UNITS,
      Number(baseline.entitlement_day) + MAX_NEW_UNITS,
      SAMPLE_SEARCHES + 2,
    ]);
}

async function runSearch(db, token, runId, attempt, query, index) {
  const idempotency = `live-sample-${runId}-${attempt}-${index + 1}`;
  const response = await fetch(env('NEARTIME_LIVE_SEARCH_URL'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-neartime-entitlement-session': token,
      'x-neartime-device-id': DEVICE,
      'x-neartime-idempotency-key': idempotency,
    },
    body: JSON.stringify({ query, origin: ORIGIN }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Search ${index + 1} HTTP ${response.status}: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  if (!Number.isInteger(payload.costUnits) || payload.costUnits < 1 || payload.costUnits > MAX_PROVIDER_CALLS_PER_SEARCH) {
    throw new Error(`Search ${index + 1} returned invalid costUnits.`);
  }

  const check = await db.query(`select sr.status as search_status, r.status as reservation_status,
    r.estimated_units as units, sr.response_payload->>'candidateCount' as candidates,
    sr.response_payload->>'qualifiedCount' as qualified,
    sr.response_payload->>'providerResultLimitReached' as provider_limit
    from public.search_requests sr join public.api_cost_reservations r on r.id=sr.reservation_id
    where sr.entitlement_hash=$1 and sr.idempotency_key=$2`, [ENTITLEMENT, idempotency]);
  const row = check.rows[0];
  if (!row || row.search_status !== 'succeeded' || row.reservation_status !== 'committed' || Number(row.units) !== payload.costUnits) {
    throw new Error(`Search ${index + 1} authoritative cost ledger did not reconcile.`);
  }

  const result = {
    index: index + 1,
    category: query.category,
    travelMode: query.travelMode,
    maxMinutes: query.maxMinutes,
    providerCalls: payload.costUnits,
    candidateCount: Number(row.candidates),
    qualifiedCount: Number(row.qualified),
    providerResultLimitReached: row.provider_limit === 'true',
  };
  console.log('LIVE_SAMPLE_SEARCH', JSON.stringify(result));
  return result;
}

async function main() {
  const token = env('NEARTIME_LIVE_PROBE_TOKEN');
  if (token.length < 20 || token.length > 256) throw new Error('Probe token must be 20-256 characters.');
  const db = new Client({ connectionString: env('NEARTIME_TEST_DATABASE_URL'), ssl: { rejectUnauthorized: false } });
  await db.connect();
  const runId = process.env.GITHUB_RUN_ID || String(Date.now());
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';

  try {
    await prepare(db, token, `${runId}-${attempt}`);
    const results = [];
    for (let i = 0; i < QUERIES.length; i += 1) {
      results.push(await runSearch(db, token, runId, attempt, QUERIES[i], i));
    }
    const totalCalls = results.reduce((sum, item) => sum + item.providerCalls, 0);
    if (totalCalls > MAX_NEW_UNITS) throw new Error('Bounded sample exceeded maximum provider-call budget.');
    console.log('LIVE_SAMPLE_SUCCESS', JSON.stringify({ searches: results.length, totalProviderCalls: totalCalls, maxProviderCalls: MAX_NEW_UNITS }));
  } finally {
    await closeGate(db).catch((error) => console.error('Cleanup failed:', error.message));
    await db.end();
  }
}

main().catch((error) => {
  console.error('LIVE_SAMPLE_FAILED', error.message);
  process.exitCode = 1;
});
