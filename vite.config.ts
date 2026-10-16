import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'OxidFeCore',
      fileName: 'oxid-fe-core',
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
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
