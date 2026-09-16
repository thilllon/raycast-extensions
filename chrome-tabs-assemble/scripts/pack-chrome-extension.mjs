// Builds the zip to upload to the Chrome Web Store.
// The store rejects a first upload whose manifest carries a "key", but local unpacked loading needs
// it to keep a stable extension ID, so the key is stripped from the copy that goes into the zip.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "chrome-extension");
const buildDir = join(root, "build");
const stageDir = join(buildDir, "chrome-extension");

const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
delete manifest.key;

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(source, stageDir, { recursive: true });
writeFileSync(join(stageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const zipPath = join(buildDir, `chrome-tabs-assemble-${manifest.version}.zip`);
execFileSync("zip", ["-r", "-q", zipPath, ".", "-x", ".DS_Store", "*/.DS_Store"], { cwd: stageDir });
console.log(`Upload this to the Chrome Web Store: ${zipPath}`);
