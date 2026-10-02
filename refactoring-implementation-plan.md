# Ticket service refactoring implementation plan

## Status and scope

Planning only. Creating this document does not authorize implementation.

The agreed target is a vanilla TypeScript frontend and a single Cloudflare Worker
backend, used both locally through Docker Compose/Wrangler and in production.
Express removal is separate work being completed by the user and is treated as
the starting point, not a task in this plan. The refactoring starts from the
updated Worker-only project, including its extracted admin-access helper, local
Wrangler configuration, and isolated Worker end-to-end tooling.

The inspected snapshot still contains uncommitted changes. At execution time,
confirm the final Worker-only baseline and preserve all existing work. Do not
restore Express, repeat its removal, or overwrite/reset the user's changes.
The observations below describe configuration and code, not verified test results.

This plan supplements, rather than replaces, the original
[implementation plan](./implementation-plan.md).

## Requirements

| ID | Requirement |
| --- | --- |
| REQ-01 | Split frontend startup from reservation, payment/status, privacy, and admin pages. |
| REQ-02 | Split admin functionality into cohesive modules without changing interactions. |
| REQ-03 | Extract Worker business logic from HTTP handlers and isolate persistence, authentication, and email delivery. |
| REQ-04 | Preserve the existing Worker-only development, test, build, and CI workflows. |
| REQ-05 | Preserve existing public routes, API responses, authorization, database behavior, and UI. |
| REQ-06 | Preserve current Worker test coverage and verify refactored behavior with automated tests. |
| REQ-07 | Keep runtime-specific code out of shared business helpers and maintain TypeScript type safety. |
| REQ-08 | Document the resulting structure and supported development workflow. |

### Non-goals

- No frontend framework, router library, UI redesign, or new product features.
- No API renaming, response-field renaming, or database schema changes.
- No generic repository framework or abstraction for an unused second runtime.
- No dependency upgrades or unrelated bug fixes.
- No change to reservation limits, expiry rules, email-failure policy, or allowed
  status transitions as part of code movement.
- No production deployment or remote database modification during refactoring.
- No Express removal, legacy dependency cleanup, or reconstruction of removed
  Express tests; those changes belong to the preceding Worker-only transition.

## Current evidence and preservation rules

- [Frontend startup](./apps/frontend/src/main.ts) currently combines routing,
  markup, network requests, integration loading, and event handlers.
- [Worker entrypoint](./apps/worker/src/cloudflare.ts) combines Hono setup,
  routes, D1 operations, authentication, reservation rules, and email delivery.
- [Payment-link helpers](./apps/worker/src/payment-links.ts) and
  [admin-access helpers](./apps/worker/src/admin-access.ts) already provide
  extraction patterns to reuse.
- [Worker tests](./apps/worker/src/cloudflare.test.ts) exercise authentication,
  owner access, email delivery, reCAPTCHA, payment links, and selected routes.
- [Browser tests](./e2e/reservation.spec.ts) cover reservations, status pages,
  privacy navigation, admin filtering, payment confirmation, and check-in.
- [Worker API regression tests](./e2e/worker/reservation-api.spec.ts) already
  carry over service-test scenarios such as quantities, capacity, expiry,
  payment/ticket creation, and repeated check-in.
- [Worker admin-access browser tests](./e2e/worker/admin-access.spec.ts) are
  part of the isolated Worker suite.
- [Isolated Playwright configuration](./playwright.worker.config.ts) runs the
  shared reservation suite and Worker-specific tests serially, with separate
  frontend/API ports and temporary D1 state through the
  [Worker test runner](./apps/worker/scripts/run-e2e-worker.mjs).
- [Root scripts](./package.json) expose `test:e2e` and `test:e2e:worker`.
  [Worker scripts](./apps/worker/package.json) use Wrangler for development and
  startup, with [local configuration](./apps/worker/wrangler.local.jsonc).
  [CI](./.github/workflows/ci.yml) runs both Docker-based and isolated Worker
  end-to-end suites.
