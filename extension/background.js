/**
 * CashChase Orbyte SME Copilot — Background Service Worker (Manifest V3)
 * Proxies API calls from https://web.whatsapp.com content script to
 * http://127.0.0.1:8000 and http://localhost:8000 without Mixed-Content,
 * Private Network Access (PNA), or WhatsApp Web CSP restrictions.
 *
 * Also holds the Supabase login (same accounts as the WebApp): the session lives in
 * chrome.storage.local and its access token is added to every backend call.
 */

const DEFAULT_BACKEND = "http://127.0.0.1:8000";

function hostVariants(url) {
  return [url, url.replace("localhost", "127.0.0.1"), url.replace("127.0.0.1", "localhost")];
}

// --- LOGIN (Supabase Auth REST API; extensions cannot load supabase-js from a CDN) ---

// Supabase URL + anon key come from the backend's .env, like the WebApp.
async function getAuthConfig(backend) {
  for (const base of hostVariants(backend || DEFAULT_BACKEND)) {
    try {
      const res = await fetch(`${base}/api/auth/config`);
      if (res.ok) return await res.json();
    } catch (e) {
      // try the next host spelling
    }
  }
  return null;
}

async function supabaseToken(config, grantType, body) {
  const res = await fetch(`${config.url}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.anonKey },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || `Login failed (HTTP ${res.status})`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: data.user && data.user.email,
    role: data.user && data.user.app_metadata && data.user.app_metadata.role === "OWNER" ? "OWNER" : "STAFF"
  };
}

async function loadSession() {
  const { ccSession } = await chrome.storage.local.get("ccSession");
  return ccSession || null;
}

async function saveSession(session) {
  if (session) await chrome.storage.local.set({ ccSession: session });
  else await chrome.storage.local.remove("ccSession");
}

// A valid access token, refreshed when it is about to expire; null when signed out.
async function getAccessToken(backend) {
  const session = await loadSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60 * 1000) return session.accessToken;
  try {
    const config = await getAuthConfig(backend);
    const fresh = await supabaseToken(config, "refresh_token", { refresh_token: session.refreshToken });
    await saveSession(fresh);
    return fresh.accessToken;
  } catch (e) {
    await saveSession(null);  // refresh token revoked or expired: sign in again
    return null;
  }
}

async function handleAuth(message) {
  if (message.type === "CC_AUTH_STATUS") {
    const config = await getAuthConfig(message.backend);
    const enabled = !!(config && config.url && config.anonKey);
    const session = enabled ? await loadSession() : null;
    return { enabled, email: session && session.email, role: session && session.role };
  }
  if (message.type === "CC_AUTH_LOGIN") {
    const config = await getAuthConfig(message.backend);
    if (!config || !config.url) return { ok: false, error: "Cannot reach the CashChase backend." };
    try {
      const session = await supabaseToken(config, "password", { email: message.email, password: message.password });
      await saveSession(session);
      return { ok: true, email: session.email, role: session.role };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }
  if (message.type === "CC_AUTH_LOGOUT") {
    await saveSession(null);
    return { ok: true };
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type && message.type.startsWith("CC_AUTH_")) {
    handleAuth(message).then(sendResponse);
    return true;
  }
  if (!message || message.type !== "CC_API_FETCH") {
    return false;
  }

  (async () => {
    const rawUrl = message.url || DEFAULT_BACKEND;
    const urlsToTry = hostVariants(rawUrl);
    const token = await getAccessToken(new URL(rawUrl).origin);

    let lastErr = null;
    for (const u of urlsToTry) {
      try {
        const fetchOptions = {
          method: message.method || "GET",
          headers: { ...(message.headers || { "Content-Type": "application/json" }) }
        };
        if (token) fetchOptions.headers.Authorization = `Bearer ${token}`;
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
        // The backend answered: pass its status back (e.g. 401 = show the login form).
        sendResponse({
          ok: res.ok,
          status: res.status,
          data
        });
        return;
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
