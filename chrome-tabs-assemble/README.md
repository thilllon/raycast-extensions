# Chrome Tabs Assemble

Raycast command that moves every tab from all Chrome windows into the frontmost window — the same as dragging each tab over by hand. Tabs are really moved, not reopened: page state, back/forward history, pinned tabs, and tab groups (title, color, collapsed) are kept.

## Why a Chrome extension is involved

Chrome's AppleScript `move tab` is not a real move: it closes the tab and leaves an empty `chrome://newtab/` in the destination. Only the extension APIs (`chrome.tabs.move`, `chrome.tabGroups.move`) relocate the live tab, so the work is split in two:

- `chrome-extension/` — a tiny unpacked extension. Its page `assemble.html` moves the tabs of every other normal window into its own window, re-activates the tab you were on, and closes itself. `background.js` only remembers each window's previously active tab for that last step.
- `src/assemble-chrome-tabs.ts` — the Raycast command. It checks that Chrome is running and the extension is enabled, then runs `open chrome-extension://<id>/assemble.html` with Chrome. No Automation (Apple Events) permission is needed.

The extension ID is pinned by the `key` in `chrome-extension/manifest.json`, so it stays `lgmjjcmgnchgbbcepmklfnihlpmiifei` wherever the folder lives.

## Setup

1. `mise install && pnpm install`
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this folder's `chrome-extension/` directory. Keep the folder in place; Chrome loads it from disk.
3. `pnpm dev` to import the command into Raycast, then assign a hotkey in Raycast settings if you like.

## Behavior

- Target window: the last active normal Chrome window, which is the frontmost one in normal use.
- Order: pinned tabs join the pinned region; other tabs keep their order and are appended window by window.
- Incognito windows, popups, and app windows are left alone.
- The helper page closes from inside a popup window, so it never shows up in Recently Closed and Cmd+Shift+T still reopens your own closed tabs.
- If some tabs cannot be moved, the helper page stays open in a small popup and lists the errors; everything else has already been moved.
- Right after **Load unpacked**, Chrome can take a few seconds to save the extension to its preferences; if the command says to load the extension, try again shortly.
- Only Google Chrome (`com.google.Chrome`) is supported, in the profile(s) where the extension is loaded.
