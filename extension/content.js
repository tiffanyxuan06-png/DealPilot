/**
 * Closiq (CashChase Orbyte SME Copilot) — Chrome/Edge Content Script for WhatsApp Web
 * Combines the best of WA_extension (auto-detects active chat + pre-caches unread sidebar chats
 * via MutationObserver + 1s heartbeat, synthetic InputEvent insertion) with CashChase's
 * ultra-clean 1-Page Copilot (Zero tab/menu bloat, Cross-Chat Client Memory, Auto PDF/Receipt OCR).
 */

// The backend this sidebar talks to: this computer by default, or a Replit address set on the sign-in screen.
const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
let BACKEND_URL = (() => {
  try {
    return localStorage.getItem("cashchase_backend") || DEFAULT_BACKEND_URL;
  } catch (e) {
    return DEFAULT_BACKEND_URL;
  }
})();

// Only hosts the manifest lets the extension reach: this computer, or Replit (https). Returns "" if not allowed.
function normalizeBackendUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch (e) {
    return "";
  }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const replit = url.protocol === "https:" && /\.(replit\.app|replit\.dev|repl\.co)$/.test(url.hostname);
  if (!(local && url.protocol === "http:") && !replit) return "";
  return url.origin;
}

async function connectBackend() {
  const input = document.getElementById("cc-server-input");
  const msg = document.getElementById("cc-server-msg");
  const url = normalizeBackendUrl(input.value);
  if (!url) {
    msg.textContent = "Use this computer (http://127.0.0.1:8000) or a Replit address (https://….replit.app).";
    return;
  }
  BACKEND_URL = url;
  input.value = url;
  try {
    localStorage.setItem("cashchase_backend", url);
  } catch (e) {
    // storage blocked: this address lasts until the page reloads
  }
  msg.textContent = "Connecting…";
  try {
    await ccApiRequest("/api/auth/config", "GET");
    msg.textContent = `Connected to ${new URL(url).host}.`;
  } catch (e) {
    msg.textContent = `Can't reach ${new URL(url).host}. Is the server running?`;
  }
  await refreshCcAuth();
  refreshStateFromBackend();
}

// Who is using the sidebar. The backend enforces what this role may do (Settings → Team & Permissions).
function getCcRole() {
  try {
    return localStorage.getItem("cashchase_role") === "STAFF" ? "STAFF" : "OWNER";
  } catch (e) {
    return "OWNER";
  }
}

function setCcRole(role) {
  try {
    localStorage.setItem("cashchase_role", role);
  } catch (e) {
    // storage blocked: the selection lasts for this page only
  }
}

// Demo accounts (same as the WebApp). Only used when the backend has login off; the role is sent as before.
const DEMO_ACCOUNTS = {
  "hafiz@sejukjaya.my": { role: "OWNER", name: "Encik Hafiz" },
  "aina@sejukjaya.my": { role: "STAFF", name: "Aina" },
  "admin@cashchase.my": { role: "OWNER", name: "Admin", password: "admin1234" }
};
let ccLoginEnabled = false; // true when the backend has Supabase login on

function getDemoEmail() {
  try {
    return localStorage.getItem("cashchase_demo_email") || "";
  } catch (e) {
    return "";
  }
}

function setDemoEmail(email) {
  try {
    if (email) localStorage.setItem("cashchase_demo_email", email);
    else localStorage.removeItem("cashchase_demo_email");
  } catch (e) {
    // storage blocked: signed in for this page only
  }
}
let lastAnalysis = null;
let currentActiveChat = "";
let lastProcessedActiveMsg = "";
const precomputedCache = new Map(); // cacheKey -> cached analysis response
const processedSidebarPreviews = new Map(); // contactTitle -> last unread preview text
let lastDetectedAttachmentKey = "";
let isAnalyzing = false;
let repTypedDraft = false; // the rep typed in the reply box: a new customer message must not overwrite it
let lastAnalyzedHash = "";
let knownCustomers = null; // customers from GET /api/state; null = not loaded (backend offline)
let knownDeals = []; // deals and reps from GET /api/state (for the follow-ups card and the deal line)
let knownReps = [];
let knownReengage = []; // quiet buyers from GET /api/state (reengage), counted on the closed circle
let knownProducts = []; // the price list (sku, name, sellPrice) from GET /api/state; the offline guess prices only from this
let gateState = ""; // "not_customer" | "offline" while the panel shows a blocked contact
let isAddingCustomer = false;

function getCacheKey(customer, message, instruction = "") {
  const cleanCust = (customer || "").trim().toLowerCase();
  const cleanMsg = (message || "").trim();
  const cleanInstr = (instruction || "").trim().toLowerCase();
  return `${cleanCust}::${cleanMsg}::${cleanInstr}`;
}

// Privileged API helper: proxies via background.js service worker to bypass
// WhatsApp Web HTTPS->HTTP Mixed Content & Chrome Private Network Access (PNA),
// with automatic fallback to direct fetch.
async function ccApiRequest(path, method = "GET", bodyObj = null) {
  const fullUrl = `${BACKEND_URL}${path}`;
  const reqHeaders = { "Content-Type": "application/json", "X-CashChase-Role": getCcRole() };
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const bgRes = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "CC_API_FETCH",
            url: fullUrl,
            method,
            headers: reqHeaders,
            body: bodyObj ? JSON.stringify(bodyObj) : null
          },
          (resp) => {
            if (chrome.runtime.lastError || !resp) {
              reject(chrome.runtime.lastError || new Error("No background response"));
            } else {
              resolve(resp);
            }
          }
        );
      });
      if (bgRes && bgRes.ok && bgRes.data) {
        return bgRes.data;
      }
      if (bgRes && bgRes.status) {
        // The backend answered with an error; a direct fetch would get the same (and has no login token).
        if (bgRes.status === 401) showCcAuth({ enabled: true });
        throw new Error(`HTTP ${bgRes.status}`);
      }
    } catch (e) {
      if (String(e && e.message).startsWith("HTTP ")) throw e;
      // Fallback to direct fetch below
    }
  }

  const opts = {
    method,
    headers: reqHeaders
  };
  if (bodyObj) opts.body = JSON.stringify(bodyObj);
  const directRes = await fetch(fullUrl, opts);
  if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
  return await directRes.json();
}

// --- LOGIN (same Supabase accounts as the WebApp; the session is kept by background.js) ---
function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ backend: BACKEND_URL, ...message }, (resp) => {
        resolve(chrome.runtime.lastError ? null : resp);
      });
    } catch (e) {
      resolve(null);  // extension was reloaded: this page needs a refresh
    }
  });
}

// status: { enabled, email, role } — login form when nobody is signed in. With login off it takes the demo accounts.
function showCcAuth(status) {
  ccLoginEnabled = !!(status && status.enabled);
  if (!ccLoginEnabled && getDemoEmail()) status = { email: getDemoEmail(), role: getCcRole() };
  const signedIn = !!(status && status.email);
  const loginBox = document.getElementById("cc-login");
  const userPill = document.getElementById("cc-user-pill");
  if (!loginBox) return;
  loginBox.style.display = signedIn ? "none" : "block";
  const root = document.getElementById("cashchase-wa-ext-root");
  if (root) root.setAttribute("data-auth", signedIn ? "in" : "out");   // signed out: only the sign-in form shows
  const privacy = document.getElementById("cc-privacy-link");
  if (privacy) privacy.href = `${BACKEND_URL}/static/privacy.html`;   // served by whichever server the sidebar uses
  const sub = document.getElementById("cc-login-sub");
  if (sub) sub.textContent = ccLoginEnabled ? "Same email and password as the WebApp." : "Demo: pick an account below, or admin@cashchase.my / admin1234.";
  const demo = document.getElementById("cc-login-demo");
  if (demo) demo.style.display = ccLoginEnabled ? "none" : "flex";
  userPill.style.display = signedIn ? "flex" : "none";
  if (signedIn) {
    document.getElementById("cc-user-text").textContent =
      `${status.role === "OWNER" ? "👑 Owner" : "👤 Staff"} · ${status.email}`;
  }
}

async function refreshCcAuth() {
  showCcAuth(await sendToBackground({ type: "CC_AUTH_STATUS" }));
}

async function submitCcLogin(event) {
  event.preventDefault();
  const errorEl = document.getElementById("cc-login-error");
  const button = document.getElementById("cc-login-submit");
  errorEl.style.display = "none";
  if (!ccLoginEnabled) {
    const email = document.getElementById("cc-login-email").value.trim().toLowerCase();
    const password = document.getElementById("cc-login-password").value;
    const account = DEMO_ACCOUNTS[email];
    const error = !account ? "No demo account with that email."
      : password.length < 6 ? "That password is too short."
        : account.password && password !== account.password ? "Wrong email or password." : "";
    if (error) {
      errorEl.textContent = error;
      errorEl.style.display = "block";
      return;
    }
    setCcRole(account.role);
    setDemoEmail(email);
    document.getElementById("cc-login-password").value = "";
    showCcAuth({ enabled: false });
    refreshStateFromBackend();
    return;
  }
  button.disabled = true;
  const resp = await sendToBackground({
    type: "CC_AUTH_LOGIN",
    email: document.getElementById("cc-login-email").value.trim(),
    password: document.getElementById("cc-login-password").value
  });
  button.disabled = false;
  if (!resp || !resp.ok) {
    errorEl.textContent = (resp && resp.error) || "Login failed. Refresh WhatsApp Web and try again.";
    errorEl.style.display = "block";
    return;
  }
  document.getElementById("cc-login-password").value = "";
  showCcAuth({ enabled: true, email: resp.email, role: resp.role });
  refreshStateFromBackend();
}

async function ccLogout() {
  if (!ccLoginEnabled) {
    setDemoEmail("");
    showCcAuth({ enabled: false });
    return;
  }
  await sendToBackground({ type: "CC_AUTH_LOGOUT" });
  showCcAuth({ enabled: true });
}

function ccDemoLogin(email) {
  document.getElementById("cc-login-email").value = email;
  document.getElementById("cc-login-password").value = "demo1234";
  submitCcLogin({ preventDefault() {} });
}

