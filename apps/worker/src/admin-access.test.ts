import { describe, expect, it } from 'vitest';
import { adminOwnerEmail, normalizeAllowedAdminEmails, validateAdminEmails } from './admin-access.js';

describe('Admin email policy', () => {
  it('normalizes and deduplicates emails while preserving the owner', () => {
    expect(normalizeAllowedAdminEmails([' ADMIN@Example.com ', adminOwnerEmail, 'admin@example.com']))
      .toEqual([adminOwnerEmail, 'admin@example.com']);
    expect(normalizeAllowedAdminEmails([])).toEqual([adminOwnerEmail]);
    expect(validateAdminEmails({ emails: [adminOwnerEmail, ' ADMIN@Example.com ', 'admin@example.com'] }))
      .toEqual({ emails: [adminOwnerEmail, 'admin@example.com'] });
  });

  it.each([
    null, {}, { emails: [] }, { emails: 'not-an-array' }, { emails: [42] },
    { emails: ['someone@example.com'] }, { emails: [adminOwnerEmail, 'invalid'] },
    { emails: [adminOwnerEmail, 'a@b\n.example'] },
    { emails: [adminOwnerEmail, `${'a'.repeat(255)}@example.com`] },
    { emails: Array(101).fill(adminOwnerEmail) },
  ])('rejects invalid access updates: %j', (body) => {
    expect(validateAdminEmails(body)).toHaveProperty('error');
  });

  it('accepts the maximum list size and rejects invalid stored data', () => {
    const emails = [adminOwnerEmail, ...Array.from({ length: 99 }, (_, index) => `admin${index}@example.com`)];
    expect(validateAdminEmails({ emails })).toEqual({ emails });
    expect(() => normalizeAllowedAdminEmails({})).toThrow('Invalid stored admin email allowlist');
    expect(() => normalizeAllowedAdminEmails([42])).toThrow('Invalid stored admin email allowlist');
  });
});
