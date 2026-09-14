const { Client } = require('pg');

const SERVICE = `test-cost-gate-concurrency-${Date.now()}`;
const PARALLEL = 10;
const UNITS = 3;
const CAP = 3;

async function main() {
  const connectionString = process.env.NEARTIME_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('NEARTIME_TEST_DATABASE_URL is required');

  const admin = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  try {
    await admin.query(`insert into public.api_cost_policy (service, external_calls_enabled, emergency_kill_switch, max_estimated_units_per_call, global_daily_units, global_monthly_units, per_device_daily_units, max_requests_per_minute_per_device) values ($1,true,false,$2,$3,1000,1000,1000)`, [SERVICE, UNITS, CAP]);

    const attempts = await Promise.all(Array.from({ length: PARALLEL }, async (_, i) => {
      const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
      await client.connect();
      try {
        const result = await client.query('select * from public.reserve_api_cost($1,$2,$3)', [`race-device-${i}`, SERVICE, UNITS]);
        return result.rows[0];
      } finally {
        await client.end();
      }
    }));

    const allowed = attempts.filter((r) => r.allowed);
    const denied = attempts.filter((r) => !r.allowed);
    const reserved = await admin.query(`select coalesce(sum(estimated_units),0)::int as units, count(*)::int as count from public.api_cost_reservations where service=$1 and status='reserved' and expires_at > now()`, [SERVICE]);

    if (allowed.length !== 1) throw new Error(`expected exactly 1 allowed reservation, got ${allowed.length}`);
    if (denied.length !== PARALLEL - 1) throw new Error(`expected ${PARALLEL - 1} denied reservations, got ${denied.length}`);
    if (reserved.rows[0].units > CAP) throw new Error(`overspend detected: ${reserved.rows[0].units} > ${CAP}`);
    if (reserved.rows[0].units !== CAP) throw new Error(`expected reserved units ${CAP}, got ${reserved.rows[0].units}`);
    if (!denied.every((r) => r.reason === 'global_daily_limit')) throw new Error(`unexpected denial reasons: ${JSON.stringify(denied.map((r) => r.reason))}`);

    console.log(JSON.stringify({ result: 'concurrency_passed', parallelAttempts: PARALLEL, allowed: allowed.length, denied: denied.length, reservedUnits: reserved.rows[0].units, cap: CAP }));
  } finally {
    await admin.query('delete from public.api_cost_reservations where service=$1', [SERVICE]).catch(() => {});
    await admin.query('delete from public.api_cost_policy where service=$1', [SERVICE]).catch(() => {});
    await admin.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
