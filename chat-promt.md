# Half Past Nine Concert Ticket System

## Project

I am building a small ticket reservation/payment system for a concert called **Half Past Nine**.

The concert has a capacity of **100 seats** and tickets cost **€10 each**.

I have an existing **free WordPress.com website**, but WordPress.com's free plan restricts custom JavaScript/iframes/scripts. Therefore, the actual ticket application should be hosted separately, most likely using **GitHub Pages** for the public frontend.

I am based in the Netherlands and have an **ING business account**.

---

## My technical background

I am comfortable programming and have experience with:

* Java
* Kotlin
* Angular

I am less comfortable with JavaScript/TypeScript.

Despite that, the current recommendation is to use **TypeScript**, because:

* The frontend can use TypeScript.
* The backend can also use TypeScript.
* Cloudflare Workers are very convenient with TypeScript.
* Vite + TypeScript is simpler than Angular for this relatively small application.
* It avoids having Java/Kotlin on the backend and TypeScript on the frontend.

I am open to Kotlin if there is a compelling reason, but TypeScript is currently the preferred stack.

---

# Desired functionality

The system should eventually do the following:

### Customer flow

1. Customer visits the ticket page.
2. Customer enters:

   * Name
   * Email address
   * Number of tickets
3. System checks available capacity.
4. System creates a reservation automatically.
5. Reservation initially has status `RESERVED`.
6. Customer receives an email confirming the reservation.
7. The email should **NOT contain the ING payment link directly**.
8. Instead, the email contains a private URL to a payment page.
9. The payment page displays the appropriate ING payment link.
10. Customer pays manually through ING.
11. I check the ING business account manually.
12. I manually mark the order as `PAID` in the admin interface.
13. Eventually the system will generate/send the actual ticket(s).

---

# Important payment requirement

I specifically want the **payment links kept on the ticket/payment page rather than in the email**.

The reason is to prevent someone from simply clicking/reusing a payment link without first completing a reservation containing the required customer information.

ING's payment links are reusable and don't provide a useful customer-defined payment reference/description in the way I need.

Therefore the intended flow is:

```text
Customer
   ↓
Reservation form
   ↓
Reservation created
   ↓
Email
   ↓
Private payment-page URL
   ↓
Payment page
   ↓
Correct ING payment link
```

NOT:

```text
Reservation
   ↓
Email containing reusable ING link
```

The private payment URL should contain a random access token, for example:

```text
https://tickets.example.com/payment/HP9-0042/<random-token>
```

The token identifies the reservation/payment page.

The raw ING payment URLs themselves do not need to be treated as cryptographic secrets. The important protection is that customers should not be able to browse other people's reservation/payment pages.

A further consideration is that the ING payment links themselves can potentially be shared. Therefore the system must still rely on manual reconciliation of ING payments before marking an order as paid.

---

# ING payment setup

ING currently offers **Betaalverzoek Zakelijk**, including payment links/QR codes and an API.

I have tested ING payment links.

An example link I provided during the discussion was:

```text
https://www.ing.nl/payreq/m/?trxid=Lon5X22DrWfau6p3bO7DGAbkHpvNmxpZ
```

I may create separate preconfigured ING payment links for different amounts, e.g.:

```text
1 ticket → €10 → ING link A
2 tickets → €20 → ING link B
3 tickets → €30 → ING link C
4 tickets → €40 → ING link D
```

The application can map the quantity/amount to the correct payment link.

For the initial version I do **not** want to integrate the ING API. Manual payment confirmation is sufficient.

Later, if worthwhile, ING's business API could potentially automate payment status.

I do not use the ING mobile app. ING business banking can use an **ING Scanner** for confirmation, so this is not necessarily a blocker.

---

# Reservation states

The basic state machine should be:

```text
RESERVED
   │
   ├──> PAID
   │       │
   │       └──> TICKETS_SENT
   │
   ├──> CANCELLED
   │
   └──> EXPIRED
```

