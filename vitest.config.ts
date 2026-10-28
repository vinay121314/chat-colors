import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { pretendToBeVisual: true } }, // gives requestAnimationFrame
    setupFiles: ['tests/unit/setup.ts'],
  },
});
