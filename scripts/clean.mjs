import { rmSync } from "node:fs";

const directories = process.argv.slice(2);
for (const directory of directories.length ? directories : ["dist"]) {
  rmSync(new URL("../" + directory, import.meta.url), { recursive: true, force: true });
}
