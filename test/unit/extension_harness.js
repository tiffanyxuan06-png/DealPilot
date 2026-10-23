/**
 * Node harness for extension/content.js (no npm, Node built-ins only).
 *
 *   node test/unit/extension_harness.js <scenario> ['{"option": 1}']
 *
 * Loads content.js into a vm context with a tiny fake DOM, runs one named scenario, lets pending timers and
 * promises finish (so delayed fetches are caught too), then prints
 *   {"scenario", "result", "network", "events", "errors"}   as JSON on stdout.
 * "network" lists every chrome.runtime.sendMessage / fetch / XHR / sendBeacon attempt, so a test can
 * assert "no network call". "events" lists every click() and dispatchEvent() (e.g. to prove nothing was sent).
 * "errors" lists exceptions thrown inside timers or left as unhandled promise rejections.
 *
 * To add a scenario: write `scenarios.my_name = async (env, opts) => { ...; return {plain: "data"}; }`
 * near the bottom. Build DOM with h(), put it in env.document.body, call content.js functions through
 * env.ctx (functions) or env.run("code") (top-level let/const such as precomputedCache). Then assert on the
 * returned JSON from pytest. The fake DOM only has what the tested functions need; extend it when yours needs more.
 *
 * Sidebar helpers on env (all async, each ends with env.settle()):
 *   env.bootSidebar()                      stub WhatsApp (#app/#main/#pane-side), run createSidebar()
 *   env.switchChat(title, [["in"|"out", text], ...])   change header title, add message rows, fire the MutationObserver
 *   env.click(id)                          click an element by id (runs its click listeners)
 *   env.settle()                           run pending timers (nested ones too) and flush promises
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// CC_CONTENT_JS lets you point the harness at a modified copy of content.js (to prove a test can fail).
const CONTENT_JS = process.env.CC_CONTENT_JS || path.join(__dirname, "..", "..", "extension", "content.js");

// ---------------------------------------------------------------- fake DOM
class Event {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() {}
}
class InputEvent extends Event {}
class KeyboardEvent extends Event {}
class MouseEvent extends Event {}

const ATTR_RE = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(\*=|\^=|\$=|=)"?([^"\]]*?)"?(\s+i)?)?\]/g;

function parseCompound(s) {
  const m = s.match(/^([\w*-]+)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/);
  if (!m) throw new Error(`harness: unsupported selector "${s}"`);
  return { tag: m[1] && m[1] !== "*" ? m[1].toLowerCase() : null, rest: [...m[2].matchAll(ATTR_RE)] };
}

// Supports: tag, #id, .class, [attr], [attr=v], [attr*=v i], descendant (space) and comma lists.
function parseSelector(sel) {
  const alts = [[]];
  for (const tok of sel.match(/(?:[^\s,\[]|\[[^\]]*\])+|,/g) || []) {
    if (tok === ",") alts.push([]); else alts[alts.length - 1].push(parseCompound(tok));
  }
  return alts;
}

function matchesCompound(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  return c.rest.every(([, id, cls, name, op, val, ci]) => {
    if (id) return el.getAttribute("id") === id;
    if (cls) return (el.getAttribute("class") || "").split(/\s+/).includes(cls);
    const have = el.getAttribute(name);
    if (have === null) return false;
    if (!op) return true;
    const a = ci ? have.toLowerCase() : have;
    const b = ci ? val.toLowerCase() : val;
    return op === "=" ? a === b : op === "*=" ? a.includes(b) : op === "^=" ? a.startsWith(b) : a.endsWith(b);
  });
}

function matchesChain(el, chain) {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let i = chain.length - 2;
  for (let p = el.parentElement; p && i >= 0; p = p.parentElement) {
    if (matchesCompound(p, chain[i])) i--;
  }
  return i < 0;
}

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** el.style: setProperty/removeProperty plus plain camelCase fields (style.display, style.marginRight). */
class FakeStyle {
  setProperty(k, v) { this[camel(k)] = v; }
  removeProperty(k) { delete this[camel(k)]; }
  getPropertyValue(k) { return this[camel(k)] || ""; }
}

