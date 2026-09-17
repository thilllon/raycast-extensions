// Loaded only into the throwaway profile used by scripts/capture-screenshots.mjs. The capture script
// attaches to this service worker over CDP and evaluates the scene setup in it, because pinned tabs and
// tab groups can only be created through the chrome.tabs APIs.
chrome.runtime.onInstalled.addListener(() => {});
