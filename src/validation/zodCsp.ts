import { z } from 'zod';

/**
 * Switches zod 4 to interpreted parsing. Zod otherwise compiles object parsers with `new Function`, which a
 * Content-Security-Policy without 'unsafe-eval' (or with Trusted Types) refuses and reports as a violation.
 *
 * Core does not call this itself: zod's config is global, and a library must not change it for its host.
 * A host under such a CSP calls it as the FIRST import of its entry point, because zod decides when a schema
 * is created, and schemas are created while modules load.
 */
export function configureZodForCsp(): void {
  z.config({ jitless: true });
}