// Mirrors backend clean_customer_name: drop (tags) / [tags], then trim spaces and !?,.:;*#-_"' from both ends.
function cleanCustomerName(name) {
  if (!name) return "Client";
  return name.replace(/\s*[(\[][^)\]]*[)\]]/g, "").replace(/^[\s!?,.:;*#\-_"']+|[\s!?,.:;*#\-_"']+$/g, "") || name;
}

const phoneDigits = (s) => String(s || "").replace(/\D/g, "");
// A WhatsApp title can be a phone number; send it so the backend matches by phone like the local check does.
const titlePhone = (title) => (phoneDigits(title).length >= 7 ? phoneDigits(title) : "");
const backendDenied = new Set(); // titles the backend refused as "not a customer" even though our list had them

// Same rule as the backend (is_customer): clean name equal, case-insensitive, or phone digits
// (both >= 7) where one ends with the other. A WhatsApp title is a saved name or a phone number, so it is tried as both.
function isKnownCustomer(title) {
  const key = cleanCustomerName(title).toLowerCase();
  const digits = phoneDigits(title);
  return (knownCustomers || []).some((c) => {
    const p = phoneDigits(c.phone);
    return String(c.name || "").toLowerCase() === key ||
      (digits.length >= 7 && p.length >= 7 && (digits.endsWith(p) || p.endsWith(digits)));
  });
}

function updateAddCustomerBtn(title) {
  const btn = document.getElementById("cc-add-cust-btn");
  if (!btn) return;
  if (!title || title === "No Chat Open" || title === "Client") {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-flex";
  const isCust = isKnownCustomer(title);
  if (isCust) {
    btn.textContent = "✓ Customer";
    btn.style.background = "#DCFCE7";
    btn.style.color = "#15803D";
    btn.style.border = "1px solid #86EFAC";
    btn.style.cursor = "default";
    btn.title = "This contact is a registered Closiq customer";
  } else {
    btn.textContent = "➕ Add Customer";
    btn.style.background = "#10B981";
    btn.style.color = "#ffffff";
    btn.style.border = "none";
    btn.style.cursor = "pointer";
    btn.title = "Add this contact as a Closiq customer so messages can be read";
  }
}

// Customers only: true (and the "Not a customer" / offline state is drawn) when this contact must not be analysed.
function blockIfNotCustomer(title) {
  if (knownCustomers && !backendDenied.has(title) && isKnownCustomer(title)) {
    gateState = "";
    updateAddCustomerBtn(title);
    return false;
  }
  renderNotCustomer(title);
  return true;
}

function renderNotCustomer(title) {
  const offline = !knownCustomers;
  gateState = offline ? "offline" : "not_customer";
  lastAnalysis = null;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("cc-ext-title", offline ? "⚠️ Can't check the customer list (backend offline)" : "🚫 Not a customer");
  set("cc-intent-badge", offline ? "Offline" : "Not a customer");
  set("cc-ext-check", offline
    ? "Nothing is sent until the customer list loads. Start the backend, then tap 🔄 Rescan."
    : "Closiq only reads chats from your customers, so nothing was sent. Add this contact to start quoting.");
  set("cc-msg-snippet", "Messages are not read for this contact.");
  set("cc-deal-ctx", "");
  set("cc-big-action-btn", offline ? "⚠️ Backend offline" : "➕ Add as customer");
  const msgInput = document.getElementById("cc-message-input");
  if (msgInput) msgInput.value = "";
  const draftEl = document.getElementById("cc-draft-output");
  if (draftEl) { draftEl.value = ""; draftEl.disabled = false; }
  const tabsEl = document.getElementById("cc-reply-tabs");
  if (tabsEl) tabsEl.innerHTML = "";
  const paramBox = document.getElementById("cc-custom-param-box");
  if (paramBox) paramBox.style.display = "none";
  const btnEl = document.getElementById("cc-big-action-btn");
  if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = "1"; }
  const banner = document.getElementById("cc-auto-ocr-banner");   // no "Quote from photo" for a blocked contact
  if (banner) { banner.style.display = "none"; banner.innerHTML = ""; }
  refreshClientMemoryPill(title);
  updateAddCustomerBtn(title);
  setMascot(offline ? "COMPLAINT" : "CASUAL_CHAT");
  const say = document.getElementById("cc-mascot-say");
  if (say) say.textContent = offline ? "Can't reach Closiq" : "Not a customer yet";
  const check = document.getElementById("cc-ext-check");
  if (check && offline) check.textContent += " Run python run_server.py on this computer.";
  renderPaymentCheck(null);
  setPanelMode("blocked");
}

// Re-read the open chat from the page, locally (no network): used once the customer list changes.
function reevaluateChat() {
  currentActiveChat = "";
  lastDetectedAttachmentKey = "";   // offer the photo button again if this contact is now a customer
  scanActiveWhatsAppChat(false);
}

async function addCurrentAsCustomer() {
  const title = currentActiveChat || getActiveChatTitle() || document.getElementById("cc-customer-input")?.value?.trim();
  if (!title || title === "No Chat Open" || isAddingCustomer) return;
  isAddingCustomer = true;
  currentActiveChat = title;
  const addBtn = document.getElementById("cc-add-cust-btn");
  const origBtnText = addBtn ? addBtn.textContent : "";
  if (addBtn) {
    addBtn.textContent = "⏳ Adding...";
    addBtn.disabled = true;
  }
  try {
    const cleanName = cleanCustomerName(title);
    const digits = titlePhone(title);
    const role = getCcRole();



    await ccApiRequest("/api/customers", "POST", {
      name: cleanName,
      phone: digits,
      role: role
    });
    backendDenied.delete(title);

    // Keep newly added customer in local allowlist and localStorage immediately
    saveLocalCustomer({ name: cleanName, phone: digits });
    if (!knownCustomers) knownCustomers = [];
    if (!isKnownCustomer(title)) {
      knownCustomers.push({ name: cleanName, phone: digits });
    }

    gateState = "";
    updateAddCustomerBtn(title);

    // Success re-reads the open chat as a customer (normal idle state, nothing analysed). If the refresh failed, Rescan retries it.
    if (!(await refreshStateFromBackend())) {
      const checkEl = document.getElementById("cc-ext-check");
      if (checkEl) checkEl.textContent = "Added. Tap 🔄 Rescan to reload the customer list.";
    } else {
      reevaluateChat();
    }
  } catch (err) {

    const checkEl = document.getElementById("cc-ext-check");
    const denied = String(err && err.message).includes("403");
    const isOffline = String(err && err.message).includes("Failed to fetch") || String(err && err.message).includes("NetworkError");
    if (checkEl) {
      if (denied) {
        checkEl.textContent = "🔒 Staff can't add customers (ask the Owner).";
      } else if (isOffline) {
        checkEl.textContent = "⚠️ Couldn't add customer — backend server is offline. Run: python run_server.py";
      } else {
        checkEl.textContent = `Couldn't add this customer (${err && err.message}). Try again.`;
      }
    }
    if (addBtn) {
      addBtn.textContent = isOffline ? "⚠️ Server Offline" : "⚠️ Failed";
      setTimeout(() => {
        if (addBtn) {
          addBtn.textContent = origBtnText || "➕ Add Customer";
          addBtn.disabled = false;
        }
      }, 3000);
    }
  } finally {
    isAddingCustomer = false;
    if (addBtn) addBtn.disabled = false;
  }
}

function buildLocalSmartAnalysis(customer, message, userInstruction = "") {
  const cleanCust = cleanCustomerName(customer);
  const combined = `${message} ${userInstruction}`.toLowerCase();

  // Check if message is a genuine business inquiry or casual chat with friends
  const isBusinessInquiry =
    Boolean(userInstruction.trim()) ||
    /(?:aircond|aircon|daikin|inverter|gas|r32|pipe|copper|quote|quotation|sebut harga|harga|price|deposit|duitnow|stok|stock|pasang|install|bocor|leak|rosak|repair|technician)/i.test(combined);

  if (!isBusinessInquiry) {
    const greeting = `Hi ${cleanCust}! Let us know if you need any aircond supply or installation assistance today.`;
    return {
      source: "local_smart_engine",
      lmstudio_connected: false,
      model_used: "Local Smart Engine",
      analysis: {
        intent: "CASUAL_CHAT",
        badge: "💬 Casual Chat",
        extTitle: `💬 Chatting with ${cleanCust}`,
        extCheck: "🟢 Personal / casual chat detected.\nNo quotation needed.",
        extActionDesc: "Casual conversation. Type in 'PROMPT AI' below if this contact asks for a quote.",
        extDraft: greeting,
        replyOptions: [
          { label: "👋 Friendly Greeting", text: greeting },
          { label: "🇲🇾 Bahasa Melayu", text: `Salam ${cleanCust}, ada apa yang boleh kami bantu untuk aircond hari ini?` }
        ],
        extBtnLabel: "💬 Insert Friendly Reply",
        extActionType: "NO_ACTION",
        amount: 0,
        clientMemory: {
          tier: "NEW_CLIENT",
          score: 50,
          styleSummary: "Personal / casual contact",
          paymentBehavior: "No past business transactions"
        }
      }
    };
  }

  // Prices come only from the price list in GET /api/state. Nothing loaded, or nothing matched: no RM at all.
  const lines = matchPriceListItems(combined) || [];
  const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const memory = localClientMemory(customer);
  if (!lines.length) {
    const wait = `Hi ${cleanCust}! Thanks for asking. Let me confirm the price and get back to you shortly.`;
    return {
      source: "local_smart_engine",
      lmstudio_connected: false,
      model_used: "Local Smart Engine",
      analysis: {
        intent: "BUYING_INQUIRY",
        badge: "1. Price & Quote Info",
        extTitle: "📋 Customer is asking about price",
        extCheck: "No price yet. Tap 🔄 Rescan to quote from your price list.",
        extActionDesc: "Insert a holding reply, then Rescan for the price-list quote.",
        extDraft: wait,
        replyOptions: [
          { label: "💬 Option 1: Will confirm price", text: wait },
          { label: "🇲🇾 Option 2: Bahasa Melayu", text: `Salam ${cleanCust}, terima kasih. Saya akan semak harga dan hubungi anda semula sebentar lagi.` }
        ],
        extBtnLabel: "💬 Insert Selected Reply",
        extActionType: "REPLY_ONLY",
        amount: 0,
        clientMemory: memory
      }
    };
  }

  const scopeStr = lines.map((l) => `${l.qty}x ${l.name} (RM ${(l.qty * l.price).toLocaleString()})`).join(" + ");
  const disclaimer = "Subject to stock availability · prices valid 7 days";   // the same legal wording the backend adds
  const opt1 = `Hi ${cleanCust}! ${scopeStr} = RM ${total.toLocaleString()}. ${disclaimer}. Let us know if you would like to confirm and we will arrange the deposit and delivery!`;
  const opt2 = `Official Quotation for ${cleanCust}: ${scopeStr} = Total RM ${total.toLocaleString()}. ${disclaimer}. Please let us know to confirm your order and we will advise the deposit and delivery schedule.`;
  const opt3 = `Boss, ${scopeStr} = Total RM ${total.toLocaleString()}. Confirm anytime and we will arrange earliest delivery! (${disclaimer})`;
  const opt4 = `Salam ${cleanCust}, sebut harga untuk ${scopeStr} ialah RM ${total.toLocaleString()}. Sila sahkan pesanan dan kami akan maklumkan deposit serta jadual penghantaran. (${disclaimer})`;

  // An offline guess from the loaded price list; Rescan asks the backend for the real quote.
  return {
    source: "local_smart_engine",
    lmstudio_connected: false,
    model_used: "Local Smart Engine",
    analysis: {
      intent: "BUYING_INQUIRY",
      badge: userInstruction ? "✨ Custom Quote" : "1. Price & Quote Info",
      extTitle: userInstruction ? `✨ Custom Quote (${userInstruction}) · Draft` : "📋 Price Quotation · Draft",
      extCheck:
        lines.map((l) => `${l.qty} × RM ${l.price.toLocaleString()} ${l.name}`).join("\n") + "\n" +
        `💰 Quote Total: RM ${total.toLocaleString()}\n` +
        `${disclaimer}\n` +
        `ℹ️ Rough estimate only. Tap 🔄 Rescan for the price-list quote.`,
      extActionDesc: "Insert the quotation reply below. Rescan for the exact price-list quote before sending.",
      extDraft: opt1,
      replyOptions: [
        { label: "💬 Option 1: Price Quote", text: opt1 },
        { label: "📋 Option 2: Official Quotation (Deposit Required)", text: opt2 },
        { label: "🤝 Option 3: Boss Style", text: opt3 },
        { label: "🇲🇾 Option 4: Bahasa Melayu (Sebut Harga Rasmi)", text: opt4 }
      ],
      extBtnLabel: `💬 Insert Selected Reply`,
      extActionType: "REPLY_ONLY",
      amount: total,
      clientMemory: memory
    }
  };
}

// Price-list lines named in a message: by SKU, or by the name's first word plus its size (1.5HP) if it has one.
// The quantity is a standalone whole number of 1-99 just before the name, or "x5" right after it; 1 if there is no number.
// Anything unclear (a phone number, "1.5", 100+): the quantity is unknown, so null comes back and no RM is guessed.
function matchPriceListItems(text) {
  const t = text.replace(/(\d)\s+hp\b/g, "$1hp");
  const out = [];
  for (const p of knownProducts) {
    const price = Number(p.sellPrice);
    const name = String(p.name || "").toLowerCase();
    if (!price || !name) continue;
    const size = (name.match(/\b\d+(?:\.\d+)?hp\b/) || [""])[0];
    const first = name.split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
    const key = String(p.sku || "").toLowerCase();
    const hit = (key && t.includes(key)) ? key : (first.length >= 3 && t.includes(first) && (!size || t.includes(size)) ? first : "");
    if (!hit) continue;
    const at = t.indexOf(hit);
    const before = t.slice(0, at);
    const lead = before.match(/(?:^|[^\d.+])(\d{1,2})\s*(?:x|units?|sets?|bottles?|tanks?|pcs)?\s*$/);
    const after = t.slice(at + hit.length).replace(/^\s*\d+(?:\.\d+)?hp\b/, "");
    const trail = after.match(/^\s*(?:[x×]\s*(\d{1,2})(?!\d)|(\d{1,2})\s*(?:units?|sets?|pcs)\b)/);
    const unclear = /[\d.+]\s*(?:x|units?|sets?|bottles?|tanks?|pcs)?\s*$/.test(before) || /^\s*[x×]?\s*\d/.test(after);
    const qty = lead ? parseInt(lead[1], 10) : trail ? parseInt(trail[1] || trail[2], 10) : unclear ? 0 : 1;
    if (qty < 1) return null;
    out.push({ name: p.name, price, qty });
  }
  return out;
}

function localClientMemory(customer) {
  const knownDemos = {
    "tan bros trading": {
      tier: "VIP_FAST_PAYER",
      score: 94,
      styleSummary: "Friendly Malaysian Boss style ('Boss, can less?') · Prefers fast itemization",
      paymentBehavior: "⭐⭐⭐⭐⭐ Grade A Client · Repeat orders, always paid · Pays the deposit promptly"
    },
    "klinik dr. lim": {
      tier: "LONG_TERM_PARTNER",
      score: 88,
      styleSummary: "Polite & professional medical clinic · Values fast aftersales service",
      paymentBehavior: "⭐⭐⭐⭐ Reliable Payer · Repeat orders, always paid · Currently reporting leaking valve"
    },
    "kedai runcit ah seng": {
      tier: "SLOW_PAYER_GHOST_RISK",
      score: 42,
      styleSummary: "Short casual messages · Frequently delays the deposit",
      paymentBehavior: "⚠️ High Ghosting Risk · Past quotes went cold · Ask for the deposit up front"
    },
    "wisma perdana": {
      tier: "PARTIAL_SHORT_PAYER",
      score: 58,
      styleSummary: "Corporate procurement · Tends to round down or deduct amounts",
      paymentBehavior: "⚠️ Shortfall Risk · Has paid less than invoiced before · Verify the bank amount"
    }
  };
  const custLower = (customer || "").toLowerCase();
  for (const [k, v] of Object.entries(knownDemos)) {
    if (custLower.includes(k)) return v;
  }
  return {
    tier: "NEW_CLIENT",
    score: 50,
    styleSummary: "New contact · First-time interaction",
    paymentBehavior: "🆕 New Customer · No past transaction history · Ask for a deposit"
  };
}

// ============================================================================
// 1. ROBUST WHATSAPP WEB DOM DETECTION (FROM WA_extension)
// ============================================================================
function findConversationHeader() {
  let header = document.querySelector("#main header");
  if (header) return header;
  const headers = document.querySelectorAll("header");
  for (const h of headers) {
    if (!h.closest("#side") && !h.closest("#pane-side") && !h.closest('div[data-testid="chat-list"]')) {
      return h;
    }
  }
  return null;
}

function getActiveChatTitle() {
  const header = findConversationHeader();
  if (!header) return "";
  const candidate =
    header.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
    header.querySelector('span[dir="auto"][title]') ||
    header.querySelector('div[role="button"] span[dir="auto"]') ||
    header.querySelector('span.selectable-text[dir="auto"]') ||
    header.querySelector("h2") ||
    header.querySelector('span[dir="auto"]');
  if (candidate) {
    return (candidate.getAttribute("title") || candidate.textContent || "").trim();
  }
  return "";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function classifyWhatsAppBubble(element, activeChatTitle = null) {
  if (!element) return null;

  // 1. Skip system notifications / date dividers / encryption text
  if (
    element.matches?.('[data-testid="system-message-text"], [data-testid="chat-history-divider"], .system-message') ||
    element.querySelector?.('[data-testid="system-message-text"], [data-testid="chat-history-divider"], span[data-icon="lock-small"]') ||
    element.classList?.contains("system-message")
  ) {
    return null;
  }

  // 2. data-pre-plain-text attribute (Most reliable in modern WhatsApp Web)
  const prePlain =
    element.getAttribute?.("data-pre-plain-text") ||
    element.querySelector?.("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") ||
    element.closest?.("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") ||
    "";
  if (prePlain) {
    const senderMatch = prePlain.match(/\]\s*([^:]+)\s*:\s*$/);
    const senderName = senderMatch ? senderMatch[1].trim() : "";
    const title = (activeChatTitle || getActiveChatTitle() || "").trim();
    if (title && senderName && senderName.toLowerCase() === title.toLowerCase()) {
      return "CLIENT";
    }
    if (/(?:^|[\s\]])(You|Anda|你|您|Tú|Você|Voce|Vous|Du)$/i.test(senderName)) {
      return "ME";
    }
    if (senderName) {
      return "CLIENT";
    }
  }

  // 3. Check delivery ticks (ONLY outgoing messages sent by ME have status ticks)
  const rowOrSelf = element.closest?.('[role="row"], [data-id]') || element;
  if (
    element.querySelector?.(
      '[data-icon*="check"], [data-testid*="check"], [data-icon*="dblcheck"], [data-testid*="dblcheck"], [data-icon="msg-time"], [data-testid="msg-time"], span[data-icon*="status-"]'
    ) ||
    rowOrSelf.querySelector?.(
      '[data-icon*="check"], [data-testid*="check"], [data-icon*="dblcheck"], [data-testid*="dblcheck"], [data-icon="msg-time"], [data-testid="msg-time"], span[data-icon*="status-"]'
    )
  ) {
    return "ME";
  }

  // 4. data-id and CSS classes (from WA_extension)
  const id =
    element.getAttribute?.("data-id") ||
    element.closest?.("[data-id]")?.getAttribute("data-id") ||
    element.querySelector?.("[data-id]")?.getAttribute("data-id") ||
    "";
  const cls = `${element.className || ""} ${element.closest?.('[class*="message-"]')?.className || ""}`;

  if (id.includes("true_") || cls.includes("message-out")) {
    return "ME";
  }
  if (id.includes("false_") || cls.includes("message-in")) {
    return "CLIENT";
  }

  // 5. Fallback from WA_extension: any chat row not outgoing is from client
  return "CLIENT";
}

