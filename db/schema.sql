CREATE TABLE IF NOT EXISTS orders (
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

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    ticket_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'VALID',
    created_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id)
);
