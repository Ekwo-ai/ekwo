#!/usr/bin/env node
/** Makes dist/bin.js executable; tsc does not carry the mode across. */
import { chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
await chmod(join(packageRoot, 'dist', 'bin.js'), 0o755);
