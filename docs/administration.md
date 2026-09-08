# Platform administration

The web and Electron administration screen is available at `/app/admin`, and through Account settings for administrators and eligible bootstrap accounts. Native mobile users can open the responsive web screen; the native app does not expose administrative controls. The shared RPC contract enforces the same authorization for every client.

## Bootstrap

1. Set `CADRE_ADMIN_EMAILS` privately on the API service to the exact intended email address. This is an eligibility list, not an automatic role grant.
2. For local password accounts without verified email, generate a random 32-byte code with a cryptographic random generator. Set only its SHA-256 hexadecimal digest as `CADRE_ADMIN_BOOTSTRAP_TOKEN_HASH`. Deliver the raw code privately to the intended operator; never put it in logs, query parameters, commits, or support tickets.
3. Sign in to the intended account, visit `/app/admin`, and activate access within 15 minutes of signing in. Unverified accounts must supply the code. Verified accounts on the eligibility list can claim using their verified identity. A URL fragment `#claim=CODE` can prefill the field for an already signed-in account; the screen immediately removes it from browser history.
4. A database transaction grants the role and records the audit entry. The unverified-account bootstrap code can be consumed only once per deployment. Remove its digest from the environment after successful activation. Never reset the consumption marker as routine recovery.

The bootstrap does not mark an unverified email as verified. Retain the bootstrap email in the private environment to protect the primary administrator from suspension or demotion through the dashboard. Recover a lost primary account through the deployment's trusted authentication or database administration process, verifying ownership out of band.

## Access and operations

Every request checks the live database role, session ownership and expiry, verification state, and suspension state. Roles and verification fields supplied to signup are ignored. Privileged writes require a session created within the past 15 minutes, a reason, and a unique request ID. Signing in again refreshes this window. Deploy behind HTTPS and use a strong unique password or the configured identity provider's MFA; this dashboard does not add an MFA factor to local password authentication.

Administrators can search users, inspect account and connector metadata, revoke sessions, grant or remove verified-user administrator roles, suspend/reactivate accounts, stop runs, pause/resume schedules, inspect token usage and failed runs, and change signup policy. Self-suspension and self-demotion are denied. Suspension revokes sessions, pauses schedules and cancels runs; queued and continuing runs check suspension, and tool execution rechecks it before another action. External requests already in flight may finish. Reactivation does not restart paused schedules or cancelled work. Account suspension does not change billing.

Mutations and their audit records commit together. A repeated identical request ID does not repeat a completed change. Audit records contain actor, target, action, reason, timestamp and outcome, not credentials or chat contents. The API has no audit editing/deletion endpoint. Database operators still control the database; this is not an external tamper-proof archive. Use database backups and infrastructure access controls accordingly.

## Optional billing

Set `STRIPE_SECRET_KEY` only on the API service. Keep the key scoped to the required customer, invoice and subscription access, and subscription updates. Core functionality does not require Stripe. The adapter uses a fixed provider origin, validates customer ownership, and returns metadata through the provider-neutral billing interface.

Link an existing Stripe customer to a user only when its email matches the user's email. The dashboard shows up to 25 recent invoices and 25 subscriptions, plus a link to the provider dashboard. Administrators can schedule cancellation at period end or restore renewal before cancellation. These changes require fresh authentication, a reason, and provider idempotency. Charges, refunds, customer creation and subscription creation are not exposed here.

Provider writes first reserve an audit operation. If a provider response is lost or fails, its outcome is marked `unknown` and the same operation cannot be automatically repeated. Check the provider dashboard and refresh billing before deciding on a new operation. A process crash can leave an operation `pending`; reconcile it with the provider before any retry. Never assume an error means the provider did nothing.

## Verification

The deterministic Stripe adapter tests cover customer ownership, fixed-origin requests, provider idempotency and currency units. Postgres integration tests exercise role escalation, bootstrap replay, stale/revoked sessions, concurrent duplicate requests, suspension and ambiguous billing writes. The web E2E test exercises access denial, the real API, reason-gated changes, audit history and desktop/mobile screenshots using an isolated database. These tests do not prove a live billing account is configured.
