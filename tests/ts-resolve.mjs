// Lets Node run the app's TypeScript directly (node --import ./tests/ts-resolve.mjs).
//
// Node 22 strips erasable TS syntax natively, but its resolver wants explicit
// extensions on relative imports, while the app's code uses extensionless
// specifiers because Next's bundler resolves those. This hook bridges the two:
// when a relative extensionless specifier fails to resolve, retry with ".ts".
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !path.extname(specifier) &&
        context.parentURL?.startsWith("file:")
      ) {
        const candidate = path.resolve(
          path.dirname(fileURLToPath(context.parentURL)),
          `${specifier}.ts`
        );
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
      throw err;
    }
  },
});
