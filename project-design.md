# Half Past Nine - Project Design

## 1. Product goal

Build a lightweight ticket reservation system for the Half Past Nine concert.

The system supports:
- a public ticket page
- reservation creation with customer data
- private reservation/payment URLs
- manual payment confirmation by the organiser
- status tracking for each reservation
- future ticket generation and check-in support

The app is intentionally small and simple: it is designed for a single-event scenario with a maximum capacity of 100 tickets and a manual reconciliation flow.

---

## 2. Core business rules

### Ticket capacity
- Total capacity: 100 tickets
- Reservations consume capacity while they are active
- Cancelled and expired reservations are released back to availability
- Paid reservations also consume capacity
- Capacity is treated as a practical operational check rather than a strict fully-locked transactional constraint in the first version

### Reservation lifecycle
Status progression:

```text
RESERVED -> PAID -> TICKETS_SENT
RESERVED -> CANCELLED
RESERVED -> EXPIRED
```

Suggested expiration window:
- 48 hours by default
- can be configured later

### Payment model
- Customer does not receive the raw ING payment link in the email
- The email contains a private reservation URL
- The private reservation page shows the reservation status and, if still unpaid, the appropriate ING payment link
- Manual check of the ING business account is still required before the organiser marks the reservation as paid

### Access model
- The private URL contains a random access token
- The token identifies the reservation
- Only the customer with the correct token can access that reservation page
- The token is the protection mechanism, not the ING link itself

---

## 3. User flows

### Customer reservation flow
1. Visitor opens the public ticket page
2. Enters name, email, and quantity
3. System validates the requested quantity
4. System creates a reservation in RESERVED state
5. System sends an email with a private reservation URL
6. Customer opens the private page
7. If still reserved, the page shows:
   - order number
   - name
   - ticket count
   - amount
   - payment instructions
   - ING payment link
   - expiration timestamp
8. Customer pays via ING manually
9. Organiser checks the business account and marks the reservation as PAID in admin
10. The reservation page later shows a paid confirmation and then, in future, ticket details or QR tickets

### Admin flow
1. Admin logs in through Cloudflare Access (preferred)
2. Admin sees a summary of totals
3. Admin can filter/search orders
4. Admin can:
   - mark a reservation as PAID
   - cancel a reservation
   - extend a reservation
   - resend an email
   - eventually generate or resend tickets

---

## 4. System architecture

### Frontend
Public frontend hosted on GitHub Pages.

Responsibilities:
- ticket landing page
- reservation form
- success confirmation page
- private reservation/status page

Technology:
- Vite + TypeScript
- static site for the public page
- simple app shell for status page if needed

### Backend
API backend implemented in TypeScript and designed to be compatible with Cloudflare Workers later.

Responsibilities:
- validate reservation inputs
- check availability
- create reservation records
- generate token and order number
- send email
- load reservation by token
- render state-aware payment/status page data
- update order status for admin actions
- handle expiry logic

Technology:
- TypeScript
- local SQLite for development
- Cloudflare D1 planned for production

### Database
Local development database should use SQLite, while the production schema should remain Cloudflare D1-compatible.

For this setup, I would prefer to model the timestamp fields as `DATETIME`/`TIMESTAMP` in the schema design, but actually store them as ISO-8601 UTC strings in the database. This is the most practical choice because SQLite and Cloudflare D1 do not enforce strict temporal types the way a heavier SQL engine does.

In other words:
- logical column type: `DATETIME` / `TIMESTAMP`
- actual storage format: ISO-8601 text, for example `2026-09-10T12:00:00Z`

This gives you consistent sorting/comparison semantics without fighting SQLite's dynamic typing.

Essential table:

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
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    paid_at DATETIME,
    notes TEXT
);
```

Recommended storage convention:
- store UTC timestamps in ISO-8601 format
- example: `2026-09-10T12:45:00Z`
- do not store local time strings unless you also explicitly track timezone information

Later extension:
- tickets table
- QR code or token-based ticket identifiers
- check-in support

### Email system
- Local development: Mailpit
- Production: Resend
- Emails contain:
  - customer name
  - order number
  - ticket count
  - amount
  - expiration date
  - private reservation URL
- Emails do not contain the raw ING payment link

### Payment integration
- ING Betaalverzoek Zakelijk links are configured separately
- The backend stores the appropriate payment link for a given amount/quantity mapping
- The payment page loads the correct link for the reservation
- The organiser manually confirms payment in the admin UI

---

## 5. Revised architectural decision

The private payment page is not only a payment page; it is also the customer status page.

That means the same URL should support:
- reservation lookup by token
- status display
- payment instructions while RESERVED
- payment confirmation once PAID
- future ticket display
- future check-in status

This is a better fit than simply redirecting directly to an ING URL from email.

---

## 6. Data model and state behavior

### Order summary
Each order should store:
- order_number
- access_token
- customer name and email
- quantity
- amount in cents
- status
- created_at
- expires_at
- paid_at
- notes

### Status logic
- RESERVED: active reservation awaiting payment
- PAID: payment was manually approved by organiser
- CANCELLED: manually cancelled / voided
- EXPIRED: timed out and released from capacity
- TICKETS_SENT: future state used once actual tickets are sent

### Availability calculation
Availability is roughly:

```text
available = total_capacity - active_reserved - active_paid
```

The system should exclude orders in CANCELLED or EXPIRED states from capacity counting.

---

## 7. Priority and implementation scope

### Phase 1 MVP
Goal: make a working local reservation flow.

Included:
- public reservation form
- API to create reservations
- capacity estimation
- SQLite persistence
- email sending to Mailpit
- private reservation page
- basic status display

### Phase 2 operational controls
Included:
- admin summary page
- order list with search and filters
- mark paid / cancel / extend
- expired reservation cleanup

### Phase 3 ticketing
Included:
- ticket generation
- QR codes
- ticket status display
- check-in support

### Phase 4 production deployment
Included:
- GitHub Pages frontend
- Cloudflare Worker backend
- Cloudflare D1 database
- Resend email
- real ING links

---

## 8. Simple operational model

The app is not meant to be a fully real-time high-availability booking engine.
It is a lightweight, organiser-managed event sales flow.

In practice:
- the app helps create reservations quickly
- the organiser checks actual payments manually
- the organiser updates state in admin
- the system provides a clear customer-facing reservation page

This keeps the product simple, trustworthy, and suitable for a single small concert.

---

## 9. Non-goals for the first version

The initial build does not need:
- full ING API integration
- real production deployment
- admin authentication beyond the later Cloudflare Access plan
- QR ticket scanning infrastructure
- full distributed concurrency controls
- complex anti-fraud logic

These can be added after the core reservation flow is working.

---

## 10. Overall design principle

The design follows a simple principle:

> Make reservation creation easy, keep the payment flow private, and let the organiser manually confirm the final payment state.

This is the most robust approach for a small concert, a small team, and a manual reconciliation process.
