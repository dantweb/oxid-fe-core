/**
 * Pure validation helpers for <themes>/<id>/config.json (unit-tested).
 * A host app names the token prefixes its themes may set; core's contract is `--oxfe-`.
 */

export const DEFAULT_TOKEN_PREFIXES = ['--oxfe-'];

/**
 * Problems with one theme's config.json, as human-readable strings (empty = valid).
 * `options.tokenPrefixes`: the custom-property prefixes a token name may start with.
 */
export function validateThemeConfig(
  config,
  folderName,
  imageFiles = [],
  { tokenPrefixes = DEFAULT_TOKEN_PREFIXES } = {},
) {
  const problems = [];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [`${folderName}: config.json must be a JSON object`];
  }
  if (config.id !== folderName) {
    problems.push(
      `${folderName}: "id" is ${JSON.stringify(config.id)} but the folder is "${folderName}"`,
    );
  }
  if (typeof config.name !== 'string' || config.name === '') {
    problems.push(`${folderName}: "name" is required`);
  }
  if (config.parent !== undefined && config.parent !== null) {
    if (typeof config.parent !== 'string' || config.parent === '') {
      problems.push(`${folderName}: "parent" must be a theme id or null`);
    } else if (config.parent === folderName) {
      problems.push(`${folderName}: a theme cannot be its own parent`);
    }
  }
  for (const [property, value] of Object.entries(config.tokens ?? {})) {
    if (!tokenPrefixes.some((prefix) => property.startsWith(prefix))) {
      const allowed = tokenPrefixes.map((prefix) => `"${prefix}"`).join(' or ');
      problems.push(`${folderName}: token "${property}" must start with ${allowed}`);
    }
    if (typeof value !== 'string') {
      problems.push(`${folderName}: token "${property}" must be a string`);
    }
  }
  for (const [name, file] of Object.entries(config.images ?? {})) {
    if (typeof file !== 'string' || !imageFiles.includes(file)) {
      problems.push(`${folderName}: image "${name}" points to missing file "${file}" in images/`);
    }
  }
  return problems;
}

/** Parent problems across all themes: unknown parents and cycles. */
export function validateParentChains(configs) {
  const problems = [];
  const ids = new Set(configs.map((config) => config.id));
  for (const config of configs) {
    if (config.parent && !ids.has(config.parent)) {
      problems.push(`${config.id}: parent "${config.parent}" does not exist`);
      continue;
    }
    const seen = new Set([config.id]);
    let current = config.parent;
    while (current) {
      if (seen.has(current)) {
        problems.push(`${config.id}: parent chain is cyclic (${[...seen, current].join(' -> ')})`);
        break;
      }
      seen.add(current);
      current = configs.find((entry) => entry.id === current)?.parent;
    }
  }
  return problems;
}
