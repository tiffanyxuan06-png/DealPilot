/**
 * Sales-sidebar scenarios for extension_harness.js (docs/11 §5, docs/08 §1): the follow-ups / commission card,
 * the deal line under an analysis, the offline guess, the reply editors and the execute body. Stub options: state ({deals, reps, products}),
 * responses {"/api/whatsapp/analyze": ..., "/api/whatsapp/execute": ...}, customers.
 */
"use strict";

module.exports = function addSalesScenarios(scenarios, { netSummary, Event }) {
  const ASK = [["in", "Boss, got 5 Daikin 1.5HP? how much"]];
  const text = (env, id) => env.document.getElementById(id).textContent;
  const rootText = (env) => text(env, "cashchase-wa-ext-root");

  /** Boot with a stubbed /api/state: what the whole sidebar says, and the two card lines. */
  scenarios.sales_card = async (env) => {
    await env.bootSidebar();
    return { sidebar: rootText(env), followups: text(env, "cc-followups-text"), commission: text(env, "cc-commission-text"),
             stockCardIds: ["cc-live-stock-card", "cc-stock-summary-text", "cc-stock-mini-list"].filter((id) => env.document.getElementById(id)) };
  };

  /** Open a customer chat, click Rescan (the stubbed analyze answer arrives), read the deal line. */
  scenarios.sales_rescan = async (env) => {
    await env.bootSidebar();
    await env.switchChat("Tan Bros Trading", ASK);
    await env.click("cc-read-dom-btn");
    return { deal: text(env, "cc-deal-ctx"), button: text(env, "cc-big-action-btn"), sidebar: rootText(env), draft: env.document.getElementById("cc-draft-output").value };
  };

  /** Rescan, then click the main button (a compose box is present): the execute POST, the button text, the compose box. */
  scenarios.sales_execute = async (env) => {
    await env.bootSidebar();
    const box = env.h("div", { contenteditable: "true", "data-tab": "10", role: "textbox" });
    env.document.getElementById("main").appendChild(env.h("footer", {}, box));
    await env.switchChat("Tan Bros Trading", ASK);
    await env.click("cc-read-dom-btn");
    const boot = env.network.length;
    env.document.getElementById("cc-big-action-btn").click();
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));   // let the answer land; settle() would also run the reset-text timer
    const button = text(env, "cc-big-action-btn");
    await env.settle();
    return { sent: netSummary(env).slice(boot), button, boxText: box.innerText };
  };

  /** The offline guess used by the pre-cache and as the fallback: every reply and line it builds. */
  scenarios.local_analysis = (env, opts) => {
    if (opts.products) env.run("knownProducts = " + JSON.stringify(opts.products));   // as if GET /api/state had returned them
    const data = env.ctx.buildLocalSmartAnalysis(opts.customer || "Tan Bros Trading", opts.message, opts.instruction || "");
    const a = data.analysis;
    return {
      intent: a.intent, actionType: a.extActionType, check: a.extCheck, title: a.extTitle, button: a.extBtnLabel,
      amount: a.amount, replies: (a.replyOptions || []).map((o) => o.text), keys: Object.keys(a), memory: JSON.stringify(a.clientMemory)
    };
  };

  /** Pick the reply tab whose label matches opts.label, then type opts.typed (if any) into the editor that opens. */
  scenarios.sales_editor = async (env, opts) => {
    await env.bootSidebar();
    await env.switchChat("Tan Bros Trading", ASK);
    await env.click("cc-read-dom-btn");
    const d = env.document;
    const tabs = d.querySelectorAll(".cc-tab-pill");
    tabs[tabs.length - 1].click();   // the editor option is the last tab
    await env.settle();
    const input = d.getElementById(opts.input);
    const draft = () => d.getElementById("cc-draft-output").value;
    const opened = { value: input.value, draft: draft(), button: text(env, "cc-big-action-btn") };
    const type = (v) => { input.value = v; input.dispatchEvent(new Event("input", { target: input })); };
    type("");
    const afterEmpty = { draft: draft(), button: text(env, "cc-big-action-btn") };
    if (opts.typed) type(opts.typed);
    return { opened, afterEmpty, afterTyped: { draft: draft(), button: text(env, "cc-big-action-btn") } };
  };
};
