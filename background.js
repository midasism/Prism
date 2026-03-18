const PLATFORMS = [
  {
    key: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/"
  },
  {
    key: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/app"
  },
  {
    key: "claude",
    label: "Claude",
    url: "https://claude.ai/new"
  }
];

const CONTROLLER_KEY = "controller";
const CONTROLLER_URL = chrome.runtime.getURL("controller.html");
const DEFAULT_SELECTION = PLATFORMS.map((platform) => platform.key);

async function getManagedState() {
  const { managedWindows = {} } = await chrome.storage.local.get("managedWindows");
  return managedWindows;
}

async function setManagedState(managedWindows) {
  await chrome.storage.local.set({ managedWindows });
}

async function getSelectedPlatforms() {
  const { selectedPlatforms = DEFAULT_SELECTION } = await chrome.storage.local.get("selectedPlatforms");
  const normalized = Array.isArray(selectedPlatforms) ? selectedPlatforms : DEFAULT_SELECTION;
  const valid = normalized.filter((key) => PLATFORMS.some((platform) => platform.key === key));
  return valid.length ? valid : DEFAULT_SELECTION;
}

async function setSelectedPlatforms(selectedPlatforms) {
  const filtered = [...new Set(selectedPlatforms)].filter((key) =>
    PLATFORMS.some((platform) => platform.key === key)
  );
  await chrome.storage.local.set({
    selectedPlatforms: filtered.length ? filtered : DEFAULT_SELECTION
  });
}

function getPlatformsByKeys(keys) {
  const wanted = new Set(keys);
  return PLATFORMS.filter((platform) => wanted.has(platform.key));
}

async function getPrimaryWorkArea() {
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find((display) => display.isPrimary) || displays[0];
  return primary.workArea;
}

async function createOrReusePlatformWindow(platform, bounds) {
  const managedWindows = await getManagedState();
  const existing = managedWindows[platform.key];

  if (existing?.windowId) {
    try {
      await chrome.windows.update(existing.windowId, {
        focused: false,
        state: "normal",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      });

      const tabs = await chrome.tabs.query({ windowId: existing.windowId });
      const activeTab = tabs[0];
      if (activeTab?.id) {
        managedWindows[platform.key] = {
          windowId: existing.windowId,
          tabId: activeTab.id,
          url: platform.url
        };
        await setManagedState(managedWindows);
        return managedWindows[platform.key];
      }
    } catch (error) {
      delete managedWindows[platform.key];
      await setManagedState(managedWindows);
    }
  }

  const created = await chrome.windows.create({
    url: platform.url,
    type: "popup",
    focused: false,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height
  });

  const tab = created.tabs?.[0];
  managedWindows[platform.key] = {
    windowId: created.id,
    tabId: tab?.id,
    url: platform.url
  };
  await setManagedState(managedWindows);
  return managedWindows[platform.key];
}

async function ensurePlatformWindows(selectedKeys) {
  const keys = selectedKeys?.length ? selectedKeys : await getSelectedPlatforms();
  const selectedPlatforms = getPlatformsByKeys(keys);
  const workArea = await getPrimaryWorkArea();
  const controllerWidth = Math.min(420, Math.max(360, Math.floor(workArea.width * 0.22)));
  const chatAreaWidth = Math.max(workArea.width - controllerWidth, 900);
  const baseWidth = Math.floor(chatAreaWidth / Math.max(selectedPlatforms.length, 1));

  const results = [];
  for (const [index, platform] of selectedPlatforms.entries()) {
    const isLast = index === selectedPlatforms.length - 1;
    const left = workArea.left + (baseWidth * index);
    const width = isLast ? chatAreaWidth - (baseWidth * index) : baseWidth;
    const bounds = {
      left,
      top: workArea.top,
      width,
      height: workArea.height
    };

    const state = await createOrReusePlatformWindow(platform, bounds);
    results.push({ ...platform, ...state });
  }

  return results;
}