- The updated Worker includes persisted Google session revocation through
  [migration 0003](./apps/worker/migrations/0003_admin_session_revocations.sql).

Use the updated Worker behavior and current tests as the source of truth.
The former Express implementation is not a compatibility target.

Preserve:

- The `/hpn-ticket-service/` base path, direct navigation, trailing-slash
  handling, payment URLs, and admin tab query strings.
- Existing markup, selectors, CSS classes, Dutch text, dialogs, redirects,
  confirmation prompts, and single/bulk check-in interactions.
- HTTP methods, status codes, response fields, error messages, credentials,
  cookies, CORS configuration, and cross-site mutation restrictions.
- Quantity limits, including the five supported payment-link quantities.
- Paid orders continuing to occupy capacity after reservation expiry.
- Reservation persistence and explicit logging when confirmation email fails;
  resend failures must still surface to the caller.
- Password and Google sessions, owner-only allowlist management, immediate
  allowlist revocation, persisted logout revocation, and atomic allowlist/audit
  writes. Preserve current signed-cookie formats and revocation lookups/cleanup.
- Existing D1 atomic batches for payment/ticket creation. Do not replace them
  with separate writes while extracting code.

If characterization tests reveal an existing defect, record it separately.
Do not silently change behavior under the label of refactoring.

## Proposed frontend structure

Paths below are proposed destinations, not files created by this plan.

```text
apps/frontend/src/
  main.ts
  config.ts
  api/
    client.ts
    types.ts
  pages/
    reservation.ts
    payment.ts
    privacy.ts
    admin/
      index.ts
      login.ts
      access.ts
      orders.ts
      ticket-modal.ts
  integrations/
    recaptcha.ts
    google-identity.ts
  ui/
    escape-html.ts
    status-label.ts
```

- `main.ts`: validate the root element, resolve the current route, and initialize
  the selected page. No page markup, API requests, or business workflows.
- Page modules: own markup and page-specific event handlers; receive the root
  element and explicit configuration/dependencies.
- Admin modules: keep login, access management, order filtering/actions, and
  ticket-modal behavior separate, with page-owned state.
- API modules: typed endpoint functions and consistent response/error handling,
  including JSON responses and successful empty logout responses.
- Integration modules: preserve lazy loading and cached script promises;
  Google Identity Services and reCAPTCHA load only where needed.
- UI helpers: reuse escaping and status labels without coupling page state.

Keep API DTOs separate from database records. Preserve existing camelCase public
responses and snake_case admin order/ticket records. For this scope, frontend
DTOs can live locally; do not introduce a cross-app workspace package solely to
share a handful of types. Type annotations do not replace runtime input checks.

## Proposed Worker structure

```text
apps/worker/src/
  cloudflare.ts
  config.ts
  types.ts
  admin-access.ts
  payment-links.ts
  routes/
    public.ts
    auth.ts
    admin-orders.ts
    admin-access.ts
    admin-tickets.ts
  services/
    reservations.ts
    tickets.ts
    admin-access.ts
  repositories/
    orders.ts
    tickets.ts
    admin-access.ts
  auth/
    sessions.ts
    google.ts
    middleware.ts
  email/
    reservation-template.ts
    delivery.ts
  integrations/
    recaptcha.ts
```

- Entrypoint: compose middleware and route registration, then export the app.
- Routes: adapt HTTP inputs/outputs and invoke services. No SQL or email markup.
- Services: validation, pricing, expiry, capacity checks, reservation actions,
  ticket creation/check-in, and access-management orchestration.
- Repositories: concrete D1 operations with typed results and atomic batches.
  Keep transaction-sensitive operations cohesive rather than decomposing every
  SQL statement into a separate service call.
- Authentication: cookie/session primitives, identity verification, and Hono
  authorization middleware with existing ordering.
- Email: pure template rendering and transport selection for Gmail, Mailpit,
  Resend, and disabled delivery. Keep provider failures explicit.
