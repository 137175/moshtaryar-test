# Moshtariar Cloudflare Worker prototype — security gate

Status: isolated logic prototype only. It is not connected to Firebase and has no privileged operations.

## What is in this branch

- `src/booking-core.js`: pure time parsing and overlap checks against approved bookings.
- `src/index.js`: Worker shell with a health endpoint; all other routes return HTTP 501.
- `test/booking-core.test.js`: Node unit tests for invalid times, overlapping intervals, adjacent intervals, date/status filtering, and midnight boundary.
- `wrangler.toml`: local Worker metadata only; no routes, secrets, or production bindings.
- `functions/emulator-booking-policy-test.js`: isolated emulator checks for duration-aware overlap, adjacent slots, rejection without locks, and authorization boundaries.
- `.github/workflows/worker-prototype-tests.yml`: CI test workflow.

Run tests locally with Node.js 22:

```sh
npm --prefix cloudflare-worker test
```

## Verified starting points from the existing app

- The existing Firebase callable implementation is in `functions/index.js`.
- `approveBooking` uses a Firestore transaction, checks confirmed bookings for the vendor/date, and writes a day lock.
- `cancelBooking` updates the booking and removes its entry from the day lock in a transaction.
- `firestore.rules.candidate` denies client writes to booking status and bookingLocks.
- The Firebase project is on Spark; the Firebase console Functions page says a billing account/Blaze upgrade is required.
- The current admin client calls Firebase callable functions in `admin.html`; it does not call a Cloudflare Worker.

## Important limitation

These unit tests verify only pure interval logic. They do NOT prove database transaction atomicity, simultaneous-request safety, Firebase token verification, user authorization, or real Firestore integration. The current Worker intentionally returns 501 for privileged routes.

## Security requirements before a real integration

A future authenticated Worker would need to:
1. Verify Firebase Authentication ID tokens on every request (signature, issuer, audience, expiry, and subject).
2. Read the user's Firestore profile and vendor record before authorizing any action.
3. Permit only the intended manager/owner or super-admin role for that vendor.
4. Perform approval/rejection/cancellation using a Firestore REST transaction.
5. Re-read all confirmed bookings for the vendor/date inside the transaction, reject overlapping intervals, and atomically update booking and lock documents.
6. Never trust role, vendorId, duration, date, or status supplied by the browser without re-reading authoritative Firestore data.
7. Keep server credentials in Cloudflare Worker Secrets only. Never commit credentials or expose them to browser code.
8. Apply strict CORS, method/path allowlists, request validation, and rate limiting.

A service-account credential has privileged access and can bypass Firestore Security Rules. The Worker would therefore have to independently enforce all authorization and data-integrity rules. Do not deploy until the credential model and least-privilege IAM permissions have been reviewed. Prefer short-lived credentials or a safer Google-supported identity mechanism where feasible.

Cloudflare Workers Free documents a daily request quota and a per-invocation CPU limit. This prototype has not been deployed or measured against those limits.

## Required integration tests before any real connection

- Two simultaneous approvals for the same vendor/date/time: exactly one succeeds.
- Overlapping intervals with different service durations: second approval fails.
- Adjacent non-overlapping intervals: both succeed.
- Rejected pending booking creates no lock.
- Customers and managers of other vendors cannot approve bookings.
- Overlapping intervals with different service durations: second approval fails.
- Adjacent non-overlapping intervals: both succeed.
- Rejected pending booking does not reserve a slot.
- Cancellation removes the lock entry and permits a later approval.
- A customer cannot approve/reject another user's booking.
- A manager cannot act on another vendor.
- Forged or expired ID tokens are rejected.
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

Do not connect the prototype to the real `moshtariar-test-2026` Firestore until the security gate and integration tests pass. If the Worker approach cannot meet security and runtime constraints, stop and choose another architecture rather than weakening Firestore rules.
