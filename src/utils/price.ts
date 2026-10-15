/**
 * Formats a storefront price with its currency (Currency.name is the ISO
 * code, e.g. "EUR"). Falls back to a plain fixed-decimal string when the
 * code is unknown to Intl.
 */
export function formatPrice(value: number, currencyName: string, locale = 'de-DE'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyName,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyName}`;
  }
}
