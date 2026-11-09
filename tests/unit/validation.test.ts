import { describe, expect, it } from 'vitest';
import {
  normalizeOmanPhone,
  omanPhoneSchema,
  registerSchema,
  safeRedirectPath,
  omanCoordinatesSchema,
  fieldErrorsOf,
  formDataToObject,
} from '@/lib/validation';

describe('Omani phone numbers', () => {
  it('normalises common formats to E.164', () => {
    expect(normalizeOmanPhone('91234567')).toBe('+96891234567');
    expect(normalizeOmanPhone('+968 9123 4567')).toBe('+96891234567');
    expect(normalizeOmanPhone('00968-7123-4567')).toBe('+96871234567');
    expect(normalizeOmanPhone('968 2412 3456')).toBe('+96824123456');
    expect(normalizeOmanPhone('٩١٢٣٤٥٦٧')).toBe('+96891234567');
  });

  it('rejects wrong lengths and prefixes', () => {
    expect(normalizeOmanPhone('9123456')).toBeNull();
    expect(normalizeOmanPhone('912345678')).toBeNull();
    expect(normalizeOmanPhone('51234567')).toBeNull();
    expect(normalizeOmanPhone('+971501234567')).toBeNull();
  });

  it('schema returns an i18n code', () => {
    const r = omanPhoneSchema.safeParse('123');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('phone_invalid');
  });
});

describe('registerSchema', () => {
  const valid = {
    fullName: 'Salim Al Harthy',
    email: 'Salim@Example.COM ',
    phone: '9123 4567',
    password: 'StrongPass123',
    confirmPassword: 'StrongPass123',
    acceptTerms: true,
  };

  it('accepts and normalises valid input', () => {
    const r = registerSchema.parse(valid);
    expect(r.email).toBe('salim@example.com');
    expect(r.phone).toBe('+96891234567');
    expect(r.locale).toBe('ar');
  });

  it('reports field codes', () => {
    const r = registerSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'other', acceptTerms: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fe = fieldErrorsOf(r.error);
      expect(fe.password).toContain('password_too_short');
      expect(fe.acceptTerms).toContain('terms_required');
    }
  });

  it('requires matching passwords', () => {
    const r = registerSchema.safeParse({ ...valid, confirmPassword: 'StrongPass124' });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrorsOf(r.error).confirmPassword).toContain('password_mismatch');
  });
});

describe('misc schemas', () => {
  it('safeRedirectPath blocks open redirects', () => {
    expect(safeRedirectPath('/account', '/')).toBe('/account');
    expect(safeRedirectPath('//evil.com', '/')).toBe('/');
    expect(safeRedirectPath('https://evil.com', '/')).toBe('/');
    expect(safeRedirectPath('/\\evil.com', '/')).toBe('/');
    expect(safeRedirectPath(undefined, '/x')).toBe('/x');
  });

  it('coordinates must be inside the Oman bounding box (coarse check)', () => {
    expect(omanCoordinatesSchema.safeParse({ lat: 23.588, lng: 58.3829 }).success).toBe(true); // Muscat
    expect(omanCoordinatesSchema.safeParse({ lat: 17.0151, lng: 54.0924 }).success).toBe(true); // Salalah
    expect(omanCoordinatesSchema.safeParse({ lat: 24.7136, lng: 46.6753 }).success).toBe(false); // Riyadh
    expect(omanCoordinatesSchema.safeParse({ lat: 48.85, lng: 2.35 }).success).toBe(false); // Paris
  });

  it('formDataToObject maps checkboxes and repeated keys', () => {
    const fd = new FormData();
    fd.append('a', '1');
    fd.append('terms', 'on');
    fd.append('tag', 'x');
    fd.append('tag', 'y');
    expect(formDataToObject(fd)).toEqual({ a: '1', terms: true, tag: ['x', 'y'] });
  });
});
