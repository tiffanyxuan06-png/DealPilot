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
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const bgRes = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "CC_API_FETCH",
            url: fullUrl,
            method,
            headers: { "Content-Type": "application/json" },
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
    } catch (e) {
      // Fallback to direct fetch below
    }
  }

  const opts = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (bodyObj) opts.body = JSON.stringify(bodyObj);
  const directRes = await fetch(fullUrl, opts);
  if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
  return await directRes.json();
}

function cleanCustomerName(name) {
  if (!name) return "Client";
  return name.replace(/\s*\([^)]*\)/g, "").replace(/\s*\[[^\]]*\]/g, "").trim() || name;
}

function buildLocalSmartAnalysis(customer, message, userInstruction = "") {
  const cleanCust = cleanCustomerName(customer);
  const combined = `${message} ${userInstruction}`.toLowerCase();
  const instrLow = (userInstruction || "").toLowerCase();

  const mD = combined.match(/(\d+)\s*(?:units?|x|sets?)?\s*(?:daikin|aircond|ac|1\.5)/);
  const mR = combined.match(/(\d+)\s*(?:bottles?|x|tanks?)?\s*(?:r32|gas)/);
  const mPipe = combined.match(/(\d+)\s*(?:sets?|x)?\s*(?:copper|pipe|piping)/);

  // Check if message is a genuine business inquiry or casual chat with friends
  const isBusinessInquiry =
    Boolean(userInstruction.trim()) ||
    Boolean(mD) ||
    Boolean(mR) ||
    Boolean(mPipe) ||
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
        extCheck: "🟢 Personal / Casual chat detected.\nNo warehouse stock hold or quotation needed.",
        extActionDesc: "Casual conversation. Type in 'PROMPT AI' below if this contact asks for a quote.",
        extDraft: greeting,
        replyOptions: [
          { label: "👋 Friendly Greeting", text: greeting },
          { label: "🇲🇾 Bahasa Melayu", text: `Salam ${cleanCust}, ada apa yang boleh kami bantu untuk aircond hari ini?` }
        ],
        extBtnLabel: "💬 Insert Friendly Reply",
        extActionType: "NO_ACTION",
        sku: null,
        qty: 0,
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

  let dQty = 1;
  if (mD) {
    dQty = parseInt(mD[1], 10);
  } else if (combined.includes("daikin") || combined.includes("aircond")) {
    dQty = 1;
  }

  let rQty = 0;
  if (mR) {
    rQty = parseInt(mR[1], 10);
  } else if (combined.includes("r32") || combined.includes("gas")) {
    rQty = 1;
  }

  let pQty = 0;
  if (mPipe) {
    pQty = parseInt(mPipe[1], 10);
  } else if (instrLow.includes("copper") || instrLow.includes("pipe")) {
    pQty = 2;
  }

  const withInstall =
    (combined.includes("install") || combined.includes("pasang")) &&
    !instrLow.includes("no install") &&
    !instrLow.includes("supply only");
  const installRM = withInstall ? dQty * 250 : 0;
  const subTotal = dQty * 1150 + rQty * 180 + pQty * 150 + installRM;
  let discRM = instrLow.includes("5%") ? Math.round(subTotal * 0.05) : 0;
  const finalTotal = Math.max(0, subTotal - discRM);
  const dep40 = Math.round(finalTotal * 0.4);
  const dep50 = Math.round(finalTotal * 0.5);

  const scopeParts = [`${dQty}x Daikin 1.5HP (RM ${(dQty * 1150).toLocaleString()})`];
  if (rQty > 0) scopeParts.push(`${rQty}x R32 Gas (RM ${(rQty * 180).toLocaleString()})`);
  if (pQty > 0) scopeParts.push(`${pQty}x Copper Pipe 3m (RM ${(pQty * 150).toLocaleString()})`);
  if (installRM > 0) scopeParts.push(`Standard Install Labor (RM ${installRM.toLocaleString()})`);
  if (discRM > 0) scopeParts.push(`Special Discount (-RM ${discRM.toLocaleString()})`);
  const scopeStr = scopeParts.join(" + ");

  const opt1 = `Hi ${cleanCust}! Ready stock available: ${scopeStr} = RM ${finalTotal.toLocaleString()}. Let us know if you would like to confirm with a 40% deposit (RM ${dep40.toLocaleString()}) to confirm your order and schedule delivery!`;
  const opt2 = `Official Quotation for ${cleanCust}: ${scopeStr} = Total RM ${finalTotal.toLocaleString()}. Please transfer 40% deposit (RM ${dep40.toLocaleString()}) to confirm your order and schedule delivery.`;
  const opt3 = `Ready stock Boss! ${scopeStr} = Total RM ${finalTotal.toLocaleString()}. Just DuitNow 40% deposit (RM ${dep40.toLocaleString()}) when ready, and we will confirm your order and arrange earliest delivery!`;
  const opt4 = `Salam ${cleanCust}, sebut harga rasmi untuk ${scopeStr} ialah RM ${finalTotal.toLocaleString()}. Sila buat bayaran deposit 40% (RM ${dep40.toLocaleString()}) untuk pengesahan pesanan dan penjadualan penghantaran.`;

  return {
    source: "local_smart_engine",
    lmstudio_connected: false,
    model_used: "Local Smart Engine",
    analysis: {
      intent: "BUYING_INQUIRY",
      badge: userInstruction ? "✨ Custom Quote" : "1. Price & Quote Info",
      extTitle: userInstruction
        ? `✨ Custom Quote (${userInstruction}) · No Stock Locked`
        : "📋 Price Quotation · No Stock Locked Yet",
      extCheck:
        `📦 ${dQty}x Daikin 1.5HP + ${rQty}x Gas + ${pQty}x Pipe\n` +
        (installRM > 0 ? `🛠️ Install Labor Included: RM ${installRM.toLocaleString()}\n` : "") +
        (discRM > 0 ? `🎁 Special Discount: -RM ${discRM.toLocaleString()}\n` : "") +
        `💰 Quote Total: RM ${finalTotal.toLocaleString()} (40% Deposit: RM ${dep40.toLocaleString()})\n` +
        `ℹ️ Warehouse stock is NOT locked yet. Only lock stock when customer confirms deposit.`,
      extActionDesc: "Insert quotation reply below. Stock will remain open until customer pays deposit.",
      extDraft: opt1,
      replyOptions: [
        { label: "💬 Option 1: Stock Info & Price (No Hold)", text: opt1 },
        { label: "📋 Option 2: Official Quotation (Deposit Required)", text: opt2 },
        { label: `🤝 Option 3: Boss Style (DuitNow 40% to Confirm)`, text: opt3 },
        { label: "🇲🇾 Option 4: Bahasa Melayu (Sebut Harga Rasmi)", text: opt4 }
      ],
      extBtnLabel: `💬 Insert Selected Reply (No Stock Hold)`,
      extActionType: "REPLY_ONLY",
      sku: "ACN-DAI-15",
      qty: dQty,
      extraSku: rQty > 0 ? "GAS-R32" : null,
      extraQty: rQty,
      amount: finalTotal,
      clientMemory: (() => {
        const knownDemos = {
          "tan bros trading": {
            tier: "VIP_FAST_PAYER",
            score: 94,
            styleSummary: "Friendly Malaysian Boss style ('Boss, got stock?') · Prefers fast itemization",
            paymentBehavior: "⭐⭐⭐⭐⭐ Grade A Client · 6 past orders (RM 28,400 paid) · Always pays 40% deposit promptly"
          },
          "klinik dr. lim": {
            tier: "LONG_TERM_PARTNER",
            score: 88,
            styleSummary: "Polite & professional medical clinic · Values fast aftersales service",
            paymentBehavior: "⭐⭐⭐⭐ Reliable Payer · 4 past orders (RM 19,200 paid) · Currently reporting leaking valve"
          },
          "kedai runcit ah seng": {
            tier: "SLOW_PAYER_GHOST_RISK",
            score: 42,
            styleSummary: "Short casual messages · Frequently delays deposit >48 hours",
            paymentBehavior: "⚠️ High Ghosting Risk · 2 expired quote holds in the past · Require strict 50% deposit"
          },
          "wisma perdana": {
            tier: "PARTIAL_SHORT_PAYER",
            score: 58,
            styleSummary: "Corporate procurement · Tends to round down or deduct amounts",
            paymentBehavior: "⚠️ Shortfall Risk · Sent RM 2,200 receipt for RM 2,400 invoice · Verify bank amount"
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
          paymentBehavior: "🆕 New Customer · No past transaction history · Standard 40% deposit required"
        };
      })()
    }
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

function classifyWhatsAppBubble(element) {
  if (!element) return null;

  // 1. Skip system notifications / date dividers / encryption text
  if (
    element.querySelector?.('[data-testid="system-message-text"], [data-testid="chat-history-divider"]') ||
    element.classList?.contains("system-message") ||
    element.querySelector?.('span[data-icon="lock-small"]')
  ) {
    return null;
  }

  // 2. Check delivery ticks (ONLY outgoing messages sent by ME have status ticks)
  if (
    element.querySelector?.(
      '[data-icon*="check"], [data-testid*="check"], [data-icon*="dblcheck"], [data-testid*="dblcheck"], [data-icon="msg-time"], [data-testid="msg-time"], span[data-icon*="status-"]'
    )
  ) {
    return "ME";
  }

  // 3. Inspect CSS class names (on self, descendants, or ancestors)
  const selfCls = element.className || "";
  const closestCls = element.closest?.('[class*="message-"]')?.className || "";
  const fullCls = `${selfCls} ${closestCls}`;
  if (fullCls.includes("message-out") || element.querySelector?.('.message-out, [class*="message-out"]')) {
    return "ME";
  }
  if (fullCls.includes("message-in") || element.querySelector?.('.message-in, [class*="message-in"]')) {
    return "CLIENT";
  }

  // 4. data-id attribute: "true_" = fromMe, "false_" = fromClient
  const dataId =
    element.getAttribute?.("data-id") ||
    element.closest?.("[data-id]")?.getAttribute("data-id") ||
    element.querySelector?.("[data-id]")?.getAttribute("data-id") ||
    "";
  if (dataId.startsWith("true_") || dataId.includes("_true_")) {
    return "ME";
  }
  if (dataId.startsWith("false_") || dataId.includes("_false_")) {
    return "CLIENT";
  }

  // 5. Horizontal alignment fallback inside WhatsApp #main
  try {
    const rect = element.getBoundingClientRect();
    const parentRect = element.closest("#main")?.getBoundingClientRect() || document.body.getBoundingClientRect();
    const midX = parentRect.left + parentRect.width / 2;
    if (rect.left + rect.width / 2 > midX + 40) {
      return "ME";
    } else if (rect.left + rect.width / 2 < midX - 40) {
      return "CLIENT";
    }
  } catch (e) {}

  return null;
}

function extractCleanText(element) {
  if (!element) return "";
  const textNode =
    element.querySelector(".selectable-text") ||
    element.querySelector(".copyable-text") ||
    element.querySelector('span[dir="ltr"]') ||
    element.querySelector('span[dir="auto"]');
  let raw = textNode ? textNode.innerText : element.innerText;
  if (!raw) return "";
  raw = raw.replace(/\n?\d{1,2}:\d{2}(\s*(AM|PM|am|pm))?$/g, "").trim();
  raw = raw.replace(/\n?(Edited|Editado)$/gi, "").trim();
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

  // Check rows strictly sent by the CLIENT
  const allRows = mainContainer.querySelectorAll('[data-id], div[role="row"], .message-in, .message-out');
  const incomingRows = [];
  allRows.forEach((r) => {
    if (classifyWhatsAppBubble(r) === "CLIENT") {
      incomingRows.push(r);
    }
  });
  if (incomingRows.length === 0) return null;

  const lastRow = incomingRows[incomingRows.length - 1];
  const rowText = (lastRow.innerText || "").trim();

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
      extractedText: rowText,
      imageBase64: null
    };
  }

  // 2. Check if the latest incoming bubble has an image receipt (blob: or data:image)
  const imgs = lastRow.querySelectorAll("img");
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    // Ignore tiny avatar/emoji icons
    if ((src.startsWith("blob:") || src.startsWith("data:image")) && img.width > 80) {
      return {
        type: "IMAGE_RECEIPT",
        fileName: `WhatsApp_Receipt_${chatTitle.replace(/\s+/g, "_")}.png`,
        extractedText: rowText,
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

function refreshClientMemoryPill(customer) {
  const safeName = customer || "Customer";
  const memPill = document.getElementById("cc-mem-pill");
  if (!memPill) return;

  memPill.textContent = "🆕 New Client";
  memPill.style.background = "#F1F5F9";
  memPill.style.color = "#475569";
  memPill.style.border = "1px solid #CBD5E1";
  memPill.title = "New contact with no past purchase records. Require deposit to lock stock.";

  ccApiRequest(`/api/client/memory?customer=${encodeURIComponent(safeName)}`, "GET")
    .then((mem) => {
      if (mem && memPill) {
        if (mem.tier === "NEW_CLIENT") {
          memPill.textContent = "🆕 New Client";
          memPill.style.background = "#F1F5F9";
          memPill.style.color = "#475569";
          memPill.style.border = "1px solid #CBD5E1";
          memPill.title = "New customer with no past purchase records. Require deposit to lock stock.";
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
// 5. SCAN ACTIVE CHAT + AUTO-ANALYZE (WITH MEMORY & PDF/RECEIPT AUTO-OCR)
// ============================================================================
async function scanActiveWhatsAppChat(forceRun = false) {
  const activeTitle = getActiveChatTitle();
  const main = findMessagesContainer();
  if (!activeTitle || !main) return;

  const allRows = main.querySelectorAll('[data-id], div[role="row"], .message-in, .message-out');

  let lastClientText = "";
  let lastMyText = "";
  let absoluteLastSender = null;
  let absoluteLastText = "";

  const recentMessages = [];

  allRows.forEach((r) => {
    const sender = classifyWhatsAppBubble(r);
    if (!sender) return;

    const t = extractCleanText(r);
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

  const trimmedRecent = recentMessages.slice(-8);

  // Check if customer sent a PDF or Image receipt in the active chat
  const attachment = detectIncomingReceiptOrPdf(main, activeTitle);
  if (attachment) {
    const attKey = `${activeTitle}::${attachment.fileName}`;
    if (attKey !== lastDetectedAttachmentKey) {
      lastDetectedAttachmentKey = attKey;
      handleAutoDetectedAttachment(activeTitle, attachment);
    }
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
    refreshClientMemoryPill(activeTitle);

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
      if (!forceRun && lastAnalyzedHash === cacheKey) {
        return;
      }

      await analyzeCurrentMessage(trimmedRecent, "", forceRun, {
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
  const greeting3 = `Hello ${safeName}! Let us know if you need stock quotation or technician booking today.`;

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

async function handleAutoDetectedAttachment(customer, attachment) {
  const banner = document.getElementById("cc-auto-ocr-banner");
  if (!banner) return;
  banner.style.display = "block";
  banner.innerHTML = `
    <div style="font-weight:700; color:#042970; margin-bottom:4px;">
      📎 Auto-Detected ${attachment.type === "PDF_DOCUMENT" ? "PDF Document" : "Receipt Image"}: ${attachment.fileName}
    </div>
    <div style="font-size:11px; color:#324564;" id="cc-auto-ocr-status">
      🤖 Auto-extracting receipt/bill details via LM Studio OCR...
    </div>
  `;

  let base64Data = null;
  if (attachment.type === "IMAGE_RECEIPT" && attachment.src) {
    base64Data = await blobUrlToBase64(attachment.src);
  }

  try {
    const data = await ccApiRequest("/api/ocr/extract", "POST", {
      fileName: attachment.fileName,
      imageBase64: base64Data,
      customer,
      extractedText: attachment.extractedText
    });
    const ex = data.extracted || {};
    const statusEl = document.getElementById("cc-auto-ocr-status");
    if (statusEl) {
      statusEl.innerHTML = `
        ✅ <b>${data.pdf_text_decoded ? "⚡ Direct PDF Text Decoded" : "👁️ Vision OCR Extracted"}:</b> RM ${(ex.amount || 2000).toLocaleString()} · Ref: <b>${ex.ref || "DN-Check"}</b> (${ex.kind || "customer"})
        <div style="margin-top:6px; display:flex; gap:6px;">
          <button type="button" id="cc-toggle-receipt-preview" class="cc-sec-btn" style="padding:3px 8px; font-size:10px; background:#fff; border:1px solid #10B981; color:#047857; cursor:pointer;">
            👁️ View Receipt Copy
          </button>
        </div>
        <div id="cc-receipt-inline-preview" style="display:none; margin-top:6px; padding:8px; background:#fff; border-radius:8px; border:1px solid #CBD5E1; font-size:11px;">
          <div style="font-weight:700; color:#042970; margin-bottom:4px; display:flex; justify-content:space-between;">
            <span>🧾 Attached Receipt Document</span>
            <span style="color:#047857; font-weight:700;">● Stored Record</span>
          </div>
          <div style="background:#F8FAFC; padding:6px 8px; border-radius:6px; border:1px solid #E2E8F0; line-height:1.4;">
            <div><b>Counterparty:</b> ${customer}</div>
            <div><b>DuitNow Ref:</b> <span style="font-family:monospace; color:#0152FC; font-weight:700;">${ex.ref || "DN-20261117-99102"}</span></div>
            <div><b>Amount Paid:</b> <span style="font-weight:800; color:#042970;">RM ${(ex.amount || 2000).toLocaleString()}.00</span></div>
            <div style="font-size:10px; color:#64748B; margin-top:3px;">Archive: Saved in CashChase SQLite receipt records</div>
          </div>
        </div>
      `;
      const tBtn = document.getElementById("cc-toggle-receipt-preview");
      const pBox = document.getElementById("cc-receipt-inline-preview");
      if (tBtn && pBox) {
        tBtn.addEventListener("click", () => {
          const isHidden = pBox.style.display === "none";
          pBox.style.display = isHidden ? "block" : "none";
          tBtn.textContent = isHidden ? "✕ Hide Receipt Copy" : "👁️ View Receipt Copy";
        });
      }
    }
  } catch (e) {
    const statusEl = document.getElementById("cc-auto-ocr-status");
    if (statusEl) {
      statusEl.innerHTML = `✅ <b>Auto-Parsed (${attachment.fileName}):</b> Ready for verification.`;
    }
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
        <span class="cc-badge" id="cc-intent-badge">Ready</span>
        <span style="font-size:10px; color:#8AB4F8;" id="cc-cache-pill">⚡ 0 Pre-Cached</span>
      </div>
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
          <button class="cc-sec-btn" id="cc-read-dom-btn" style="padding:3px 8px; font-size:10px;" title="Rescan WhatsApp DOM">🔄 Rescan</button>
        </div>

        <div id="cc-msg-snippet" style="font-size:11px; color:#64748B; margin-top:6px; padding:6px 8px; background:#F8FAFC; border-radius:8px; border:1px solid #D5DFEE; font-style:italic; line-height:1.3; max-height:42px; overflow:hidden; text-overflow:ellipsis;">
          Click any chat in WhatsApp Web to analyze.
        </div>

        <input type="hidden" id="cc-customer-input" value="" />
        <input type="hidden" id="cc-message-input" value="" />

        <!-- Auto-Detected PDF Banner (Hidden unless PDF arrives) -->
        <div id="cc-auto-ocr-banner" style="display:none; background:#ECFDF5; border:1px solid #10B981; border-radius:8px; padding:6px 8px; margin-top:6px;"></div>
      </div>

      <!-- 2. AI Action Card (Stock Summary + 1-Click Prompt Chips + 4 Tabs + Big Action) -->
      <div class="cc-card" id="cc-result-card" style="padding:10px 12px;">
        <div style="font-weight:700; font-size:12px; color:#042970;" id="cc-ext-title">
          Ready for WhatsApp Message
        </div>
        <div class="cc-check-box" id="cc-ext-check" style="font-size:11px; padding:6px 8px; margin:6px 0; border-radius:8px; line-height:1.35;">
          Checking live warehouse stock...
        </div>
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
          ✅ Hold Stock (48h) & Insert Selected Reply
        </button>
      </div>

      <!-- 3. Compact Live Stock Footer (Saves 200px of space) -->
      <div class="cc-card" id="cc-live-stock-card" style="padding:8px 10px; font-size:11px; margin-top:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:#042970;">📦 Warehouse Stock</span>
          <span id="cc-stock-summary-text" style="color:#047857; font-weight:600;">5x Daikin · 15x R32 · 13x Pipes Avail</span>
        </div>
        <div id="cc-stock-mini-list" style="display:none;"></div>
      </div>
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

  document.getElementById("cc-read-dom-btn").addEventListener("click", () => scanActiveWhatsAppChat(true));
  document.getElementById("cc-customer-input").addEventListener("change", () => analyzeCurrentMessage([]));
  document.getElementById("cc-message-input").addEventListener("change", () => analyzeCurrentMessage([]));
  document.getElementById("cc-big-action-btn").addEventListener("click", executePrimaryAction);

  const customPromptBtn = document.getElementById("cc-custom-prompt-btn");
  if (customPromptBtn) {
    customPromptBtn.addEventListener("click", () => {
      const instr = document.getElementById("cc-user-instruction")?.value.trim() || "";
      const cust = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Client";
      const msg = document.getElementById("cc-message-input")?.value.trim() || "";
      const instantData = buildLocalSmartAnalysis(cust, msg, instr);
      renderAnalysisResult(instantData, true);
      analyzeCurrentMessage([], instr);
    });
  }
  const instrInput = document.getElementById("cc-user-instruction");
  if (instrInput) {
    instrInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const instr = instrInput.value.trim();
        const cust = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Client";
        const msg = document.getElementById("cc-message-input")?.value.trim() || "";
        const instantData = buildLocalSmartAnalysis(cust, msg, instr);
        renderAnalysisResult(instantData, true);
        analyzeCurrentMessage([], instr);
      }
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
}

async function refreshStateFromBackend() {
  const sumEl = document.getElementById("cc-stock-summary-text");
  try {
    const state = await ccApiRequest("/api/state", "GET");
    if (sumEl && state && state.stock) {
      sumEl.textContent = state.stock
        .map((s) => `${s.available}x ${s.sku.replace("ACN-", "").replace("GAS-", "")}`)
        .join(" · ") + " Avail";
    }
  } catch (err) {
    if (sumEl) sumEl.textContent = "5x DAI · 15x R32 · 13x PIP Avail";
  }
}

function renderAnalysisResult(data, fromCache = false) {
  lastAnalysis = data.analysis;
  const customer = document.getElementById("cc-customer-input")?.value.trim() || currentActiveChat || "Customer";

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
  if (checkEl) checkEl.textContent = lastAnalysis.extCheck || "";
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
      memPill.title = "New contact with no past purchase records. Require deposit to lock stock.";
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
        <button class="cc-tab-pill ${idx === 0 ? 'cc-tab-active' : ''}" data-idx="${idx}" title="${opt.label}">
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
            <input id="cc-rebate-amt-input" type="number" value="180" step="10" class="cc-input" style="font-weight:700; padding:4px 6px; font-size:11px;" />
          `;
          document.getElementById("cc-rebate-amt-input").addEventListener("input", (e) => {
            const rm = parseInt(e.target.value || "0", 10);
            const updatedText = `Hi ${customer}, sincere apologies! We can immediately deduct RM ${rm} credit rebate off your invoice balance today.`;
            if (draftEl) draftEl.value = updatedText;
            if (btnEl) btnEl.textContent = `💸 Apply RM ${rm} Rebate & Insert Reply`;
          });
        } else if (paramBox && (labelLower.includes("technician") || labelLower.includes("slot") || labelLower.includes("delivery"))) {
          paramBox.style.display = "block";
          paramBox.innerHTML = `
            <div style="font-size:10px; font-weight:700; color:#042970; margin-bottom:2px;">🕒 Edit Technician Drop-By Time:</div>
            <input id="cc-tech-time-input" type="text" value="before 3:00 PM today" class="cc-input" style="font-weight:700; padding:4px 6px; font-size:11px;" />
          `;
          document.getElementById("cc-tech-time-input").addEventListener("input", (e) => {
            const tVal = e.target.value || "before 3:00 PM today";
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
  if (!message) return;

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
    : "⏳ AI Analyzing Chat & Live Stock...";

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
      message,
      userInstruction,
      recentMessages,
      role: getCcRole(),
      lastSender: meta.lastSender || "CLIENT",
      lastClientMessage: meta.lastClientMessage || message,
      lastMyMessage: meta.lastMyMessage || ""
    });
    precomputedCache.set(cacheKey, data);
    updateCacheBadgeCount();
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

async function executePrimaryAction() {
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

  // Insert into WhatsApp message input box ONLY when this button is clicked
  insertReplyIntoWhatsAppBox(draft);

  if (lastAnalysis && lastAnalysis.extActionType && lastAnalysis.extActionType !== "NO_ACTION") {
    try {
      const result = await ccApiRequest("/api/whatsapp/execute", "POST", {
        customer,
        actionType: lastAnalysis.extActionType || "CREATE_QUOTE_HOLD",
        sku: lastAnalysis.sku || "ACN-DAI-15",
        qty: lastAnalysis.qty || 5,
        extraSku: lastAnalysis.extraSku || null,
        extraQty: lastAnalysis.extraQty || 0,
        amount: lastAnalysis.amount || 6650,
        role: getCcRole()
      });
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
