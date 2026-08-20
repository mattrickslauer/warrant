import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC = new URL("../src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

/** `@/x` is the tsconfig alias for `src/x`; `./x` may need any of the extensions above. */
export async function resolve(specifier, context, next) {
  let candidate = null;

  if (specifier.startsWith("@/")) {
    candidate = fileURLToPath(new URL(specifier.slice(2), SRC));
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    candidate = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
  }

  if (candidate) {
    for (const ext of ["", ...EXTENSIONS]) {
      const attempt = candidate + ext;
      if (existsSync(attempt) && !attempt.endsWith("/")) {
        return next(pathToFileURL(attempt).href, context);
      }
    }
  }

  return next(specifier, context);
}
