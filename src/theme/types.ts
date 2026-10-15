import { z } from 'zod';

/**
 * A theme's main configuration (`resources/themes/<id>/config.json`). `tokens` has the shape of
 * vbwd's `ThemePreset.colors`: CSS custom properties applied on `:root`.
 */
export const themeConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  parent: z.string().min(1).nullable().optional(),
  tokens: z.record(z.string()).default({}),
  /** logical name → file inside the theme's images/ folder */
  images: z.record(z.string()).default({}),
});

export type ThemeConfig = z.infer<typeof themeConfigSchema>;

/** A theme with its parent chain merged and image names resolved to URLs. */
export interface ResolvedTheme {
  /** the theme that was actually loaded (active, or the fallback) */
  id: string;
  name: string;
  tokens: Record<string, string>;
  /** logical image name → URL */
  images: Record<string, string>;
  stylesheetUrl: string;
}