function extractCleanText(element) {
  if (!element) return "";

  // WhatsApp Web specific text containers (from WA_extension)
  const textNode =
    element.querySelector?.(".selectable-text") ||
    element.querySelector?.(".copyable-text") ||
    element.querySelector?.('span[dir="ltr"]') ||
    element.querySelector?.('span[dir="auto"]');

  let raw = textNode ? (textNode.innerText || textNode.textContent || "") : (element.innerText || element.textContent || "");
  if (!raw) return "";

  // Clean trailing timestamps, e.g. "10:24 AM", "15:30", "Edited"
  raw = raw.replace(/\n?\d{1,2}:\d{2}(\s*(AM|PM|am|pm))?$/gi, "").trim();
  raw = raw.replace(/\n?(Edited|Editado|Telah diedit|已编辑)$/gi, "").trim();
  return raw;
}

function findMessagesContainer() {
  return (
    document.querySelector("#main") ||
    document.querySelector('[data-testid="conversation-panel-messages"]')?.closest('div[role="region"]') ||
    document.querySelector('div[data-testid="conversation-panel-wrapper"]')
  );
}

// ============================================================================
// 2. AUTO-DETECT IMAGE / PDF RECEIPT ATTACHMENTS IN WHATSAPP CHAT
// ============================================================================
function detectIncomingReceiptOrPdf(mainContainer, chatTitle) {
  if (!mainContainer) return null;

  // Check incoming bubbles using WA_extension method
  let incomingBubbles = mainContainer.querySelectorAll('[data-id*="false_"], [class*="message-in"]');
  if (!incomingBubbles || incomingBubbles.length === 0) {
    const allRows = mainContainer.querySelectorAll('[data-id], div[role="row"]');
    const filtered = [];
    allRows.forEach((r) => {
      const id = r.getAttribute("data-id") || "";
      const cls = r.className || "";
      const hasTick = r.querySelector?.(
        '[data-icon*="check"], [data-testid*="check"], [data-icon*="dblcheck"], [data-testid*="dblcheck"], [data-icon="msg-time"], [data-testid="msg-time"], span[data-icon*="status-"]'
      );
      if (!id.includes("true_") && !cls.includes("message-out") && !hasTick) {
        filtered.push(r);
      }
    });
    incomingBubbles = filtered;
  }
  if (!incomingBubbles || incomingBubbles.length === 0) return null;

  const lastRow = incomingBubbles[incomingBubbles.length - 1];
  const rowText = (lastRow.innerText || lastRow.textContent || "").trim();

  // Check if it's a PDF document attachment
  const isPdfBubble =
    rowText.toLowerCase().includes(".pdf") ||
    lastRow.querySelector('[data-icon*="document"], [data-testid*="document"], [title*=".pdf" i]');

  if (isPdfBubble) {
    const pdfMatch = rowText.match(/([^\n]+\.pdf)/i);
    const fileName = pdfMatch ? pdfMatch[1].trim() : `DuitNow_Receipt_${chatTitle.replace(/\s+/g, "_")}.pdf`;
    return {
      type: "PDF_DOCUMENT",
      fileName,
      imageBase64: null
    };
  }

  // Check image receipt (blob: or data:image)
  const imgs = lastRow.querySelectorAll("img");
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if ((src.startsWith("blob:") || src.startsWith("data:image")) && img.width > 80) {
      return {
        type: "IMAGE_RECEIPT",
        fileName: `WhatsApp_Receipt_${chatTitle.replace(/\s+/g, "_")}.png`,
        imgElement: img,
        src
      };
    }
  }

  return null;
}

async function blobUrlToBase64(blobUrl) {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

// ============================================================================
// 3.INSERT TEXT INTO WHATSAPP INPUT BOX (WITH SYNTHETIC INPUT EVENT)
// ============================================================================
function insertReplyIntoWhatsAppBox(text) {
  if (!text) return false;
  const selectors = [
    '#main footer div[contenteditable="true"]',
    'footer div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][role="textbox"]',
    'footer div[role="textbox"]'
  ];
  let chatInput = null;
  for (const sel of selectors) {
    chatInput = document.querySelector(sel);
    if (chatInput) break;
  }
  if (!chatInput) return false;

  try {
    chatInput.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(chatInput);
    selection.removeAllRanges();
    selection.addRange(range);

    // WhatsApp's editor applies insertText a moment later, so the box can't be checked right away. Falling back
    // whenever it still looked empty sent a second insert, and the reply appeared twice.
    const executed = document.execCommand("insertText", false, text);
    if (!executed) {
      const inputEvent = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      });
      chatInput.dispatchEvent(inputEvent);
      chatInput.innerText = text;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      chatInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  } catch (err) {
    return false;
  }
}

// ============================================================================
// 4. PRE-COMPUTE & CACHE UNREAD CHATS IN LEFT SIDEBAR (#pane-side)
// ============================================================================
function scanUnreadSidebarChatsAndPreCache() {
  const paneSide =
    document.querySelector("#pane-side") ||
    document.querySelector('div[aria-label*="Chat list" i]') ||
    document.querySelector('div[data-testid="chat-list"]');
  if (!paneSide) return;

  const chatRows = paneSide.querySelectorAll('div[role="listitem"], div[role="row"], div[tabindex="-1"]');
  chatRows.forEach((row) => {
    const unreadBadge =
      row.querySelector('span[aria-label*="unread" i]') ||
      row.querySelector('span[class*="unread" i]') ||
      row.querySelector('span[data-testid="unread-count"]');
    if (!unreadBadge) return;

    const titleEl =
      row.querySelector("span[title]") ||
      row.querySelector('div[role="gridcell"] span[dir="auto"]') ||
      row.querySelector('span[dir="auto"]');
    if (!titleEl) return;

    const contactTitle = (titleEl.getAttribute("title") || titleEl.textContent || "").trim();
    if (!contactTitle) return;

    const textSpans = row.querySelectorAll('span[dir="ltr"], span[dir="auto"]');
    let previewText = "";
    for (let i = textSpans.length - 1; i >= 0; i--) {
      const t = textSpans[i].textContent.trim();
      if (t && t !== contactTitle && !/^\d{1,2}:\d{2}/.test(t) && !/^\d+$/.test(t)) {
        previewText = t;
        break;
      }
    }
    if (!previewText) return;

    const cacheKey = getCacheKey(contactTitle, previewText);
    if (processedSidebarPreviews.get(contactTitle) === previewText && precomputedCache.has(cacheKey)) return;
    processedSidebarPreviews.set(contactTitle, previewText);

    // Instant local pre-computation with 0 network calls and 0 LLM token cost!
    const localData = buildLocalSmartAnalysis(contactTitle, previewText, "");
    precomputedCache.set(cacheKey, localData);
    updateCacheBadgeCount();
  });
}

function updateCacheBadgeCount() {
  const badgeEl = document.getElementById("cc-cache-pill");
  if (badgeEl) {
    badgeEl.textContent = `⚡ ${precomputedCache.size} Pre-Cached`;
  }
}

// Network lookup only when the user clicks Analyse/Rescan (lookup=true); switching chats never sends the name.
function refreshClientMemoryPill(customer, lookup = false) {
  const safeName = customer || "Customer";
  const memPill = document.getElementById("cc-mem-pill");
  if (!memPill) return;

  if (!lookup) {
    renderRating(safeName, null);
    memPill.textContent = "Client Ready";
    memPill.style.background = "#E6EEFF";
    memPill.style.color = "#0152FC";
    memPill.style.border = "";
    memPill.title = "Tap Rescan to check this client's history.";
    return;
  }

  memPill.textContent = "🆕 New Client";
  memPill.style.background = "#F1F5F9";
  memPill.style.color = "#475569";
  memPill.style.border = "1px solid #CBD5E1";
  memPill.title = "New contact with no past purchase records. Ask for a deposit to confirm the order.";

  // A chat titled by number only matches its customer through the phone digits.
  const phone = titlePhone(safeName);
  ccApiRequest(`/api/client/memory?customer=${encodeURIComponent(safeName)}${phone ? `&phone=${phone}` : ""}`, "GET")
    .then((mem) => {
      if (mem) renderRating(safeName, mem);
    })
    .catch(() => {});
}

