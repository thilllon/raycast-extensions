// Takes the Chrome Web Store screenshots by actually running the extension: a throwaway Chromium
// profile gets a few windows of demo tabs (pinned tabs and tab groups included), the screen region
// holding those windows is captured, the extension merges them, and the region is captured again.
//
// Everything inside the captured region belongs to Chromium — a backdrop popup window covers it — so
// no part of the real desktop ends up in an image that gets uploaded to the store.
//
// macOS only, and the app running this needs Screen Recording permission
// (System Settings > Privacy & Security > Screen Recording).

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { connect } from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "chrome-extension");
const fixtureDir = join(root, "scripts", "screenshot-fixture");
const outDir = join(root, "build", "store");

// The region that gets captured, in points on the main display. The backdrop window covers it exactly.
const REGION = { x: 60, y: 100, width: 1280, height: 800 };
const BACKDROP_TOOLBAR = 72; // the backdrop popup's own toolbar is parked above the region
const BACKDROP_COLOR = { r: 17, g: 22, b: 52 };
const WINDOW = { width: 1000, height: 600 };

// --no-capture exercises the whole run (demo windows, merge, cleanup) without touching the screen,
// which is the only part that needs Screen Recording permission.
const skipCapture = process.argv.includes("--no-capture");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO_PAGES = [
  { slug: "inbox", title: "Inbox", hue: 212 },
  { slug: "benchmarks", title: "Benchmarks", hue: 258 },
  { slug: "field-notes", title: "Field notes", hue: 286 },
  { slug: "changelog", title: "Changelog", hue: 24 },
  { slug: "calendar", title: "Calendar", hue: 160 },
  { slug: "pull-request-128", title: "Pull request #128", hue: 340 },
  { slug: "spec", title: "Spec", hue: 196 },
  { slug: "mockups", title: "Mockups", hue: 320 },
  { slug: "weekly-report", title: "Weekly report", hue: 40 },
  { slug: "dashboard", title: "Dashboard", hue: 230 },
];

function extensionIdFromKey(manifestPath) {
  const { key } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!key) throw new Error(`${manifestPath} has no "key", so its extension ID is not stable`);
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...digest].map((char) => "abcdefghijklmnop"[parseInt(char, 16)]).join("");
}

function startDemoServer() {
  const favicon = (hue) =>
    `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="hsl(${hue} 72% 58%)"/></svg>`,
    )}`;

  const demoPage = ({ title, hue }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="icon" href="${favicon(hue)}">
<style>
  body { margin: 0; height: 100vh; display: grid; place-content: center; text-align: center;
         font: 16px -apple-system, BlinkMacSystemFont, sans-serif; color: #2c3150;
         background: linear-gradient(140deg, hsl(${hue} 60% 96%), #f7f8fc); }
  h1 { font-size: 40px; margin: 0 0 10px; letter-spacing: -0.02em; }
  p { margin: 0; color: #6b7190; }
</style></head><body><h1>${title}</h1><p>Demo page for the Chrome Web Store screenshots</p></body></html>`;

  const backdropPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Chrome Tabs Assemble</title>
