# Half Past Nine - Implementation Plan

## Goal

Create the first runnable version of the reservation system in a simple, understandable structure. The initial version should support the local developer workflow: reservation form -> backend -> SQLite -> Mailpit -> private reservation page.

The first release is intentionally narrow and does not include ING API integration, admin login, or QR ticketing.

---

## 1. Project structure

```text
concert-tickets/
├── apps/
│   ├── frontend/
│   │   ├── src/
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── worker/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── db/
│   └── schema.sql
├── docker-compose.yml
├── .gitignore
├── README.md
├── package.json
└── tests/
    └── reservation-flow.test.ts
```

---

## 2. Milestone 1 - Project bootstrap

### Tasks
- Initialise a monorepo-style project structure
- Add frontend app with Vite + TypeScript
- Add backend worker app with TypeScript
- Add SQLite database support for local development
- Add Docker Compose configuration
- Add Mailpit for local email inspection
- Add base environment config
- Add .gitignore and README

### Acceptance criteria
- `docker compose up` starts the stack successfully
- frontend is accessible at `http://localhost:5173/hpn-ticket-service/`
- backend is accessible at `http://localhost:8787`
- Mailpit is accessible at `http://localhost:8025`
- SQLite DB is created and available to the backend

---

## 3. Milestone 2 - Database and schema

### Tasks
- Create the initial `orders` table
- Add fields for order number, access token, name, email, quantity, amount, status, timestamps
- Add initial SQL migration file
- Create helper functions for DB access

### Schema
```sql
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'RESERVED',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    paid_at TEXT,
    notes TEXT
);
```

### Acceptance criteria
- a reservation can be inserted successfully
- order number and token are unique
- records are retrievable by ID and token

---

## 4. Milestone 3 - Reservation creation API

### Tasks
- Create public reservation form in frontend
- Add API endpoint for reservation submission
- Validate form input
- Validate quantity is positive and within a sane upper bound
- Calculate total amount as `quantity * 10` euros
- Generate order number and access token
- Persist the reservation in RESERVED state
- Set expires_at to `now + 48 hours`
- Send email with the private reservation URL

### Recommended API
```text
POST /api/reservations
Body:
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "quantity": 2
}
```

### Response
```json
{
  "orderNumber": "HP9-0001",
  "status": "RESERVED",
  "expiresAt": "2026-09-12T10:00:00Z",
  "paymentUrl": "http://localhost:5173/hpn-ticket-service/payment/HP9-0001/abc123"
}
```

### Acceptance criteria
- valid submission creates a reservation
- invalid input is rejected
- quantity and amount are stored correctly
- a confirmation email is sent to Mailpit
- the email includes the private payment/status URL
- the email does not include a raw ING payment link

---

## 5. Milestone 4 - Reservation status and payment page

### Tasks
- Create route for private reservation page
- Accept `orderNumber` and token from the URL
- Load the reservation by token
- Show status-aware content:
  - RESERVED: payment instructions + ING link
  - PAID: paid confirmation
  - CANCELLED: expired/invalid message
  - EXPIRED: expired message
- Add a page that can later show ticket details after payment

### Payment page behavior
- If reservation is RESERVED, fetch the correct ING link based on quantity/amount
- If reservation is PAID, display a confirmation state
- If reservation is CANCELLED or EXPIRED, show a clear message

### Acceptance criteria
- valid token loads the correct reservation
- invalid token does not reveal another reservation
- reserved reservation shows payment instructions and ING link
- paid reservation does not show the payment link again
- expired or cancelled reservations are clearly marked

---

## 6. Milestone 5 - Capacity and expiry management

### Tasks
- Add an availability helper to calculate active reservations
- Exclude expired and cancelled records from active capacity count
- Add a scheduled or manual expiry task to expire stale reservations
- Mark expired reservations and free their seats
- Add an admin/ops endpoint to list summary totals

### Summary counts
The admin should compute:
- total capacity
- reserved count
- paid count
- available count
- expired count
- cancelled count

### Acceptance criteria
- expired reservations are no longer counted as active
- cancelled reservations are not counted
- final availability calculation is visible in admin summary
- expired reservations free up capacity for later bookings

---

## 7. Milestone 6 - Admin overview and actions

### Tasks
- Add secure admin login flow using Cloudflare Access in production
- Create admin dashboard with summary cards
- List orders with filters and search
- Add actions:
  - mark as paid
  - cancel
  - extend reservation
  - resend email

### Filters
- All
- Reserved / Pending
- Paid
- Expired
- Cancelled

### Search fields
- order number
- customer name
- email

### Acceptance criteria
- admin can view order list and counts
- filtering works as expected
- mark paid updates status and paid_at timestamp
- cancel removes active usage from capacity
- extend reservation changes expires_at

---

## 8. Milestone 7 - Ticketing phase (later)

### Tasks
- Add tickets table
- Generate ticket codes for paid orders
- Render QR codes or token-based ticket IDs
- Display tickets on the private reservation page after PAID
- Add check-in status support: VALID / USED

### Acceptance criteria
- paid orders can generate tickets
- ticket status can be viewed by the customer
- admin can see/check ticket status
- check-in updates ticket state

---

## 9. Milestone 8 - Production deployment

### Tasks
- Deploy frontend to GitHub Pages
- Deploy backend to Cloudflare Worker
- Use Cloudflare D1 for production database
- Use Resend for production emails
- Store ING payment links in backend configuration
- Add environment-based configuration for local vs production

### Acceptance criteria
- public frontend loads without backend code embedded in the page
- reservation API works through Cloudflare Worker
- production database is used instead of local SQLite
- production emails are sent through Resend

---

## 10. Testing strategy

### Current development tests
Focus on practical, simple checks:
- reservation is created correctly
- quantity and amount are valid
- expiration is applied
- status transitions are correct
- the private payment URL is generated correctly
- email payload contains the private URL and not the ING link

### Tools
- Vitest for unit/integration tests
- optional Playwright later for end-to-end flow validation

### Example tests
- creates reservation for valid customer input
- rejects invalid quantity
- expires orders after timeout
- displays reserved status page correctly
- blocks access with incorrect token

---

## 11. Build order

The work should be done in small vertical slices:

1. local stack and DB
2. reservation form and API
3. email + private URL
4. private status/payment page
5. admin overview and actions
6. expiry and capacity logic
7. production deployment
8. ticket generation and check-in

This keeps the implementation understandable and allows testing each slice before moving on.

---

## 12. Risk and design notes

### Capacity risk
The initial version does not need strict transactional locking. The operational flow remains human-led, and the organiser manually confirms paid reservations. This keeps the first implementation simpler without sacrificing the user experience.

### Security note
The token is the authorization mechanism. The payment URL itself is not the secret; the reservation URL is.

### Simplicity note
The project should stay intentionally small and focused on the one-event use case instead of building a generic ticketing platform from day one.

---

## 13. Next immediate step

The next action is to build the first runnable slice:
- Docker Compose stack
- frontend reservation form
- TypeScript backend API
- SQLite DB
- Mailpit email testing
- first reservation creation flow

Once that works, the next features can be added incrementally: payment page, admin overview, expiry logic, and later ticketing.
