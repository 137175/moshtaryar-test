# Moshtariar Cloudflare Worker prototype — security gate

Status: design/prototype only. This branch must not be connected to production data or deployed with privileged credentials.

## Verified starting points

- The existing Firebase callable implementation is in `functions/index.js`.
- `approveBooking` currently performs a Firestore transaction, checks all confirmed bookings for the vendor/date, and writes a day lock.
- `cancelBooking` updates the booking and removes its entry from the day lock in a transaction.
- `firestore.rules.candidate` denies client writes to booking status and bookingLocks.
- The Firebase project is on Spark; the Firebase console Functions page says a billing account/Blaze upgrade is required.
- The current admin client calls Firebase callable functions in `admin.html`; it does not call a Cloudflare Worker.

## Proposed prototype boundary

The first prototype must be isolated and contain no Firebase service-account key, no production Firestore writes, and no change to Firestore Security Rules.

A later authenticated Worker would need to:
1. Verify the Firebase Authentication ID token on every request (signature, issuer, audience, expiry, and subject).
2. Read the user's Firestore profile and the vendor record before authorizing any action.
3. Permit only the intended manager/owner or super-admin role for that vendor.
4. Perform approval/rejection/cancellation in a Firestore REST transaction.
5. Re-read all confirmed bookings for the vendor/date inside the transaction, reject overlapping intervals, and atomically update the booking and lock.
6. Never trust role, vendorId, duration, date, or status supplied by the browser without re-reading authoritative Firestore data.
7. Keep any server credential in Cloudflare Worker Secrets only. Never commit credentials or expose them to browser code.
8. Apply strict CORS, method/path allowlists, request validation, and rate limiting.

## Important security and feasibility gate

A service-account credential gives privileged server access and can bypass Firestore Security Rules. Therefore, the Worker must independently enforce every authorization and data-integrity rule. A mistake could expose or alter all project data. Prefer short-lived credentials or a safer Google-supported identity mechanism over a long-lived private key where feasible. Do not deploy until the credential model and least-privilege IAM permissions have been reviewed.

Cloudflare Workers Free currently documents 100,000 requests/day and 10 ms CPU time per invocation. This is a platform quota, not a guarantee that a Firestore transaction and token verification will fit within the CPU limit. Measure on a non-production test project before considering deployment.

## Required tests before any real connection

- Two simultaneous approvals for the same vendor/date/time: exactly one succeeds.
- Overlapping intervals with different service durations: second approval fails.
- Adjacent non-overlapping intervals: both succeed.
- Rejected pending booking does not reserve a slot.
- Cancellation removes the lock entry and permits a later approval.
- A customer cannot approve/reject another user's booking.
- A manager cannot act on another vendor.
- A forged, expired, or revoked/invalid ID token is rejected.
- A user cannot self-assign a privileged role.
- Missing/invalid service duration fails closed.
- Transaction retry/conflict behavior is tested.

## Explicitly out of scope

- No edits to `main`.
- No edits to production Firestore rules or data.
- No deployment to Cloudflare or Firebase.
- No billing-plan upgrade.
- No secrets or service-account JSON in this repository.

## Decision

Do not connect the prototype to the real `moshtariar-test-2026` Firestore until the security gate and emulator/concurrency tests pass. If the Worker approach cannot meet the security and CPU constraints, stop and choose a different architecture rather than weakening Firestore rules.
