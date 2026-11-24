# Cloudflare Access → Google WIF disposable proof of concept

Status: **planning only; no cloud resources created** (2026-11-24)

## Verified baseline

- The latest prototype CI run at commit `c990bde` completed both `worker-unit-tests` and `firebase-emulator-concurrency` successfully. This validates only the existing isolated unit/Emulator tests.
- Cloudflare documents an Access application JWT in the `Cf-Access-Jwt-Assertion` header, signed with RS256, with issuer, application audience, expiration and a published JWKS/certificate endpoint. Access rotates signing keys every six weeks and retains the previous key for seven days.
- Google WIF accepts externally issued OIDC JWTs and can validate a JWKS uploaded directly to the provider when public OIDC discovery is unavailable (up to eight keys). The token audience must match the provider's expected audience or configured allowed audience.
- Cloudflare also documents a separate Generic OIDC SaaS integration with discovery, authorization, token, and JWKS endpoints. That documentation describes Cloudflare Access acting as an OIDC provider for a SaaS application; it does not by itself prove that a Cloudflare Access application JWT can be exchanged at Google STS.

## POC hypothesis to test

Use only an identity-based Cloudflare Access application JWT (not a service-token JWT) as the external subject token for Google STS. Configure a disposable WIF pool/provider with:
- exact Cloudflare Access issuer URI;
- exact Access application AUD as an explicitly allowed audience (if accepted by the selected provider configuration);
- Cloudflare's current and previous public signing keys in JWKS;
- attribute conditions restricting the exact issuer, audience, and one test identity subject;
- a dedicated test service account with the narrowest possible permissions and no access to production Firestore data.

The decisive test is an actual Google STS token exchange using a short-lived test JWT. A successful JWT signature check alone is not sufficient. Do not assume compatibility until STS accepts the token and returns a federated token.

## Hard safety gates

1. Do not create or download a service-account private key.
2. Do not add a client secret, API token, or private credential to Git, source files, logs, chat, or a browser screenshot. Any OAuth client secret required by an alternative Generic OIDC flow must be stored only as a managed secret and separately reviewed.
3. Do not grant the test identity Firestore read/write access. First prove STS exchange and identity attributes only.
4. Do not enable billing, upgrade Firebase, or enable paid APIs/services without explicit user approval after showing the exact cost implications.
5. Do not change Firestore Rules, deploy a privileged Worker, or access production/customer data.
6. Keep the public customer site outside the Access gate; protect only a separate test endpoint/application.
7. If WIF requires unsupported issuer/discovery/audience semantics, stop and record the failure. Do not weaken conditions to make the test pass.

## Required inputs before provisioning

- Cloudflare Zero Trust team domain (team name only; never send a token or secret).
- Confirmation that a separate disposable Access application may be created in the Cloudflare account.
- Google Cloud project number for the existing test project, plus confirmation of current billing status. Project ID is `moshtariar-test-2026`.
- A dedicated test identity (not the production superadmin account) and approval of any required API enablement. Do not share passwords or MFA codes.

## Planned sequence

A. Inspect Cloudflare Access plan/seat availability and confirm whether the disposable test application can be created without charge.

B. Inspect Google Cloud IAM/WIF API prerequisites and current billing state. No billing upgrade or paid API activation.

C. Create a separate Access application that protects only a harmless test route. Verify its JWT claims and key IDs locally without printing the token.

D. Create a disposable WIF pool/provider with no Firestore permissions. Attempt one STS exchange using the actual test assertion.

E. Record the exact result. Only if successful, separately design a restricted service-account impersonation test and review Firestore IAM implications. No production rollout is implied.

## Official references

- Cloudflare Access JWT validation and key rotation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Cloudflare Access application token: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- Cloudflare Generic OIDC SaaS application: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/saas-apps/generic-oidc-saas/
- Google WIF with other OIDC providers and uploaded JWKS: https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- Google WIF overview: https://docs.cloud.google.com/iam/docs/workload-identity-federation
