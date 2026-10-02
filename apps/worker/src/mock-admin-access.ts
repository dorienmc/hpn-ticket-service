import { config } from './config.js';
import { getDb } from './db.js';
import { adminOwnerEmail, normalizeAllowedAdminEmails } from './admin-access.js';

export function allowedMockAdminEmails(): string[] {
  const row = getDb().prepare('SELECT emails FROM admin_access_settings WHERE id = 1').get() as { emails: string } | undefined;
  return normalizeAllowedAdminEmails(row ? JSON.parse(row.emails) : config.adminAllowedEmails);
}

export function saveMockAdminEmails(emails: string[]): void {
  const db = getDb();
  const serialized = JSON.stringify(emails);
  db.transaction(() => {
    db.prepare('INSERT INTO admin_access_settings (id, emails) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET emails = excluded.emails')
      .run(serialized);
    db.prepare('INSERT INTO admin_access_audit (actor_email, emails, created_at) VALUES (?, ?, ?)')
      .run(adminOwnerEmail, serialized, new Date().toISOString());
  })();
}
