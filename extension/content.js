/**
 * CashChase Orbyte SME Copilot — Chrome/Edge Content Script for WhatsApp Web
 * Combines the best of WA_extension (auto-detects active chat + pre-caches unread sidebar chats
 * via MutationObserver + 1s heartbeat, synthetic InputEvent insertion) with CashChase's
 * ultra-clean 1-Page Copilot (Zero tab/menu bloat, Cross-Chat Client Memory, Auto PDF/Receipt OCR).
 */

const BACKEND_URL = "http://127.0.0.1:8000";

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
let lastAnalysis = null;
let currentActiveChat = "";
let lastProcessedActiveMsg = "";
const precomputedCache = new Map(); // cacheKey -> cached analysis response
const processedSidebarPreviews = new Map(); // contactTitle -> last unread preview text
let lastDetectedAttachmentKey = "";
let isAnalyzing = false;
let lastAnalyzedHash = "";
let knownCustomers = null; // customers from GET /api/state; null = not loaded (backend offline)
let knownDeals = []; // deals and reps from GET /api/state (for the follow-ups card and the deal line)
let knownReps = [];
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

// status: { enabled, email, role } — login form when login is on and nobody is signed in.
function showCcAuth(status) {
  const enabled = !!(status && status.enabled);
  const signedIn = !!(status && status.email);
  const loginBox = document.getElementById("cc-login");
  const roleSelect = document.getElementById("cc-role-select");
  const userPill = document.getElementById("cc-user-pill");
  if (!loginBox) return;
  loginBox.style.display = enabled && !signedIn ? "block" : "none";
  if (roleSelect) roleSelect.style.display = enabled ? "none" : "";  // with login on, the role is the account's
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
  await sendToBackground({ type: "CC_AUTH_LOGOUT" });
  showCcAuth({ enabled: true });
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
    btn.title = "This contact is a registered CashChase customer";
  } else {
    btn.textContent = "➕ Add Customer";
    btn.style.background = "#10B981";
    btn.style.color = "#ffffff";
    btn.style.border = "none";
    btn.style.cursor = "pointer";
    btn.title = "Add this contact as a CashChase customer so messages can be read";
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
    : "CashChase only reads chats from your customers, so nothing was sent. Add this contact to start quoting.");
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

    const executed = document.execCommand("insertText", false, text);
    if (!executed || chatInput.innerText.trim() !== text.trim()) {
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
      if (mem && memPill) {
        if (mem.tier === "NEW_CLIENT") {
          memPill.textContent = "🆕 New Client";
          memPill.style.background = "#F1F5F9";
          memPill.style.color = "#475569";
          memPill.style.border = "1px solid #CBD5E1";
          memPill.title = "New customer with no past purchase records. Ask for a deposit to confirm the order.";
        } else {
          const isRisk = (mem.score || 75) < 60;
          memPill.textContent = `${isRisk ? "⚠️" : "⭐"} ${mem.tier.replace(/_/g, " ")} (${mem.score}/100)`;
          memPill.style.background = isRisk ? "#FEF3C7" : "#E6EEFF";
          memPill.style.color = isRisk ? "#B45309" : "#0152FC";
          memPill.style.border = isRisk ? "1px solid #FCD34D" : "1px solid #B8CEFF";
          memPill.title = `${mem.paymentBehavior || ""}\n${mem.styleSummary || ""}`;
        }
      }
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

      // Check cache first
      const cacheKey = getCacheKey(activeTitle, lastClientText);
      if (precomputedCache.has(cacheKey) && !forceRun) {
        renderAnalysisResult(precomputedCache.get(cacheKey), true);
        return;
      }
      if (!forceRun) {
        lastAnalysis = null;
        const draftEl = document.getElementById("cc-draft-output");
        const tabsEl = document.getElementById("cc-reply-tabs");
        const bigBtn = document.getElementById("cc-big-action-btn");
        const paramBox = document.getElementById("cc-custom-param-box");
        const lmStatus = document.getElementById("cc-lm-status");
        if (titleEl) titleEl.textContent = `💬 New message from ${activeTitle}`;
        if (badgeEl) badgeEl.textContent = "Needs Reply";
        if (draftEl && chatSwitched) draftEl.value = "";
        if (tabsEl) tabsEl.innerHTML = "";
        if (bigBtn) bigBtn.textContent = "✅ Insert Selected Reply";
        if (paramBox) paramBox.style.display = "none";
        if (lmStatus) lmStatus.textContent = "Ready · tap Rescan";
        const checkEl = document.getElementById("cc-ext-check");
        if (checkEl) checkEl.textContent = "Tap 🔄 Rescan to analyse this chat and draft a reply.";
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

  if (tabsContainer) {
    tabsContainer.innerHTML = `
      <button class="cc-tab-pill cc-tab-active" data-text="${greeting1.replace(/"/g, '&quot;')}">👋 Greeting</button>
      <button class="cc-tab-pill" data-text="${greeting2.replace(/"/g, '&quot;')}">🇲🇾 BM</button>
      <button class="cc-tab-pill" data-text="${greeting3.replace(/"/g, '&quot;')}">🛠️ Service</button>
    `;
    tabsContainer.querySelectorAll(".cc-tab-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-text");
        if (draftEl) draftEl.value = text;
        tabsContainer.querySelectorAll(".cc-tab-pill").forEach(b => b.classList.remove("cc-tab-active"));
        btn.classList.add("cc-tab-active");
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
    say("Couldn't reach CashChase. Please type the items.");
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// 6. CLEAN, UNCLUTTERED, SPACIOUS COPILOT UI (ZERO CRAMP)
// ============================================================================
const CC_SIDEBAR_WIDTH = 330;

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

function createSidebar() {
  if (document.getElementById("cashchase-wa-ext-root")) return;

  const root = document.createElement("div");
  root.id = "cashchase-wa-ext-root";
  root.innerHTML = `
    <div class="cc-header">
      <div style="display:flex; align-items:center; gap:8px;">
        <button id="cc-collapse-btn" title="Hide sidebar to view 100% WhatsApp (Alt+C)" style="background:rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.3); color:#fff; border-radius:6px; padding:3px 8px; font-size:11px; cursor:pointer; font-weight:700; line-height:1.2; display:flex; align-items:center; gap:4px;">
          <span>▶</span> <span>Hide</span>
        </button>
        <div>
          <div class="cc-title">⚡ CashChase Copilot</div>
          <div class="cc-sub" id="cc-lm-status">Connected to Local AI</div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
        <select id="cc-role-select" title="Acting as (permissions are checked by the backend)" style="font-size:10px; font-weight:700; border-radius:6px; border:1px solid rgba(255,255,255,0.35); background:rgba(255,255,255,0.15); color:#fff; padding:1px 4px; cursor:pointer;">
          <option value="OWNER" style="color:#042970;">👑 Owner</option>
          <option value="STAFF" style="color:#042970;">👤 Staff</option>
        </select>
        <div id="cc-user-pill" style="display:none; align-items:center; gap:4px; font-size:10px; color:#fff;">
          <span id="cc-user-text" style="font-weight:700; max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></span>
          <button id="cc-logout-btn" style="background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.35); color:#fff; border-radius:6px; padding:1px 5px; font-size:10px; cursor:pointer;">Log out</button>
        </div>
        <span class="cc-badge" id="cc-intent-badge">Ready</span>
        <span style="font-size:10px; color:#8AB4F8;" id="cc-cache-pill">⚡ 0 Pre-Cached</span>
      </div>
    </div>

    <!-- Login (shown when the backend has Supabase login on and nobody is signed in) -->
    <div id="cc-login" style="display:none; padding:12px; background:#F2F6FF; border-bottom:1px solid #D5DFEE;">
      <div style="font-weight:700; font-size:12px; color:#042970; margin-bottom:2px;">🔒 Log in to CashChase</div>
      <div style="font-size:11px; color:#64748B; margin-bottom:8px;">Same email and password as the WebApp.</div>
      <form id="cc-login-form" style="display:flex; flex-direction:column; gap:6px;">
        <input id="cc-login-email" class="cc-input" type="email" required placeholder="Email" autocomplete="email" />
        <input id="cc-login-password" class="cc-input" type="password" required placeholder="Password" autocomplete="current-password" />
        <div id="cc-login-error" role="alert" style="display:none; font-size:11px; color:#DC2626;"></div>
        <button id="cc-login-submit" type="submit" style="background:#042970; color:#fff; border:none; padding:7px; font-size:12px; font-weight:700; border-radius:8px; cursor:pointer;">Log in</button>
      </form>
    </div>

    <div class="cc-body">
      <!-- 1. Sleek Active Contact Card -->
      <div class="cc-card" style="padding:10px 12px; margin-bottom:2px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:6px; min-width:0;">
            <span style="font-size:14px;">👤</span>
            <span id="cc-customer-display" style="font-weight:700; font-size:13px; color:#042970; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">No Chat Open</span>
            <span id="cc-mem-pill" style="font-size:10px; padding:2px 7px; border-radius:999px; background:#E6EEFF; color:#0152FC; font-weight:700; white-space:nowrap;">Client Ready</span>
          </div>
          <div style="display:flex; gap:4px; align-items:center;">
            <button class="cc-sec-btn" id="cc-add-cust-btn" style="padding:3px 8px; font-size:10px; background:#10B981; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; display:none;" title="Add this contact as customer">➕ Add Customer</button>
            <button class="cc-sec-btn" id="cc-read-dom-btn" style="padding:3px 8px; font-size:10px;" title="Rescan WhatsApp DOM">🔄 Rescan</button>
          </div>
        </div>

        <div id="cc-msg-snippet" style="font-size:11px; color:#64748B; margin-top:6px; padding:6px 8px; background:#F8FAFC; border-radius:8px; border:1px solid #D5DFEE; font-style:italic; line-height:1.3; max-height:42px; overflow:hidden; text-overflow:ellipsis;">
          Click any chat in WhatsApp Web to analyze.
        </div>

        <input type="hidden" id="cc-customer-input" value="" />
        <input type="hidden" id="cc-message-input" value="" />

        <!-- Customer photo / PDF banner (hidden unless one arrives) -->
        <div id="cc-auto-ocr-banner" style="display:none; background:#ECFDF5; border:1px solid #10B981; border-radius:8px; padding:6px 8px; margin-top:6px;"></div>
      </div>

      <!-- 2. AI Action Card (deal line + 1-Click Prompt Chips + reply tabs + Big Action) -->
      <div class="cc-card" id="cc-result-card" style="padding:10px 12px;">
        <div style="font-weight:700; font-size:12px; color:#042970;" id="cc-ext-title">
          Ready for WhatsApp Message
        </div>
        <div class="cc-check-box" id="cc-ext-check" style="font-size:11px; padding:6px 8px; margin:6px 0; border-radius:8px; line-height:1.35;">
          Tap 🔄 Rescan to analyse this chat.
        </div>
        <div id="cc-deal-ctx" style="font-size:11px; color:#324564; line-height:1.4; margin-bottom:6px; white-space:pre-line;"></div>
        <div style="display:none;" id="cc-ext-desc"></div>

        <!-- Compact 1-Row Prompt Bar (Clean SME AI Copilot) -->
        <div style="background:#F2F6FF; border:1px solid #B8CEFF; border-radius:8px; padding:6px 8px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
            <span style="font-size:10px; font-weight:700; color:#0152FC;">✨ PROMPT AI (CUSTOMIZE FOR YOUR SME)</span>
          </div>
          <div style="display:flex; gap:4px;">
            <input id="cc-user-instruction" class="cc-input" placeholder="e.g. give 10% discount, quote 3 units, polite BM..." style="padding:6px 8px; font-size:11px; flex:1; background:#ffffff;" />
            <button id="cc-custom-prompt-btn" class="cc-sec-btn" style="background:#0152FC; color:#fff; border:none; padding:6px 11px; font-size:11px; font-weight:700; border-radius:8px; white-space:nowrap; cursor:pointer;">
              Ask AI ✨
            </button>
          </div>
        </div>

        <!-- 4 Sleek Horizontal Choice Tabs (NO VERTICAL TEXT STACK!) -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span class="cc-label" style="margin:0; font-size:10px;">💬 CHOOSE REPLY:</span>
          <span style="font-size:10px; color:#0152FC; font-weight:600;">Click tab to switch</span>
        </div>
        <div id="cc-reply-tabs" style="display:flex; gap:3px; margin-bottom:6px;"></div>

        <!-- Inline Editor for Rebate or Tech Drop-By -->
        <div id="cc-custom-param-box" style="display:none; background:#F2F6FF; border:1px solid #0152FC; border-radius:8px; padding:6px 8px; margin-bottom:6px;"></div>

        <!-- Single Focused Draft Textarea (Always Fits on Screen!) -->
        <textarea id="cc-draft-output" class="cc-textarea" rows="3" style="font-size:11.5px; line-height:1.35; margin-bottom:8px;" placeholder="Selected reply appears here..."></textarea>

        <!-- 1 Big Primary Action Button (Always in View Without Scrolling!) -->
        <button class="cc-big-btn" id="cc-big-action-btn" style="padding:11px 12px; font-size:12px;">
          ✅ Insert Selected Reply
        </button>
      </div>

      <!-- 3. Compact sales footer: follow-ups due now + reps' commission this month (GET /api/state) -->
      <div class="cc-card" id="cc-sales-card" style="padding:8px 10px; font-size:11px; margin-top:auto;">
        <div style="font-weight:700; color:#042970;">⏰ Follow-ups due</div>
        <div id="cc-followups-text" style="color:#324564; margin-bottom:6px;">Loading...</div>
        <div style="font-weight:700; color:#042970;">💰 Commission this month</div>
        <div id="cc-commission-text" style="color:#324564;">Loading...</div>
      </div>
      <div style="font-size:10px; color:#92400E; text-align:center; padding:2px 0 4px;">Prototype — synthetic data, not connected to Orbyte</div>
    </div>
  `;

  document.body.appendChild(root);

  // Floating Reopen Button (visible when sidebar is minimized)
  let reopenBtn = document.getElementById("cc-floating-reopen-btn");
  if (!reopenBtn) {
    reopenBtn = document.createElement("div");
    reopenBtn.id = "cc-floating-reopen-btn";
    reopenBtn.title = "Open CashChase Copilot";
    reopenBtn.innerHTML = "⚡ CashChase";
    reopenBtn.style.display = "none";
    document.body.appendChild(reopenBtn);
  }

  const roleSelect = document.getElementById("cc-role-select");
  if (roleSelect) {
    roleSelect.value = getCcRole();
    roleSelect.addEventListener("change", () => setCcRole(roleSelect.value));
  }
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
    ok = true;
    renderSalesCard();
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
  lastAnalysis = data.analysis;

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
  if (titleEl) titleEl.textContent = lastAnalysis.extTitle || "Recommended Action";
  const checkEl = document.getElementById("cc-ext-check");
  if (checkEl) {
    let checkText = lastAnalysis.extCheck || "";
    if (lastAnalysis.stage) {
      checkText = `[Chat stage: ${lastAnalysis.stage}]\n` + (lastAnalysis.coachTip ? `💡 Coach: ${lastAnalysis.coachTip}\n\n` : "") + checkText;
    }
    checkEl.textContent = checkText;
  }
  renderDealContext(lastAnalysis);
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
    btnEl.textContent = lastAnalysis.extBtnLabel || "✅ Insert Selected Reply";
  }

  // Render client memory pill with dedicated NEW_CLIENT neutral styling
  const mem = lastAnalysis.clientMemory;
  const memPill = document.getElementById("cc-mem-pill");
  if (mem && memPill) {
    if (mem.tier === "NEW_CLIENT") {
      memPill.textContent = "🆕 New Client";
      memPill.style.background = "#F1F5F9";
      memPill.style.color = "#475569";
      memPill.style.border = "1px solid #CBD5E1";
      memPill.title = "New contact with no past purchase records. Ask for a deposit to confirm the order.";
    } else {
      const isRisk = (mem.score || 75) < 60;
      memPill.textContent = `${isRisk ? "⚠️" : "⭐"} ${mem.tier.replace(/_/g, " ")} (${mem.score}/100)`;
      memPill.style.background = isRisk ? "#FEF3C7" : "#E6EEFF";
      memPill.style.color = isRisk ? "#B45309" : "#0152FC";
      memPill.style.border = isRisk ? "1px solid #FCD34D" : "1px solid #B8CEFF";
      memPill.title = `${mem.paymentBehavior || ""}\n${mem.styleSummary || ""}`;
    }
  }

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
    tabsContainer.innerHTML = opts.map((opt, idx) => {
      let shortLabel = "💼 Formal";
      const lLow = (opt.label || "").toLowerCase();
      if (lLow.includes("boss") || lLow.includes("friendly")) shortLabel = "🤝 Boss Style";
      else if (lLow.includes("fast") || lLow.includes("priority") || lLow.includes("close")) shortLabel = "⚡ Fast Close";
      else if (lLow.includes("melayu") || lLow.includes("bm") || lLow.includes("salam")) shortLabel = "🇲🇾 BM";
      else if (lLow.includes("custom") || lLow.includes("option 1")) shortLabel = "⭐ Quote";

      return `
        <button class="cc-tab-pill ${idx === 0 ? 'cc-tab-active' : ''}" data-idx="${idx}" title="${escapeHtml(opt.label)}">
          ${shortLabel}
        </button>
      `;
    }).join("");

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

        tabsContainer.querySelectorAll(".cc-tab-pill").forEach(b => b.classList.remove("cc-tab-active"));
        btn.classList.add("cc-tab-active");
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

  document.getElementById("cc-ext-title").textContent = userInstruction
    ? `⏳ AI Building Custom Quote: "${userInstruction}"...`
    : "⏳ AI Analyzing Chat...";

  // HIDE OLD REPLIES WHILE AI IS GENERATING NEW REPLY
  const tabsContainer = document.getElementById("cc-reply-tabs");
  if (tabsContainer) {
    tabsContainer.innerHTML = '<div style="padding:10px;text-align:center;color:#0152FC;font-size:12px;font-weight:600;background:#E6EEFF;border-radius:8px;">🤖 AI Copilot is generating new reply...</div>';
  }
  const draftEl = document.getElementById("cc-draft-output");
  if (draftEl) {
    draftEl.value = "";
    draftEl.placeholder = "🤖 Generating new reply with AI Copilot...";
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
    : a && a.extActionType === "MARK_WON" && !a.depositRef ? "⚠️ Add the slip reference first" : "";
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
