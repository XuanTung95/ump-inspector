chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "SAVE_FILE") {
    const uint8 = new Uint8Array(msg.bytes);
    const blob = new Blob([uint8], { type: "application/octet-stream" });

    // Chuyển Blob → base64 (MV3-compatible)
    const base64 = await blobToBase64(blob);

    chrome.downloads.download({
      url: base64,          // DÙNG data URL thay vì object URL
      filename: msg.filename,
      saveAs: false
    }, (id) => {
      console.log("Downloaded:", id, chrome.runtime.lastError);
    });
  }
});

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result); // data URL
    reader.readAsDataURL(blob);
  });
}