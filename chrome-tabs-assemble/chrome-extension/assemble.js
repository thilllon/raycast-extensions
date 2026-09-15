// Opened as a tab (by the Raycast command) in the window that should receive every other tab.
// Uses chrome.tabs.move / chrome.tabGroups.move, which relocate the live tab: same tab id,
// navigation history, page state, and group title/color/collapsed state are kept.

const TAB_GROUP_ID_NONE = -1;

async function moveWindowInto(source, targetWindowId) {
  const tabs = [...source.tabs].sort((a, b) => a.index - b.index);

  const pinnedIds = tabs.filter((tab) => tab.pinned).map((tab) => tab.id);
  if (pinnedIds.length > 0) {
    await chrome.tabs.move(pinnedIds, { windowId: targetWindowId, index: -1 });
    // A cross-window move drops the pinned flag; pinning again appends each tab to the pinned region in order.
    for (const id of pinnedIds) {
      await chrome.tabs.update(id, { pinned: true });
    }
  }

  // Walk the rest in tab-strip order: consecutive ungrouped tabs move together, groups move as a whole.
  let ungroupedRun = [];
  const flushUngrouped = async () => {
    if (ungroupedRun.length === 0) return;
    await chrome.tabs.move(ungroupedRun, { windowId: targetWindowId, index: -1 });
    ungroupedRun = [];
  };
  const movedGroupIds = new Set();
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (tab.groupId === TAB_GROUP_ID_NONE) {
      ungroupedRun.push(tab.id);
      continue;
    }
    await flushUngrouped();
    if (movedGroupIds.has(tab.groupId)) continue;
    movedGroupIds.add(tab.groupId);
    await chrome.tabGroups.move(tab.groupId, { windowId: targetWindowId, index: -1 });
  }
  await flushUngrouped();
}

// The tab the user was on before this page opened, so focus can go back to it afterwards.
async function findPreviousTab(self, target) {
  const key = `active:${target.id}`;
  const { [key]: record } = await chrome.storage.session.get(key);
  // background.js may or may not have recorded this page's own activation yet.
  const recordedId = record?.current === self.id ? record.previous : record?.current;
  const others = target.tabs.filter((tab) => tab.id !== self.id);
  return (
    others.find((tab) => tab.id === recordedId) ??
    others.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]
  );
}

// Chrome adds a tab closed in a normal window (and a popup window closed via windows.remove) to Recently
// Closed, where Cmd+Shift+T would reopen this page and run the merge again. A tab closed inside a popup
// window is not recorded, so the page leaves through one.
function moveSelfToPopup(self, focused) {
  return chrome.windows.create({ tabId: self.id, type: "popup", focused, width: 560, height: 400 });
}

async function assemble(self) {
  const target = await chrome.windows.get(self.windowId, { populate: true });
  const previousTab = await findPreviousTab(self, target);

  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const errors = [];
  for (const source of windows) {
    if (source.id === target.id || source.incognito !== target.incognito) continue;
    try {
      await moveWindowInto(source, target.id);
    } catch (error) {
      errors.push(`window ${source.id}: ${error.message}`);
    }
  }
  if (errors.length > 0) {
    // Whatever could be moved has already moved; the page stays open to show what failed.
    throw new Error(`Some tabs could not be moved:\n${errors.join("\n")}`);
  }

  if (previousTab) await chrome.tabs.update(previousTab.id, { active: true });
  await chrome.windows.update(target.id, { focused: true });
  await moveSelfToPopup(self, false);
  await chrome.tabs.remove(self.id);
}

(async () => {
  const self = await chrome.tabs.getCurrent();
  try {
    await assemble(self);
  } catch (error) {
    document.title = "Assemble failed";
    document.getElementById("status").textContent = "Assemble failed";
    const details = document.getElementById("errors");
    details.textContent = error.message;
    details.hidden = false;
    await moveSelfToPopup(self, true);
  }
})();
