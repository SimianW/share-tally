import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// These are the views and requests a feature offers to other features; everything else is implementation that only the app may compose.
export const publicFeatureEntries = {
  groups: ['api', 'icons/GroupIconView'],
  bills: ['api'],
  receipts: ['api', 'photos/ReceiptPhoto', 'photos/ReceiptLinePhoto', 'photos/ReceiptPhotoViewer', 'review/ReceiptItemRow', 'review/ReceiptReview'],
};

export function moduleBoundaryViolations(files) {
  const violations = [];
  for (const [file, text] of files) {
    const imports = path.extname(file).toLowerCase() === '.css'
      ? cssImports(text)
      : ts.preProcessFile(text, true, true).importedFiles.map(({ fileName, pos }) => ({ specifier: fileName, pos }));
    for (const { specifier, pos } of imports) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const target = resolveImport(file, specifier);
      const sourceLayer = layerFor(file);
      const targetLayer = layerFor(target);
      const line = text.slice(0, pos).split('\n').length;

      if ((sourceLayer === 'shared' || sourceLayer === 'theme') && (targetLayer === 'app' || targetLayer.startsWith('features/'))) {
        violations.push(`${file}:${line}: ${sourceLayer} must not import ${targetLayer}`);
      } else if (sourceLayer.startsWith('features/') && targetLayer === 'app') {
        violations.push(`${file}:${line}: ${sourceLayer} must not import app`);
      } else if (sourceLayer.startsWith('features/') && targetLayer.startsWith('features/') && sourceLayer !== targetLayer) {
        const targetFeature = targetLayer.slice('features/'.length);
        const targetEntry = path.posix.relative(targetLayer, target);
        const allowed = publicFeatureEntries[targetFeature]?.includes(targetEntry);
        if (!allowed) {
          violations.push(`${file}:${line}: ${sourceLayer} imports ${target}, which is not a public entry point of ${targetLayer}; compose it in app`);
        }
      }
    }
  }
  return violations;
}

const cssImportPattern = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?/g;

function cssImports(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  return [...source.matchAll(cssImportPattern)].map(match => ({
    specifier: match[2],
    pos: match.index + match[0].indexOf(match[2]),
  }));
}

function layerFor(file) {
  const segments = file.split('/');
  if (segments[0] === 'features' && segments.length > 1) return `features/${segments[1]}`;
  return segments[0];
}

// Vite serves the client root at `/`, so `/src/...` names the same files as relative imports.
function resolveImport(file, specifier) {
  const bare = specifier.replace(/[?#].*$/, '');
  const base = bare.startsWith('/')
    ? path.posix.normalize(bare.slice(1)).replace(/^src\//, '')
    : path.posix.normalize(path.posix.join(path.posix.dirname(file), bare));
  return base.replace(/\.(?:js|jsx|mjs|ts|tsx|css)$/i, '');
}

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css']);

export async function listSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSources(fullPath));
    else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

async function run() {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const files = new Map();
  for (const fullPath of await listSources(srcDir)) {
    const relative = path.relative(srcDir, fullPath).split(path.sep).join('/');
    files.set(relative, await readFile(fullPath, 'utf8'));
  }
  const violations = moduleBoundaryViolations(files);
  if (violations.length) {
    for (const violation of violations) console.error(violation);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
