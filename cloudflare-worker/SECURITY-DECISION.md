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


## Keyless identity feasibility check (2026-11-24)

The official Google documentation confirms that Workload Identity Federation (WIF) can exchange an external OIDC/SAML identity assertion for short-lived Google credentials, without a downloaded service-account key. However, the external workload must actually be able to obtain a suitable assertion from an IdP with a verifiable issuer/JWKS and the required audience/claims.

The Cloudflare documentation reviewed for this prototype describes:
- Cloudflare Access generic OIDC as an integration where Access consumes tokens from an external identity provider for user sign-in.
- Cloudflare Access service tokens as a Client ID + Client Secret pair for automated systems.

Those are not evidence that a Cloudflare Worker runtime receives a native, short-lived OIDC workload assertion suitable for Google WIF. A Cloudflare Access service token is itself a static secret and is not a substitute for a Google-trusted OIDC workload assertion.

### Decision after documentation check

- Google WIF is a valid general keyless pattern.
- A directly supported Cloudflare Workers → Google WIF workload identity flow has **not been verified** from the official documentation reviewed.
- Do not configure WIF with guessed issuer/audience values or treat Cloudflare Access service-token credentials as keyless federation.
- Do not create a service-account key, weaken Firestore Rules, add secrets, or deploy a privileged Worker as a workaround.
- Revisit only if Cloudflare documents a supported Worker workload OIDC token/issuer flow, or another supported identity broker is selected and its cost, security, and operations are verified.

Sources:
- Google Cloud Workload Identity Federation: https://docs.cloud.google.com/iam/docs/workload-identity-federation
- Google Cloud WIF with other providers: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- Cloudflare Access generic OIDC: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/
- Cloudflare Access service tokens: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- Firestore REST authentication and authorization: https://firebase.google.com/docs/firestore/use-rest-api


## Candidate follow-up: Cloudflare Access user JWT → Google WIF (2026-11-24)

A new candidate was identified after reviewing the current Cloudflare and Google documentation. This corrects the earlier conclusion only in a limited way: a native Worker workload identity assertion is still not documented, but a **user-authenticated Cloudflare Access application JWT** may be usable as an external OIDC-style assertion for Google WIF.

Verified documentation facts:
- Cloudflare Access sends a signed `Cf-Access-Jwt-Assertion` application JWT to the protected origin. Identity-based tokens include `iss`, `aud`, `exp`, `iat`, `nbf`, `sub`, and a verified `email`; Cloudflare documents RS256 signatures and a public JWK endpoint at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
- Cloudflare rotates its signing key every six weeks; the previous key remains valid for seven days. Any manually uploaded JWKS therefore needs an explicit rotation/refresh procedure.
- Google WIF accepts external OIDC assertions when issuer, audience, and signing keys can be validated. Google permits uploading a JWKS directly to the provider when discovery metadata is unavailable, with a maximum of eight uploaded keys.
- Google IAM pricing states IAM API use and Workload Identity Federation have no additional per-user/identity charge. This does **not** prove that every API, Firestore operation, logging choice, or the whole proposed architecture has zero cost.

Important limitations and required safeguards:
- This is **user identity federation**, not proof of a native Cloudflare Worker workload identity. The protected Worker would receive a Cloudflare Access JWT for the signed-in manager/admin.
- The Cloudflare Access application would add a second authentication gate for manager/admin actions. Public customer routes should not be forced behind this gate.
- Google WIF compatibility with the exact Cloudflare Access application-token format has not yet been proven by a real STS token exchange. Cloudflare documents the token format and validation, but does not explicitly document this Google WIF integration.
- Service-token JWTs have an empty `sub` and are based on a static Client ID/Secret; reject them for this flow. Only identity-based Access tokens with a non-empty immutable `sub`, expected issuer, exact application audience, and verified email could be considered.
- Before any Firestore privileged action, the Worker must also validate the Firebase ID token, require its UID/email to match the authenticated Access identity, and re-read the user's current role, vendor ownership/manager assignment, booking state, service duration, and relevant bookings from Firestore. Never authorize from the Access email or browser-supplied role alone.
- The Google service account would still bypass Firestore Security Rules. IAM must be restricted to the minimum Firestore permissions and the WIF provider must restrict the exact issuer, Access application audience, token type, and allowed identities. The Worker must independently enforce every security rule and transaction invariant.
- Cloudflare Access key rotation must be operationally handled. If Google WIF uses an uploaded JWKS, update it before/at rotation and retain the previous key during the documented overlap; do not pin a single stale key.
- Confirm all required APIs, IAM permissions, billing status, Firestore quotas, and any charges in the actual Google project before setup. Do not upgrade billing or enable paid services without explicit user approval.

### Revised decision

**NO-GO for production or real Firestore writes. CONDITIONAL GO for a disposable proof-of-concept only**, after explicit approval to configure a Cloudflare Access test application and a Google WIF test provider. The proof-of-concept must first exchange a test identity JWT with Google STS and verify that a tightly restricted service account can obtain a short-lived token. Only after that succeeds should mock/emulator adapter tests be considered. Do not use the real project data, create service-account private keys, alter Firestore Rules, or deploy privileged routes during this proof.

Sources:
- Cloudflare Access application token claims and signing keys: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- Cloudflare Access JWT validation and six-week key rotation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Google WIF external OIDC requirements and uploaded JWKS: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- Google Cloud IAM pricing: https://cloud.google.com/products/iam
