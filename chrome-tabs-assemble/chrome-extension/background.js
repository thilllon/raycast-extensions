// Remembers the current and previous active tab of each window, so assemble.js can hand focus back
// to the tab the user was on before the helper tab opened. Tab.lastAccessed can't tell that: tabs
// opened in the background get a newer timestamp than the tab being read.

const keyFor = (windowId) => `active:${windowId}`;

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const key = keyFor(windowId);
  const { [key]: record } = await chrome.storage.session.get(key);
  if (record?.current === tabId) return;
  await chrome.storage.session.set({ [key]: { current: tabId, previous: record?.current } });
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.remove(keyFor(windowId));
});
