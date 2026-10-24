import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      // `zod-csp` is its own entry: a host must configure zod before any schema exists, and importing the
      // main entry creates core's schemas
      entry: { 'oxid-fe-core': 'src/index.ts', 'zod-csp': 'src/validation/zodCsp.ts' },
      fileName: (_format: string, entryName: string) => `${entryName}.js`,
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue', 'vue-router', 'pinia', 'zod'],
    },
  },
  test: {
    environment: 'happy-dom',
    // unit tests never touch the network: <link>/<script> elements must not be fetched
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'theme-tools/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 90 },
    },
  },
});