async function ensureControllerWindow(focus = true) {
  const managedWindows = await getManagedState();
  const existing = managedWindows[CONTROLLER_KEY];
  const workArea = await getPrimaryWorkArea();
  const width = Math.min(420, Math.max(360, Math.floor(workArea.width * 0.22)));
  const bounds = {
    left: workArea.left + workArea.width - width,
    top: workArea.top,
    width,
    height: workArea.height
  };

  if (existing?.windowId) {
    try {
      await chrome.windows.update(existing.windowId, {
        focused: focus,
        state: "normal",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      });

      const tabs = await chrome.tabs.query({ windowId: existing.windowId });
      const activeTab = tabs[0];
      if (activeTab?.id) {
        managedWindows[CONTROLLER_KEY] = {
          windowId: existing.windowId,
          tabId: activeTab.id,
          url: CONTROLLER_URL
        };
        await setManagedState(managedWindows);
        return managedWindows[CONTROLLER_KEY];
      }
    } catch (error) {
      delete managedWindows[CONTROLLER_KEY];
      await setManagedState(managedWindows);
    }
  }

  const created = await chrome.windows.create({
    url: CONTROLLER_URL,
    type: "popup",
    focused: focus,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height
  });

  const tab = created.tabs?.[0];
  managedWindows[CONTROLLER_KEY] = {
    windowId: created.id,
    tabId: tab?.id,
    url: CONTROLLER_URL
  };
  await setManagedState(managedWindows);
  return managedWindows[CONTROLLER_KEY];
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        return true;
      }
    } catch (error) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

async function sendMessageToPlatform(tabId, text) {
  await waitForTabComplete(tabId);
  return chrome.tabs.sendMessage(tabId, {
    type: "TRI_CHAT_SEND",
    text
  });
}

async function broadcast(text, selectedKeys) {
  const targets = await ensurePlatformWindows(selectedKeys);
  const results = [];

  for (const platform of targets) {
    if (!platform.tabId) {
      results.push({
        platform: platform.label,
        ok: false,
        error: "未找到标签页"
      });
      continue;
    }

    try {
      const response = await sendMessageToPlatform(platform.tabId, text);
      results.push({
        platform: platform.label,
        ok: Boolean(response?.ok),
        error: response?.error || null
      });
    } catch (error) {
      results.push({
        platform: platform.label,
        ok: false,
        error: error.message
      });
    }
  }

  return results;
}

async function resetConversations(selectedKeys) {
  const targets = await ensurePlatformWindows(selectedKeys);
  const results = [];

  for (const platform of targets) {
    if (!platform.tabId) {
      results.push({
        platform: platform.label,
        ok: false,
        error: "未找到标签页"
      });
      continue;
    }

    try {
      await chrome.tabs.update(platform.tabId, { url: platform.url });
      results.push({
        platform: platform.label,
        ok: true,
        error: null
      });
    } catch (error) {
      results.push({
        platform: platform.label,
        ok: false,
        error: error.message
      });
    }
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TRI_CHAT_OPEN_WINDOWS") {
    Promise.resolve()
      .then(async () => {
        if (Array.isArray(message.selectedPlatforms)) {
          await setSelectedPlatforms(message.selectedPlatforms);
        }
        const selectedPlatforms = await getSelectedPlatforms();
        return Promise.all([ensurePlatformWindows(selectedPlatforms), ensureControllerWindow(false)]);
      })
      .then(([targets, controller]) => sendResponse({ ok: true, targets, controller }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TRI_CHAT_BROADCAST") {
    Promise.resolve()
      .then(async () => {
        if (Array.isArray(message.selectedPlatforms)) {
          await setSelectedPlatforms(message.selectedPlatforms);
        }
        const selectedPlatforms = await getSelectedPlatforms();
        return broadcast(message.text, selectedPlatforms);
      })
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TRI_CHAT_RESET_CONVERSATIONS") {
    Promise.resolve()
      .then(async () => {
        if (Array.isArray(message.selectedPlatforms)) {
          await setSelectedPlatforms(message.selectedPlatforms);
        }
        const selectedPlatforms = await getSelectedPlatforms();
        return resetConversations(selectedPlatforms);
      })
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TRI_CHAT_GET_SELECTION") {
    getSelectedPlatforms()
      .then((selectedPlatforms) => sendResponse({ ok: true, selectedPlatforms }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TRI_CHAT_SET_SELECTION") {
    setSelectedPlatforms(message.selectedPlatforms || [])
      .then(async () => {
        const selectedPlatforms = await getSelectedPlatforms();
        sendResponse({ ok: true, selectedPlatforms });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return undefined;
});

chrome.action.onClicked.addListener(async () => {
  const selectedPlatforms = await getSelectedPlatforms();
  await Promise.all([ensurePlatformWindows(selectedPlatforms), ensureControllerWindow(true)]);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const managedWindows = await getManagedState();
  let changed = false;

  for (const key of [...PLATFORMS.map((platform) => platform.key), CONTROLLER_KEY]) {
    if (managedWindows[key]?.windowId === windowId) {
      delete managedWindows[key];
      changed = true;
    }
  }

  if (changed) {
    await setManagedState(managedWindows);
  }
});