// ============================================================================
// 5. SCAN ACTIVE CHAT (LOCAL ONLY; ANALYSE / PHOTO QUOTE SEND ON CLICK)
// ============================================================================
async function scanActiveWhatsAppChat(forceRun = false) {
  const activeTitle = getActiveChatTitle();
  const main = findMessagesContainer();
  if (!activeTitle || !main) return;

  // 1. Find incoming bubbles (from WA_extension)
  let incomingBubbles = main.querySelectorAll('[data-id*="false_"], [class*="message-in"]');
  if (!incomingBubbles || incomingBubbles.length === 0) {
    const allRows = main.querySelectorAll('[data-id], div[role="row"]');
    const filtered = [];
    allRows.forEach((r) => {
      const id = r.getAttribute("data-id") || "";
      const cls = r.className || "";
      const hasTick = r.querySelector?.(
        '[data-icon*="check"], [data-testid*="check"], [data-icon*="dblcheck"], [data-testid*="dblcheck"], [data-icon="msg-time"], [data-testid="msg-time"], span[data-icon*="status-"]'
      );
      if (!id.includes("true_") && !cls.includes("message-out") && !hasTick) {
        filtered.push(r);
      }
    });
    incomingBubbles = filtered;
  }

  // 2. Extract recent conversation context (from WA_extension)
  const allBubbles = main.querySelectorAll('[data-id], [class*="message-in"], [class*="message-out"], div[role="row"]');
  let lastClientText = "";
  let lastMyText = "";
  let absoluteLastSender = null;
  let absoluteLastText = "";

  const recentMessages = [];

  allBubbles.forEach((b) => {
    const sender = classifyWhatsAppBubble(b, activeTitle);
    if (!sender) return;

    const t = extractCleanText(b);
    if (!t || t.length > 800) return;

    const isMe = sender === "ME";
    recentMessages.push({
      sender: isMe ? "You" : `Client (${activeTitle})`,
      text: t,
      isMe
    });

    if (isMe) {
      lastMyText = t;
      absoluteLastSender = "ME";
      absoluteLastText = t;
    } else {
      lastClientText = t;
      absoluteLastSender = "CLIENT";
      absoluteLastText = t;
    }
  });

  // Fallback to incomingBubbles if recentMessages didn't capture client text
  if (!lastClientText && incomingBubbles && incomingBubbles.length > 0) {
    const lastIncoming = incomingBubbles[incomingBubbles.length - 1];
    const text = extractCleanText(lastIncoming);
    if (text) {
      lastClientText = text;
      if (!absoluteLastSender) {
        absoluteLastSender = "CLIENT";
        absoluteLastText = text;
      }
    }
  }

  const trimmedRecent = recentMessages.slice(-8);

  // Customer sent an image/PDF: only offer the "Quote from photo" button. Nothing is sent until it is clicked.
  const attachment = detectIncomingReceiptOrPdf(main, activeTitle);
  const attKey = attachment ? `${activeTitle}::${attachment.fileName}::${attachment.src || ""}` : "";
  if (attKey !== lastDetectedAttachmentKey) {
    lastDetectedAttachmentKey = attKey;
    offerPhotoQuote(activeTitle, attachment);
  }

  const chatSwitched = activeTitle !== currentActiveChat;
  const newMsgArrived = absoluteLastText && absoluteLastText !== lastProcessedActiveMsg;

  if (chatSwitched || newMsgArrived || forceRun) {
    currentActiveChat = activeTitle;
    lastProcessedActiveMsg = absoluteLastText;

    const custInput = document.getElementById("cc-customer-input");
    const msgInput = document.getElementById("cc-message-input");
    const custDisp = document.getElementById("cc-customer-display");
    const msgSnippet = document.getElementById("cc-msg-snippet");
    const badgeEl = document.getElementById("cc-intent-badge");
    const titleEl = document.getElementById("cc-ext-title");

    if (custInput) custInput.value = activeTitle;
    if (custDisp) custDisp.textContent = activeTitle || "Active Contact";
    if (blockIfNotCustomer(activeTitle)) {
      if (forceRun) {
        backendDenied.delete(activeTitle);
        refreshStateFromBackend();
      }
      return;
    }
    refreshClientMemoryPill(activeTitle, forceRun);
    updateAddCustomerBtn(activeTitle);
    if (!isAnalyzing) setPanelMode("reply");   // a customer's chat is open: show the reply view

    if (absoluteLastSender === "ME") {
      // You sent the last message!
      if (msgInput) msgInput.value = lastClientText || lastMyText;
      if (msgSnippet) {
        msgSnippet.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
            <span style="background:#DCFCE7; color:#15803D; font-weight:700; font-size:10px; padding:1px 6px; border-radius:4px;">🟢 You (Owner)</span>
            <span style="font-size:10px; color:#15803D; font-weight:600;">✓✓ Sent · Waiting for reply</span>
          </div>
          <div style="font-size:11px; color:#14532D; font-weight:500; line-height:1.3; overflow:hidden; text-overflow:ellipsis; max-height:36px;">
            "${escapeHtml(lastMyText)}"
          </div>
          ${lastClientText ? `<div style="font-size:10px; color:#64748B; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">In reply to: "${escapeHtml(lastClientText)}"</div>` : ""}
        `;
      }
      if (badgeEl) {
        badgeEl.textContent = "Sent · Waiting";
        badgeEl.style.background = "#DCFCE7";
        badgeEl.style.color = "#15803D";
        badgeEl.style.borderColor = "#86EFAC";
      }
      if (titleEl) titleEl.textContent = `✅ Quote/Reply Sent to ${activeTitle}`;
      return;
    }

    if (absoluteLastSender === "CLIENT" && lastClientText) {
      // Client sent the last message!
      if (msgInput) msgInput.value = lastClientText;
      if (msgSnippet) {
        msgSnippet.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
            <span style="background:#EEF2FF; color:#4338CA; font-weight:700; font-size:10px; padding:1px 6px; border-radius:4px;">👤 Client (${escapeHtml(activeTitle)})</span>
            <span style="font-size:10px; color:#4338CA; font-weight:700;">Needs Reply</span>
          </div>
          <div style="font-size:11px; color:#1E1B4B; font-weight:600; line-height:1.3; overflow:hidden; text-overflow:ellipsis; max-height:36px;">
            "${escapeHtml(lastClientText)}"
          </div>
        `;
      }

      // A registered customer's newest message: write the reply straight away, no click needed.
      // (Not a customer? blockIfNotCustomer above already stopped here, so nothing is sent.)
      const cacheKey = getCacheKey(activeTitle, lastClientText);
      const cached = precomputedCache.get(cacheKey);
      if (cached && cached.source !== "local_smart_engine" && !forceRun) {   // the AI already answered this message
        renderAnalysisResult(cached, true);
        return;
      }
      if (chatSwitched) repTypedDraft = false;
      if (!forceRun && attachment) {
        // A photo or PDF: its own button or hint handles it, so the text isn't sent as a reply request.
        lastAnalysis = null;
        const pdf = attachment.type === "PDF_DOCUMENT";
        if (titleEl) titleEl.textContent = `📎 ${activeTitle} sent ${pdf ? "a PDF" : "a photo"}`;
        if (badgeEl) badgeEl.textContent = "Needs Reply";
        const tabsEl = document.getElementById("cc-reply-tabs");
        if (tabsEl) tabsEl.innerHTML = "";
        const bigBtn = document.getElementById("cc-big-action-btn");
        if (bigBtn) bigBtn.textContent = "✅ Insert Selected Reply";
        const checkEl = document.getElementById("cc-ext-check");
        if (checkEl) checkEl.textContent = pdf ? "Type the items to quote, or tap 🔄 Rescan." : "Tap 📷 Quote from photo to price it, or 🔄 Rescan to reply to the text.";
        return;
      }
      if (!forceRun && isAnalyzing) {
        lastProcessedActiveMsg = "";   // still writing the previous reply: the 1s heartbeat retries this message
        return;
      }
      if (!forceRun && repTypedDraft) {
        // The rep is typing their own reply: never overwrite it. Rescan writes a new one on request.
        if (titleEl) titleEl.textContent = `💬 New message from ${activeTitle}`;
        if (badgeEl) badgeEl.textContent = "Needs Reply";
        const checkEl = document.getElementById("cc-ext-check");
        if (checkEl) checkEl.textContent = "New message. Your typed reply is kept; tap 🔄 Rescan for a new suggestion.";
        return;
      }

      await analyzeCurrentMessage(trimmedRecent, "", true, {
        lastSender: "CLIENT",
        lastClientMessage: lastClientText,
        lastMyMessage: lastMyText
      });
    } else {
      // No messages detected yet
      if (msgInput) msgInput.value = "";
      if (msgSnippet) {
        msgSnippet.innerHTML = `<span style="color:#64748B; font-style:italic;">No messages detected in ${escapeHtml(activeTitle)}.</span>`;
      }
      renderIdleStateForContact(activeTitle);
    }
  }
}

// One reply card: label, then the text (full when picked, one line otherwise)
function replyCardHtml(label, text, idx, active, extraAttr = "") {
  return `
    <button type="button" class="cc-tab-pill cc-reply${active ? " cc-tab-active" : ""}" role="radio" aria-checked="${active}" data-idx="${idx}" ${extraAttr} title="${escapeHtml(label)}">
      <span class="cc-radio" aria-hidden="true"></span>
      <span class="cc-reply-text"><span class="cc-reply-label">${escapeHtml(plainText(label) || "Reply")}</span><span class="cc-reply-preview">${escapeHtml(text || "")}</span></span>
    </button>`;
}

function markActiveReply(container, btn) {
  container.querySelectorAll(".cc-tab-pill").forEach((b) => { b.classList.remove("cc-tab-active"); b.setAttribute("aria-checked", "false"); });
  btn.classList.add("cc-tab-active");
  btn.setAttribute("aria-checked", "true");
}

function renderIdleStateForContact(customer) {
  const safeName = customer || "Customer";
  const titleEl = document.getElementById("cc-ext-title");
  const checkEl = document.getElementById("cc-ext-check");
  const descEl = document.getElementById("cc-ext-desc");
  const draftEl = document.getElementById("cc-draft-output");
  const btnEl = document.getElementById("cc-big-action-btn");
  const badgeEl = document.getElementById("cc-intent-badge");
  const tabsContainer = document.getElementById("cc-reply-tabs");

  if (titleEl) titleEl.textContent = `💬 Ready · Chat with ${safeName}`;
  if (badgeEl) badgeEl.textContent = "Chat Ready";
  if (checkEl) checkEl.textContent = `Type or wait for incoming message from ${safeName}, or tap any quick prompt below to draft a quote.`;
  if (descEl) descEl.textContent = "Select a quick greeting or prompt AI to customize.";

  const greeting1 = `Hi ${safeName}! How can we assist you with aircond supply or installation today?`;
  const greeting2 = `Salam ${safeName}, ada apa yang boleh kami bantu untuk servis atau pemasangan aircond hari ini?`;
  const greeting3 = `Hello ${safeName}! Let us know if you need a quotation or technician booking today.`;

  if (draftEl) draftEl.value = greeting1;
  if (btnEl) btnEl.textContent = `💬 Insert Greeting to ${safeName}`;

  refreshClientMemoryPill(safeName);
  setMascot("CASUAL_CHAT");
  setPanelMode(customer && customer !== "Client" ? "reply" : "empty");
  renderPaymentCheck(null);

  if (tabsContainer) {
    const greetings = [["Greeting", greeting1], ["Bahasa Melayu", greeting2], ["Service", greeting3]];
    tabsContainer.innerHTML = greetings.map(([label, text], i) =>
      replyCardHtml(label, text, i, i === 0, `data-text="${escapeHtml(text)}"`)).join("");
    tabsContainer.querySelectorAll(".cc-tab-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-text");
        if (draftEl) draftEl.value = text;
        markActiveReply(tabsContainer, btn);
      });
    });
  }
}

// Customer sent an image/PDF: show a button only. Nothing leaves the browser until the user clicks it.
function offerPhotoQuote(customer, attachment) {
  const banner = document.getElementById("cc-auto-ocr-banner");
  if (!banner) return;
  if (!attachment) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  banner.style.display = "block";
  if (attachment.type === "PDF_DOCUMENT") {   // the PDF bytes are not readable from the page, so no button
    banner.innerHTML = `<div style="font-size:11px; color:#324564;">📎 PDF received: please type the items to quote.</div>`;
    return;
  }
  banner.innerHTML = `
    <div style="font-weight:700; color:#042970; margin-bottom:4px;">
      📎 Photo from ${escapeHtml(customer)}: ${escapeHtml(attachment.fileName)}
    </div>
    <button type="button" id="cc-photo-quote-btn" class="cc-sec-btn" style="padding:4px 10px; font-size:11px; background:#fff; border:1px solid #10B981; color:#047857; cursor:pointer;">📷 Quote from photo</button>
    <div style="font-size:11px; color:#324564; margin-top:4px;" id="cc-auto-ocr-status"></div>
  `;
  document.getElementById("cc-photo-quote-btn").addEventListener("click", () => quoteFromPhoto(customer, attachment));
}

