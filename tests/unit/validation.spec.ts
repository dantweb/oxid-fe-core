import { describe, expect, it } from 'vitest';
import { addressSchema } from '../../src/validation/address';
import { formatPrice } from '../../src/utils/price';

describe('addressSchema', () => {
  const valid = {
    firstName: 'Daniil',
    lastName: 'Tkachev',
    street: 'Bertoldstraße',
    streetNumber: '48',
    zipCode: '79098',
    city: 'Freiburg',
    countryId: 'a7c40f631fc920687.20179984',
  };

  it('accepts a complete address', () => {
    expect(addressSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing required fields and reports the field', () => {
    const result = addressSchema.safeParse({ ...valid, city: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['city']);
    }
  });
});

describe('formatPrice', () => {
  it('formats with the ISO currency from the storefront Currency type', () => {
    expect(formatPrice(29.9, 'EUR', 'de-DE')).toContain('29,90');
    expect(formatPrice(29.9, 'EUR', 'de-DE')).toContain('€');
  });

  it('falls back for unknown currency codes', () => {
    expect(formatPrice(5, 'NOPE')).toBe('5.00 NOPE');
  });
});
