import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Two passes (see package.json "build"): content scripts can't be ES modules, so the
// content entry is a single IIFE; the popup is a normal HTML entry. public/ (manifest, CSS) is copied as-is.
export default defineConfig(({ mode }) =>
  mode === 'content'
    ? {
        publicDir: false,
        build: {
          outDir: r('dist'),
          emptyOutDir: false,
          minify: false, // readable for review; it's small anyway
          lib: { entry: r('src/content/main.ts'), formats: ['iife'], name: 'crc', fileName: () => 'content.js' },
        },
      }
    : {
        root: r('src/popup'),
        base: './',
        publicDir: r('public'),
        build: {
          outDir: r('dist'),
          emptyOutDir: true,
          minify: false,
          rollupOptions: { input: r('src/popup/popup.html') },
        },
      },
);
