# hpn-ticket-service
This project is a small ticket reservation MVP for Half Past Nine. It runs locally with Docker Compose and includes:

- a Vite frontend for ticket purchase and admin pages
- a Cloudflare Worker API running through Wrangler
- a local Cloudflare D1 database
- Mailpit for email capture in development

## Requirements

The project expects the following toolchain versions:

- Node.js 24.x
- npm 10.x or newer
- Docker Desktop / Docker Engine with Compose support
- Git for repository operations

This project is configured for Node 24 via the repository's `.nvmrc` file and the package `engines` fields.

## TODOs

- [ ] Send mail after payment is confirmed?
- [ ] Use HP9 styling in emails
- [ ] Get things working in production
- [x] CI/CD pipeline (GitHub Actions: worker tests/build, frontend build, e2e)
- [ ] Ticket QR code support
- [x] Ticket check-in support (manual check-in via admin UI)

## Local development with Docker Compose

From the project root, start all services:

```bash
docker compose up --build
```

This starts:

- frontend: http://localhost:5173
- backend API: http://localhost:8787
- Mailpit UI: http://localhost:8025

The backend runs the same Worker entrypoint used in production. Wrangler provides the local Worker runtime and persists the local D1 database in a Docker volume.

Mailpit remains useful because its HTTP Send API is compatible with the Worker runtime. Local Worker email requests go to Mailpit over HTTP; production requests use Resend's HTTP API. Resend itself is a hosted email service and does not run as a local Compose container.

The backend settings can be configured with environment variables. `TOTAL_CAPACITY`, `MAX_TICKETS_PER_RESERVATION`, `TICKET_PRICE_CENTS`, and `RESERVATION_TTL_HOURS` come from the `vars` block in `apps/worker/wrangler.jsonc` (Wrangler loads the same file locally and in production); `FRONTEND_URL`, `EMAIL_DELIVERY`, `MAILPIT_API_URL`, `LOCAL_ADMIN_AUTH`, and `ING_PAYMENT_LINK` are passed as `--var` flags from `docker-compose.yml` for local development:

| Variable | Local default | Purpose |
| --- | ---: | --- |
| `TOTAL_CAPACITY` | `100` | Maximum number of tickets |
| `MAX_TICKETS_PER_RESERVATION` | `5` | Maximum tickets in one reservation |
| `TICKET_PRICE_CENTS` | `1000` | Price per ticket in cents |
| `RESERVATION_TTL_HOURS` | `48` | Reservation lifetime before expiry |
| `ING_PAYMENT_LINK` | Demo URL | Payment link shown on the private page |

For production, set these values through `apps/worker/wrangler.jsonc` vars or Cloudflare Worker secrets rather than committing real payment links to Compose.

## Production rollout

Production deployment is split into two phases:

1. **GitHub Pages:** `.github/workflows/deploy.yml` builds and publishes the static frontend. Reservations remain disabled while the `RESERVATIONS_ENABLED` repository variable is unset or `false`.
2. **Cloudflare:** the production API runs as a Cloudflare Worker with D1 and Cloudflare Access. Production email delivery is disabled until a sending provider is configured. `.github/workflows/deploy-cloudflare.yml` performs the D1 schema setup and Worker deployment manually.

Local development keeps reservations enabled by default.

### Cloudflare setup

1. Authenticate Wrangler locally and create the production database:

	```bash
	cd apps/worker
	npx wrangler login
	npx wrangler d1 create hpn-ticket-service-prod
	```

2. Copy the returned database ID into `apps/worker/wrangler.jsonc`. Also replace `FRONTEND_URL` with the real GitHub Pages URL.

3. Store runtime secrets directly in Cloudflare. Do not commit their values:

	```bash
	npx wrangler secret put ING_PAYMENT_LINK
	npx wrangler secret put RECAPTCHA_SECRET_KEY
	```

Email delivery can be enabled later by setting `EMAIL_DELIVERY` to `gmail` or `resend` and adding the matching provider secrets. Until then, reservations are created without sending customer email.

To protect the public reservation form, create a Google reCAPTCHA v3 key pair for the GitHub Pages domain and use the `reserve` action. Store the secret key in Cloudflare as `RECAPTCHA_SECRET_KEY`. Store the public site key as a GitHub Actions repository variable named `RECAPTCHA_SITE_KEY` so the Pages build can pass it to the frontend as `VITE_RECAPTCHA_SITE_KEY`.

