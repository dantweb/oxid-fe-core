const pending = new Map<string, Promise<void>>();

/**
 * Loads a provider SDK (Stripe.js, PayPal's JS SDK, Mollie.js) exactly once per page, however many
 * components ask. Resolves when the script has loaded; a failed load can be retried.
 */
export function loadScriptOnce(
  url: string,
  attributes: Record<string, string> = {},
  doc: Document = document,
): Promise<void> {
  const known = pending.get(url);
  if (known) {
    return known;
  }
  const promise = new Promise<void>((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = url;
    script.async = true;
    for (const [name, value] of Object.entries(attributes)) {
      script.setAttribute(name, value);
    }
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        pending.delete(url);
        script.remove();
        reject(new Error(`could not load ${url}`));
      },
      { once: true },
    );
    doc.head.appendChild(script);
  });
  pending.set(url, promise);
  return promise;
}
