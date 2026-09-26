import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

// Expo/Metro accepts extensionless TypeScript imports. Node's native TypeScript
// stripping preserves them, so tests register the same source-file resolution.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/mobile/src/')) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