Reservations should expire automatically after a configurable period, e.g. **48 hours**, so unpaid reservations don't permanently consume capacity.

When a reservation expires, its seats become available again.

---

# Capacity

Capacity is exactly:

```text
100 tickets
```

Availability should be calculated from active reservations/orders.

For example:

```text
100
- active RESERVED tickets
- PAID tickets
= available
```

Expired/cancelled orders should not count toward availability.

The backend must perform the capacity check and reservation creation atomically enough to prevent two simultaneous customers from overselling the final seats.

---

# Database

The initial database model proposed was:

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

Eventually there will also be a `tickets` table, something like:

```text
tickets
-------
id
order_id
ticket_code
status
checked_in_at
```

Ticket status will eventually support:

```text
VALID
USED
```

The QR code should contain a random ticket token/code rather than personal information.

---

# Admin functionality

There should eventually be an admin overview page.

It needs authentication/login.

Preferred approach is **Cloudflare Access**, rather than building our own username/password system.

The admin page should show:

* Total capacity
* Number reserved
* Number paid
* Number available
* Number expired
* Number cancelled

And an order table with:

* Order number
* Customer name
* Email
* Quantity
* Amount
* Status
* Created date
* Expiration
* Paid date

Useful actions:

* Mark as paid
* Cancel
* Extend reservation
* Resend email
* Eventually generate/resend tickets

There should be filters:

```text
All
Reserved/Pending
Paid
Expired
Cancelled
```

And search by:

* order number
* name
* email

---

# Email

After creating a reservation, the backend automatically sends an email.

The email should include:

* Customer name
* Order number
* Number of tickets
* Amount
* Reservation expiration
* Private payment page URL

It should **not contain the raw ING payment link**.

For local development, use **Mailpit** so emails can be inspected without sending real mail.

For production, use **Resend**.

Resend's free tier was checked as approximately:

* 3,000 emails/month
* 100 emails/day

which should be more than sufficient for this small concert.

---

# Hosting architecture

Current preferred architecture:

```text
                    ┌─────────────────────┐
                    │   WordPress.com     │
                    │   existing website  │
                    └──────────┬──────────┘
                               │
                         Buy tickets
                               │
                               ▼
                    ┌─────────────────────┐
                    │    GitHub Pages     │
                    │ Vite + TypeScript   │
                    └──────────┬──────────┘
                               │
                              API
                               │
                               ▼
                    ┌─────────────────────┐
                    │ Cloudflare Worker   │
                    │    TypeScript       │
                    └──────────┬──────────┘
                               │
                         ┌─────┴─────┐
                         ▼           ▼
                    Cloudflare     Resend
                       D1          email
                         │
                         ▼
                      Orders
```

Payment remains separate:

```text
Customer
   ↓
Private payment page
   ↓
ING Betaalverzoek
   ↓
ING business account
   ↓
Manual admin confirmation
```

---

# Cloudflare

The production backend is planned to use:

* Cloudflare Workers
* Cloudflare D1

Cloudflare's free tier should be more than sufficient for a 100-ticket concert.

The database schema should therefore be designed to work both with local SQLite and Cloudflare D1.

---

# Local development / Docker

I specifically asked whether we could create a **Docker Compose test stack**.

The answer was yes, and this is strongly preferred.

The intended local stack is:

```text
Docker Compose
├── frontend
│   └── Vite + TypeScript
│
├── worker/backend
│   └── TypeScript
│
├── SQLite
│   └── local ticket database
│
└── Mailpit
    └── local fake email server/inbox
```

The goal is to be able to run:

```bash
docker compose up
```

and then access something like:

```text
Frontend:
http://localhost:5173

Backend:
http://localhost:8787

Mailpit:
http://localhost:8025
```

No Node.js installation should ideally be necessary on the host if Docker is used.

---

# Local test flow

The first vertical slice should support:

