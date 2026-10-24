import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildThemes,
  stageThemeSources,
  validateParentChains,
  validateThemeConfig,
} from '../../theme-tools/index.mjs';

describe('validateThemeConfig', () => {
  const valid = { id: 'x', name: 'X', parent: null, tokens: { '--oxfe-color-primary': '#fff' } };

  it('accepts a valid config', () => {
    expect(validateThemeConfig(valid, 'x')).toEqual([]);
  });

  it('reports id/folder mismatch, missing name, foreign token prefix and self-parent', () => {
    const problems: string[] = validateThemeConfig(
      { id: 'y', tokens: { '--other-thing': 'red' }, parent: 'x' },
      'x',
    );
    expect(problems.join('\n')).toContain('"id" is "y" but the folder is "x"');
    expect(problems.join('\n')).toContain('"name" is required');
    expect(problems.join('\n')).toContain('token "--other-thing" must start with "--oxfe-"');
    expect(problems.join('\n')).toContain('cannot be its own parent');
  });

  it('reports images that do not exist in images/', () => {
    const problems: string[] = validateThemeConfig(
      { ...valid, images: { logo: 'nope.png', hero: 'hero.jpg' } },
      'x',
      ['hero.jpg'],
    );
    expect(problems).toEqual(['x: image "logo" points to missing file "nope.png" in images/']);
  });
});

describe('validateThemeConfig token prefixes', () => {
  const config = {
    id: 'x',
    name: 'X',
    tokens: { '--oxfe-color-primary': '#fff', '--oxadm-sidebar-bg': '#000' },
  };

  it('accepts only --oxfe- by default', () => {
    expect(validateThemeConfig(config, 'x')).toEqual([
      'x: token "--oxadm-sidebar-bg" must start with "--oxfe-"',
    ]);
  });

  it('accepts every configured prefix and nothing else', () => {
    const options = { tokenPrefixes: ['--oxfe-', '--oxadm-'] };
    expect(validateThemeConfig(config, 'x', [], options)).toEqual([]);
    const problems = validateThemeConfig(
      { ...config, tokens: { '--evil-x': 'red' } },
      'x',
      [],
      options,
    );
    expect(problems).toEqual(['x: token "--evil-x" must start with "--oxfe-" or "--oxadm-"']);
  });
});

describe('validateParentChains', () => {
  it('reports unknown parents and cycles', () => {
    expect(validateParentChains([{ id: 'a', parent: 'ghost' }])).toEqual([
      'a: parent "ghost" does not exist',
    ]);
    const cyclic: string[] = validateParentChains([
      { id: 'a', parent: 'b' },
      { id: 'b', parent: 'a' },
    ]);
    expect(cyclic.join('\n')).toContain('cyclic');
  });

  it('accepts a proper parent chain', () => {
    expect(
      validateParentChains([
        { id: 'default', parent: null },
        { id: 'dark', parent: 'default' },
      ]),
    ).toEqual([]);
  });
});

