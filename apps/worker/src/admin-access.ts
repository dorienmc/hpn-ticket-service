export const adminOwnerEmail = 'dorienmc@gmail.com';

export function normalizeAllowedAdminEmails(emails: unknown): string[] {
  if (!Array.isArray(emails) || !emails.every((email): email is string => typeof email === 'string')) {
    throw new Error('Invalid stored admin email allowlist');
  }
  return [...new Set([adminOwnerEmail, ...emails.map((email) => email.trim().toLowerCase())])];
}

export function validateAdminEmails(body: unknown): { emails: string[] } | { error: string } {
  if (!body || typeof body !== 'object' || !('emails' in body)
    || !Array.isArray(body.emails) || body.emails.length > 100
    || !body.emails.every((email): email is string => typeof email === 'string')) {
    return { error: 'Provide an array of at most 100 email addresses' };
  }
  const emails = [...new Set(body.emails.map((email) => email.trim().toLowerCase()))];
  if (!emails.length || emails.some((email) => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: 'Provide valid email addresses; the allowlist cannot be empty' };
  }
  if (!emails.includes(adminOwnerEmail)) {
    return { error: 'The owner email cannot be removed' };
  }
  return { emails };
}
