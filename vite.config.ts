import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ rollupTypes: true, tsconfigPath: './tsconfig.json' })],
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
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
