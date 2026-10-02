import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Use the invoking app's compiler, including TypeScript's native compiler.
const require = createRequire(resolve('package.json'));
const metadata = require('typescript/package.json');
const compiler = resolve(dirname(require.resolve('typescript/package.json')), metadata.bin.tsc);
const config = fileURLToPath(new URL('../packages/domain/tsconfig.json', import.meta.url));
const result = spawnSync(process.execPath, [compiler, '-p', config], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
