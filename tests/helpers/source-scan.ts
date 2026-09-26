/**
 * Reads every TypeScript source under `src/` for the static-scan security
 * suites, with comments stripped so a check runs against code, not prose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const SRC = resolve(process.cwd(), "src");

export interface SourceFile {
  path: string;
  text: string;
  /** `text` with comments removed. See {@link stripComments}. */
  code: string;
}

/**
 * Removes line and block comments, leaving string literals intact.
 *
 * The expression-based checks have to run against code, not prose.
 * Without this, a comment explaining what a defective decoder USED to do -
 * `parseInt(b, 16)` - reads as a second implementation, the check cries wolf,
 * and the next person deletes it. Not a parser: a regex literal containing a
 * comment opener would confuse it, and there is none in `src/`.
 */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") {
          out += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += text[i];
        i++;
      }
      out += text[i] ?? "";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function collectSources(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    const text = readFileSync(full, "utf-8");
    out.push({
      path: relative(process.cwd(), full).replaceAll("\\", "/"),
      text,
      code: stripComments(text),
    });
  }
  return out;
}
