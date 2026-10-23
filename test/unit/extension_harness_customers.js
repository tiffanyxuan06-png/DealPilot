/**
 * Customers-only scenarios for extension_harness.js (docs/11 §5): "Not a customer" state, Add as customer,
 * backend offline. Loaded by the harness; stub options (customers, stateFails, responses) are documented there.
 */
"use strict";

module.exports = function addCustomerScenarios(scenarios, { netSummary, echoSrc, KeyboardEvent }) {
  const ASK = [["in", "Boss, got 5 Daikin 1.5HP? how much"]];
  const WITH_PHOTO = [...ASK, ["in", "", "img-1"]];

  /** What the panel shows right now, as plain text. */
  const ui = (env) => {
    const d = env.document;
    const text = (id) => d.getElementById(id).textContent;
    return {
      title: text("cc-ext-title"), badge: text("cc-intent-badge"), check: text("cc-ext-check"),
      button: text("cc-big-action-btn"), customer: text("cc-customer-display"),
      draft: d.getElementById("cc-draft-output").value, tabs: d.querySelectorAll(".cc-tab-pill").length
    };
  };
  const since = (env, from) => netSummary(env).slice(from);
  const pressEnter = (env) =>
    env.document.getElementById("cc-user-instruction").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

  /** A contact that is not a customer: every send button must do nothing, and the photo button is hidden. */
  scenarios.cust_friend_chat = async (env) => {
    await env.bootSidebar();
    const boot = env.network.length;
    await env.switchChat("Mum", WITH_PHOTO);
    const shown = ui(env);
    const afterOpen = since(env, boot);
    env.document.getElementById("cc-user-instruction").value = "give 10% discount";
    await env.click("cc-read-dom-btn");
    await env.click("cc-custom-prompt-btn");
    pressEnter(env);
    await env.settle();
    const banner = env.document.getElementById("cc-auto-ocr-banner");
    return {
      shown, afterOpen, sent: since(env, boot), final: ui(env),
      bannerDisplay: banner.style.display, photoButton: Boolean(env.document.getElementById("cc-photo-quote-btn"))
    };
  };

  /** A customer chat (opts.title): normal idle state, then Rescan. */
  scenarios.cust_customer_chat = async (env, opts) => {
    await env.bootSidebar();
    const boot = env.network.length;
    await env.switchChat(opts.title, ASK);
    const shown = ui(env);
    const afterOpen = since(env, boot);
    await env.click("cc-read-dom-btn");
    return { shown, afterOpen, sent: since(env, boot) };
  };

  /** Ask AI button or Enter (opts.via) on a customer chat. */
  scenarios.cust_ask_ai = async (env, opts) => {
    await env.bootSidebar();
    await env.switchChat("Tan Bros Trading", ASK);
    const boot = env.network.length;
    env.document.getElementById("cc-user-instruction").value = "give 10% discount";
    if (opts.via === "enter") { pressEnter(env); await env.settle(); } else await env.click("cc-custom-prompt-btn");
    return { sent: since(env, boot) };
  };

  /** Add as customer (opts.title, opts.double), then Rescan. */
  scenarios.cust_add = async (env, opts) => {
    await env.bootSidebar();
    const boot = env.network.length;
    await env.switchChat(opts.title || "Mum", ASK);
    const before = ui(env);
    const btn = env.document.getElementById("cc-big-action-btn");
    btn.click();
    if (opts.double) btn.click();
    await env.settle();
    const afterAdd = since(env, boot);
    const added = ui(env);
    await env.click("cc-read-dom-btn");
    return { before, afterAdd, added, final: since(env, boot) };
  };

  /** The local list says customer but the backend answers NOT_A_CUSTOMER (opts.responses): same state, no stub reply. */
  scenarios.cust_backend_says_no = async (env) => {
    await env.bootSidebar();
    const box = env.h("div", { contenteditable: "true", "data-tab": "10", role: "textbox" });
    env.document.getElementById("main").appendChild(env.h("footer", {}, box));
    await env.switchChat("Tan Bros Trading", ASK);
    const boot = env.network.length;
    await env.click("cc-read-dom-btn");
    const shown = ui(env);
    const afterAnalyze = since(env, boot);
    env.document.getElementById("cc-big-action-btn").click();   // must add the customer, not insert a reply
    await env.settle();
    return { shown, afterAnalyze, boxText: box.innerText, afterClick: since(env, boot) };
  };

  /** GET /api/state fails (opts.stateFails): nothing is sent; Rescan retries the list only. */
  scenarios.cust_state_offline = async (env) => {
    await env.bootSidebar();
    const boot = env.network.length;
    await env.switchChat("Tan Bros Trading", ASK);
    const shown = ui(env);
    const afterOpen = since(env, boot);
    await env.click("cc-read-dom-btn");
    return { shown, afterOpen, sent: since(env, boot), final: ui(env) };
  };

  /** A contact added in the webapp after the list was read: Rescan re-reads the list only, the next Rescan analyses. */
  scenarios.cust_stale_list = async (env) => {
    await env.bootSidebar();
    const boot = env.network.length;
    await env.switchChat("Mum", WITH_PHOTO);
    const blocked = ui(env);
    env.opts.customers.push({ name: "Mum", phone: "" });   // added in the webapp meanwhile
    await env.click("cc-read-dom-btn");
    const afterFirstRescan = since(env, boot);
    const idle = ui(env);
    const banner = env.document.getElementById("cc-auto-ocr-banner").style.display;
    await env.click("cc-read-dom-btn");
    return { blocked, afterFirstRescan, idle, banner, final: since(env, boot) };
  };

  /** The phone digits of a number title go to analyze, execute and photo-quote (the backend matches by phone too). */
  scenarios.cust_phone_bodies = async (env, opts) => {
    await env.bootSidebar();
    env.ctx.blobUrlToBase64 = echoSrc;
    await env.switchChat(opts.title, WITH_PHOTO);
    const boot = env.network.length;
    await env.click("cc-read-dom-btn");
    await env.click("cc-big-action-btn");
    await env.click("cc-photo-quote-btn");
    return { sent: since(env, boot) };
  };
};