async function quoteFromPhoto(customer, attachment) {
  const btn = document.getElementById("cc-photo-quote-btn");
  const statusEl = document.getElementById("cc-auto-ocr-status");
  const say = (t) => { if (statusEl) statusEl.textContent = t; };
  if (!btn || btn.disabled || blockIfNotCustomer(customer)) return;
  btn.disabled = true;   // no double send while the request is in flight
  try {
    const imageBase64 = await blobUrlToBase64(attachment.src);
    if (!imageBase64) {
      say("Couldn't read this photo here. Please type the items.");
      return;
    }
    say("⏳ Reading the photo...");
    const data = await ccApiRequest("/api/whatsapp/photo-quote", "POST", {
      customer,
      phone: titlePhone(customer),
      imageBase64,
      fileName: attachment.fileName,
      role: getCcRole()
    });
    if (currentActiveChat !== customer) return;   // user moved to another chat meanwhile
    renderAnalysisResult(data, false);
    say("");
  } catch (e) {
    say("Couldn't reach Closiq. Please type the items.");
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// 6. CLEAN, UNCLUTTERED, SPACIOUS COPILOT UI (ZERO CRAMP)
// ============================================================================
const CC_SIDEBAR_WIDTH = 360;

function applyWhatsAppLayoutResize(isCollapsed) {
  try {
    const sw = isCollapsed ? 0 : CC_SIDEBAR_WIDTH;
    document.documentElement.style.setProperty("--cc-sidebar-width", `${sw}px`);

    if (isCollapsed) {
      document.documentElement.classList.remove("cashchase-active");
      document.documentElement.classList.add("cashchase-collapsed");
      document.documentElement.style.removeProperty("width");
      document.documentElement.style.removeProperty("margin-right");
      document.body.style.removeProperty("width");
      document.body.style.removeProperty("margin-right");
    } else {
      document.documentElement.classList.remove("cashchase-collapsed");
      document.documentElement.classList.add("cashchase-active");
      document.documentElement.style.setProperty("width", `calc(100vw - ${sw}px)`, "important");
      document.documentElement.style.setProperty("margin-right", `${sw}px`, "important");
      document.body.style.setProperty("width", "100%", "important");
      document.body.style.setProperty("margin-right", "0px", "important");
    }

    const app = document.querySelector("#app");
    if (app) {
      if (isCollapsed) {
        app.style.setProperty("position", "absolute", "important");
        app.style.setProperty("top", "0px", "important");
        app.style.setProperty("left", "0px", "important");
        app.style.setProperty("bottom", "0px", "important");
        app.style.setProperty("right", "0px", "important");
        app.style.setProperty("width", "100vw", "important");
        app.style.setProperty("max-width", "100vw", "important");
        app.style.removeProperty("transform");
      } else {
        app.style.setProperty("position", "fixed", "important");
        app.style.setProperty("top", "0px", "important");
        app.style.setProperty("left", "0px", "important");
        app.style.setProperty("bottom", "0px", "important");
        app.style.setProperty("right", `${sw}px`, "important");
        app.style.setProperty("width", `calc(100vw - ${sw}px)`, "important");
        app.style.setProperty("max-width", `calc(100vw - ${sw}px)`, "important");
        app.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
      }
    }

    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 500);
  } catch (err) {
    console.warn("[CashChase] Layout resize warning:", err);
  }
}

// ============================================================================
// CLOSIQ PANEL HELPERS (layout states, rating card, closed circle)
// ============================================================================
// Brand images ship inside the extension (web_accessible_resources)
function ccAsset(name) {
  try {
    return chrome.runtime.getURL(`img/${name}`);
  } catch (e) {
    return `img/${name}`;
  }
}

// Instructions the AI gets when a chip is tapped (the same as typing them in Adjust reply)
const ADJUST_CHIPS = [
  ["Shorter", "Make the reply shorter"],
  ["More polite", "Make the reply more polite and formal"],
  ["In BM", "Write the reply in Bahasa Melayu"],
  ["Ask for deposit", "Ask for the deposit to confirm the order"]
];

// One panel view at a time: "empty" (no chat), "reading", "reply" (a chat to answer) or "blocked" (not a customer / offline)
function setPanelMode(mode) {
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.hidden = !on; };
  const chat = mode !== "empty";
  show("cc-empty", mode === "empty");
  show("cc-reading", mode === "reading");
  show("cc-rating", chat && mode !== "reading");
  show("cc-result-card", chat && mode !== "reading");
  show("cc-replies", mode === "reply");
  show("cc-adjust", mode === "reply");
  show("cc-pl-card", mode === "reply");
  const root = document.getElementById("cashchase-wa-ext-root");
  if (root) root.setAttribute("data-mode", mode);
}

// Panel copy from the backend may carry emoji; the panel uses its own icons and the mascot instead
const plainText = (s) => String(s || "")
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
  .replace(/^\s*Option \d+:\s*/i, "")
  .replace(/[ \t]+/g, " ")
  .trim();

// The mascot and its one-line speech follow what the customer wants
function setMascot(intent) {
  const pick = {
    BUYING_INQUIRY: ["mascot-laptop.png", "I priced it for you"],
    DISCOUNT_REQUEST: ["mascot-question.png", "They want a better price"],
    CUSTOMER_CONFIRMED: ["mascot-cheer.png", "Money came in!"],
    CUSTOMER_DECLINED: ["mascot-question.png", "They said no"],
    COMPLAINT: ["mascot-question.png", "Something went wrong"],
    FOLLOW_UP_DUE: ["mascot-idea.png", "Time to follow up"],
    PRODUCT_CONSULTATION: ["mascot-idea.png", "They have a question"],
    CASUAL_CHAT: ["mascot-wave.png", "Just a chat"]
  }[intent] || ["mascot-idea.png", "I spotted this"];
  const img = document.getElementById("cc-mascot");
  if (img) img.setAttribute("src", ccAsset(pick[0]));
  const say = document.getElementById("cc-mascot-say");
  if (say) say.textContent = pick[1];
}

// Customer rating card from GET /api/client/memory (or the analysis' clientMemory)
function renderRating(customer, mem) {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("cc-rating-name", cleanCustomerName(customer));
  const scoreEl = document.getElementById("cc-score");
  const aiEl = document.getElementById("cc-rating-ai");
  if (!mem) {
    set("cc-score-num", "–");
    if (scoreEl) { scoreEl.style.setProperty("--score", "0deg"); scoreEl.setAttribute("aria-label", "Customer score not checked yet"); }
    set("cc-rating-sub", "Tap Rescan to check this customer's history.");
    if (aiEl) aiEl.hidden = true;
    return;
  }
  const isNew = mem.tier === "NEW_CLIENT";
  const score = Math.max(0, Math.min(100, Number(mem.score) || 0));
  const tone = isNew ? "#98A2B3" : score >= 80 ? "#059669" : score >= 60 ? "#0152FC" : "#D97706";
  set("cc-score-num", isNew ? "New" : String(score));
  if (scoreEl) {
    scoreEl.style.setProperty("--score", `${isNew ? 0 : score * 3.6}deg`);
    scoreEl.style.setProperty("--score-color", tone);
    scoreEl.setAttribute("aria-label", isNew ? "New customer" : `Customer score ${score} out of 100`);
  }
  const tier = String(mem.tier || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const orders = mem.totalOrders ? `${mem.totalOrders} order${mem.totalOrders === 1 ? "" : "s"}` : "";
  const paid = mem.totalPaidRm || mem.totalPaidRM ? `${fmtRm(mem.totalPaidRm || mem.totalPaidRM)} paid` : "";
  set("cc-rating-sub", isNew ? "No past orders yet. Ask for a deposit to confirm." : [tier, orders, paid].filter(Boolean).join(" · "));
  const pill = document.getElementById("cc-mem-pill");
  if (pill) {
    const [label, bg, fg] = isNew ? ["New client", "#F1F5F9", "#475569"]
      : score >= 80 ? ["Trusted", "#ECFDF5", "#065F46"] : score >= 60 ? ["Good", "#E6EEFF", "#042970"] : ["Watch closely", "#FFFBEB", "#92400E"];
    pill.textContent = label;
    pill.style.background = bg;
    pill.style.color = fg;
    pill.style.border = "";
    pill.title = [mem.paymentBehavior, mem.styleSummary].filter(Boolean).join("\n");
  }
  const note = plainText(mem.styleSummary || mem.paymentBehavior || "");
  if (aiEl) {
    aiEl.hidden = !note;
    aiEl.innerHTML = note ? `<b>AI says:</b> ${escapeHtml(note)}` : "";
  }
}

// What's happening: the analysis' check lines as a list, the total line last
function renderCheckLines(text) {
  const el = document.getElementById("cc-ext-check");
  if (!el) return;
  const lines = String(text || "").split("\n").map(plainText).filter((l) => l && !/^[-–]+$/.test(l));
  el.innerHTML = lines.map((l) => {
    const t = escapeHtml(l.replace(/^-\s*/, ""));
    if (/^\[Chat stage:/i.test(l)) return `<div class="cc-line-stage">${t}</div>`;
    if (/^Coach:/i.test(l)) return `<div class="cc-tip"><b>Tip</b> ${escapeHtml(l.replace(/^Coach:\s*/i, ""))}</div>`;
    if (/:$/.test(l) && l.length < 40) return `<div class="cc-line-head">${t.replace(/:$/, "")}</div>`;
    const total = /^(total|received)|total:/i.test(l);
    return `<div class="cc-line${total ? " cc-line-total" : ""}">${t}</div>`;
  }).join("");
}

// Payment check: a won order needs the money seen in the bank first
function renderPaymentCheck(a) {
  const box = document.getElementById("cc-payment");
  if (!box) return;
  const needed = !!(a && a.extActionType === "MARK_WON");
  box.hidden = !needed;
  const seen = document.getElementById("cc-payment-seen");
  if (seen) seen.checked = false;
  if (needed) {
    const amt = a.depositAmount ? fmtRm(a.depositAmount) : "this amount";
    const claim = document.getElementById("cc-payment-claim");
    if (claim) claim.textContent = [a.depositAmount ? `Customer says ${amt} paid` : "", a.depositRef ? `Ref ${a.depositRef}` : ""].filter(Boolean).join(" · ");
    const label = document.getElementById("cc-payment-label");
    if (label) label.textContent = `I can see ${amt} in our bank account`;
  }
  updatePaymentGate();
}

function paymentBlocked() {
  const box = document.getElementById("cc-payment");
  const seen = document.getElementById("cc-payment-seen");
  return !!(box && !box.hidden && seen && !seen.checked);
}

function updatePaymentGate() {
  const box = document.getElementById("cc-payment");
  if (box) box.classList.toggle("is-ok", !paymentBlocked() && !box.hidden);
  const sub = document.getElementById("cc-big-sub");
  if (sub) sub.textContent = paymentBlocked() ? "Tick the payment check first" : "Nothing sends until you press Enter in WhatsApp";
}

// Reading state: what Closiq is doing while the AI answers
function renderReading(customer, count) {
  const title = document.getElementById("cc-reading-title");
  if (title) title.textContent = `Reading ${cleanCustomerName(customer)}`;
  const steps = document.getElementById("cc-reading-steps");
  if (steps) {
    steps.innerHTML = [
      [true, count ? `Read the last ${count} message${count === 1 ? "" : "s"}` : "Read the open chat"],
      [true, "Checked your price list"],
      [false, "Writing replies…"]
    ].map(([done, t]) => `<li class="${done ? "is-done" : "is-busy"}">${t}</li>`).join("");
  }
  setPanelMode("reading");
}

// The closed circle: how many customers need you (overdue follow-ups + quiet buyers), from GET /api/state
function updateBubble() {
  const due = knownDeals.filter((d) => d.stage === "FOLLOW_UP" && !d.paused).length;
  const quiet = knownReengage.filter((r) => !knownDeals.some((d) => d.id === r.dealId && d.stage === "FOLLOW_UP")).length;
  const n = due + quiet;
  const count = document.getElementById("cc-bubble-count");
  const pill = document.getElementById("cc-bubble-pill");
  const btn = document.getElementById("cc-bubble");
  if (count) { count.hidden = !n; count.textContent = String(n); }
  if (pill) { pill.hidden = !n; pill.textContent = `${n} need${n === 1 ? "s" : ""} you`; }
  if (btn) btn.setAttribute("aria-label", n ? `Open Closiq, ${n} customer${n === 1 ? "" : "s"} need you` : "Open Closiq");
}

// Drag the closed circle anywhere; it sticks to the nearest side and remembers where it was left
const bubbleDrag = { moved: false };
function initBubbleDrag(wrap) {
  const SIZE = 56, EDGE = 16;
  const place = (pos) => {
    wrap.style.top = `${pos.top}px`;
    wrap.classList.toggle("on-left", pos.side === "left");
  };
  let pos = { side: "right", top: Math.round((window.innerHeight || 800) / 2) - SIZE / 2 };
  try {
    const saved = JSON.parse(localStorage.getItem("cc_bubble_pos") || "null");
    if (saved && (saved.side === "left" || saved.side === "right") && typeof saved.top === "number") pos = saved;
  } catch (e) {}
  place(pos);
  let start = null;
  wrap.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY, top: pos.top };
    bubbleDrag.moved = false;
    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!bubbleDrag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    bubbleDrag.moved = true;
    wrap.classList.add("is-dragging");
    const maxTop = (window.innerHeight || 800) - SIZE - EDGE;
    wrap.style.top = `${Math.max(EDGE, Math.min(maxTop, start.top + dy))}px`;
    wrap.style.left = `${Math.max(0, e.clientX - SIZE / 2)}px`;
    wrap.style.right = "auto";
  });
  const end = (e) => {
    if (!start) return;
    if (bubbleDrag.moved) {
      const maxTop = (window.innerHeight || 800) - SIZE - EDGE;
      pos = {
        side: e.clientX < (window.innerWidth || 1280) / 2 ? "left" : "right",
        top: Math.max(EDGE, Math.min(maxTop, start.top + (e.clientY - start.y)))
      };
      wrap.classList.remove("is-dragging");
      wrap.style.removeProperty("left");
      wrap.style.removeProperty("right");
      place(pos);
      try { localStorage.setItem("cc_bubble_pos", JSON.stringify(pos)); } catch (err) {}
    }
    start = null;
  };
  wrap.addEventListener("pointerup", end);
  wrap.addEventListener("pointercancel", end);
}

