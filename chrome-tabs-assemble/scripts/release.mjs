// One command that produces everything needed for a Chrome Web Store upload:
// the zip, the screenshots, and the listing text to paste.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: "inherit" });
const { version } = JSON.parse(readFileSync(join(root, "chrome-extension", "manifest.json"), "utf8"));

run(process.execPath, [join(root, "scripts", "pack-chrome-extension.mjs")]);
try {
  run(process.execPath, [join(root, "scripts", "capture-screenshots.mjs")]);
} catch {
  console.error(`\nThe zip is ready at build/chrome-tabs-assemble-${version}.zip, but the screenshots are not.`);
  process.exit(1);
}

console.log(`
Ready to upload (version ${version}):
  1. build/chrome-tabs-assemble-${version}.zip          -> Add new item / Upload new package
  2. build/store/screenshot-1-before.png                -> Store listing > Screenshots
     build/store/screenshot-2-after.png
  3. store-listing.md                                   -> listing text, permission justifications, privacy answers
  4. Set Visibility to Unlisted, then submit for review.
`);