4. Protect the admin area. Cloudflare Access requires a domain managed in your Cloudflare account; if the Worker is only reachable through its `workers.dev` URL (as with `hpn-ticket-service-worker.dorienmc.workers.dev`), Access cannot protect it, so use one or both of these instead:

**Password fallback:**

	```bash
	npx wrangler secret put ADMIN_PASSWORD
	```

When `ADMIN_PASSWORD` is set, the admin login page also accepts that password and issues a signed session cookie, independent of Cloudflare Access.

**Google Sign-In with an email allowlist:**

- In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type **Web application**.
- Under **Authorized JavaScript origins**, add the GitHub Pages origin, e.g. `https://dorienmc.github.io`. No redirect URI is needed for this flow.
- Copy the client ID and store it as a Cloudflare Worker secret:

	```bash
	npx wrangler secret put GOOGLE_CLIENT_ID
	```

- Manage the allowlist directly in `apps/worker/wrangler.jsonc` as the committed `ADMIN_ALLOWED_EMAILS` var, a comma-separated list of Gmail addresses allowed to sign in as admin, e.g. `"organiser@example.com, backup@example.com"`. Leave it empty to allow any Google account with a verified email. Redeploy the Worker after changing it.

- The Worker signs Google session cookies with `ADMIN_PASSWORD`, so it must be set (see the password fallback above) even if you don't intend to use password login yourself.

- Add the same client ID as a GitHub Pages variable (`GOOGLE_CLIENT_ID`, see step 6 below) so the frontend can render the Google Sign-In button.

1. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. Run the **Deploy Cloudflare Worker** workflow manually. It validates the bundle, applies the D1 schema, and deploys the Worker.

	`db:migrate:remote` runs `wrangler d1 execute --remote --file migrations/0001_initial.sql` directly rather than `wrangler d1 migrations apply --remote`, because the latter currently fails with Cloudflare API error `7403` on this account. The schema statements use `IF NOT EXISTS`, so rerunning it is safe. If you add a new migration file, update this script (or switch back to `wrangler d1 migrations apply` if Cloudflare resolves the issue) so it gets applied too.

2. Verify the deployed `/api/health` endpoint. Then add these GitHub Actions repository variables:

	| Variable | Value |
	| --- | --- |
	| `CLOUDFLARE_WORKER_URL` | Worker origin, without a trailing slash |
	| `RECAPTCHA_SITE_KEY` | Public Google reCAPTCHA v3 site key |
	| `GOOGLE_CLIENT_ID` | Google OAuth client ID, passed to the frontend as `VITE_GOOGLE_CLIENT_ID` |

Rerun **Deploy GitHub Pages** manually and choose `reservations_enabled=true` to enable the public reservation button. Push-triggered Pages deploys keep reservations blocked by default.

## Testing the reservation flow

### 1. Open the frontend

Visit http://localhost:5173 and fill in the reservation form:

- full name
- email address
- number of tickets

Submit the form to create a reservation.

### 2. Check the confirmation email

Open Mailpit at http://localhost:8025 and look for the reservation email.

The email contains a private link that is not the raw ING payment URL. The link goes to the local reservation status page and contains:

- the order number
- the reservation token

Example shape:

```text
http://localhost:5173/payment/HPN-123456/abc123token
```

### 3. Open the private reservation page

Click the link in the email or open the route manually. This page shows:

- order number
- customer name and email
- ticket quantity
- amount due
- expiry time
- current status
- ING payment link when the reservation is still active

This acts as the private payment + status page without exposing the raw banking link in the email itself.

### 4. Admin reconciliation

Open the admin page here:

```text
http://localhost:5173/admin
```

From there you can:

- review reservation totals
- see the current list of orders
- verify status values such as RESERVED, PAID, EXPIRED, and CANCELLED
- mark a reservation as paid with the action button for reserved orders

### 5. Re-check the private page after payment

After marking an order paid from the admin page, refresh the reservation page or reopen the private link. The status should change to PAID.

## Useful commands

Stop all services:

```bash
docker compose down
```

Stop and remove all local volumes:

```bash
docker compose down -v
```

Inspect the running container logs:

```bash
docker compose logs -f
```

## Notes

- The local flow is intentionally simple and operational rather than a strict lock-based capacity system.
- The project is designed so that payment and status live behind a private URL rather than embedding raw banking details in emails.
- Both local development and production run the same Cloudflare Worker (via Wrangler) and Cloudflare D1 database; the only difference is the local D1 database and Mailpit stand in for the remote D1 database and the configured production email provider (Gmail API or Resend).