- Configuration: typed Worker bindings and configuration mapping. No
  `process.env`, Node-only imports, or Hono context in business helpers.

Prefer explicit arguments over global mutable configuration. An injectable
clock/ID generator is appropriate where it simplifies deterministic tests.
Reuse the existing admin-access helper rather than duplicating it in the service
layer; moving or renaming it is optional.

## Execution phases and tasks

### Phase 1: Establish the updated Worker-only baseline

Dependencies: none. Requirements: REQ-04, REQ-05, REQ-06.

- [ ] T01 Confirm the user's completed Worker-only transition as the baseline,
  including Compose, local/production Wrangler configuration, Playwright, CI,
  admin-access helpers, and session-revocation migrations.
- [ ] T02 Run current Worker tests, type checks/builds, and browser regression
  tests using isolated local data. Record baseline failures before extraction.
- [ ] T03 Review current unit/HTTP tests and isolated Worker API/browser tests.
  Reuse their existing reservation and admin-access coverage; add only missing
  cases for create/read/expire/cancel/extend/pay/resend/check-in and capacity.
- [ ] T04 Characterize exact request/response shapes, expiry boundaries,
  missing records, invalid inputs, repeated payment, and repeated check-in.

Acceptance: the updated Worker-only baseline is documented and relevant existing
behavior is covered; pre-existing failures are
distinguished from refactoring regressions. Tests must not use or delete real
reservation data.

### Phase 2: Extract frontend pages

Dependencies: Phase 1. Requirements: REQ-01, REQ-02, REQ-05, REQ-07.

- [ ] T05 Extract configuration, escaping/status helpers, and integration loaders.
- [ ] T06 Move reservation, payment/status, and privacy pages into page modules;
  reduce startup to route selection and initialization.
- [ ] T07 Extract admin login, access management, orders, and ticket-modal modules,
  preserving event registration, state, reloads, and query-string behavior.
- [ ] T08 Introduce typed endpoint functions/DTOs and remove page-level `any`
  usage for orders and tickets. Preserve each request's credentials and errors.
- [ ] T09 Verify all existing page navigation and admin flows, plus network
  errors, invalid payment tokens, and disabled reservations.

Acceptance: startup has no page markup or network workflows; pages initialize
independently; no duplicate handlers; existing selectors and browser flows pass.

### Phase 3: Extract Worker modules

Dependencies: Phase 1; may be developed separately from Phase 2.
Requirements: REQ-03, REQ-05, REQ-06, REQ-07.

- [ ] T10 Extract bindings/configuration and pure reservation/email helpers,
  reusing payment-link and admin-access utilities.
- [ ] T11 Extract email template/delivery and reCAPTCHA integration, preserving
  logging, provider behavior, and existing error policies.
- [ ] T12 Extract session/Google helpers and auth middleware. Preserve middleware
  registration order, cookie attributes/formats, owner checks, allowlist
  revocation, and persisted logout-revocation behavior.
- [ ] T13 Extract D1 repositories and business services for reservations,
  tickets, summaries, and access management. Keep atomic writes intact.
- [ ] T14 Register public/auth/admin route modules from the small entrypoint.
  Move direct helper tests to their owning modules and retain HTTP contract tests.
- [ ] T15 Update TypeScript include/exclude rules as needed so every new module
  is checked and the Worker bundle excludes browser and Node-only dependencies.

Acceptance: no business SQL or templates in routes; no Hono request contexts in
business services; exact route contracts and persistence behavior remain intact.

### Phase 4: Integrate the modular structure with existing tooling

Dependencies: Phases 1 and 3. Requirements: REQ-04, REQ-06, REQ-08.

- [ ] T16 Keep unit/helper tests beside their owning modules and preserve the
  existing Worker API/browser scenarios when imports or entrypoints move.
- [ ] T17 Ensure the existing local/production Wrangler configurations and
  isolated test runner resolve the modular Worker and apply current migrations.
  No dependency changes or schema changes are expected for this extraction.
