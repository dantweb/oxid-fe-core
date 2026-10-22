#!/usr/bin/env node
/**
 * oxfe-build-themes --src=<themes dir> --out=<output dir> [--theme=<id>] [--watch]
 *                   [--token-prefixes=--oxfe-,--oxadm-]
 * Compiles <src>/<id> into <out>/<id> (served at /themes/<id>/…). Exit 1 on a theme problem,
 * 2 on a usage error.
 */
import { watch } from 'node:fs';
import { buildThemes } from './theme-build.mjs';
import { DEFAULT_TOKEN_PREFIXES } from './theme-lib.mjs';

const WATCH_DEBOUNCE_MS = 200;

function option(args, name) {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

const args = process.argv.slice(2);
const srcDir = option(args, 'src');
const outDir = option(args, 'out');
if (!srcDir || !outDir) {
  console.error(
    'usage: oxfe-build-themes --src=<dir> --out=<dir> [--theme=<id>] [--watch] [--token-prefixes=a,b]',
  );
  process.exit(2);
}
const only = option(args, 'theme');
const tokenPrefixes = option(args, 'token-prefixes')?.split(',') ?? DEFAULT_TOKEN_PREFIXES;

async function run() {
  try {
    const { built } = await buildThemes({ srcDir, outDir, only, tokenPrefixes });
    console.log(`themes: built ${built.join(', ')} -> ${outDir}`);
    return true;
  } catch (error) {
    console.error(error.message);
    return false;
  }
}

const ok = await run();
if (!args.includes('--watch')) {
  process.exit(ok ? 0 : 1);
}

console.log(`themes: watching ${srcDir} …`);
let timer;
watch(srcDir, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(run, WATCH_DEBOUNCE_MS);
});
