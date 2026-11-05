import { cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { build as viteBuild, defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

async function buildIife(entry: string, name: string, fileName: string) {
  await viteBuild({
    configFile: false,
    build: {
      outDir: resolve(rootDir, 'dist'),
      emptyOutDir: false,
      lib: { entry, name, formats: ['iife'], fileName: () => fileName },
      rollupOptions: { output: { extend: true } },
    },
    logLevel: 'warn',
  });
}

// Background and content scripts must be classic scripts, so they get their own IIFE builds after the main one.
// Build only: the demo dev server must never rewrite dist/ when it shuts down.
const buildExtensionScripts = {
  name: 'build-extension-scripts',
  apply: 'build' as const,
  async closeBundle() {
    cpSync(resolve(rootDir, 'static'), resolve(rootDir, 'dist'), { recursive: true });
    await buildIife(resolve(rootDir, 'src/background/index.ts'), 'background', 'background.js');
    await buildIife(resolve(rootDir, 'src/content/index.ts'), 'content', 'content.js');
  },
};

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), svelte(), buildExtensionScripts],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        deck: resolve(rootDir, 'deck.html'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
