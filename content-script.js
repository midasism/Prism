function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fireInputEvents(element) {
  element.dispatchEvent(new InputEvent("input", { bubbles: true, data: "" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearEditable(element) {
  element.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
}

async function sendToChatGPT(text) {
  const inputBox =
    document.querySelector("#prompt-textarea") ||
    document.querySelector("div#prompt-textarea[contenteditable='true']");

  if (!inputBox) {
    throw new Error("未找到 ChatGPT 输入框");
  }

  inputBox.focus();
  inputBox.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  inputBox.appendChild(paragraph);
  fireInputEvents(inputBox);

  await sleep(300);

  const sendButton =
    document.querySelector("[data-testid='send-button']") ||
    document.querySelector("button[aria-label*='Send']");

  if (!sendButton) {
    throw new Error("未找到 ChatGPT 发送按钮");
  }

  sendButton.click();
  return "ChatGPT 已发送";
}

async function sendToGemini(text) {
  const inputBox =
    document.querySelector(".ql-editor[contenteditable='true']") ||
    document.querySelector("rich-textarea div[contenteditable='true']") ||
    document.querySelector("div[contenteditable='true'][role='textbox']");

  if (!inputBox) {
    throw new Error("未找到 Gemini 输入框");
  }

  inputBox.focus();
  clearEditable(inputBox);
  await sleep(100);

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  inputBox.appendChild(paragraph);

  inputBox.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text
  }));
  inputBox.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: false,
    inputType: "insertText",
    data: text
  }));
  inputBox.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(600);

  const sendButton =
    document.querySelector("button.send-button") ||
    document.querySelector("button[aria-label='Send message']") ||
    document.querySelector("button[aria-label='发送']") ||
    document.querySelector("button[aria-label*='Send']") ||
    document.querySelector("button[aria-label*='发送']");

  if (sendButton) {
    sendButton.click();
    return "Gemini 已发送";
  }

  inputBox.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  }));
  return "Gemini 已尝试回车发送";
}

async function sendToClaude(text) {
  const candidates = Array.from(document.querySelectorAll("div[contenteditable='true']"));
  const editor =
    candidates.find((node) => node.getAttribute("role") === "textbox") ||
    candidates[0];

  if (!editor) {
    throw new Error("未找到 Claude 输入框");
  }

  editor.focus();
  clearEditable(editor);

  if (!document.execCommand("insertText", false, text)) {
    editor.textContent = text;
  }

  fireInputEvents(editor);
  await sleep(500);

  const sendButton = document.querySelector("button[aria-label*='Send']");
  if (sendButton && !sendButton.disabled) {
    sendButton.click();
    return "Claude 已发送";
  }

  const enterEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true
  });
  editor.dispatchEvent(enterEvent);
  return "Claude 已尝试回车发送";
}

async function sendByPlatform(text) {
  const host = window.location.hostname;

  if (host.includes("chatgpt.com")) {
    return sendToChatGPT(text);
  }
  if (host.includes("gemini.google.com")) {
    return sendToGemini(text);
  }
  if (host.includes("claude.ai")) {
    return sendToClaude(text);
  }

  throw new Error("当前页面不在支持的平台列表中");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "TRI_CHAT_SEND") {
    return undefined;
  }

  sendByPlatform(message.text)
    .then((detail) => sendResponse({ ok: true, detail }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
