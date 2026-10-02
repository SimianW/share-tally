// Throwaway dev server. Only this command swaps in the sample-data entry point.
import { mergeConfig, defineConfig } from 'vite';
import base from './vite.config.ts';

export default mergeConfig(base, defineConfig({
  plugins: [{ name: 'history-prototype-entry', transformIndexHtml: html => html.replace('/src/main.tsx', '/src/app/HistoryPrototypeEntry.tsx') }],
  server: { host: '0.0.0.0', port: 5174, open: false },
}));