function createSidebar() {
  if (document.getElementById("cashchase-wa-ext-root")) return;

  const root = document.createElement("div");
  root.id = "cashchase-wa-ext-root";
  root.innerHTML = `
    <div class="cc-header">
      <img class="cc-logo" src="${ccAsset("logo.png")}" alt="" width="28" height="28" />
      <div class="cc-head-text">
        <div class="cc-title">Closiq</div>
        <div class="cc-sub"><span id="cc-lm-status">Sales helper for WhatsApp</span></div>
      </div>
      <span class="cc-badge" id="cc-intent-badge" hidden>Ready</span>
      <button id="cc-collapse-btn" class="cc-icon-btn" aria-label="Hide Closiq (Alt+C)" title="Hide (Alt+C)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
    <div id="cc-user-pill" class="cc-user-row" style="display:none;">
      <span id="cc-user-text"></span>
      <button id="cc-logout-btn" class="cc-link-btn">Log out</button>
    </div>

    <!-- Sign in (Supabase accounts with login on, demo accounts with login off) -->
    <div id="cc-login" class="cc-state" style="display:none;">
      <div class="cc-state-title">Sign in</div>
      <label for="cc-server-input" class="cc-field-label">Server</label>
      <div class="cc-demo-row">
        <input id="cc-server-input" class="cc-input" type="url" placeholder="http://127.0.0.1:8000 or https://….replit.app" />
        <button type="button" id="cc-server-save" class="cc-ghost-btn">Connect</button>
      </div>
      <div id="cc-server-msg" class="cc-state-text"></div>
      <div id="cc-login-sub" class="cc-state-text">Same login as the web app.</div>
      <div id="cc-login-demo" class="cc-demo-row" style="display:none;">
        <button type="button" id="cc-demo-owner" class="cc-ghost-btn">Owner (Hafiz)</button>
        <button type="button" id="cc-demo-staff" class="cc-ghost-btn">Staff (Aina)</button>
      </div>
      <form id="cc-login-form" class="cc-form">
        <label for="cc-login-email" class="cc-field-label">Email</label>
        <input id="cc-login-email" class="cc-input" type="email" required autocomplete="email" />
        <label for="cc-login-password" class="cc-field-label">Password</label>
        <input id="cc-login-password" class="cc-input" type="password" required autocomplete="current-password" />
        <div id="cc-login-error" role="alert" class="cc-error" style="display:none;"></div>
        <button id="cc-login-submit" type="submit" class="cc-big-btn">Sign in</button>
      </form>
      <a id="cc-privacy-link" class="cc-state-text" href="#" target="_blank" rel="noopener">Privacy Notice</a>
    </div>

    <div class="cc-body">
      <!-- The open chat -->
      <div class="cc-contact" id="cc-contact">
        <span id="cc-customer-display" class="cc-contact-name">No chat open</span>
        <button id="cc-add-cust-btn" class="cc-chip-btn" style="display:none;" title="Add this contact as a customer">Add customer</button>
        <button id="cc-read-dom-btn" class="cc-ghost-btn" title="Read this chat and suggest replies">Rescan</button>
      </div>
      <div id="cc-msg-snippet" class="cc-snippet cc-chat-only">Open a customer's chat, then tap Rescan.</div>
      <input type="hidden" id="cc-customer-input" value="" />
      <input type="hidden" id="cc-message-input" value="" />
      <!-- Customer photo / PDF banner (hidden unless one arrives) -->
      <div id="cc-auto-ocr-banner" class="cc-banner" style="display:none;"></div>

      <!-- Customer rating -->
      <div id="cc-rating" class="cc-card cc-rating">
        <div class="cc-rating-row">
          <span id="cc-score" class="cc-score" role="img" aria-label="Customer score not checked yet"><span id="cc-score-num">–</span></span>
          <span class="cc-rating-main">
            <span class="cc-rating-name-row"><span id="cc-rating-name" class="cc-sr">Customer</span><span id="cc-mem-pill" class="cc-pill">Client Ready</span></span>
            <span id="cc-rating-sub" class="cc-rating-sub">Tap Rescan to check this customer's history.</span>
          </span>
        </div>
        <p id="cc-rating-ai" class="cc-rating-ai" hidden></p>
      </div>

      <!-- Reading the chat -->
      <div id="cc-reading" class="cc-reading" role="status" aria-live="polite" hidden>
        <div class="cc-mascot-row">
          <img class="cc-mascot" src="${ccAsset("mascot-laptop.png")}" alt="" width="64" height="64" />
          <div><span class="cc-say">Give me a few seconds</span><div id="cc-reading-title" class="cc-happening-title">Reading the chat</div></div>
        </div>
        <ul id="cc-reading-steps" class="cc-steps"></ul>
        <div class="cc-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>

      <!-- What's happening -->
      <div class="cc-section" id="cc-result-card">
        <div class="cc-mascot-row">
          <img id="cc-mascot" class="cc-mascot" src="${ccAsset("mascot-idea.png")}" alt="" width="64" height="64" />
          <div class="cc-min0">
            <span id="cc-mascot-say" class="cc-say">I'm ready</span>
            <div class="cc-kicker">What's happening</div>
            <div id="cc-ext-title" class="cc-happening-title">Ready for WhatsApp Message</div>
          </div>
        </div>
        <div id="cc-ext-check" class="cc-check">Tap Rescan to analyse this chat.</div>
        <div id="cc-deal-ctx" class="cc-deal"></div>
        <div id="cc-ext-desc" hidden></div>

        <!-- Check payment before an order is marked won -->
        <div id="cc-payment" class="cc-payment" hidden>
          <div class="cc-payment-title">Check payment</div>
          <div id="cc-payment-claim" class="cc-payment-claim"></div>
          <label class="cc-check-row"><input id="cc-payment-seen" type="checkbox" /> <span id="cc-payment-label">I can see this amount in our bank account</span></label>
        </div>
      </div>

      <!-- Pick a reply: cards; the draft below is what goes into WhatsApp -->
      <div class="cc-section" id="cc-replies">
        <div class="cc-section-head"><span>Pick a reply</span><span>Goes into your reply box</span></div>
        <div id="cc-reply-tabs" class="cc-reply-list" role="radiogroup" aria-label="Suggested replies"></div>
        <div id="cc-custom-param-box" class="cc-param" style="display:none;"></div>
        <label for="cc-draft-output" class="cc-field-label">Your reply (you can edit it)</label>
        <textarea id="cc-draft-output" class="cc-textarea" rows="4" placeholder="The reply you pick shows here"></textarea>
      </div>

      <!-- Adjust reply: tell the AI what to change -->
      <details id="cc-adjust" class="cc-section cc-adjust">
        <summary><span class="cc-sparkle" aria-hidden="true">✦</span> Adjust reply <span class="cc-muted">tone, terms, language</span></summary>
        <div class="cc-adjust-body">
          <div class="cc-prompt-row">
            <label for="cc-user-instruction" class="cc-sr">Tell the AI how to change the reply</label>
            <input id="cc-user-instruction" class="cc-input" placeholder="e.g. 50% deposit, polite BM" />
            <button id="cc-custom-prompt-btn" class="cc-ghost-btn">Rewrite</button>
          </div>
          <div id="cc-adjust-chips" class="cc-chips"></div>
        </div>
      </details>

      <!-- Quote from the price list: the rep picks items; the backend prices the quote and saves the deal -->
      <div class="cc-section" id="cc-pl-card">
        <button id="cc-pl-toggle" class="cc-ghost-btn cc-wide">Quote from price list</button>
        <div id="cc-pl-body" style="display:none; margin-top:10px;">
          <input id="cc-pl-search" class="cc-input" placeholder="Search item or SKU" />
          <div id="cc-pl-list" class="cc-pl-list"></div>
          <div id="cc-pl-total" class="cc-pl-total"></div>
          <button id="cc-pl-create" class="cc-big-btn">Create quote &amp; insert into chat</button>
          <div id="cc-pl-msg" class="cc-muted-line"></div>
          <button id="cc-pl-pdf" class="cc-ghost-btn cc-wide" style="display:none;">Download PDF</button>
        </div>
      </div>

      <!-- No chat open: who needs you today (GET /api/state) -->
      <div id="cc-empty" class="cc-empty">
        <img class="cc-mascot-big" src="${ccAsset("mascot-wave.png")}" alt="" width="112" height="112" />
        <div class="cc-state-title">Open a customer's chat</div>
        <div class="cc-state-text">I'll read it and suggest a reply. Nothing sends until you press Enter.</div>
        <div class="cc-card cc-day" id="cc-sales-card">
          <div class="cc-day-label">Follow-ups due</div>
          <div id="cc-followups-text">Loading...</div>
          <div class="cc-day-label">Commission this month</div>
          <div id="cc-commission-text">Loading...</div>
        </div>
      </div>
      <div class="cc-proto">Prototype · synthetic data, not connected to Orbyte<span id="cc-cache-pill" class="cc-sr">⚡ 0 Pre-Cached</span></div>
    </div>

    <!-- One main action -->
    <div class="cc-footer">
      <button class="cc-big-btn" id="cc-big-action-btn">Insert reply</button>
      <div id="cc-big-sub" class="cc-big-sub">Nothing sends until you press Enter in WhatsApp</div>
    </div>
  `;

  document.body.appendChild(root);
  setPanelMode("empty");

  // Closed: a small circle that can be dragged anywhere and sticks to the nearest side
  let reopenBtn = document.getElementById("cc-floating-reopen-btn");
  if (!reopenBtn) {
    reopenBtn = document.createElement("div");
    reopenBtn.id = "cc-floating-reopen-btn";
    reopenBtn.innerHTML = `
      <span id="cc-bubble-pill" class="cc-bubble-pill" hidden></span>
      <button id="cc-bubble" class="cc-bubble" aria-label="Open Closiq" title="Tap to open, drag to move">
        <img src="${ccAsset("logo.png")}" alt="" width="32" height="32" draggable="false" />
        <span id="cc-bubble-count" class="cc-bubble-count" hidden></span>
      </button>`;
    reopenBtn.style.display = "none";
    document.body.appendChild(reopenBtn);
    initBubbleDrag(reopenBtn);
  }

  const chipsEl = document.getElementById("cc-adjust-chips");
  if (chipsEl) {
    chipsEl.innerHTML = ADJUST_CHIPS.map(([label], i) => `<button type="button" class="cc-chip" data-chip="${i}">${label}</button>`).join("");
  }

  document.getElementById("cc-draft-output").addEventListener("input", () => { repTypedDraft = true; });   // typing only, not code
  document.getElementById("cc-pl-toggle").addEventListener("click", () => {
    const body = document.getElementById("cc-pl-body");
    body.style.display = body.style.display === "none" ? "block" : "none";
    renderPriceList();
  });
  document.getElementById("cc-pl-search").addEventListener("input", renderPriceList);
  document.getElementById("cc-pl-create").addEventListener("click", createPriceListQuote);
  document.getElementById("cc-pl-pdf").addEventListener("click", downloadQuotePdf);
  document.getElementById("cc-server-input").value = BACKEND_URL;
  document.getElementById("cc-server-save").addEventListener("click", connectBackend);
  document.getElementById("cc-demo-owner").addEventListener("click", () => ccDemoLogin("hafiz@sejukjaya.my"));
  document.getElementById("cc-demo-staff").addEventListener("click", () => ccDemoLogin("aina@sejukjaya.my"));
  document.getElementById("cc-login-form").addEventListener("submit", submitCcLogin);
  document.getElementById("cc-logout-btn").addEventListener("click", ccLogout);
  refreshCcAuth();

  const collapseBtn = document.getElementById("cc-collapse-btn");
  if (collapseBtn) {
    collapseBtn.addEventListener("click", () => {
      root.classList.add("cc-collapsed");
      if (reopenBtn) reopenBtn.style.display = "block";
      applyWhatsAppLayoutResize(true);
    });
  }

  if (reopenBtn) {
    reopenBtn.addEventListener("click", () => {
      if (bubbleDrag.moved) { bubbleDrag.moved = false; return; }   // that was a drag, not a tap
      root.classList.remove("cc-collapsed");
      reopenBtn.style.display = "none";
      applyWhatsAppLayoutResize(false);
    });
  }

  // Keyboard shortcut Alt + C to toggle sidebar anytime
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      const isCurrentlyCollapsed = root.classList.contains("cc-collapsed");
      if (isCurrentlyCollapsed) {
        root.classList.remove("cc-collapsed");
        if (reopenBtn) reopenBtn.style.display = "none";
        applyWhatsAppLayoutResize(false);
      } else {
        root.classList.add("cc-collapsed");
        if (reopenBtn) reopenBtn.style.display = "block";
        applyWhatsAppLayoutResize(true);
      }
    }
  });

  // Automatically dock sidebar and resize WhatsApp viewport on initial load
  applyWhatsAppLayoutResize(false);

  const addCustBtn = document.getElementById("cc-add-cust-btn");
  if (addCustBtn) {
    addCustBtn.addEventListener("click", () => {
      const title = currentActiveChat || getActiveChatTitle() || document.getElementById("cc-customer-input")?.value?.trim();
      if (title && isKnownCustomer(title)) return;
      addCurrentAsCustomer();
    });
  }
  document.getElementById("cc-read-dom-btn").addEventListener("click", () => scanActiveWhatsAppChat(true));
  document.getElementById("cc-big-action-btn").addEventListener("click", executePrimaryAction);

  const askAi = (instr) => {
    const cust = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Client";
    const msg = document.getElementById("cc-message-input")?.value.trim() || "";
    if (currentActiveChat && blockIfNotCustomer(cust)) return;
    renderAnalysisResult(buildLocalSmartAnalysis(cust, msg, instr), true);
    analyzeCurrentMessage([], instr);
  };
  const customPromptBtn = document.getElementById("cc-custom-prompt-btn");
  if (customPromptBtn) {
    customPromptBtn.addEventListener("click", () => askAi(document.getElementById("cc-user-instruction")?.value.trim() || ""));
  }
  const instrInput = document.getElementById("cc-user-instruction");
  if (instrInput) {
    instrInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") askAi(instrInput.value.trim());
    });
  }
  // Adjust chips are instructions for the AI, the same as typing them
  document.querySelectorAll("#cc-adjust-chips .cc-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const prompt = ADJUST_CHIPS[parseInt(chip.getAttribute("data-chip"), 10)][1];
      if (instrInput) instrInput.value = prompt;
      askAi(prompt);
    });
  });
  const paySeen = document.getElementById("cc-payment-seen");
  if (paySeen) paySeen.addEventListener("change", () => updatePaymentGate());

  // Render clean idle state on sidebar load
  renderIdleStateForContact(currentActiveChat || "Client");
  refreshStateFromBackend();

  // Automatic MutationObserver (debounced to 600ms, ignores blinking cursor)
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!isAnalyzing) {
        scanActiveWhatsAppChat(false);
        scanUnreadSidebarChatsAndPreCache();
      }
    }, 600);
  });
  observer.observe(document.querySelector("#app") || document.body, {
    childList: true,
    subtree: true
  });

  // Dock maintainer heartbeat (every 3s, zero repeated analysis)
  setInterval(() => {
    const r = document.getElementById("cashchase-wa-ext-root");
    const appEl = document.querySelector("#app");
    if (r && !r.classList.contains("cc-collapsed") && appEl) {
      if (appEl.style.right !== `${CC_SIDEBAR_WIDTH}px`) {
        applyWhatsAppLayoutResize(false);
      }
    }
  }, 3000);

  // Heartbeat interval to guarantee chat detection across virtual lists (from WA_extension)
  setInterval(() => {
    if (!isAnalyzing) {
      scanActiveWhatsAppChat(false);
    }
  }, 1000);

  // Initial trigger after sidebar creation (from WA_extension)
  setTimeout(() => {
    scanActiveWhatsAppChat(false);
  }, 800);
}

