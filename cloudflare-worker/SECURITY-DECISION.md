# Worker-to-Firestore integration decision

Status: design gate only. No Firebase connection, credentials, deployment, or production changes have been made.

## Verified constraints

1. The candidate Firestore rules deny client updates/deletes to bookings and deny all reads/writes to bookingLocks. Approval, rejection, and cancellation are intended to be trusted-server operations.
2. Firestore REST calls authenticated with a Firebase Authentication ID token are evaluated by Firestore Security Rules. Therefore, a Worker forwarding the signed-in user's ID token cannot perform the currently forbidden privileged booking writes.
3. Firestore REST calls authenticated with a Google OAuth access token minted for a service account use IAM and bypass Firestore Security Rules. This is privileged access and requires the Worker to enforce authentication, authorization, and every data-integrity invariant itself.
4. Cloudflare Workers Free currently documents 100,000 requests/day and 10 ms CPU per invocation. Durable Objects with SQLite are available on Workers Free with published daily limits. These limits do not establish that the proposed integration will fit or remain free under all usage.
5. Firebase Functions deployment in this project currently requires the Blaze billing upgrade shown in the Firebase console. This document does not assume that using Firestore REST with a service account is exempt from every Google Cloud billing or quota condition; that must be checked before any credential is created or used.

## Options

### A. User Firebase ID token only — not sufficient for current rules

This preserves user-level Firestore Rules enforcement, but the current rules deliberately block the booking status and bookingLocks writes needed by approve/reject/cancel. Do not weaken those rules merely to make the Worker work.

### B. Worker plus service-account OAuth — technically possible, security-sensitive

A Worker could validate the Firebase ID token, read authoritative user/vendor/booking data, obtain a short-lived Google OAuth access token using a server-side identity, and execute Firestore REST transactions. Service-account requests bypass Firestore Rules, so the Worker must reproduce all authorization and validation checks independently.

Before considering this option:
- Confirm the exact Google Cloud IAM role required and whether it can be limited sufficiently for this project.
- Confirm any billing requirement and free-tier/quota impact in the actual project.
- Prefer workload identity federation or another short-lived credential mechanism if it is supported by Cloudflare Workers and this Google project. Do not assume support.
- If a private key is the only feasible method, obtain explicit user approval before creating it; store it only as a Cloudflare Worker Secret, never in GitHub, source files, browser code, logs, or chat.
- Validate Firebase ID tokens (signature, issuer, audience, expiry, subject) and re-read the user role, vendor ownership, booking, service duration, and booking state from Firestore.
- Use Firestore REST transaction APIs for the booking and lock changes; never rely on a separate lock store as the sole source of truth.

### C. Durable Object as a coordinator — supplemental only

A SQLite-backed Durable Object could serialize requests for a vendor/date and help coordinate concurrency. It cannot make its own storage transaction atomic with a Firestore transaction. Firestore must still enforce the final invariant in a Firestore transaction. Do not treat a Durable Object lock as a replacement for Firestore transaction checks.

## Current decision

NO-GO for a real Firebase connection or deployment until option B's identity, IAM, billing, and transaction design are verified. Keep the Worker isolated and keep the existing Firestore rules unchanged. The next safe engineering task is to build and test token-validation and Firestore REST transaction adapters against local mocks/emulators, with no real credentials or production endpoint.
