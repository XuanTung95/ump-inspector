function injectScript(): void {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dist/injected.bundle.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (e) {
    console.error(
      '%cump-inspector%c - failed to inject script into page.',
      'background-color: #dc3545; color: white; padding: 2px 4px; border-radius: 3px; font-weight: bold;',
      'background-color: transparent; color: inherit;',
      e
    );
  }
}

injectScript();

window.addEventListener("message", (event) => {
  if (!event.data || event.source !== window) return;

  console.log("CONTENT GOT MESSAGE:", event.data);

  if (event.data.type === "SAVE_FILE") {
    chrome.runtime.sendMessage(event.data, () => {
      console.log("CONTENT forwarded to BACKGROUND", chrome.runtime.lastError);
    });
  }
});