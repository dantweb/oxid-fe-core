export interface ThemeConfigOptions {
  /** Custom-property prefixes a token name may start with. Default `['--oxfe-']`. */
  tokenPrefixes?: readonly string[];
}

export interface BuildThemesOptions extends ThemeConfigOptions {
  srcDir: string;
  outDir: string;
  /** Build only this theme (all themes are still validated). */
  only?: string | null;
}

export const DEFAULT_TOKEN_PREFIXES: readonly string[];

/** Compiles `<srcDir>/<id>` into `<outDir>/<id>`; rejects with one Error listing every problem. */
export function buildThemes(options: BuildThemesOptions): Promise<{ built: string[] }>;

/** Merges theme source directories (a later one wins on a name clash); returns `stagingDir`. */
export function stageThemeSources(srcDirs: readonly string[], stagingDir: string): string;

/** Problems with one theme's config.json (empty = valid). */
export function validateThemeConfig(
  config: unknown,
  folderName: string,
  imageFiles?: readonly string[],
  options?: ThemeConfigOptions,
): string[];

/** Unknown parents and cycles across all themes. */
export function validateParentChains(
  configs: ReadonlyArray<{ id: string; parent?: string | null }>,
): string[];
