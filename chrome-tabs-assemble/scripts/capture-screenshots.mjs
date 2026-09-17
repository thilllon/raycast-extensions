// Takes the Chrome Web Store screenshots by actually running the extension: a throwaway Chromium
// profile gets a few windows of demo tabs (pinned tabs and tab groups included), the screen region
// holding those windows is captured, the extension merges them, and the region is captured again.
//
// macOS only, and the app running this needs Screen Recording permission
// (System Settings > Privacy & Security > Screen Recording) or the captures show just the desktop.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connect } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "chrome-extension");
const fixtureDir = join(root, "scripts", "screenshot-fixture");
const outDir = join(root, "build", "store");

// The region of the screen the demo windows are placed in, in points, on the primary display.
const REGION = { x: 60, y: 60, width: 1280, height: 800 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extensionIdFromKey(manifestPath) {
  const { key } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!key) throw new Error(`${manifestPath} has no "key", so its extension ID is not stable`);
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...digest].map((char) => "abcdefghijklmnop"[parseInt(char, 16)]).join("");
}

function startDemoServer() {
  const page = (title, subtitle) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
  body { margin: 0; height: 100vh; display: grid; place-content: center; text-align: center;
         font: 16px -apple-system, BlinkMacSystemFont, sans-serif; color: #2c3150;
         background: linear-gradient(140deg, #eef2ff, #f7f8fc); }
  h1 { font-size: 40px; margin: 0 0 8px; letter-spacing: -0.02em; }
  p { margin: 0; color: #6b7190; }
</style></head><body><h1>${title}</h1><p>${subtitle}</p></body></html>`;

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const title = url.searchParams.get("title") ?? "Demo page";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page(title, "Demo page for the Chrome Web Store screenshots"));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function launchChromium(profileDir) {
  const binary = chromium.executablePath();
  if (!existsSync(binary)) {
    console.log("Downloading the Chromium build Playwright uses…");
    execFileSync("pnpm", ["exec", "playwright", "install", "chromium"], { cwd: root, stdio: "inherit" });
  }
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${extensionDir},${fixtureDir}`,
      "--remote-debugging-port=0",
      "--use-mock-keychain",
      "--password-store=basic",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--hide-crash-restore-bubble",
      "--test-type", // hides the "unsupported command-line flag" infobar
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt++) {
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      if (port > 0) return { child, port };
    }
    await sleep(250);
  }
  child.kill("SIGKILL");
  throw new Error("Chromium never reported a debugging port");
}

// Runs in the fixture extension's service worker.
function sceneScript(demoPort, region) {
  return `(async () => {
    const url = (title) => "http://127.0.0.1:${demoPort}/?title=" + encodeURIComponent(title);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const startup = await chrome.windows.getAll();
    const research = await chrome.windows.create({ url: [url("Inbox"), url("Benchmarks"), url("Field notes"), url("Changelog")] });
    // Close the startup window only once a window of our own exists, or the browser would quit.
    for (const w of startup) await chrome.windows.remove(w.id);
    const review = await chrome.windows.create({ url: [url("Calendar"), url("Pull request #128"), url("Spec"), url("Mockups")] });
    const target = await chrome.windows.create({ url: [url("Weekly report"), url("Dashboard")] });
    await wait(2500);

    await chrome.tabs.update(research.tabs[0].id, { pinned: true });
    await chrome.tabs.update(review.tabs[0].id, { pinned: true });
    const researchGroup = await chrome.tabs.group({
      tabIds: [research.tabs[1].id, research.tabs[2].id],
      createProperties: { windowId: research.id },
    });
    await chrome.tabGroups.update(researchGroup, { title: "Research", color: "cyan" });
    const designGroup = await chrome.tabs.group({
      tabIds: [review.tabs[2].id, review.tabs[3].id],
      createProperties: { windowId: review.id },
    });
    await chrome.tabGroups.update(designGroup, { title: "Design", color: "pink" });

    // Cascade the windows inside the captured region, target window in front.
    await chrome.windows.update(research.id, { left: ${region.x}, top: ${region.y}, width: 1000, height: 600 });
    await chrome.windows.update(review.id, { left: ${region.x + 80}, top: ${region.y + 70}, width: 1000, height: 600 });
    await chrome.windows.update(target.id, { left: ${region.x + 160}, top: ${region.y + 140}, width: 1000, height: 600, focused: true });
    await chrome.tabs.update(target.tabs[0].id, { active: true });
    await wait(1200);
    return { target: target.id };
  })()`;
}

// --no-capture exercises the whole run (demo windows, merge, cleanup) without touching the screen,
// which is the only part that needs Screen Recording permission.
const skipCapture = process.argv.includes("--no-capture");

function capture(rect, file) {
  if (skipCapture) {
    console.log(`(skipped capture of ${file})`);
    return;
  }
  try {
    execFileSync("/usr/sbin/screencapture", [
      "-x",
      "-t",
      "png",
      `-R${rect.x},${rect.y},${rect.width},${rect.height}`,
      file,
    ]);
  } catch {
    throw new Error(
      [
        "screencapture could not read the screen.",
        "macOS needs Screen Recording permission for the app this command runs in",
        "(Terminal, iTerm, Ghostty, Claude Code, …):",
        "  System Settings > Privacy & Security > Screen Recording",
        "Open it with: open 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'",
        "Then run pnpm release again.",
      ].join("\n"),
    );
  }
  // Retina displays capture at 2x; the store wants exactly 1280x800.
  execFileSync("/usr/bin/sips", ["-s", "format", "png", "-z", "800", "1280", file, "--out", file], { stdio: "ignore" });
}

async function main() {
  if (process.platform !== "darwin") throw new Error("screenshots are captured with macOS screencapture");
  const extensionId = extensionIdFromKey(join(extensionDir, "manifest.json"));
  const fixtureId = extensionIdFromKey(join(fixtureDir, "manifest.json"));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), "chrome-tabs-assemble-shots-"));
  const { server, port: demoPort } = await startDemoServer();
  const { child, port } = await launchChromium(profileDir);
  const cdp = await connect(port);

  try {
    const fixture = await cdp.attachToServiceWorker(fixtureId);
    const { target } = await cdp.evaluate(fixture, sceneScript(demoPort, REGION));
    capture(REGION, join(outDir, "screenshot-1-before.png"));

    // Exactly what the Raycast command triggers: open the extension's page in the target window.
    await cdp.evaluate(
      fixture,
      `chrome.tabs.create({ windowId: ${target}, url: "chrome-extension://${extensionId}/assemble.html" })`,
    );
    let merged = false;
    for (let attempt = 0; attempt < 40 && !merged; attempt++) {
      const count = await cdp.evaluate(
        fixture,
        `chrome.windows.getAll({ windowTypes: ["normal"] }).then((w) => w.length)`,
      );
      merged = count === 1;
      if (!merged) await sleep(250);
    }
    if (!merged) throw new Error("the extension did not merge the demo windows");
    await sleep(1200);
    capture(REGION, join(outDir, "screenshot-2-after.png"));
    const layout = await cdp.evaluate(
      fixture,
      `chrome.tabs.query({}).then((tabs) => tabs.filter((t) => !t.url.startsWith("chrome-extension:"))
         .map((t) => t.index + ":" + t.title + (t.pinned ? " [pinned]" : "") + (t.groupId !== -1 ? " [grouped]" : "")))`,
    );
    console.log(`Merged window: ${layout.length} tabs`);
    for (const line of layout) console.log(`  ${line}`);
  } finally {
    cdp.close();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    server.close();
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  console.log(`Screenshots: ${outDir}`);
  console.log("If they show only the desktop, grant Screen Recording permission and run again.");
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
