import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getPreferenceValues, open, showHUD } from "@raycast/api";

// Fixed by the "key" in chrome-extension/manifest.json, so it is the same wherever the folder is loaded
// from. A store-installed copy gets a different ID, which goes in the extension's preferences.
const UNPACKED_EXTENSION_ID = "lgmjjcmgnchgbbcepmklfnihlpmiifei";
const CHROME_BUNDLE_ID = "com.google.Chrome";
const CHROME_DATA_DIR = join(homedir(), "Library", "Application Support", "Google", "Chrome");

const execFileAsync = promisify(execFile);

async function isChromeRunning(): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/pgrep", ["-x", "Google Chrome"]);
    return true;
  } catch {
    return false;
  }
}

function resolveExtensionId(): string {
  const { extensionId } = getPreferenceValues<{ extensionId?: string }>();
  return extensionId?.trim() || UNPACKED_EXTENSION_ID;
}

type ExtensionSettings = { disable_reasons?: number[] | number };

// Chrome records installed extensions under extensions.settings in each profile's "Secure Preferences".
async function isExtensionEnabled(extensionId: string): Promise<boolean> {
  const entries = await readdir(CHROME_DATA_DIR).catch(() => []);
  const profiles = entries.filter((name) => name === "Default" || /^Profile \d+$/.test(name));
  for (const profile of profiles) {
    try {
      const prefs = JSON.parse(await readFile(join(CHROME_DATA_DIR, profile, "Secure Preferences"), "utf8"));
      const settings: ExtensionSettings | undefined = prefs?.extensions?.settings?.[extensionId];
      if (!settings) continue;
      const reasons = settings.disable_reasons;
      const disabled = Array.isArray(reasons) ? reasons.length > 0 : Boolean(reasons);
      if (!disabled) return true;
    } catch {
      // Unreadable or missing preferences for this profile; try the next one.
    }
  }
  return false;
}

export default async function main() {
  if (!(await isChromeRunning())) {
    await showHUD("Chrome is not running");
    return;
  }
  const extensionId = resolveExtensionId();
  if (!(await isExtensionEnabled(extensionId))) {
    await showHUD("Install the Chrome Tabs Assemble extension in Chrome first");
    return;
  }
  // Chrome opens the page as a tab in its frontmost window; the page moves every other window's tabs there and closes itself.
  await open(`chrome-extension://${extensionId}/assemble.html`, CHROME_BUNDLE_ID);
}
