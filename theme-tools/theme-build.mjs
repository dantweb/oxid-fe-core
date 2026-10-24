/**
 * Compiles <srcDir>/<id>/ into <outDir>/<id>/ :
 *   config.json            copied
 *   styles/styles.css      compiled from styles/styles.less (LESS)
 *   images/*               copied (jpg, png, gif, …)
 *   fonts/*                copied (woff2, … — referenced from the LESS as url('../fonts/…'))
 * Layout is preserved, so relative url("../images/…") in the LESS works in the output too.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import less from 'less';
import { DEFAULT_TOKEN_PREFIXES, validateParentChains, validateThemeConfig } from './theme-lib.mjs';

function listThemeFolders(srcDir) {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Merges theme source directories into one staging directory (a later directory wins on a name
 * clash), so a project's themes can name a theme of the base package as their `parent` and
 * `@import` its LESS. Returns the staging directory.
 */
export function stageThemeSources(srcDirs, stagingDir) {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  for (const dir of srcDirs) {
    for (const folder of listThemeFolders(dir)) {
      rmSync(join(stagingDir, folder), { recursive: true, force: true });
      cpSync(join(dir, folder), join(stagingDir, folder), { recursive: true });
    }
  }
  return stagingDir;
}

/**
 * Returns { built: string[] }; throws one Error listing every problem found.
 * `tokenPrefixes` are the custom-property prefixes the themes' tokens may use.
 */
export async function buildThemes({
  srcDir,
  outDir,
  only = null,
  tokenPrefixes = DEFAULT_TOKEN_PREFIXES,
}) {
  const folders = listThemeFolders(srcDir);
  const configs = [];
  const problems = [];

  for (const folder of folders) {
    const configPath = join(srcDir, folder, 'config.json');
    if (!existsSync(configPath)) {
      problems.push(`${folder}: config.json is missing`);
      continue;
    }
    let config;
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (cause) {
      problems.push(`${folder}: config.json is not valid JSON (${cause.message})`);
      continue;
    }
    const imagesDir = join(srcDir, folder, 'images');
    const imageFiles = existsSync(imagesDir) ? readdirSync(imagesDir) : [];
    problems.push(...validateThemeConfig(config, folder, imageFiles, { tokenPrefixes }));
    configs.push(config);
  }
  problems.push(...validateParentChains(configs));
  if (only && !folders.includes(only)) {
    problems.push(`theme "${only}" does not exist in ${srcDir}`);
  }
  if (problems.length > 0) {
    throw new Error(`Theme configuration problems:\n- ${problems.join('\n- ')}`);
  }

  const built = [];
  for (const folder of only ? [only] : folders) {
    const target = join(outDir, folder);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(join(target, 'styles'), { recursive: true });

    cpSync(join(srcDir, folder, 'config.json'), join(target, 'config.json'));
    for (const assets of ['images', 'fonts']) {
      if (existsSync(join(srcDir, folder, assets))) {
        cpSync(join(srcDir, folder, assets), join(target, assets), { recursive: true });
      }
    }

    const lessFile = join(srcDir, folder, 'styles', 'styles.less');
    if (existsSync(lessFile)) {
      try {
        const output = await less.render(readFileSync(lessFile, 'utf-8'), {
          filename: lessFile,
          // a child theme's imported parent keeps working: urls are rewritten relative to the entry file
          rewriteUrls: 'all',
        });
        writeFileSync(join(target, 'styles', 'styles.css'), output.css);
      } catch (cause) {
        throw new Error(
          `${folder}: LESS compile failed — ${cause.message} (${cause.filename ?? lessFile}:${cause.line ?? '?'})`,
        );
      }
    }
    built.push(folder);
  }
  return { built };
}
