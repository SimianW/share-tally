import type { Plugin } from 'vite';
import { palettes, paletteStorageKey, schemeStorageKey, resolveScheme } from '../src/theme/palettes.ts';

export function themeBootstrap(): Plugin {
  return {
    name: 'theme-bootstrap',
    transformIndexHtml: { order: 'pre', handler() {
      const code = `try {
        var palette = localStorage.getItem(${JSON.stringify(paletteStorageKey)});
        if (${JSON.stringify(palettes.map(palette => palette.key))}.indexOf(palette) >= 0)
          document.documentElement.dataset.palette = palette;
      } catch (error) {}
      var scheme = null;
      try { scheme = localStorage.getItem(${JSON.stringify(schemeStorageKey)}); } catch (error) {}
      document.documentElement.dataset.scheme = (${resolveScheme.toString()})(scheme, matchMedia('(prefers-color-scheme: dark)').matches);`;
      return [{ tag: 'script', children: code, injectTo: 'head-prepend' }];
    } },
  };
}
