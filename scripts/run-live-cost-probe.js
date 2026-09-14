const crypto = require('node:crypto');
const { Client } = require('pg');

const SERVICE = 'places-text-search-enterprise-atmosphere';
const ENTITLEMENT = '7d2364bbe8f7f645267ba8c0c1ccfebc7555e3b78bf16a4734d6162f9fa171f6';
const DEVICE = 'internal-live-cost-probe';

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

  await db.query(`insert into public.wallet(entitlement_hash,platform,product_id,billing_period_start,billing_period_end,status)
    values($1,'android','internal.live.cost.probe',now(),now()+interval '1 day','active')
    on conflict(entitlement_hash) do update set status='active', billing_period_start=excluded.billing_period_start,
    billing_period_end=excluded.billing_period_end, updated_at=now()`, [ENTITLEMENT]);

  await db.query(`update public.wallet_entries set expires_at=now() where entitlement_hash=$1
    and kind in ('included_allocation','topup_purchase') and (expires_at is null or expires_at>now())`, [ENTITLEMENT]);

  await db.query(`insert into public.wallet_entries(entitlement_hash,kind,units,idempotency_key,expires_at)
    values($1,'included_allocation',3,$2,now()+interval '20 minutes')`, [ENTITLEMENT, `probe-allocation-${runKey}`]);

  await db.query(`insert into public.entitlement_sessions(token_hash,entitlement_hash,device_id,expires_at)
    values($1,$2,$3,now()+interval '15 minutes')
    on conflict(token_hash) do update set entitlement_hash=excluded.entitlement_hash, device_id=excluded.device_id,
    expires_at=excluded.expires_at, revoked_at=null`, [sha256(token), ENTITLEMENT, DEVICE]);

  await db.query(`update public.api_cost_policy set external_calls_enabled=true, emergency_kill_switch=false,
    max_estimated_units_per_call=3, global_daily_units=3, global_monthly_units=3,
    per_device_daily_units=3, per_entitlement_daily_units=3,
    max_requests_per_minute_per_device=1, max_requests_per_minute_per_entitlement=1, updated_at=now()
    where service=$1`, [SERVICE]);
}

async function main() {
  const token = env('NEARTIME_LIVE_PROBE_TOKEN');
  if (token.length < 20 || token.length > 256) throw new Error('Probe token must be 20-256 characters.');
  const db = new Client({ connectionString: env('NEARTIME_TEST_DATABASE_URL'), ssl: { rejectUnauthorized: false } });
  await db.connect();
  const runId = process.env.GITHUB_RUN_ID || String(Date.now());
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  const idempotency = `live-probe-${runId}-${attempt}`;

  try {
    await prepare(db, token, `${runId}-${attempt}`);
    const response = await fetch(env('NEARTIME_LIVE_SEARCH_URL'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neartime-entitlement-session': token,
        'x-neartime-device-id': DEVICE,
        'x-neartime-idempotency-key': idempotency,
      },
      body: JSON.stringify({
        query: { category: 'Pharmacy', travelMode: 'Walk', maxMinutes: 5, minimumRating: 0, minimumReviews: 0, openNow: false, openForMinutes: 0 },
        origin: { latitude: 55.6761, longitude: 12.5683 },
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    const payload = JSON.parse(text);
    if (!Number.isInteger(payload.costUnits) || payload.costUnits < 1 || payload.costUnits > 3) throw new Error('Invalid costUnits.');

    const check = await db.query(`select sr.status as search_status, r.status as reservation_status,
      r.estimated_units as units, sr.response_payload->>'candidateCount' as candidates,
      sr.response_payload->>'qualifiedCount' as qualified,
      sr.response_payload->>'providerResultLimitReached' as provider_limit
      from public.search_requests sr join public.api_cost_reservations r on r.id=sr.reservation_id
      where sr.entitlement_hash=$1 and sr.idempotency_key=$2`, [ENTITLEMENT, idempotency]);
    const row = check.rows[0];
    if (!row || row.search_status !== 'succeeded' || row.reservation_status !== 'committed' || Number(row.units) !== payload.costUnits) {
      throw new Error('Authoritative cost ledger did not reconcile.');
    }

    console.log('LIVE_PROBE_SUCCESS', JSON.stringify({
      providerCalls: payload.costUnits,
      candidateCount: Number(row.candidates),
      qualifiedCount: Number(row.qualified),
      providerResultLimitReached: row.provider_limit === 'true',
      billingSku: payload.billingSku,
    }));
  } finally {
    await closeGate(db).catch((error) => console.error('Cleanup failed:', error.message));
    await db.end();
  }
}

main().catch((error) => {
  console.error('LIVE_PROBE_FAILED', error.message);
  process.exitCode = 1;
});
