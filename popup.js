const messageInput = document.getElementById("message");
const openWindowsButton = document.getElementById("openWindows");
const sendAllButton = document.getElementById("sendAll");
const statusBox = document.getElementById("status");

function setStatus(text) {
  statusBox.textContent = text;
}

function withBusy(button, busy) {
  button.disabled = busy;
}

async function openWindows() {
  withBusy(openWindowsButton, true);
  setStatus("正在打开并平铺三个窗口...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRI_CHAT_OPEN_WINDOWS"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "打开窗口失败");
    }

    const lines = response.targets.map((target) => `已就绪: ${target.label}`);
    setStatus(lines.join("\n"));
  } catch (error) {
    setStatus(`打开失败: ${error.message}`);
  } finally {
    withBusy(openWindowsButton, false);
  }
}

async function sendAll() {
  const text = messageInput.value.trim();
  if (!text) {
    setStatus("请输入消息内容。");
    return;
  }

  withBusy(sendAllButton, true);
  setStatus("正在发送到三个平台...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRI_CHAT_BROADCAST",
      text
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
  } catch (error) {
    setStatus(`发送失败: ${error.message}`);
  } finally {
    withBusy(sendAllButton, false);
  }
}

openWindowsButton.addEventListener("click", openWindows);
sendAllButton.addEventListener("click", sendAll);

messageInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    sendAll();
  }
});
