import { describe, it, expect } from 'vitest';
import { loginSchema, registerSchema, customerSchema, reviewSchema } from '../schemas';

describe('form schemas (frontend validation, UX only)', () => {
  it('rejects an invalid login email', () => {
    const r = loginSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(/valid email/i);
  });

  it('enforces password strength and confirmation on registration', () => {
    const base = { name: 'Asha Rao', email: 'asha@example.com' };
    expect(registerSchema.safeParse({ ...base, password: 'weak', confirmPassword: 'weak' }).success).toBe(false);
    const mismatch = registerSchema.safeParse({ ...base, password: 'Strong123', confirmPassword: 'Strong124' });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error.issues.some((i) => i.path[0] === 'confirmPassword')).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: 'Strong123', confirmPassword: 'Strong123' }).success).toBe(true);
  });

  it('does not allow a role field to be set through registration', () => {
    const r = registerSchema.safeParse({ name: 'Mallory', email: 'm@example.com', password: 'Strong123', confirmPassword: 'Strong123', role: 'admin' });
    expect(r.success).toBe(true);
    expect(r.data.role).toBeUndefined();
  });

  it('requires the GSTIN prefix to match the selected state', () => {
    const ok = customerSchema.safeParse({ name: 'Demo Traders', stateCode: '03', gstin: '03ABCDE1234F1Z5' });
    const bad = customerSchema.safeParse({ name: 'Demo Traders', stateCode: '27', gstin: '03ABCDE1234F1Z5' });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it('requires a documented reason when resolving or marking a false positive', () => {
    expect(reviewSchema.safeParse({ reviewStatus: 'Resolved' }).success).toBe(false);
    expect(reviewSchema.safeParse({ reviewStatus: 'False Positive', resolutionNotes: '' }).success).toBe(false);
    expect(reviewSchema.safeParse({ reviewStatus: 'Resolved', resolutionNotes: 'Verified with customer' }).success).toBe(true);
    expect(reviewSchema.safeParse({ reviewStatus: 'Under Review' }).success).toBe(true);
  });
});
