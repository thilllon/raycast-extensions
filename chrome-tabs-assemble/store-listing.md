# Chrome Web Store submission

Everything needed for the listing, kept here so a resubmission does not start from scratch.
Visibility: **Unlisted** — no listing page, installable by anyone with the link.

## Steps

1. `pnpm release` — writes everything to upload:
   - `build/chrome-tabs-assemble-<version>.zip` (the manifest `key` is stripped, which a first upload requires)
   - `build/store/screenshot-1-before.png` and `screenshot-2-after.png`, 1280x800, captured from a real run of the extension in a throwaway Chromium profile
   - macOS asks for Screen Recording permission the first time, for the app the command runs in. Without it the capture step stops with instructions and only the zip is produced. `pnpm release` can be re-run any time.
   - The two steps can also be run on their own while working on them: `node scripts/pack-chrome-extension.mjs`, `node scripts/capture-screenshots.mjs` (add `--no-capture` to exercise everything except the screen capture).
2. Open the [developer dashboard](https://chrome.google.com/webstore/devconsole). The registration fee is one-time per account, so an account that has published before pays nothing here. (Publishing private to a Google Workspace domain needs no fee at all, but that is a different distribution mode than the unlisted listing below.)
3. **Add new item**, upload the zip, fill in the listing below, set Visibility to **Unlisted**, and submit for review.
4. After it is published, install it from the store link, then:
   - Put the store URL in both READMEs.
   - Set the store extension ID in the Raycast command's **Chrome Extension ID** preference (Raycast → Extensions → Chrome Tabs Assemble).
   - Remove the unpacked copy from `chrome://extensions` so only one of them handles the command.
   - Optionally copy the item's public key from the dashboard (Package tab) into `chrome-extension/manifest.json` as `key`, so a locally loaded copy keeps the same ID.

## Listing

- **Name:** Chrome Tabs Assemble
- **Summary (132 chars max):** Moves every tab from all windows into the current window, keeping pinned tabs and tab groups.
- **Category:** Workflow & Planning
- **Language:** English

**Description:**

> Assemble Chrome Tabs gathers the tabs of every open Chrome window into the window you are looking at, the same as dragging each tab over by hand.
>
> Tabs are moved, not reopened, so nothing is lost: page state, scroll position, and back/forward history stay intact. Pinned tabs stay pinned, and tab groups keep their name, color, and collapsed state.
>
> The extension has no toolbar UI. It runs when its page is opened, which the companion Raycast command does with a hotkey. Incognito windows, popups, and app windows are left alone.
>
> Source: https://github.com/thilllon/raycast-extensions

**Screenshots:** `pnpm release` produces them. They are a real run — demo windows with pinned tabs and tab groups before, the merged window after — so they show actual functionality, as Chrome's policies expect.

## Privacy tab answers

- **Single purpose:** Move the tabs of all Chrome windows into one window.
- **Permission `tabGroups`:** Needed to move a tab group to another window as a group, so grouped tabs keep their group, name, and color.
- **Permission `storage`:** Stores only the id of each window's previously active tab, in session storage, so focus can return to the tab the user was on. Cleared when Chrome closes.
- **Remote code:** No. All code is in the package.
- **Data collection:** None. The extension does not read page content, does not send anything anywhere, and has no host permissions.
