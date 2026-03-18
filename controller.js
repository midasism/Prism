const messageInput = document.getElementById("message");
const layoutButton = document.getElementById("layoutWindows");
const newChatsButton = document.getElementById("newChats");
const sendAllButton = document.getElementById("sendAll");
const statusBox = document.getElementById("status");
const platformInputs = Array.from(document.querySelectorAll('input[name="platform"]'));

function setStatus(text) {
  statusBox.textContent = text;
}

function setBusy(button, busy) {
  button.disabled = busy;
}

function getSelectedPlatforms() {
  return platformInputs.filter((input) => input.checked).map((input) => input.value);
}

function ensureAtLeastOneSelection(changedInput) {
  if (getSelectedPlatforms().length > 0) {
    return true;
  }

  if (changedInput) {
    changedInput.checked = true;
  } else if (platformInputs[0]) {
    platformInputs[0].checked = true;
  }

  setStatus("至少要选择一个平台。");
  return false;
}

async function persistSelection() {
  if (!ensureAtLeastOneSelection()) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "TRI_CHAT_SET_SELECTION",
    selectedPlatforms: getSelectedPlatforms()
  });
}

async function loadSelection() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRI_CHAT_GET_SELECTION"
    });

    if (!response?.ok || !Array.isArray(response.selectedPlatforms)) {
      return;
    }

    const selected = new Set(response.selectedPlatforms);
    for (const input of platformInputs) {
      input.checked = selected.has(input.value);
    }

    ensureAtLeastOneSelection();
  } catch (error) {
    setStatus(`读取平台选择失败: ${error.message}`);
  }
}

async function layoutWindows() {
  if (!ensureAtLeastOneSelection()) {
    messageInput.focus();
    return;
  }

  setBusy(layoutButton, true);
  setStatus("正在打开并重新排布已勾选的平台窗口...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRI_CHAT_OPEN_WINDOWS",
      selectedPlatforms: getSelectedPlatforms()
    });
    if (!response?.ok) {
      throw new Error(response?.error || "排布失败");
    }

    const lines = [
      "已完成窗口排布:",
      ...response.targets.map((target) => `- ${target.label}`)
    ];
    setStatus(lines.join("\n"));
  } catch (error) {
    setStatus(`排布失败: ${error.message}`);
  } finally {
    setBusy(layoutButton, false);
    messageInput.focus();
  }
}

async function sendAll() {
  if (!ensureAtLeastOneSelection()) {
    messageInput.focus();
    return;
  }

  const text = messageInput.value.trim();
  if (!text) {
    setStatus("请输入消息。");
    messageInput.focus();
    return;
  }

  setBusy(sendAllButton, true);
  setStatus("正在向已勾选的平台同步发送...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRI_CHAT_BROADCAST",
      text,
      selectedPlatforms: getSelectedPlatforms()
    });
    if (!response?.ok) {
      throw new Error(response?.error || "发送失败");
    }

    const lines = response.results.map((item) => {
      if (item.ok) {
        return `成功: ${item.platform}`;
      }
      return `失败: ${item.platform} (${item.error || "未知错误"})`;
    });
    setStatus(lines.join("\n"));
    messageInput.value = "";
    messageInput.focus();
  } catch (error) {
    setStatus(`发送失败: ${error.message}`);
    messageInput.focus();
  } finally {
    setBusy(sendAllButton, false);
  }
}

async function resetConversations() {
  if (!ensureAtLeastOneSelection()) {
    messageInput.focus();
    return;
  }

  setBusy(newChatsButton, true);
  setStatus("正在为已勾选的平台打开新对话...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRI_CHAT_RESET_CONVERSATIONS",
      selectedPlatforms: getSelectedPlatforms()
    });
    if (!response?.ok) {
      throw new Error(response?.error || "新建对话失败");
    }

    const lines = response.results.map((item) => {
      if (item.ok) {
        return `已重置: ${item.platform}`;
      }
      return `失败: ${item.platform} (${item.error || "未知错误"})`;
    });
    setStatus(lines.join("\n"));
    messageInput.focus();
  } catch (error) {
    setStatus(`新建对话失败: ${error.message}`);
    messageInput.focus();
  } finally {
    setBusy(newChatsButton, false);
  }
}

layoutButton.addEventListener("click", layoutWindows);
newChatsButton.addEventListener("click", resetConversations);
sendAllButton.addEventListener("click", sendAll);

for (const input of platformInputs) {
  input.addEventListener("change", async () => {
    ensureAtLeastOneSelection(input);
    await persistSelection();
  });
}

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendAll();
  }
});

loadSelection().finally(() => {
  messageInput.focus();
});
