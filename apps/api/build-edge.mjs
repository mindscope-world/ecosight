// Bundles the API and everything it depends on into one file an edge runtime can
// load. The runtime is Deno, which has Node's built-in modules but not its
// globals or `require`, so the banner supplies those.
import { builtinModules } from 'node:module';
import { build } from 'esbuild';

// Deno only knows Node's built-in modules by their prefixed names.
const prefixed = Object.fromEntries(
  builtinModules.filter((name) => !name.startsWith('_') && !name.startsWith('node:')).map((name) => [name, `node:${name}`]),
);

await build({
  entryPoints: [new URL('./src/edge.ts', import.meta.url).pathname],
  outfile: new URL('../../supabase/functions/api/bundle.js', import.meta.url).pathname,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  alias: prefixed,
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import __process from 'node:process';",
      "import { Buffer as __Buffer } from 'node:buffer';",
      "import { setImmediate as __setImmediate, clearImmediate as __clearImmediate } from 'node:timers';",
      'const require = __createRequire(import.meta.url);',
      'globalThis.process ??= __process;',
      'globalThis.Buffer ??= __Buffer;',
      'globalThis.setImmediate ??= __setImmediate;',
      'globalThis.clearImmediate ??= __clearImmediate;',
    ].join('\n'),
  },
  logLevel: 'warning',
});
console.log('built supabase/functions/api/bundle.js');