const fmtRm = (n) => `RM ${Number(n || 0).toLocaleString()}`;

// Follow-ups due now (deals in FOLLOW_UP, not paused) and the reps' commission this month, from GET /api/state.
function renderSalesCard() {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const due = knownDeals.filter((d) => d.stage === "FOLLOW_UP" && !d.paused);
  set("cc-followups-text", due.length
    ? `${due.length} due: ${due.slice(0, 3).map((d) => cleanCustomerName(d.customer)).join(", ")}${due.length > 3 ? "..." : ""}`
    : "None due now");
  const top = knownReps.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)).slice(0, 3);
  set("cc-commission-text", top.length
    ? top.map((r) => `#${r.rank} ${r.name} ${fmtRm(r.commissionRm)}`).join(" · ")
    : "No reps yet");
  updateBubble();
}

function getLocalSavedCustomers() {
  try {
    const raw = localStorage.getItem("cc_local_customers");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalCustomer(customerObj) {
  try {
    const list = getLocalSavedCustomers();
    const key = cleanCustomerName(customerObj.name).toLowerCase();
    if (!list.some(c => cleanCustomerName(c.name).toLowerCase() === key)) {
      list.push(customerObj);
      localStorage.setItem("cc_local_customers", JSON.stringify(list));
    }
  } catch (e) {}
}

async function refreshStateFromBackend() {
  let ok = false;
  try {
    const state = await ccApiRequest("/api/state", "GET");
    const backendCustomers = Array.isArray(state && state.customers) ? state.customers : [];
    // Merge with any locally added customers and localStorage so newly added customers are never dropped
    const localSaved = getLocalSavedCustomers();
    const existingKeys = new Set(backendCustomers.map(c => cleanCustomerName(c.name).toLowerCase()));
    const kept = [...(knownCustomers || []), ...localSaved].filter(c => !existingKeys.has(cleanCustomerName(c.name).toLowerCase()));
    const seen = new Set();
    const dedupeKept = [];
    for (const c of kept) {
      const k = cleanCustomerName(c.name).toLowerCase();
      if (!seen.has(k)) { seen.add(k); dedupeKept.push(c); }
    }
    knownCustomers = [...backendCustomers, ...dedupeKept];
    knownDeals = Array.isArray(state && state.deals) ? state.deals : [];
    knownReps = Array.isArray(state && state.reps) ? state.reps : [];
    knownProducts = Array.isArray(state && state.products) ? state.products : [];
    knownReengage = Array.isArray(state && state.reengage) ? state.reengage : [];
    ok = true;
    renderSalesCard();
    renderPriceList();
    if (lastAnalysis && !gateState) renderDealContext(lastAnalysis);   // the deal may have just changed
  } catch (err) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set("cc-followups-text", "Backend offline");
    set("cc-commission-text", "Backend offline");
  }
  if (ok && gateState && knownCustomers) reevaluateChat(); // list loaded late, or Rescan / Add as customer re-read it
  return ok;
}

// Doc 08 §1: who owns the deal, where it stands, follow-up n of 3, quote total, margin guard and commission.
// Reps see "Margin ✓ / ⚠" only (marginOk); costs and margin % never reach the extension.
function renderDealContext(a) {
  const deal = a.dealId ? knownDeals.find((d) => d.id === a.dealId) : null;
  // The deal's rep, else a rep the analysis names for a new quote; no rep is shown if neither is known.
  const repId = deal ? deal.repId : a.repId;
  const rep = repId != null ? knownReps.find((r) => r.id === repId) : null;
  const lines = [];
  const who = [];
  if (rep) who.push(`Rep: ${rep.name}`);
  // a.stage is the chat stage, not the deal's: a quote that has no deal yet is a "New quote".
  const stage = deal ? deal.stage : (!a.dealId && a.extActionType === "CREATE_QUOTE" ? "New quote" : "");
  if (stage) who.push(`Stage: ${stage}`);
  if (a.followUp && a.followUp.count) who.push(`Follow-up ${a.followUp.count} of ${a.followUp.of || 3}`);
  if (who.length) lines.push(who.join(" · "));
  if (a.amount) lines.push(`Quote total: ${fmtRm(a.amount)}`);
  if (a.amount && typeof a.marginOk === "boolean") {
    lines.push(a.marginOk
      ? `Margin ✓${a.commissionRm != null ? ` · You earn ${fmtRm(a.commissionRm)}` : ""}`
      : "⚠ Below margin floor — needs Owner approval");
  }
  const el = document.getElementById("cc-deal-ctx");
  if (el) el.textContent = lines.join("\n");
}

function renderAnalysisResult(data, fromCache = false) {
  const customer = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Customer";
  if (data.analysis && data.analysis.intent === "NOT_A_CUSTOMER") {   // the backend's list is newer than ours
    backendDenied.add(customer);
    renderNotCustomer(customer);
    return;
  }
  gateState = "";
  repTypedDraft = false;   // the box now holds the AI's suggestion
  lastAnalysis = data.analysis;
  setPanelMode("reply");
  setMascot(lastAnalysis.intent);

  const statusEl = document.getElementById("cc-lm-status");
  if (statusEl) {
    statusEl.textContent = fromCache
      ? `⚡ Cached (${data.model_used || "Local"})`
      : data.lmstudio_connected
        ? `🟢 LM Studio (${data.model_used})`
        : `🟢 Smart Engine Active`;
  }

  const intentBadge = document.getElementById("cc-intent-badge");
  if (intentBadge) intentBadge.textContent = lastAnalysis.badge || lastAnalysis.intent || "Ready";
  const titleEl = document.getElementById("cc-ext-title");
  if (titleEl) titleEl.textContent = plainText(lastAnalysis.extTitle) || "Recommended Action";
  const checkEl = document.getElementById("cc-ext-check");
  if (checkEl) {
    let checkText = lastAnalysis.extCheck || "";
    if (lastAnalysis.stage) {
      checkText = `[Chat stage: ${lastAnalysis.stage}]\n` + (lastAnalysis.coachTip ? `💡 Coach: ${lastAnalysis.coachTip}\n\n` : "") + checkText;
    }
    renderCheckLines(checkText);
  }
  renderDealContext(lastAnalysis);
  renderPaymentCheck(lastAnalysis);
  const draftEl = document.getElementById("cc-draft-output");
  if (draftEl) {
    draftEl.disabled = false;
    draftEl.placeholder = "Recommended reply will appear here...";
    draftEl.value = lastAnalysis.extDraft || "";
  }
  const btnEl = document.getElementById("cc-big-action-btn");
  if (btnEl) {
    btnEl.disabled = false;
    btnEl.style.opacity = "1";
    btnEl.textContent = plainText(lastAnalysis.extBtnLabel) || "Insert reply";
  }

  // Render client memory pill with dedicated NEW_CLIENT neutral styling
  const mem = lastAnalysis.clientMemory;
  if (mem) renderRating(customer, mem);

  // Render 4 sleek horizontal tabs (NO VERTICAL TEXT STACK!)
  const opts = Array.isArray(lastAnalysis.replyOptions) && lastAnalysis.replyOptions.length > 0
    ? lastAnalysis.replyOptions
    : [
        { label: "💼 Formal", text: lastAnalysis.extDraft },
        { label: "🤝 Boss Style", text: `Hi ${customer}! ${lastAnalysis.extDraft}` },
        { label: "⚡ Fast Close", text: `Hi ${customer}, confirm today for priority dispatch! ${lastAnalysis.extDraft}` },
        { label: "🇲🇾 BM", text: `Salam ${customer}, ${lastAnalysis.extDraft}` }
      ];

  const tabsContainer = document.getElementById("cc-reply-tabs");
  if (tabsContainer) {
    tabsContainer.innerHTML = opts.map((opt, idx) => replyCardHtml(opt.label, opt.text, idx, idx === 0)).join("");

    tabsContainer.querySelectorAll(".cc-tab-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pickedIdx = parseInt(btn.getAttribute("data-idx"), 10);
        const pickedOpt = opts[pickedIdx];
        if (draftEl) draftEl.value = pickedOpt.text;

        const paramBox = document.getElementById("cc-custom-param-box");
        const labelLower = (pickedOpt.label || "").toLowerCase();
        if (paramBox && (labelLower.includes("rebate") || labelLower.includes("discount"))) {
          paramBox.style.display = "block";
          paramBox.innerHTML = `
            <div style="font-size:10px; font-weight:700; color:#042970; margin-bottom:2px;">✏️ Edit Credit Rebate Amount (RM):</div>
            <input id="cc-rebate-amt-input" type="number" value="" placeholder="Type the amount" required min="1" step="10" class="cc-input" style="font-weight:700; padding:4px 6px; font-size:11px;" />
          `;
          document.getElementById("cc-rebate-amt-input").addEventListener("input", (e) => {
            const rm = parseInt(e.target.value, 10);
            if (!(rm > 0)) return;   // no amount typed yet: keep the reply as it is, never invent a figure
            const updatedText = `Hi ${customer}, sincere apologies! We can immediately deduct RM ${rm} credit rebate off your invoice balance today.`;
            if (draftEl) draftEl.value = updatedText;
            if (btnEl) btnEl.textContent = `💸 Apply RM ${rm} Rebate & Insert Reply`;
          });
        } else if (paramBox && (labelLower.includes("technician") || labelLower.includes("slot") || labelLower.includes("delivery"))) {
          paramBox.style.display = "block";
          paramBox.innerHTML = `
            <div style="font-size:10px; font-weight:700; color:#042970; margin-bottom:2px;">🕒 Edit Technician Drop-By Time:</div>
            <input id="cc-tech-time-input" type="text" value="" placeholder="e.g. before 3:00 PM today" required class="cc-input" style="font-weight:700; padding:4px 6px; font-size:11px;" />
          `;
          document.getElementById("cc-tech-time-input").addEventListener("input", (e) => {
            const tVal = (e.target.value || "").trim();
            if (!tVal) return;   // no time typed yet: keep the reply as it is
            const updatedText = `Sorry about that ${customer}! Our technician can drop by ${tVal} to inspect and swap the unit on the spot.`;
            if (draftEl) draftEl.value = updatedText;
            if (btnEl) btnEl.textContent = `🛠️ Schedule Tech (${tVal}) & Insert Reply`;
          });
        } else if (paramBox) {
          paramBox.style.display = "none";
        }

        markActiveReply(tabsContainer, btn);
      });
    });
  }
}

