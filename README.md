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

The backend settings can be configured with environment variables:

| Variable | Local default | Purpose |
| --- | ---: | --- |
| `TOTAL_CAPACITY` | `100` | Maximum number of tickets |
| `MAX_TICKETS_PER_RESERVATION` | `5` | Maximum tickets in one reservation |
| `TICKET_PRICE_CENTS` | `1000` | Price per ticket in cents |
| `RESERVATION_TTL_HOURS` | `48` | Reservation lifetime before expiry |
| `ING_PAYMENT_LINK` | Demo URL | Payment link shown on the private page |

For production, set these values through the deployment environment rather than committing real payment links to Compose.

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
	```

Email delivery can be enabled later by setting `EMAIL_DELIVERY` to `gmail` or `resend` and adding the matching provider secrets. Until then, reservations are created without sending customer email.

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
- Production design extends this with Cloudflare/D1 + Resend patterns, but the Docker Compose setup is the quickest way to test the MVP locally.
