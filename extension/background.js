/**
 * CashChase Orbyte SME Copilot — Background Service Worker (Manifest V3)
 * Proxies API calls from https://web.whatsapp.com content script to
 * http://127.0.0.1:8000 and http://localhost:8000 without Mixed-Content,
 * Private Network Access (PNA), or WhatsApp Web CSP restrictions.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "CC_API_FETCH") {
    return false;
  }

  (async () => {
    const rawUrl = message.url || "http://127.0.0.1:8000";
    const urlsToTry = [
      rawUrl,
      rawUrl.replace("localhost", "127.0.0.1"),
      rawUrl.replace("127.0.0.1", "localhost")
    ];

    let lastErr = null;
    for (const u of urlsToTry) {
      try {
        const fetchOptions = {
          method: message.method || "GET",
          headers: message.headers || { "Content-Type": "application/json" }
        };
        if (message.body) {
          fetchOptions.body =
            typeof message.body === "string" ? message.body : JSON.stringify(message.body);
        }
        const res = await fetch(u, fetchOptions);
        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { raw: text };
        }
        if (res.ok) {
          sendResponse({
            ok: true,
            status: res.status,
            data
          });
          return;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    sendResponse({
      ok: false,
      status: 0,
      error: String(lastErr && lastErr.message ? lastErr.message : lastErr || "Failed to fetch")
    });
  })();

  return true; // Keep async message channel open
});
