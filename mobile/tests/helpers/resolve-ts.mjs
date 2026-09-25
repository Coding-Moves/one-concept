import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

// Node's TypeScript stripping does not resolve Metro's extensionless imports.
// Resolve source files only; package resolution remains Node's own behavior.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.includes('/mobile/src/')) {
    for (const suffix of ['.ts', '/index.ts']) {
      const url = new URL(specifier + suffix, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
  }
  return nextResolve(specifier, context);
} });
