# NearTime subscription wallet and cost invariant

## Economic invariant

The wallet is not merely a technical spend bucket. It exists to enforce NearTime's permanent commercial unit economics.

The normative rules are defined in [`ECONOMIC_INVARIANTS.md`](ECONOMIC_INVARIANTS.md):

1. A customer may never generate more provider/API cost than the net revenue allocated to that customer for the same billing period.
2. One logical customer search may never cost more than NOK 10 equivalent in provider COGS.
3. A search must fail closed before billable work if either bound cannot be proven in advance.

Therefore, **having enough wallet balance is necessary but not sufficient**. A search is invalid even if a test or customer wallet could technically fund it when its worst-case cost exceeds the NOK 10 per-search ceiling or would violate the customer-period revenue bound.

No external Google provider call is allowed unless NearTime has already reserved enough funded wallet units to cover the conservative worst-case provider cost of that logical search **and** both permanent economic invariants remain satisfied after that reservation.

A subscription wallet is pseudonymous. It is keyed by a server-side HMAC derived from a verified App Store / Google Play entitlement. NearTime does not need a name, email address or password for quota accounting.

- iOS canonical identity: verified `originalTransactionId`.
- Android identity: verified purchase token, with `linkedPurchaseToken` aliases preserving continuity across plan changes/resubscribe events.
- Installation ID remains a separate signal used only for device-level rate limiting.

Raw store identifiers are not stored in the wallet tables. Only HMAC hashes are persisted.

## Wallet ledger

`wallet` stores the current verified entitlement state and billing period.

`wallet_entries` is append-only:

- `included_allocation`: subscription-period credit; expires at `billing_period_end`.
- `topup_purchase`: prepaid extra credit; no expiry by default.
- `reservation`: audit entry for worst-case search reservation.
- `reservation_release`: audit entry when the reservation is finalized/released.
- `usage_commit`: actual provider usage; each debit is linked to the funding credit it consumed.

The available balance is derived. It is never stored as a mutable balance column. Expired included allocations disappear from available capacity without carrying prior-period usage into the next billing period. Top-up credits persist until consumed.

The amount allocated to provider COGS for a customer billing period must itself be derived from commercially valid net revenue. It must never be configured merely because a technical wallet can hold a larger number.

## Search authorization

A search requires all of these before Google is contacted:

1. Valid pseudonymous entitlement session.
2. Logical-search idempotency key.
3. Active/grace subscription wallet.
4. A conservative worst-case provider-cost plan for the complete logical search, including retries and fallbacks.
5. Proof that worst-case provider COGS is at or below NOK 10 equivalent.
6. Proof that reserving the search cannot make billing-period provider COGS exceed the net revenue allocated to that customer.
7. Enough funded wallet balance to reserve that worst case.
8. Per-call/provider-specific cost limit.
9. Per-device daily/rate limits.
10. Per-entitlement daily/rate limits across all devices.
11. Global daily/monthly limits.
12. External-call switch enabled and emergency kill switch disabled.

The wallet row and provider policy row are locked during reservation, so parallel requests cannot overdraw the same funded capacity.

If any check fails, the request must fail closed before billable provider work begins. Completeness requirements do not authorize NearTime to spend past either economic invariant.

## Idempotency

The mobile client creates one idempotency key per logical search and reuses it for retries. `search_requests` has a unique `(entitlement_hash, idempotency_key)` key.

- Same key + same request while first request is running: no new reservation/provider call.
- Same key after success: cached NearTime response payload is replayed from the idempotency record; no new Google call.
- Same key + different request: rejected as an idempotency conflict.
- Failed logical request: same key cannot silently start a new billable attempt.

This protects against double taps, connection loss and retry races without relying on Google Places supporting idempotency itself.

## Store verification

`POST /api/entitlement/verify` verifies the store proof server-side before issuing an opaque NearTime entitlement session.

### iOS

The server uses Apple's official `@apple/app-store-server-library`, App Store Server API and signed JWS verification. Production and sandbox are explicitly separated. The verified `originalTransactionId`, product, period and subscription state are synchronized into the wallet.

`POST /api/entitlement/apple-notifications?environment=production|sandbox` accepts App Store Server Notifications V2, verifies the signed payload, then refreshes the subscription from Apple's Server API before updating the wallet.

### Android

The server exchanges the configured service-account assertion for an Android Publisher access token and calls `purchases.subscriptionsv2.get` using the purchase token. The API response is the subscription source of truth. `linkedPurchaseToken` is stored only as an HMAC alias.

`POST /api/entitlement/google-notifications` accepts authenticated Google Pub/Sub RTDN pushes. The Pub/Sub OIDC token, audience and optional sender service-account email are verified before the purchase token is used to refresh the subscription through the Developer API.

## Product policies are fail-closed

No product grants usage automatically merely because it exists in App Store / Play.

`wallet_plan_policy` maps a verified subscription product to included units. A row must be explicitly enabled before period credit is allocated.

`wallet_topup_policy` maps a verified prepaid product to top-up units. `credit_verified_topup` is idempotent by store transaction hash, preventing webhook retries from crediting the same purchase twice.

Until product economics are decided and encoded, these tables can remain empty/disabled. A verified subscription can then create a wallet/session but has zero funded search balance, so Google calls remain blocked.

## Required secrets

All of these are server-only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_PLACES_SERVER_API_KEY`
- `ENTITLEMENT_HMAC_SECRET`
- Apple App Store Server API credentials/root certificates
- Google Play service-account credentials and Pub/Sub verification configuration

Never expose any of them as `EXPO_PUBLIC_*` variables.

## Current deployment safety

Applying the wallet migration does not enable ordinary Google spend. Existing service policies remain fail-closed until limits, product policies and external-call switches are deliberately configured after the commercial unit economics are fixed and both permanent invariants are enforced in the production admission path.

A live-probe wallet may be deliberately larger for bounded testing, but that test funding must never be interpreted as an acceptable production per-search cost. Any live search above NOK 10 equivalent is a redesign signal, not a valid commercial result.