<style>
  body { margin: 0; height: 100vh;
         background: radial-gradient(circle at 20% 15%, #1d2a63, rgb(17 22 52)); }
</style></head><body></body></html>`;

  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname.slice(1);
    const page = DEMO_PAGES.find((entry) => entry.slug === path);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page ? demoPage(page) : backdropPage);
  });
  server.on("connection", (socket) => socket.unref());
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

  let exitReason = null;
  child.once("exit", (code, signal) => {
    exitReason = `Chromium exited early (code ${code}, signal ${signal})`;
  });

  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt++) {
    if (exitReason) throw new Error(exitReason);
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      if (port > 0) return { child, port };
    }
    await sleep(250);
  }
  throw new Error("Chromium never reported a debugging port");
}

async function stopChromium(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await Promise.race([exited, sleep(5000)]);
}

// Runs in the fixture extension's service worker.
function sceneScript(demoPort) {
  const url = (slug) => `"http://127.0.0.1:${demoPort}/${slug}"`;
  const urls = (...slugs) => slugs.map(url).join(", ");
  return `(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let startup = [];
    for (let attempt = 0; attempt < 40 && startup.length === 0; attempt++) {
      startup = await chrome.windows.getAll();
      if (startup.length === 0) await wait(100);
    }

    // A popup window covering the captured region, so nothing of the real desktop shows through.
    // Popups are skipped by the extension, so it never becomes part of the merge.
    const backdrop = await chrome.windows.create({
      url: ${url("backdrop")}, type: "popup",
      left: ${REGION.x}, top: ${REGION.y - BACKDROP_TOOLBAR},
      width: ${REGION.width}, height: ${REGION.height + BACKDROP_TOOLBAR},
    });

    const research = await chrome.windows.create({ url: [${urls("inbox", "benchmarks", "field-notes", "changelog")}] });
    // Close the startup window only once a window of our own exists, or the browser would quit.
    for (const w of startup) await chrome.windows.remove(w.id);
    const review = await chrome.windows.create({ url: [${urls("calendar", "pull-request-128", "spec", "mockups")}] });
    const target = await chrome.windows.create({ url: [${urls("weekly-report", "dashboard")}] });
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
    await chrome.windows.update(research.id, { left: ${REGION.x + 40}, top: ${REGION.y + 40}, width: ${WINDOW.width}, height: ${WINDOW.height} });
    await chrome.windows.update(review.id, { left: ${REGION.x + 120}, top: ${REGION.y + 110}, width: ${WINDOW.width}, height: ${WINDOW.height} });
    await chrome.windows.update(target.id, { left: ${REGION.x + 200}, top: ${REGION.y + 180}, width: ${WINDOW.width}, height: ${WINDOW.height}, focused: true });
    await chrome.tabs.update(target.tabs[0].id, { active: true });
    await wait(1200);
    return { target: target.id, backdrop: backdrop.id };
  })()`;
}

function sips(args) {
  return execFileSync("/usr/bin/sips", args, { encoding: "utf8" });
}

function pixelSize(file) {
  const output = sips(["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return { width, height };
}

function screencapture(rect, file) {
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
}

// Reads the average color of an image by asking sips for a 1x1 BMP, whose single pixel is easy to parse.
function averageColor(file) {
  const bmp = `${file}.probe.bmp`;
  try {
    sips(["-s", "format", "bmp", "-z", "1", "1", file, "--out", bmp]);
    const data = readFileSync(bmp);
    const offset = data.readUInt32LE(10);
    return { b: data[offset], g: data[offset + 1], r: data[offset + 2] };
  } finally {
    rmSync(bmp, { force: true });
  }
}

// The backdrop window covers the whole region, so its color proves the capture really shows the browser
// and that the windows are where they are meant to be.
function assertBackdropVisible(file) {
  const probe = join(outDir, "probe.png");
  // Bottom-left corner: backdrop in both shots, and clear of every window's toolbar.
  screencapture({ x: REGION.x + 6, y: REGION.y + REGION.height - 30, width: 24, height: 24 }, probe);
  try {
    const color = averageColor(probe);
    const off =
      Math.abs(color.r - BACKDROP_COLOR.r) +
      Math.abs(color.g - BACKDROP_COLOR.g) +
      Math.abs(color.b - BACKDROP_COLOR.b);
    if (off > 90) {
      throw new Error(
        `the corner of the capture area is not the browser backdrop (got rgb(${color.r}, ${color.g}, ${color.b})).\n` +
          `Something is covering it, or the ${REGION.width}x${REGION.height} area at (${REGION.x}, ${REGION.y}) does not fit the main display.\n` +
          `Nothing was written to ${file}.`,
      );
    }
  } finally {
    rmSync(probe, { force: true });
  }
}

function capture(file) {
  if (skipCapture) {
    console.log(`(skipped capture of ${file})`);
    return;
  }
  assertBackdropVisible(file);
  screencapture(REGION, file);

  // A clipped region would otherwise be stretched to 1280x800 and look distorted in the listing.
  const raw = pixelSize(file);
  const scale = raw.width / REGION.width;
  if (![1, 2].includes(scale) || raw.height !== REGION.height * scale) {
    rmSync(file, { force: true });
    throw new Error(
      `captured ${raw.width}x${raw.height}, expected the ${REGION.width}x${REGION.height} region at 1x or 2x`,
    );
  }
  sips(["-s", "format", "png", "-z", String(REGION.height), String(REGION.width), file, "--out", file]);
}

async function main() {
  if (process.platform !== "darwin") throw new Error("screenshots are captured with macOS screencapture");
  const extensionId = extensionIdFromKey(join(extensionDir, "manifest.json"));
  const fixtureId = extensionIdFromKey(join(fixtureDir, "manifest.json"));

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Every resource registers its own teardown, so nothing is left running whatever fails.
  const teardown = [];
  const cleanUp = async () => {
    while (teardown.length > 0) await teardown.pop()();
  };
  const onSignal = () => {
    cleanUp().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const profileDir = mkdtempSync(join(tmpdir(), "chrome-tabs-assemble-shots-"));
    teardown.push(() => rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

    const { server, port: demoPort } = await startDemoServer();
    teardown.push(() => {
      server.closeAllConnections();
      server.close();
    });

    const { child, port } = await launchChromium(profileDir);
    teardown.push(() => stopChromium(child));

    const cdp = await connect(port);
    teardown.push(() => cdp.close());

    const fixture = await cdp.attachToServiceWorker(fixtureId);
    const { target } = await cdp.evaluate(fixture, sceneScript(demoPort));
    capture(join(outDir, "screenshot-1-before.png"));

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

    // Center the merged window in the region for the second shot.
    await cdp.evaluate(
      fixture,
      `chrome.windows.update(${target}, { left: ${REGION.x + 140}, top: ${REGION.y + 100}, width: ${WINDOW.width}, height: ${WINDOW.height} })`,
    );
    await sleep(1200);
    capture(join(outDir, "screenshot-2-after.png"));

    const layout = await cdp.evaluate(
      fixture,
      `chrome.tabs.query({ windowId: ${target} }).then((tabs) => tabs
         .map((t) => t.index + ":" + t.title + (t.pinned ? " [pinned]" : "") + (t.groupId !== -1 ? " [grouped]" : "")))`,
    );
    console.log(`Merged window: ${layout.length} tabs`);
    for (const line of layout) console.log(`  ${line}`);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await cleanUp();
  }

  console.log(skipCapture ? "Capture skipped (--no-capture)." : `Screenshots: ${outDir}`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