1. Start Docker Compose.
2. Open `http://localhost:5173`.
3. Fill in name/email/quantity.
4. Submit reservation.
5. Backend checks availability.
6. Backend creates a `RESERVED` order.
7. Order is stored in SQLite.
8. Email is sent to Mailpit.
9. Open Mailpit at `http://localhost:8025`.
10. Inspect the email.
11. Verify the email contains a private payment-page URL.
12. Verify it does **not** contain an ING payment link.

The next steps would then be:

* Payment page
* Admin page
* Admin authentication
* Mark as paid
* Reservation expiry
* Real ING links
* Real production email
* Deployment to Cloudflare/GitHub Pages
* QR ticket generation
* Check-in system

---

# Proposed repository

The initial repository structure:

```text
concert-tickets/
├── apps/
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   └── api/
│   │   └── package.json
│   │
│   └── worker/
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── db/
│       │   └── index.ts
│       └── package.json
│
├── migrations/
│   └── 001_initial.sql
│
├── docker-compose.yml
├── package.json
└── README.md
```

---

# Technology decisions

Current preferred choices:

| Component            | Technology                 |
| -------------------- | -------------------------- |
| Public frontend      | Vite + TypeScript          |
| Backend              | TypeScript                 |
| Production backend   | Cloudflare Worker          |
| Production DB        | Cloudflare D1              |
| Local DB             | SQLite                     |
| Local email          | Mailpit                    |
| Production email     | Resend                     |
| Public hosting       | GitHub Pages               |
| Admin authentication | Cloudflare Access          |
| Payment              | ING Betaalverzoek Zakelijk |
| Testing              | Vitest, later Playwright   |
| Local orchestration  | Docker Compose             |

Angular is intentionally not being used initially because this is a relatively small application and Vite + TypeScript should be simpler.

Kotlin/Java is also not being used initially because it would introduce a second backend language/runtime without providing much benefit for this project.

---

# Development approach

We decided **not to build everything at once**.

Instead, build small working vertical slices:

### Phase 1

Local reservation system:

```text
Frontend
→ API
→ SQLite
→ Mailpit
```

### Phase 2

Private payment page:

```text
Reservation
→ email
→ private payment URL
→ correct ING payment link
```

### Phase 3

Admin:

```text
Admin login
→ order overview
→ mark paid
→ cancel
→ extend
```

### Phase 4

Production:

```text
GitHub Pages
+
Cloudflare Worker
+
D1
+
Resend
+
real ING links
```

### Phase 5

Tickets:

```text
PAID
→ generate ticket
→ email QR ticket
→ scan
→ mark USED
```

---

# Important design consideration

The payment links should preferably **not be hard-coded into the public GitHub Pages HTML**, even though the conceptual requirement is that the customer sees them on the GitHub-hosted payment page.

A better design is:

```text
GitHub Pages
    ↓
private payment page request
    ↓
Cloudflare Worker
    ↓
lookup reservation
    ↓
determine amount
    ↓
return corresponding ING payment URL
```

The ING URLs can then be stored as backend environment/configuration values.

This prevents someone browsing the GitHub repository/source and immediately finding all payment URLs.

The reservation access token is the actual authorization mechanism.

---

# Current immediate task

The next task is to create the **first runnable project**.

Please generate a complete starter repository containing:

* `docker-compose.yml`
* Vite + TypeScript frontend
* TypeScript backend suitable for later migration to Cloudflare Workers
* SQLite database
* Initial SQL schema
* Mailpit
* Reservation API
* Reservation form
* Capacity checking
* 48-hour reservation expiration
* Email generation
* README with setup instructions
* `.gitignore`
* Basic automated tests where practical

The first version does **not** need:

* Real ING integration
* Admin login
* Admin UI
* QR codes
* Production deployment
* Real email provider

Keep the implementation simple and understandable. We will build the system incrementally and test each step before adding the next feature.
