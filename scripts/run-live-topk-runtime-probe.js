const crypto = require('node:crypto');
const { Client } = require('pg');

const SERVICE = 'google-provider-cogs';
const ENTITLEMENT = '3f4aab5f5f21856ff3f402753a597d494a53eecb91fce35b36d37972f39d5b91';
const DEVICE = 'internal-live-topk-probe';
const PRODUCT = 'neartime_runtime_test';
const PROVIDER_COGS_MICRO_USD = 3000000;
const ORIGIN = { latitude: 59.9139, longitude: 10.7522 };
const ALLOWED_RANKING_MODES = new Set(['RATING', 'PRICE', 'TRAVEL_TIME']);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function rankingMode() {
  const value = (process.env.NEARTIME_TOPK_RANKING_MODE || 'RATING').trim().toUpperCase();
  if (!ALLOWED_RANKING_MODES.has(value)) throw new Error(`Invalid NEARTIME_TOPK_RANKING_MODE: ${value}`);
  return value;
}

function queryFor(mode) {
  return {
    category: 'Cafe',
    travelMode: 'Walk',
    maxMinutes: 10,
    minimumRating: 0,
    minimumReviews: 0,
    openNow: false,
    openForMinutes: 0,
    rankingMode: mode,
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function snapshotPolicy(db) {
  const result = await db.query(`select * from public.api_cost_policy where service=$1`, [SERVICE]);
  if (result.rowCount !== 1) throw new Error('google-provider-cogs policy missing');
  return result.rows[0];
}

async function restorePolicy(db, policy) {
  await db.query(`update public.api_cost_policy set
    external_calls_enabled=$2,
    emergency_kill_switch=$3,
    max_estimated_units_per_call=$4,
    global_daily_units=$5,
    global_monthly_units=$6,
    per_device_daily_units=$7,
    per_entitlement_daily_units=$8,
    max_requests_per_minute_per_device=$9,
    max_requests_per_minute_per_entitlement=$10,
    updated_at=now()
    where service=$1`, [
    SERVICE,
    policy.external_calls_enabled,
    policy.emergency_kill_switch,
    policy.max_estimated_units_per_call,
    policy.global_daily_units,
    policy.global_monthly_units,
    policy.per_device_daily_units,
    policy.per_entitlement_daily_units,
    policy.max_requests_per_minute_per_device,
    policy.max_requests_per_minute_per_entitlement,
  ]);
}

async function prepareFixture(db, token, runKey) {
  await db.query('begin');
  try {
    const policy = await snapshotPolicy(db);
    if (policy.external_calls_enabled || !policy.emergency_kill_switch) {
      throw new Error('Provider policy must be fail-closed before probe.');
    }

    await db.query(`insert into public.wallet(entitlement_hash,platform,product_id,billing_period_start,billing_period_end,status)
      values($1,'ios',$2,now(),now()+interval '1 day','active')
      on conflict(entitlement_hash) do update set
        platform='ios', product_id=excluded.product_id,
        billing_period_start=excluded.billing_period_start,
        billing_period_end=excluded.billing_period_end,
        status='active', updated_at=now()`, [ENTITLEMENT, PRODUCT]);

    await db.query(`insert into public.logical_search_plan_policy(platform,product_id,included_searches,enabled)
      values('ios',$1,1,true)
      on conflict(platform,product_id) do update set included_searches=1, enabled=true, updated_at=now()`, [PRODUCT]);

    await db.query(`update public.wallet_entries set expires_at=now()
      where entitlement_hash=$1 and bucket='provider_cogs'
        and kind in ('included_allocation','topup_purchase')
        and (expires_at is null or expires_at>now())`, [ENTITLEMENT]);

    await db.query(`insert into public.wallet_entries(
        entitlement_hash,kind,units,idempotency_key,expires_at,bucket,unit)
      values($1,'included_allocation',$2,$3,now()+interval '20 minutes','provider_cogs','micro_usd')`,
      [ENTITLEMENT, PROVIDER_COGS_MICRO_USD, `topk-probe-allocation-${runKey}`]);

    await db.query(`insert into public.entitlement_sessions(token_hash,entitlement_hash,device_id,expires_at)
      values($1,$2,$3,now()+interval '15 minutes')
      on conflict(token_hash) do update set entitlement_hash=excluded.entitlement_hash,
        device_id=excluded.device_id, expires_at=excluded.expires_at, revoked_at=null`,
      [sha256(token), ENTITLEMENT, DEVICE]);

    await db.query(`update public.api_cost_policy set
      external_calls_enabled=true,
      emergency_kill_switch=false,
      max_estimated_units_per_call=1000,
      global_daily_units=1000,
      global_monthly_units=1000,
      per_device_daily_units=1000,
      per_entitlement_daily_units=1000,
      max_requests_per_minute_per_device=1,
      max_requests_per_minute_per_entitlement=1,
      updated_at=now()
      where service=$1`, [SERVICE]);

    await db.query('commit');
    return policy;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function cleanupFixture(db, policy) {
  await db.query('begin');
  try {
    await restorePolicy(db, policy);
    await db.query(`update public.entitlement_sessions set revoked_at=coalesce(revoked_at,now()) where entitlement_hash=$1`, [ENTITLEMENT]);
    await db.query(`update public.wallet set status='expired', updated_at=now() where entitlement_hash=$1`, [ENTITLEMENT]);
    await db.query(`update public.wallet_entries set expires_at=now()
      where entitlement_hash=$1 and kind in ('included_allocation','topup_purchase')
        and (expires_at is null or expires_at>now())`, [ENTITLEMENT]);
    await db.query(`update public.logical_search_plan_policy set enabled=false, updated_at=now()
      where platform='ios' and product_id=$1`, [PRODUCT]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

async function main() {
  const token = env('NEARTIME_LIVE_PROBE_TOKEN');
  const url = env('NEARTIME_TOPK_SEARCH_URL');
  const mode = rankingMode();
  const query = queryFor(mode);
  const db = new Client({
    connectionString: env('NEARTIME_TEST_DATABASE_URL'),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const runId = `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  let policy = null;
  try {
    policy = await prepareFixture(db, token, runId);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neartime-entitlement-session': token,
        'x-neartime-device-id': DEVICE,
        'x-neartime-idempotency-key': `topk-live-${mode.toLowerCase()}-${runId}`,
      },
      body: JSON.stringify({ query, origin: ORIGIN }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Top-K HTTP ${response.status}: ${text.slice(0, 500)}`);
    const payload = JSON.parse(text);
    if (payload.resultStatus !== 'COMPLETE_TOP_K') {
      throw new Error(`Top-K did not complete: ${payload.resultStatus || 'unknown'} / ${payload.reason || 'no reason'}`);
    }
    if (payload.rankingMode !== mode) {
      throw new Error(`Top-K ranking mode mismatch: expected ${mode}, got ${payload.rankingMode || 'missing'}`);
    }
    if (!Array.isArray(payload.places) || payload.places.length < 1 || payload.places.length > 20) {
      throw new Error('Top-K returned invalid place count.');
    }

    const ledger = await db.query(`select
      count(*) filter (where status='committed')::int as committed,
      coalesce(sum(actual_micro_usd) filter (where status='committed'),0)::bigint as actual_micro_usd,
      coalesce(sum(estimated_micro_usd),0)::bigint as reserved_micro_usd
      from public.api_cost_reservations
      where entitlement_hash=$1 and cost_bucket='provider_cogs'
        and reserved_at >= now()-interval '15 minutes'`, [ENTITLEMENT]);
    const row = ledger.rows[0];
    if (Number(row.actual_micro_usd) > PROVIDER_COGS_MICRO_USD) {
      throw new Error('Actual provider COGS exceeded funded test wallet.');
    }

    console.log('LIVE_TOPK_SUCCESS', JSON.stringify({
      resultStatus: payload.resultStatus,
      rankingMode: payload.rankingMode,
      returned: payload.places.length,
      providerCalls: payload.providerCalls,
      actualProviderCogsMicroUsd: Number(row.actual_micro_usd),
      fundedProviderCogsMicroUsd: PROVIDER_COGS_MICRO_USD,
    }));
  } finally {
    if (policy) await cleanupFixture(db, policy).catch((error) => console.error('Cleanup failed:', error.message));
    await db.end();
  }
}

main().catch((error) => {
  console.error('LIVE_TOPK_FAILED', error.message);
  process.exitCode = 1;
});