const VOID_TAGS = new Set(["input", "br", "img", "hr", "meta", "link"]);
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&nbsp;": " " };
const TOKEN_RE = /<!--[\s\S]*?-->|<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
const ATTR_PAIR_RE = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Tiny HTML parser for innerHTML: tags, attributes (quoted, unquoted, boolean), nesting, void tags, text. */
function parseHtml(parent, html) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  for (const m of html.matchAll(TOKEN_RE)) {
    const [whole, closeTag, openTag, attrs, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      top.appendChild(text.replace(/&(?:amp|lt|gt|quot|#039|nbsp);/g, (e) => ENTITIES[e]));
    } else if (closeTag) {
      const at = stack.map((e) => e.tagName.toLowerCase()).lastIndexOf(closeTag.toLowerCase());
      if (at > 0) stack.length = at;
    } else if (openTag) {
      const el = doc.createElement(openTag);
      for (const [, name, dq, sq, bare] of (attrs || "").matchAll(ATTR_PAIR_RE)) {
        el.setAttribute(name, dq ?? sq ?? bare ?? "");
      }
      top.appendChild(el);
      if (!VOID_TAGS.has(openTag.toLowerCase()) && !whole.endsWith("/>")) stack.push(el);
    }
  }
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];   // elements and strings (text)
    this.parentElement = null;
    this._attrs = {};
    this._text = null;    // set when textContent/innerText/innerHTML is assigned
    this._listeners = {};
    this.style = new FakeStyle();
    this.checked = false;
    this.width = 0;       // content.js reads img.width to skip tiny icons
  }
  get value() {
    if (this._value !== undefined) return this._value;
    return this.tagName === "TEXTAREA" ? this.textContent : this.getAttribute("value") || "";
  }
  set value(v) { this._value = String(v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    const save = (l) => { el.className = l.join(" "); };
    return {
      add: (...c) => save([...new Set([...list(), ...c])]),
      remove: (...c) => save(list().filter((x) => !c.includes(x))),
      contains: (c) => list().includes(c),
      toggle(c, force) {
        const on = force === undefined ? !list().includes(c) : force;
        on ? this.add(c) : this.remove(c);
        return on;
      }
    };
  }
  get dataset() {
    const el = this;
    const attr = (k) => "data-" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    return new Proxy({}, {
      get: (_, k) => el.getAttribute(attr(String(k))) ?? undefined,
      set: (_, k, v) => { el.setAttribute(attr(String(k)), v); return true; }
    });
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(v) { this.children = []; this._text = String(v); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.textContent; }          // ponytail: returns text, not markup
  set innerHTML(v) { this.children = []; this._text = null; parseHtml(this, String(v)); }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get attributes() { return Object.entries(this._attrs).map(([name, value]) => ({ name, value })); }
  getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; }
  setAttribute(n, v) {
    this._attrs[n] = String(v);
    if (n === "style") String(v).split(";").forEach((d) => {
      const i = d.indexOf(":");
      if (i > 0) this.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim());
    });
  }
  hasAttribute(n) { return n in this._attrs; }
  removeAttribute(n) { delete this._attrs[n]; }
  appendChild(c) {
    if (typeof c !== "string") { if (c.parentElement) c.remove(); c.parentElement = this; }
    this._text = null;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  closest(sel) {
    const alts = parseSelector(sel);
    for (let e = this; e; e = e.parentElement) if (alts.some((ch) => matchesChain(e, ch))) return e;
    return null;
  }
  querySelectorAll(sel) {
    const alts = parseSelector(sel);
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (typeof c === "string") continue;
        if (alts.some((ch) => matchesChain(c, ch))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) {
    this.ownerDocument._env.events.push({ type: ev.type, tag: this.tagName.toLowerCase(), key: ev.key, data: ev.data });
    (this._listeners[ev.type] || []).forEach((fn) => fn(ev));
    return true;
  }
  click() { this.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}

function makeDocument(env) {
  const doc = { _env: env, activeElement: null };
  doc.createElement = (tag) => new FakeElement(tag, doc);
  doc.documentElement = doc.createElement("html");
  doc.body = doc.createElement("body");
  doc.documentElement.appendChild(doc.body);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.getElementById = (id) => doc.documentElement.querySelector(`[id="${id}"]`);
  doc.createRange = () => ({ selectNodeContents() {} });
  doc.addEventListener = () => {};
  // Models a browser where insertText works; set opts.execCommandWorks=false to test the fallback path.
  doc.execCommand = (cmd, _ui, value) => {
    if (cmd !== "insertText" || env.opts.execCommandWorks === false || !doc.activeElement) return false;
    doc.activeElement.innerText = value;
    return true;
  };
  return doc;
}

/** h("div", {role: "row"}, child, "text", ...) builds a FakeElement tree. */
function h(doc, tag, attrs = {}, ...kids) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  kids.flat().forEach((k) => el.appendChild(k));
  return el;
}

// ---------------------------------------------------------------- environment
/** Loads content.js into a fresh vm context. Returns { ctx, document, network, events, run, runTimers, h }. */
function loadContent(opts = {}) {
  const env = { opts, network: [], events: [], errors: [], timers: [], intervals: [], observers: [], winListeners: {} };
  const document = makeDocument(env);
  const store = {};
  // Stubbed backend. opts: customers (list GET /api/state returns), state (more /api/state fields: deals, reps), stateFails (fail the first N state reads),
  // responses {"/api/path": reply} per path, backendResponse (every other path). A good POST /api/customers adds to the list.
  const customers = opts.customers || [{ name: "Tan Bros Trading", phone: "" }, { name: "Ah Seng", phone: "" }];
  let stateFailures = Number(opts.stateFails || 0);
  const replyFor = (msg) => {
    const urlPath = String(msg.url || "").replace("http://127.0.0.1:8000", "");
    if (urlPath === "/api/state") {
      return stateFailures-- > 0 ? { ok: false, status: 503 } : { ok: true, data: { ...(opts.state || {}), customers: customers.map((c) => ({ ...c })) } };   // a copy, like a real HTTP response
    }
    const r = (opts.responses && opts.responses[urlPath]) || opts.backendResponse || { ok: true, data: {} };
    if (urlPath === "/api/customers" && msg.method === "POST" && r.ok) {
      const { name, phone } = JSON.parse(msg.body);
      customers.push({ name, phone });
    }
    return r;
  };

  const sandbox = {
    document, Event, InputEvent, KeyboardEvent, MouseEvent, console,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    chrome: {
      runtime: {
        lastError: undefined,
        sendMessage(msg, cb) {
          env.network.push({ kind: "sendMessage", message: msg });
          if (cb) Promise.resolve().then(() => cb(replyFor(msg)));
        }
      }
    },
    fetch: async (url, init) => {
      env.network.push({ kind: "fetch", url: String(url), method: (init && init.method) || "GET" });
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", blob: async () => ({}) };
    },
    XMLHttpRequest: class {
      open(method, url) { this.rec = { kind: "xhr", method, url: String(url) }; }
      send() { env.network.push(this.rec || { kind: "xhr" }); }
    },
    MutationObserver: class {
      constructor(cb) { this.callback = cb; env.observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() {}
    },
    // Timers are recorded, not run. Call env.runTimers() to run pending setTimeouts once.
    setTimeout: (fn, ms) => { env.timers.push({ fn, ms }); return env.timers.length; },
    setInterval: (fn, ms) => { env.intervals.push({ fn, ms }); return env.intervals.length; },
    clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: (fn) => { env.timers.push({ fn, ms: 0 }); return 0; }
  };
  sandbox.navigator = { sendBeacon: (url) => { env.network.push({ kind: "beacon", url: String(url) }); return true; } };
  sandbox.window = sandbox;
  sandbox.innerWidth = 1280;
  sandbox.addEventListener = (type, fn) => { (env.winListeners[type] = env.winListeners[type] || []).push(fn); };
  sandbox.dispatchEvent = (ev) => {
    env.events.push({ type: ev.type, tag: "window", key: ev.key });
    (env.winListeners[ev.type] || []).forEach((fn) => fn(ev));
    return true;
  };
  sandbox.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  sandbox.getComputedStyle = () => ({});

  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CONTENT_JS, "utf8"), ctx, { filename: "extension/content.js" });
  env.timers.length = 0;   // drop content.js's load-time setTimeout(createSidebar); scenarios boot it on purpose

  return Object.assign(env, {
    ctx, document,
    h: (...a) => h(document, ...a),
    run: (code) => vm.runInContext(code, ctx),   // sees top-level let/const of content.js too
    settle: () => settle(env),
    bootSidebar: () => bootSidebar(env),
    switchChat: (title, messages) => switchChat(env, title, messages),
    click: async (id) => { env.document.getElementById(id).click(); await settle(env); }
  });
}

const flush = () => new Promise((r) => setImmediate(r));

/** Flush promises and run pending setTimeouts (nested ones too, up to 20 rounds). Intervals are never run. */
async function settle(env) {
  for (let round = 0; round < 20; round++) {
    await flush();
    if (!env.timers.length) return;
    for (const t of env.timers.splice(0)) {
      try { t.fn(); } catch (e) { env.errors.push(String(e && e.stack || e)); }
    }
  }
  await flush();
}

/** WhatsApp Web shell: #app > (#pane-side, #main with header and message area), then content.js createSidebar(). */
async function bootSidebar(env) {
  const d = env.document;
  const title = env.h("span", { dir: "auto", title: "" });
  d.body.appendChild(env.h("div", { id: "app" },
    env.h("div", { id: "side" }, env.h("div", { id: "pane-side" })),
    env.h("div", { id: "main" }, env.h("header", {}, title), env.h("div", { id: "cc-test-messages" }))));
  env.ctx.createSidebar();
  await settle(env);
}

/** Open another chat: new header title and message rows ([["in"|"out", text, "img"?], ...]), then fire the MutationObserver.
 *  A third item "img" or "img-2" adds a photo to that bubble (src blob:...photo-<that item>). */
async function switchChat(env, title, messages = []) {
  const d = env.document;
  const span = d.querySelector("#main header span[dir=auto]");
  span.setAttribute("title", title);
  span.textContent = title;
  const box = d.getElementById("cc-test-messages");
  box.children = [];
  messages.forEach(([dir, text, img], i) => {
    const fromMe = dir === "out";
    const row = env.h("div", { "data-id": `${fromMe ? "true" : "false"}_60123456789@c.us_MSG${i}`, role: "row" },
      env.h("span", { dir: "ltr", class: "selectable-text" }, text));
    if (img) {
      const pic = env.h("img", { src: "blob:https://web.whatsapp.com/photo-" + img });
      pic.width = 200;
      row.appendChild(pic);
    }
    box.appendChild(row);
  });
  env.observers.forEach((o) => o.callback([], o));
  await settle(env);
}

// ---------------------------------------------------------------- scenarios
const scenarios = {};

/** A WhatsApp-like footer with a compose box and a send button. */
function composeBox(env) {
  const box = env.h("div", { contenteditable: "true", "data-tab": "10", role: "textbox" });
  const send = env.h("button", { "aria-label": "Send" });
  env.document.body.appendChild(env.h("div", { id: "main" }, env.h("footer", {}, box, send)));
  return { box, send };
}

scenarios.insert_reply = (env) => {
  const { box } = composeBox(env);
  const text = "Hi Ahmad, the Daikin 1.5HP is RM 1,150. 40% deposit: RM 460.";
  const returned = env.ctx.insertReplyIntoWhatsAppBox(text);
  return { returned, boxText: box.innerText, expected: text };
};

// execCommand("insertText") fails, so content.js falls back to beforeinput + innerText + input events.
scenarios.insert_reply_fallback = (env) => {
  env.opts.execCommandWorks = false;
  const { box } = composeBox(env);
  const returned = env.ctx.insertReplyIntoWhatsAppBox("Fallback text");
  return { returned, boxText: box.innerText };
};

scenarios.insert_reply_no_box = (env) => ({
  returned: env.ctx.insertReplyIntoWhatsAppBox("Nowhere to go"),
  emptyReturned: env.ctx.insertReplyIntoWhatsAppBox("")
});

/** Chat list row: title, last-message preview, time, optional unread badge. */
function chatRow(env, title, preview, unread) {
  const cell = env.h("div", { role: "gridcell" },
    env.h("span", { dir: "auto", title }, title),
    env.h("span", { dir: "ltr" }, preview),
    env.h("span", {}, "10:42"));
  if (unread) cell.appendChild(env.h("span", { "aria-label": `${unread} unread messages` }, String(unread)));
  return env.h("div", { role: "listitem" }, cell);
}

scenarios.scan_unread = (env) => {
  const pill = env.h("span", { id: "cc-cache-pill" });
  const pane = env.h("div", { id: "pane-side" },
    chatRow(env, "Tan Bros Trading", "Boss, 5 units Daikin 1.5HP, got stock?", 2),
    chatRow(env, "Ah Seng", "How much for R32 gas?", 1),
    chatRow(env, "Mum", "Dinner at 7?", 0));      // read chat: must not be cached
  env.document.body.appendChild(pill);
  env.document.body.appendChild(pane);

  env.ctx.scanUnreadSidebarChatsAndPreCache();
  const afterFirst = env.run("precomputedCache.size");
  env.ctx.scanUnreadSidebarChatsAndPreCache();   // same previews again: nothing new
  const entry = env.run('precomputedCache.get(getCacheKey("Tan Bros Trading", "Boss, 5 units Daikin 1.5HP, got stock?"))');
  return {
    cacheSize: afterFirst,
    cacheSizeAfterRescan: env.run("precomputedCache.size"),
    keys: env.run("Array.from(precomputedCache.keys())"),
    previews: env.run("Object.fromEntries(processedSidebarPreviews)"),
    tanBrosSource: entry && entry.source,
    tanBrosIntent: entry && entry.analysis.intent,
    pillText: pill.textContent
  };
};

/** Boot the real sidebar. Network calls at boot (e.g. /api/state) are listed, not hidden. */
scenarios.sidebar_boot = async (env) => {
  await env.bootSidebar();
  const root = env.document.getElementById("cashchase-wa-ext-root");
  const ids = env.document.documentElement.querySelectorAll("[id]").map((e) => e.id)
    .filter((id) => id.startsWith("cc-") && !id.startsWith("cc-test-"));
  return {
    rootExists: Boolean(root),
    ids,
    bootNetwork: env.network.map((n) => n.kind === "sendMessage"
      ? { kind: n.kind, type: n.message.type, url: n.message.url } : n),
    observers: env.observers.length,
    sidebarText: root.textContent
  };
};

/** Login off: demo sign-in sets the role sent to the backend; sign-out shows the form again. */
scenarios.demo_login = async (env) => {
  await env.bootSidebar();
  const d = env.document;
  const shown = () => d.getElementById("cc-login").style.display;
  const before = { login: shown(), demo: d.getElementById("cc-login-demo").style.display };
  env.network.length = 0;
  await env.click("cc-demo-staff");
  const staff = {
    login: shown(), pill: d.getElementById("cc-user-text").textContent,
    roles: env.network.filter((n) => n.message && n.message.headers).map((n) => n.message.headers["X-CashChase-Role"])
  };
  await env.click("cc-logout-btn");
  const afterLogout = { login: shown(), email: env.run("getDemoEmail()") };
  const tryLogin = async (email, password) => {
    d.getElementById("cc-login-email").value = email;
    d.getElementById("cc-login-password").value = password;
    env.run("submitCcLogin({ preventDefault() {} })");
    await env.settle();
    const err = d.getElementById("cc-login-error");
    return { error: err.style.display === "block" ? err.textContent : "", role: env.run("getCcRole()"), email: env.run("getDemoEmail()") };
  };
  return {
    before, staff, afterLogout,
    adminWrong: await tryLogin("admin@cashchase.my", "wrongpass"),
    adminRight: await tryLogin("admin@cashchase.my", "admin1234")
  };
};

/** Network calls as plain facts: {type, method, path, body}. Boot calls are included. */
function netSummary(env) {
  return env.network.map((n) => {
    const m = n.message || {};
    const url = (m.url || n.url || "").replace("http://127.0.0.1:8000", "");
    return { kind: n.kind, type: m.type, method: m.method || n.method, path: url, body: m.body ? JSON.parse(m.body) : null };
  });
}

/** Switching chats and new incoming messages must not send anything: only the boot calls exist. */
scenarios.sidebar_chat_activity_is_local = async (env) => {
  await env.bootSidebar();
  const afterBoot = netSummary(env);
  await env.switchChat("Tan Bros Trading", [["in", "Boss, got 5 Daikin 1.5HP? how much"]]);
  const afterFirstChat = env.network.length;
  await env.switchChat("Ah Seng", [["in", "How much for R32 gas?"]]);
  await env.switchChat("Mum", [["out", "ok see you"]]);
  const displayAfterMum = env.document.getElementById("cc-customer-display").textContent;   // not a customer, but the header follows the chat
  await env.switchChat("Tan Bros Trading", [["in", "Boss, got 5 Daikin 1.5HP? how much"], ["out", "checking"], ["in", "Boss any update?"]]);
  await env.switchChat("Tan Bros Trading", [["in", "Boss, got 5 Daikin 1.5HP? how much"], ["out", "checking"], ["in", "Boss any update?"], ["in", "Hello??"]]);
  const d = env.document;
  const customer = d.getElementById("cc-customer-input").value;
  const message = d.getElementById("cc-message-input").value;
  await env.switchChat("Tan Bros Trading", [["in", "Order_list.pdf"]]);   // a PDF: hint only, no button
  const banner = d.getElementById("cc-auto-ocr-banner");
  return {
    afterBoot, afterFirstChat, final: netSummary(env), pdfButton: Boolean(d.getElementById("cc-photo-quote-btn")), pdfBanner: banner.textContent,
    customer, message, displayAfterMum, display: d.getElementById("cc-customer-display").textContent,
    memPill: d.getElementById("cc-mem-pill").textContent
  };
};

/** Click Rescan on an open chat: this is the one thing that sends the chat. */
scenarios.sidebar_analyse_click = async (env) => {
  await env.bootSidebar();
  await env.switchChat("Tan Bros Trading", [["out", "Hi boss"], ["in", "Boss, got 5 Daikin 1.5HP? how much"]]);
  const before = env.network.length;
  await env.click("cc-read-dom-btn");
  return { before, final: netSummary(env) };
};

/** Customer photo: no network on arrival, button visible, one photo-quote POST on click, never /api/ocr/extract. */
scenarios.sidebar_photo_quote = async (env) => {
  await env.bootSidebar();
  env.ctx.blobUrlToBase64 = async () => "data:image/png;base64,iVBORw0KGgo=";   // skip the real blob -> FileReader step
  const before = env.network.length;
  await env.switchChat("Tan Bros Trading", [["in", "", "img-1"]]);
  const banner = env.document.getElementById("cc-auto-ocr-banner");
  const btn = env.document.getElementById("cc-photo-quote-btn");
  const afterArrival = env.network.length;
  const shown = { bannerDisplay: banner.style.display, buttonText: btn && btn.textContent };
  await env.click("cc-photo-quote-btn");
  return { before, afterArrival, shown, final: netSummary(env), title: env.document.getElementById("cc-ext-title").textContent };
};

const echoSrc = async (src) => "data:image/png;base64," + src.replace(/\W/g, "");   // stands in for blob -> FileReader
const photoPosts = (env) => netSummary(env).filter((n) => n.path === "/api/whatsapp/photo-quote");

/** Second photo from the same customer: the button sends the newest one, once even if double-clicked. */
scenarios.sidebar_second_photo = async (env) => {
  await env.bootSidebar();
  env.ctx.blobUrlToBase64 = echoSrc;
  await env.switchChat("Tan Bros Trading", [["in", "", "img-1"]]);
  await env.switchChat("Tan Bros Trading", [["in", "", "img-1"], ["in", "", "img-2"]]);
  const btn = env.document.getElementById("cc-photo-quote-btn");
  btn.click(); btn.click();
  await env.settle();
  return { sent: photoPosts(env) };
};

/** The photo answer arrives after the user moved to another chat: it must not overwrite the panel. */
scenarios.sidebar_photo_then_chat_changed = async (env) => {
  await env.bootSidebar();
  env.ctx.blobUrlToBase64 = echoSrc;
  await env.switchChat("Tan Bros Trading", [["in", "", "img-1"]]);
  env.document.getElementById("cc-photo-quote-btn").click();
  env.run('currentActiveChat = "Ah Seng"');
  await env.settle();
  return { title: env.document.getElementById("cc-ext-title").textContent };
};

/** Editing the fields is local; a new message in the same chat keeps the user's draft, another chat clears it. */
scenarios.sidebar_field_edit_and_draft = async (env) => {
  await env.bootSidebar();
  const d = env.document;
  await env.switchChat("Tan Bros Trading", [["in", "Boss, got 5 Daikin 1.5HP? how much"]]);
  for (const id of ["cc-message-input", "cc-customer-input"]) d.getElementById(id).dispatchEvent(new Event("change"));
  await env.settle();
  const draft = d.getElementById("cc-draft-output");
  draft.value = "Hi boss, typing my own reply";
  await env.switchChat("Tan Bros Trading", [["in", "Boss, got 5 Daikin 1.5HP? how much"], ["in", "Hello?"]]);
  const sameChat = draft.value;
  await env.switchChat("Ah Seng", [["in", "How much for R32 gas?"]]);
  return { calls: env.network.length, sameChat, otherChat: draft.value, btn: d.getElementById("cc-big-action-btn").textContent };
};

// Customers-only scenarios live in their own file to keep this one small.
require("./extension_harness_customers")(scenarios, { netSummary, echoSrc, KeyboardEvent });
require("./extension_harness_sales")(scenarios, { netSummary, Event });

// ---------------------------------------------------------------- CLI
async function main() {
  const [name, optJson] = process.argv.slice(2);
  if (!scenarios[name]) {
    console.error(`unknown scenario "${name}". Known: ${Object.keys(scenarios).join(", ")}`);
    process.exit(2);
  }
  const opts = optJson ? JSON.parse(optJson) : {};
  const env = loadContent(opts);
  process.on("unhandledRejection", (e) => env.errors.push(String(e && e.stack || e)));
  const result = await scenarios[name](env, opts);
  await env.settle();   // catch delayed timers/fetches before reporting
  process.stdout.write(JSON.stringify({
    scenario: name, result, network: env.network, events: env.events, errors: env.errors
  }));
}

if (require.main === module) {
  main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
module.exports = { loadContent, scenarios, h };
