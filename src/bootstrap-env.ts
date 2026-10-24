import { existsSync, readFileSync } from "node:fs";

/**
 * Loads .env.local and .env for standalone Node entrypoints (queue worker,
 * seed script). Next.js loads these itself; tsx does not. Existing process
 * environment variables always win, which matches deployment behavior.
 */
function loadFile(path: string): void {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1]!;
    let value = match[2]!.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadFile(".env.local");
loadFile(".env");