async function analyzeCurrentMessage(recentMessages = [], userInstruction = "", forceRun = false, meta = {}) {
  const customer = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Client";
  const message = document.getElementById("cc-message-input")?.value.trim() || "";
  if (!message || blockIfNotCustomer(customer)) return;

  const cacheKey = getCacheKey(customer, message, userInstruction);
  if (!forceRun && precomputedCache.has(cacheKey)) {
    renderAnalysisResult(precomputedCache.get(cacheKey), true);
    return;
  }

  // Prevent duplicate concurrent executions or re-analyzing identical messages
  if (!forceRun && (isAnalyzing || lastAnalyzedHash === cacheKey)) {
    return;
  }

  isAnalyzing = true;
  lastAnalyzedHash = cacheKey;
  renderReading(customer, recentMessages.length);

  document.getElementById("cc-ext-title").textContent = userInstruction
    ? `⏳ AI Building Custom Quote: "${userInstruction}"...`
    : "⏳ AI Analyzing Chat...";

  // HIDE OLD REPLIES WHILE AI IS GENERATING NEW REPLY
  const tabsContainer = document.getElementById("cc-reply-tabs");
  if (tabsContainer) {
    tabsContainer.innerHTML = "";
  }
  const draftEl = document.getElementById("cc-draft-output");
  if (draftEl) {
    draftEl.value = "";
    draftEl.placeholder = "Writing a reply…";
    draftEl.disabled = true;
  }
  const btnEl = document.getElementById("cc-big-action-btn");
  if (btnEl) {
    btnEl.textContent = "⏳ Generating Reply...";
    btnEl.disabled = true;
    btnEl.style.opacity = "0.5";
  }
  try {
    const data = await ccApiRequest("/api/whatsapp/analyze", "POST", {
      customer,
      phone: titlePhone(customer),
      message,
      userInstruction,
      recentMessages,
      role: getCcRole(),
      lastSender: meta.lastSender || "CLIENT",
      lastClientMessage: meta.lastClientMessage || message,
      lastMyMessage: meta.lastMyMessage || ""
    });
    if (!(data.analysis && data.analysis.intent === "NOT_A_CUSTOMER")) {   // never cache a "not a customer" answer
      precomputedCache.set(cacheKey, data);
      updateCacheBadgeCount();
    }
    renderAnalysisResult(data, Boolean(data.cached));
    refreshStateFromBackend();
  } catch (err) {
    // Instant local fallback so the extension NEVER stays stuck on "Backend Offline"
    const localData = buildLocalSmartAnalysis(customer, message, userInstruction);
    precomputedCache.set(cacheKey, localData);
    updateCacheBadgeCount();
    renderAnalysisResult(localData, false);
    refreshStateFromBackend();
  } finally {
    isAnalyzing = false;
  }
}

// --- QUOTE FROM THE PRICE LIST: the rep picks items; the backend prices the quote and saves the deal ---
const plQty = {}; // sku -> quantity picked in the panel
let plDealId = null; // the quote just created, for its PDF

function plSay(text) {
  const el = document.getElementById("cc-pl-msg");
  if (el) el.textContent = text;
}

function renderPriceList() {
  const list = document.getElementById("cc-pl-list");
  if (!list) return;
  const q = (document.getElementById("cc-pl-search")?.value || "").trim().toLowerCase();
  const shown = knownProducts.filter((p) => !q || `${p.sku} ${p.name}`.toLowerCase().includes(q));
  list.innerHTML = shown.length ? shown.map((p, i) => `
    <div style="display:flex; align-items:center; gap:6px; padding:4px 0; border-bottom:1px solid #EEF2F8;">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; color:#042970; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.name)}</div>
        <div style="font-size:10px; color:#64748B;">${escapeHtml(p.sku)} · ${fmtRm(p.sellPrice)}</div>
      </div>
      <input id="cc-pl-qty-${i}" type="number" min="0" value="${plQty[p.sku] || 0}" aria-label="Quantity of ${escapeHtml(p.name)}" class="cc-input" style="width:54px; padding:3px 4px;" />
    </div>`).join("")
    : `<div style="color:#64748B;">${knownProducts.length ? "No item matches." : "Price list not loaded yet. Tap 🔄 Rescan."}</div>`;
  shown.forEach((p, i) => {
    const input = document.getElementById(`cc-pl-qty-${i}`);
    const update = () => {
      const n = Math.max(0, parseInt(input.value, 10) || 0);
      if (n) plQty[p.sku] = n;
      else delete plQty[p.sku];
      renderPriceListTotal();
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });
  renderPriceListTotal();
}

function plItems() {
  return Object.entries(plQty).map(([sku, qty]) => ({ sku, qty }));
}

function renderPriceListTotal() {
  const el = document.getElementById("cc-pl-total");
  if (!el) return;
  const items = plItems();
  // Shown while picking; the saved quote is priced by the backend.
  const total = items.reduce((sum, i) => sum + i.qty * ((knownProducts.find((p) => p.sku === i.sku) || {}).sellPrice || 0), 0);
  el.textContent = items.length ? `${items.length} item(s) · Total ${fmtRm(total)}` : "Set a quantity to add an item.";
}

// The WhatsApp message for a saved quote, from the backend's prices.
function quoteMessage(deal) {
  return [
    `Hi ${cleanCustomerName(deal.customer)}, here is your quotation ${deal.id}:`,
    ...deal.items.map((i) => `• ${i.qty} × ${i.name} @ ${fmtRm(i.unitPrice)} = ${fmtRm(i.qty * i.unitPrice)}`),
    deal.discount ? `Discount: -${fmtRm(deal.discount)}` : "",
    `Total: ${fmtRm(deal.amount)}`,
    "Subject to stock availability · prices valid 7 days."
  ].filter(Boolean).join("\n");
}

async function createPriceListQuote() {
  const customer = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat;
  if (gateState === "offline") return plSay("Backend offline. Start it, then tap 🔄 Rescan.");
  if (gateState || !customer) return plSay("Open a customer's chat first.");
  const items = plItems();
  if (!items.length) return plSay("Set a quantity for at least one item.");
  plSay("Creating quote…");
  try {
    const res = await ccApiRequest("/api/whatsapp/execute", "POST",
      { customer, phone: titlePhone(customer), actionType: "CREATE_QUOTE", items, role: getCcRole() });
    if (res && res.status === "pending_approval") return plSay("📨 Sent to the Owner for approval. The quote is saved once they approve.");
    const id = res && (res.createdId || res.createdDealId);
    const deal = ((res && res.state && res.state.deals) || []).find((d) => d.id === id);
    if (!deal) return plSay("Quote saved. Open the WebApp to see it.");
    plDealId = deal.id;
    insertReplyIntoWhatsAppBox(quoteMessage(deal));
    Object.keys(plQty).forEach((k) => delete plQty[k]);
    renderPriceList();
    plSay(`✓ ${deal.id} saved (${fmtRm(deal.amount)}). Quote inserted: press Send in WhatsApp.`);
    const pdfBtn = document.getElementById("cc-pl-pdf");
    pdfBtn.textContent = `📄 Download PDF (${deal.id})`;
    pdfBtn.style.display = "block";
    refreshStateFromBackend();
  } catch (err) {
    plSay(String(err && err.message).includes("403") ? "🔒 Staff can't create quotes (ask the Owner)." : "Couldn't create the quote. Is the backend running?");
  }
}

// Saves the quote PDF so the rep can attach it to the chat (WhatsApp Web can't be sent a file by an extension).
async function downloadQuotePdf() {
  if (!plDealId) return;
  const resp = await sendToBackground({
    type: "CC_API_FETCH",
    url: `${BACKEND_URL}/api/deals/${encodeURIComponent(plDealId)}/pdf`,
    method: "GET",
    headers: { "X-CashChase-Role": getCcRole() },
    binary: true
  });
  if (!resp || !resp.ok || !resp.dataUrl) return plSay("Couldn't get the PDF. Is the backend running?");
  const a = document.createElement("a");
  a.href = resp.dataUrl;
  a.download = `${plDealId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  plSay(`📄 ${plDealId}.pdf downloaded. Attach it in WhatsApp with 📎.`);
}

// The quote's lines for the execute body: the analysis `items`, else the quote preview's, else its own sku/qty.
function analysisItems(a) {
  const list = [a.items, a.quotePreview && a.quotePreview.items].find((l) => Array.isArray(l) && l.length);
  if (list) return list.map(({ sku, qty }) => ({ sku, qty }));
  const lines = [];
  if (a.sku && a.qty > 0) lines.push({ sku: a.sku, qty: a.qty });
  if (a.extraSku && a.extraQty > 0) lines.push({ sku: a.extraSku, qty: a.extraQty });
  return lines.length ? lines : null;
}

async function executePrimaryAction() {
  if (gateState) {   // blocked contact: the big button adds the customer (or retries refresh when offline), never inserts a reply
    if (gateState === "not_customer") {
      addCurrentAsCustomer();
    } else if (gateState === "offline") {
      refreshStateFromBackend();
    }
    return;
  }
  const customer = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Client";
  const draftEl = document.getElementById("cc-draft-output");
  const draft = draftEl ? draftEl.value.trim() : "";
  const btnEl = document.getElementById("cc-big-action-btn");
  const originalBtnText = btnEl ? btnEl.textContent : "✅ Insert Selected Reply";

  if (!draft) {
    if (btnEl) {
      btnEl.textContent = "⚠️ Please select or type a reply first";
      setTimeout(() => { btnEl.textContent = originalBtnText; }, 2000);
    }
    return;
  }

  // Nothing to record yet: say what is missing instead of inserting a reply or posting a blind action.
  const a = lastAnalysis;
  const items = a ? analysisItems(a) : null;
  const missing = a && a.extActionType === "CREATE_QUOTE" && !items ? "⚠️ Type the items to quote first"
    : a && a.extActionType === "MARK_WON" && !a.depositRef ? "⚠️ Add the slip reference first"
      : a && a.extActionType === "MARK_WON" && paymentBlocked() ? "⚠️ Tick the payment check first" : "";
  if (missing) {
    if (btnEl) {
      btnEl.textContent = missing;
      setTimeout(() => { btnEl.textContent = originalBtnText; }, 3000);
    }
    return;
  }

  // Insert into WhatsApp message input box ONLY when this button is clicked
  insertReplyIntoWhatsAppBox(draft);

  if (lastAnalysis && lastAnalysis.extActionType && lastAnalysis.extActionType !== "NO_ACTION") {
    try {
      // The contract body (docs/11 §2.4): only what the analysis says, nothing invented; empty fields are left out.
      const body = {
        customer,
        phone: titlePhone(customer),
        actionType: a.extActionType,
        dealId: a.dealId,
        items,
        discount: a.discount,
        depositRef: a.depositRef,
        depositAmount: a.depositAmount,
        reason: a.lossReasonSuggestion,
        note: a.note,
        tin: a.tin,
        ssmBrn: a.ssmBrn,
        role: getCcRole()
      };
      const result = await ccApiRequest("/api/whatsapp/execute", "POST",
        Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)));
      if (btnEl) {
        btnEl.textContent = result && result.status === "pending_approval"
          ? "📨 Reply Inserted · Sent to Owner for Approval"
          : "✓ Synced & Reply Inserted!";
      }
      setTimeout(() => { if (btnEl) btnEl.textContent = originalBtnText; }, 2500);
      refreshStateFromBackend();
    } catch (err) {
      const denied = String(err && err.message).includes("403");
      if (btnEl) btnEl.textContent = denied ? "🔒 Reply Inserted · Staff not allowed (ask Owner)" : "✓ Reply Inserted into WhatsApp!";
      setTimeout(() => { if (btnEl) btnEl.textContent = originalBtnText; }, denied ? 3500 : 2500);
    }
  } else {
    if (btnEl) btnEl.textContent = "✓ Reply Inserted into WhatsApp!";
    setTimeout(() => { if (btnEl) btnEl.textContent = originalBtnText; }, 2500);
  }
}

setTimeout(createSidebar, 1200);