- [ ] T18 Verify root/app scripts, Docker defaults/Compose overrides, both
  Playwright configurations, CI jobs, and build configuration still work with
  the extracted modules; retain both existing end-to-end workflows.
- [ ] T19 Add explicit frontend type checking in CI without replacing the
  existing Worker builds or isolated Worker end-to-end job.
- [ ] T20 Update README architecture/workflow documentation and related TODOs.

Acceptance: existing Worker-only commands and both browser suites remain usable;
production remains on the same Worker entrypoint; all extracted modules are
checked and bundled; documentation matches the updated structure.

### Phase 5: Final regression gate

Dependencies: Phases 2 and 4. Requirements: REQ-05, REQ-06, REQ-07, REQ-08.

- [ ] T21 Run the complete Worker tests, frontend type check/build, Worker type
  check/build and Wrangler dry-run bundle, then the supported browser suites.
- [ ] T22 Verify direct URLs/base paths, payment statuses, admin login/logout,
  search/tabs, owner access, cancellation/extension/resend, and bulk check-in.
- [ ] T23 Review the final diff for accidental UI/API/schema changes, generated
  artifacts, secrets, unused imports, and runtime-boundary violations.

Acceptance: no refactoring-introduced failures; documentation matches actual
commands; no production deployment, remote writes, or changes to real data.

## Validation approach

Use existing runners and the smallest relevant test selection after each
extraction. Escalate to full suites at phase boundaries and the final gate.

Commands to reconcile against the scripts present at execution time:

```bash
# Worker unit/HTTP tests
npm --prefix apps/worker test

# Frontend type checking (Vite build alone does not type-check)
cd apps/frontend
npx tsc --noEmit -p tsconfig.json
npm run build

# Worker type checking and dry-run bundle (not a deployment)
cd ../worker
npm run build
npm run build:cloudflare

# Existing Docker-based browser suite, from the repository root
cd ../..
npm run test:e2e -- e2e/reservation.spec.ts

# Existing isolated Worker API and browser suites
npm run test:e2e:worker
```

The isolated suite already provides temporary D1 state, separate ports, and
serial execution. Preserve this isolation and its runner-managed email test
setup rather than replacing it with tests against the developer's live stack.
Confirm final script details if the preceding Worker-only transition changes them.

Browser tests create reservations and check-ins: use a dedicated local D1
database/volume and Mailpit instance. Do not run tests against production, reset
an existing user's database, or take down unrelated running containers.
Confirm container CLI configuration before generating/executing container
commands. Installing/restoring dependencies is only necessary after manifest
changes or a missing-dependency failure.

## Requirement mapping

| Requirement | Tasks | Verification |
| --- | --- | --- |
| REQ-01 | T05-T06 | Thin startup; all four pages navigate directly and under the base path. |
| REQ-02 | T07-T09 | Login/access/orders/modal isolation; unchanged filtering and check-in flows. |
| REQ-03 | T10-T14 | Layer boundaries; service, repository, integration and HTTP tests. |
| REQ-04 | T01, T16-T19 | Existing Worker-only commands and both end-to-end workflows remain functional. |
| REQ-05 | T02-T04, T06-T15, T21-T23 | Exact API contracts, UI regression tests, atomicity and auth checks. |
| REQ-06 | T02-T04, T14, T16, T21-T22 | Current Worker coverage retained; missing cases added; full final regression gate. |
| REQ-07 | T05, T08, T10, T13, T15, T21 | Both TypeScript checks; no Node-only imports in business helpers. |
| REQ-08 | T18-T20, T23 | README commands and structure match the final implementation. |

## Delivery and review

Recommended review units:

1. Updated Worker-only baseline and coverage.
2. Frontend extraction.
3. Worker extraction.
4. Tooling integration and documentation.

Express retirement is outside these review units and must not be repeated.
Keep behavior fixes separate unless caused
by the extraction itself. Review each unit before proceeding, and retain a
green baseline so regression causes remain attributable.

Implementation starts only after explicit user approval.
