/**
 * Resolver hook: a relative specifier without an extension is matched against
 * `./x.js`, `./x.jsx` and `./x/index.js`, mirroring what the bundler accepts.
 *
 * The default resolver is tried *first* and its answer stands when it resolves —
 * the extension is only added when default resolution cannot find the module.
 * That keeps everything else (bare specifiers like React, `node:*`, and any
 * argument the runner itself resolves) untouched.
 */

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative || /\.[a-zA-Z0-9]+$/.test(specifier)) {
    return nextResolve(specifier, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    for (const candidate of [`${specifier}.js`, `${specifier}.jsx`, `${specifier}/index.js`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Not this spelling; try the next.
      }
    }
    throw err;
  }
}