describe('buildThemes', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oxfe-themes-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function theme(id: string, config: object, less: string, images: string[] = []): void {
    const dir = join(root, 'src', id);
    mkdirSync(join(dir, 'styles'), { recursive: true });
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    writeFileSync(join(dir, 'styles', 'styles.less'), less);
    for (const image of images) {
      writeFileSync(join(dir, 'images', image), 'binary-ish');
    }
  }

  const srcDir = (): string => join(root, 'src');
  const outDir = (): string => join(root, 'out');

  it('compiles LESS, copies config and images (jpg, png, gif), keeps the folder layout', async () => {
    theme(
      'default',
      { id: 'default', name: 'D', images: { logo: 'logo.png' } },
      '@c: #112233; :root { --oxfe-color-primary: @c; } .hero { background: url("../images/a.jpg"); }',
      ['logo.png', 'a.jpg', 'spin.gif'],
    );

    const { built } = await buildThemes({ srcDir: srcDir(), outDir: outDir() });

    expect(built).toEqual(['default']);
    const css = readFileSync(join(outDir(), 'default/styles/styles.css'), 'utf-8');
    expect(css).toContain('--oxfe-color-primary: #112233');
    expect(css).toContain('url("../images/a.jpg")');
    for (const file of ['config.json', 'images/logo.png', 'images/a.jpg', 'images/spin.gif']) {
      expect(existsSync(join(outDir(), 'default', file)), file).toBe(true);
    }
  });

  it('a child theme overrides parent LESS variables and rewrites the parent’s image urls', async () => {
    theme(
      'default',
      { id: 'default', name: 'D' },
      '@bg: #ffffff; body { background: @bg; } .hero { background: url("../images/hero.jpg"); }',
      ['hero.jpg'],
    );
    theme(
      'dark',
      { id: 'dark', name: 'Dark', parent: 'default' },
      '@import "../../default/styles/styles.less"; @bg: #000000;',
    );

    await buildThemes({ srcDir: srcDir(), outDir: outDir() });

    const css = readFileSync(join(outDir(), 'dark/styles/styles.css'), 'utf-8');
    expect(css).toContain('background: #000000');
    expect(css).toContain('url("../../default/images/hero.jpg")');
  });

  it('copies a theme’s fonts/ next to its styles, so url("../fonts/…") resolves', async () => {
    theme('default', { id: 'default', name: 'D' }, '@font-face { src: url("../fonts/a.woff2"); }');
    mkdirSync(join(srcDir(), 'default', 'fonts'));
    writeFileSync(join(srcDir(), 'default', 'fonts', 'a.woff2'), 'font');

    await buildThemes({ srcDir: srcDir(), outDir: outDir() });

    expect(existsSync(join(outDir(), 'default/fonts/a.woff2'))).toBe(true);
    expect(readFileSync(join(outDir(), 'default/styles/styles.css'), 'utf-8')).toContain(
      'url("../fonts/a.woff2")',
    );
  });

  it('stageThemeSources merges base and project themes; a project theme can import its base parent', async () => {
    theme('default', { id: 'default', name: 'D' }, '@bg: #fff; body { background: @bg; }');
    const project = join(root, 'project');
    mkdirSync(join(project, 'brand', 'styles'), { recursive: true });
    writeFileSync(
      join(project, 'brand', 'config.json'),
      JSON.stringify({ id: 'brand', name: 'B', parent: 'default' }),
    );
    writeFileSync(
      join(project, 'brand', 'styles', 'styles.less'),
      '@import "../../default/styles/styles.less"; @bg: #123456;',
    );

    const staged = stageThemeSources([srcDir(), project], join(root, 'staged'));
    const { built } = await buildThemes({ srcDir: staged, outDir: outDir() });

    expect(built).toEqual(['brand', 'default']);
    expect(readFileSync(join(outDir(), 'brand/styles/styles.css'), 'utf-8')).toContain(
      'background: #123456',
    );
  });

  it('builds a single theme with `only`', async () => {
    theme('default', { id: 'default', name: 'D' }, 'a{b:c}');
    theme('other', { id: 'other', name: 'O' }, 'a{b:c}');

    const { built } = await buildThemes({ srcDir: srcDir(), outDir: outDir(), only: 'other' });

    expect(built).toEqual(['other']);
    expect(existsSync(join(outDir(), 'default'))).toBe(false);
  });

  it('fails with every problem listed, building nothing', async () => {
    theme('default', { id: 'wrong', name: 'D' }, 'a{b:c}');
    theme('child', { id: 'child', name: 'C', parent: 'ghost' }, 'a{b:c}');

    await expect(buildThemes({ srcDir: srcDir(), outDir: outDir() })).rejects.toThrow(
      /"id" is "wrong"[\s\S]*parent "ghost" does not exist/,
    );
    expect(existsSync(outDir())).toBe(false);
  });

  it('reports a LESS compile error with the theme name', async () => {
    theme('default', { id: 'default', name: 'D' }, '.broken { color: @undefined-variable; }');

    await expect(buildThemes({ srcDir: srcDir(), outDir: outDir() })).rejects.toThrow(
      /default: LESS compile failed/,
    );
  });
});

describe('buildThemes token prefixes', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oxfe-themes-prefix-'));
    mkdirSync(join(root, 'src', 'default'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'default', 'config.json'),
      JSON.stringify({ id: 'default', name: 'D', tokens: { '--oxadm-sidebar-bg': '#000' } }),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('rejects a foreign-prefix token unless the host allows its prefix', async () => {
    const options = { srcDir: join(root, 'src'), outDir: join(root, 'out') };
    await expect(buildThemes(options)).rejects.toThrow(/must start with "--oxfe-"/);
    const { built } = await buildThemes({
      ...options,
      tokenPrefixes: ['--oxfe-', '--oxadm-'],
    });
    expect(built).toEqual(['default']);
  });
});

const CLI_PATH = resolve(__dirname, '../../theme-tools/cli.mjs');

describe('theme-tools CLI', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oxfe-themes-cli-'));
    mkdirSync(join(root, 'src', 'default', 'styles'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'default', 'config.json'),
      JSON.stringify({ id: 'default', name: 'D', tokens: { '--oxadm-sidebar-bg': '#000' } }),
    );
    writeFileSync(join(root, 'src', 'default', 'styles', 'styles.less'), 'a { b: c }');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [CLI_PATH, ...args], {
      cwd: root,
      encoding: 'utf-8',
    });

  it('builds with --src, --out and --token-prefixes', () => {
    const result = cli('--src=src', '--out=out', '--token-prefixes=--oxfe-,--oxadm-');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('themes: built default -> out');
    expect(existsSync(join(root, 'out/default/styles/styles.css'))).toBe(true);
  });

  it('exits 1 with the problems on stderr', () => {
    const result = cli('--src=src', '--out=out');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must start with "--oxfe-"');
  });

  it('exits 2 without --src or --out', () => {
    expect(cli().status).toBe(2);
  });
});
