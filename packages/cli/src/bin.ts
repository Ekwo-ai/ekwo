#!/usr/bin/env node
/**
 * The `ekwo` binary. Nothing but argv in, exit code out.
 */

import { run } from './cli.js';

const code = await run(process.argv.slice(2));
process.exitCode = code;
