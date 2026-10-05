/**
 * Front-end test entry: teaches Node to resolve extensionless relative imports
 * the way Vite does, so the suites in this directory can import `src/` directly.
 *
 * The front-end has no test runner configured; the modules under test are plain
 * ESM with no browser dependencies, and Node's own runner covers them once the
 * project's extensionless import style resolves. Passed with `--import`, and the
 * suite file is named explicitly because this Node version does not glob a
 * directory argument:
 *
 *   node --import ./tests/extensionless-resolution.js --test ./tests/document-lines.test.js
 */

import { register } from 'node:module';

register(new URL('./extensionless-hook.js', import.meta.url), import.meta.url);
