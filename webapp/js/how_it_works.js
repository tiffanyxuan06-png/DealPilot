// =========================================================================
// HOW IT WORKS: the guide page and the step-by-step walkthrough that opens after sign-in.
// The steps are written once here; the page's "Step by step" lists are built from the same steps.
// =========================================================================

const HIW_IMG = { wave: 'img/mascot-wave.png', cheer: 'img/mascot-cheer.png' };

// Mini mock-ups for the walkthrough's left panel. Like the rest of webapp/, they hold no business data:
// no customer or rep names and no RM amounts (test_webapp_no_seed_data.py).
const HIW_ART = {
  welcome: () => `<div style="text-align:center"><img class="hiw-mascot" src="${HIW_IMG.wave}" alt="" width="240" height="260"><div class="hiw-chips"><span>AI suggests</span><span>Rules check</span><span>You decide</span></div></div>`,
  setup: () => `<div class="hiw-mock"><div class="hiw-lbl">Settings · Business</div>
    <div class="hiw-row"><span>price-list.xlsx</span><span class="hiw-pill hiw-ok">9 products matched</span></div>
    <div class="hiw-row"><span>Follow-up time</span><b>2 hours</b></div>
    <div class="hiw-row"><span>Margin floor</span><b>15%</b></div>
    <div class="hiw-mini-btn">Save setup</div></div>`,
  team: () => `<div class="hiw-mock"><div class="hiw-lbl">Team &amp; permissions</div>
    <div style="display:grid;gap:6px"><span>Send follow-up</span><div class="hiw-seg"><span class="on">Allowed</span><span>Needs approval</span><span>Off</span></div></div>
    <div style="display:grid;gap:6px"><span>Mark deal won</span><div class="hiw-seg"><span>Allowed</span><span class="on">Needs approval</span><span>Off</span></div></div>
    <div class="hiw-row" style="font-size:12px"><span>Sales rep · own commission rate</span><span class="hiw-pill hiw-blue">Staff</span></div></div>`,
  extension: () => `<div class="hiw-mock"><div class="hiw-lbl">Install in about 1 minute</div><div class="hiw-steps5">
    <div><span>Download the .zip from the web app</span></div><div><span>Unzip the folder</span></div><div><span>Open <code>chrome://extensions</code>, turn on Developer mode</span></div><div><span>Load unpacked, pick the folder</span></div><div><span>Open web.whatsapp.com and sign in</span></div></div></div>`,
  stages: () => `<div class="hiw-vstages">
    <div><i class="hiw-dot" style="background:var(--sky)"></i>New inquiry<small>customer asked</small></div>
    <div><i class="hiw-dot" style="background:var(--blue)"></i>Quoted<small>timer starts</small></div>
    <div><i class="hiw-dot" style="background:#B54708"></i>Follow-up due<small>no reply yet</small></div>
    <div class="hiw-split"><div style="color:#067647">Won</div><div style="color:#B42318">Lost</div></div></div>`,
  approvals: () => `<div class="hiw-mock"><div class="hiw-row"><span class="hiw-lbl">Owner approvals</span><span class="hiw-pill hiw-warn">1 waiting</span></div>
    <div>A sales rep asks to give <b style="color:var(--navy)">a discount</b> on a quote</div>
    <div class="hiw-pill hiw-bad" style="justify-self:start">Below your 15% margin floor</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><div class="hiw-mini-btn">Approve</div><div class="hiw-mini-btn ghost">Reject</div></div></div>`,
  chat: () => `<div class="hiw-mock"><div class="hiw-wa"><div class="hiw-bubble">Boss, need 3 units 1.5HP aircond with installation to Subang. Got discount?</div></div>
    <div class="hiw-lbl">What's happening</div><div class="hiw-row"><b>Buying inquiry</b><span class="hiw-pill hiw-blue">New inquiry</span></div>
    <div class="hiw-row" style="font-size:12px"><span>Customer score</span><span class="hiw-pill hiw-ok">Pays on time</span></div></div>`,
  reply: () => `<div class="hiw-mock"><div class="hiw-lbl">Pick a reply</div>
    <div class="hiw-opt on"><b>Consultative quote · recommended</b>Hi Boss! For 3 units of 1.5HP with installation, the total from our price list is…</div>
    <div class="hiw-opt"><b>Friendly boss style</b>Can boss! 3 units all-in, price as below ya…</div>
    <div class="hiw-mini-btn">Insert reply</div><div class="hiw-mini-note">Nothing sends until you press Enter in WhatsApp</div></div>`,
  quote: () => `<div class="hiw-mock"><div class="hiw-lbl">Quote from price list</div>
    <div class="hiw-qline"><span>3 × 1.5HP inverter unit</span><span>Price list</span></div>
    <div class="hiw-qline"><span>3 × Installation</span><span>Price list</span></div>
    <div class="hiw-qline"><span>Delivery</span><span>Your rules</span></div>
    <div class="hiw-qline hiw-qtotal"><span><b style="color:var(--navy)">Total</b></span><span>Worked out by DealPilot</span></div>
    <div class="hiw-mini-btn">Create quote &amp; insert into chat</div></div>`,
  track: () => `<div class="hiw-mock"><div class="hiw-lbl">Next up for you</div>
    <div class="hiw-row"><span>Quote sent yesterday · no reply</span><span class="hiw-pill hiw-warn">Follow up</span></div>
    <div class="hiw-row"><span>New price question</span><span class="hiw-pill hiw-blue">New</span></div>
    <div class="hiw-row"><span>Your commission this month</span><span class="hiw-pill hiw-ok">Adds up as you win</span></div></div>`,
  done: () => `<div style="text-align:center"><img class="hiw-mascot" src="${HIW_IMG.cheer}" alt="" width="227" height="216"><div class="hiw-chips"><span>You're set</span></div></div>`
};

const HIW_EXT_POINTS = [
  'Click <b>Get the WhatsApp extension</b> and download the .zip.',
  'Open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the folder.',
  'Open <b>web.whatsapp.com</b> and sign in on the DealPilot panel with the same login.'
];

const HIW_STEPS = {
  OWNER: [
    { art: 'welcome', title: 'Welcome to DealPilot', text: "DealPilot helps your team answer WhatsApp customers faster, with quotes priced from your own price list. Here's how to get going.",
      points: ['<b>Your reps</b> work in WhatsApp Web with the DealPilot panel beside the chat.', '<b>You</b> see every deal here, set the rules and approve what needs you.', "<b>The AI</b> writes the words. DealPilot's own code sets every price."], intro: true },
    { art: 'setup', title: 'Set up your business', text: 'This takes about a minute. Every quote uses these prices, so the totals are always right.',
      points: ['Start from a template, or <b>upload your price list</b> (.xlsx or .csv). DealPilot matches the SKU, name, unit cost and selling price.', 'Set your <b>follow-up time</b>: how long to wait for a reply before DealPilot reminds the rep.', 'Set your <b>margin floor</b>: the lowest margin a rep can give without asking you.'], where: 'Settings → Business' },
    { art: 'team', title: 'Add your team and choose what they can do', text: 'Each rep gets their own deals and commission. You decide which actions need your OK.',
      points: ['Add each rep with their <b>commission rate</b>.', 'For every Staff action pick <b>Allowed</b>, <b>Needs approval</b> or <b>Off</b>.', 'A discount below the margin floor <b>always</b> comes to you, whatever you pick.'], where: 'Commission → Add a rep · Settings → Team & permissions' },
    { art: 'extension', title: 'Install the WhatsApp extension', text: 'Each rep installs it once on the computer they use for WhatsApp Web. Chrome and Edge both work.',
      points: HIW_EXT_POINTS, where: 'Sidebar → Get the WhatsApp extension' },
    { art: 'stages', title: 'How a deal moves', text: 'Every customer request becomes one deal. DealPilot moves it along as the chat goes on.',
      points: ['<b>New inquiry</b> → <b>Quoted</b> when the quote is sent. The follow-up timer starts.', 'No reply in time? It becomes <b>Follow-up due</b> and DealPilot drafts the follow-up.', '<b>Won</b> when the customer pays (the order and commission are created), or <b>Lost</b> with a reason.'] },
    { art: 'approvals', title: 'Approve requests and watch the numbers', text: 'Your Pipeline page is the daily check-in.',
      points: ['<b>Owner approvals</b>: approve and the action runs; reject and nothing changes.', 'See paid orders, won vs. closed and commission to pay for this month.', 'Download the <b>Won orders CSV</b> from Deals & Quotes for your accounting software.'], where: 'Pipeline → Owner approvals' },
    { art: 'done', title: "You're ready", text: 'Try a full conversation without a real phone: open WhatsApp CRM and play the customer. You can come back to this guide any time.',
      points: ['<b>How it works</b> in the menu has the full guide.', '<b>WhatsApp CRM</b> lets you test 7 common customer situations.'], done: true }
  ],
  STAFF: [
    { art: 'welcome', title: 'Welcome to DealPilot', text: 'DealPilot sits beside your WhatsApp chats and writes replies and quotes for you. You stay in charge of what gets sent.',
      points: ['Replies are <b>suggestions</b>. You check and edit them.', 'Prices come from the <b>company price list</b>, so totals are always right.', '<b>Nothing sends</b> until you press Enter.'], intro: true },
    { art: 'extension', title: 'Install the WhatsApp extension', text: 'Do this once on the computer you use for WhatsApp Web.',
      points: HIW_EXT_POINTS, where: 'Sidebar → Get the WhatsApp extension' },
    { art: 'chat', title: "Open a customer's chat", text: 'When the newest message is from a customer, DealPilot reads it straight away.',
      points: ['The panel shows <b>what the customer wants</b>, the deal stage and a customer score.', 'Tap <b>↻ Rescan</b> any time to read the chat again.', 'Not a customer yet? Tap <b>Add customer</b>. Other chats are never read.'] },
    { art: 'reply', title: 'Pick a reply and make it yours', text: 'DealPilot suggests a few replies in different styles.',
      points: ['Pick one. It appears in a box you can <b>edit</b>.', 'Open <b>Adjust reply</b> and type what to change, like <i>50% deposit, polite BM</i>.', 'Tap <b>Insert reply</b>, check it in WhatsApp, then press Enter.'] },
    { art: 'quote', title: 'Send a quote in a few taps', text: 'Quotes are priced from the price list, including labour and delivery rules.',
      points: ['<b>Quote from price list</b>: search the item, set the quantity, tap <b>Create quote &amp; insert into chat</b>.', 'Customer sent a photo of what they need? Tap <b>Quote from photo</b>.', 'Discount below the margin floor? It goes to the Owner first.'] },
    { art: 'track', title: 'Keep your deals moving', text: 'Your Pipeline page shows what to do next.',
      points: ['<b>Next up for you</b>: the deals most likely to close first.', '<b>Re-engage</b>: customers who went quiet, with a message ready to send.', 'Customer paid? <b>Mark it won</b> with the slip reference and your commission is added.'] },
    { art: 'done', title: "You're ready", text: 'Practise first if you like: open WhatsApp CRM and play the customer. The full guide is always under How it works.',
      points: ['<b>How it works</b> in the menu has the full guide.', '<b>WhatsApp CRM</b> lets you practise 7 common customer situations.'], done: true }
  ]
};

const HIW_STAGES = [
  ['New inquiry', 'Customer asked, no quote yet', 'var(--sky)'],
  ['Quoted', 'Quote sent, follow-up timer running', 'var(--blue)'],
  ['Follow-up due', 'No reply in your follow-up time', '#B54708'],
  ['Won', 'Paid. Order and commission created', '#067647'],
  ['Lost', 'Closed with a reason', '#B42318']
];

let hiwStep = 0;
let hiwRole = 'OWNER';
let hiwLastFocus = null;

function hiwRoleNow() {
  return (typeof currentRole !== 'undefined' && currentRole === 'STAFF') ? 'STAFF' : 'OWNER';
}

// "Don't show this when I sign in" is remembered per role in this browser. Storage can be blocked: then it just shows again.
function hiwHiddenKey(role) { return 'dealpilot-hiw-hidden-' + role; }
function hiwIsHidden(role) { try { return localStorage.getItem(hiwHiddenKey(role)) === '1'; } catch (e) { return false; } }
function hiwSetHidden(role, hidden) {
  try { hidden ? localStorage.setItem(hiwHiddenKey(role), '1') : localStorage.removeItem(hiwHiddenKey(role)); } catch (e) { /* ignore */ }
}

// ---------- Guide page ----------
function renderHowItWorksPage() {
  const track = document.getElementById('hiw-track');
  if (!track) return;
  track.innerHTML = HIW_STAGES.map(([name, desc, color]) =>
    `<div class="hiw-stg"><b><i class="hiw-dot" style="background:${color}"></i>${name}</b><span>${desc}</span></div>`).join('');
  const item = (s) => `<li><div><span class="hiw-flow-title">${s.title}</span><p class="hiw-flow-text">${s.text}</p>
    <ul>${s.points.map(p => `<li>${p}</li>`).join('')}</ul>${s.where ? `<span class="hiw-where">${s.where}</span>` : ''}</div></li>`;
  ['OWNER', 'STAFF'].forEach(role => {
    const list = document.getElementById('hiw-list-' + role.toLowerCase());
    if (list) list.innerHTML = HIW_STEPS[role].filter(s => !s.intro && !s.done).map(item).join('');
  });
  showHowItWorksTab(hiwRoleNow() === 'STAFF' ? 'staff' : 'owner');
}

function showHowItWorksTab(which) {
  ['owner', 'staff'].forEach(w => {
    const tab = document.getElementById('hiw-tab-' + w);
    const panel = document.getElementById('hiw-flow-' + w);
    if (tab) tab.setAttribute('aria-selected', String(w === which));
    if (panel) panel.hidden = w !== which;
  });
}

// ---------- Walkthrough ----------
// auto: opened by sign-in, so it respects "Don't show this when I sign in"
function openHowItWorksTour(opts) {
  const auto = !!(opts && opts.auto);
  hiwRole = hiwRoleNow();
  if (auto && hiwIsHidden(hiwRole)) return;
  const scrim = document.getElementById('hiw-tour');
  if (!scrim) return;
  hiwLastFocus = document.activeElement;
  hiwStep = 0;
  document.getElementById('hiw-dont').checked = hiwIsHidden(hiwRole);
  scrim.hidden = false;
  document.body.classList.add('is-locked');
  renderHowItWorksStep();
  document.getElementById('hiw-next').focus();
}

function renderHowItWorksStep() {
  const steps = HIW_STEPS[hiwRole];
  const s = steps[hiwStep];
  document.getElementById('hiw-step-no').textContent = `Step ${hiwStep + 1} of ${steps.length}`;
  document.getElementById('hiw-art').innerHTML = HIW_ART[s.art]();
  const content = document.getElementById('hiw-content');
  content.innerHTML = `<div class="hiw-swap"><h2 id="hiw-tour-title">${s.title}</h2><p id="hiw-tour-desc">${s.text}</p>
    <ul class="hiw-points">${s.points.map((p, k) => `<li><span class="hiw-n">${k + 1}</span><span>${p}</span></li>`).join('')}</ul>
    ${s.where ? `<span class="hiw-where">Where: ${s.where}</span>` : ''}</div>`;
  content.scrollTop = 0;
  document.getElementById('hiw-back').style.visibility = hiwStep === 0 ? 'hidden' : 'visible';
  document.getElementById('hiw-skip').hidden = !!s.done;
  document.getElementById('hiw-next').textContent = s.done ? 'Start using DealPilot' : 'Next';
  document.getElementById('hiw-dots').innerHTML = steps.map((x, k) =>
    `<button type="button" data-k="${k}" class="${k < hiwStep ? 'is-done' : ''}" ${k === hiwStep ? 'aria-current="step"' : ''} aria-label="Go to step ${k + 1}: ${x.title.replace(/"/g, '')}"><i></i></button>`).join('');
}

function goHowItWorksStep(k) {
  const last = HIW_STEPS[hiwRole].length - 1;
  hiwStep = Math.max(0, Math.min(last, k));
  renderHowItWorksStep();
}

function closeHowItWorksTour(finished) {
  const scrim = document.getElementById('hiw-tour');
  if (!scrim || scrim.hidden) return;
  hiwSetHidden(hiwRole, document.getElementById('hiw-dont').checked);
  scrim.hidden = true;
  document.body.classList.remove('is-locked');
  if (typeof showToast === 'function') {
    showToast(finished ? 'All set. The full guide is under How it works.' : 'Walkthrough closed. Reopen it any time from How it works.');
  }
  if (hiwLastFocus && document.contains(hiwLastFocus)) hiwLastFocus.focus();
}

(function initHowItWorks() {
  renderHowItWorksPage();
  const scrim = document.getElementById('hiw-tour');
  if (!scrim) return;
  document.getElementById('hiw-next').addEventListener('click', () => {
    if (hiwStep >= HIW_STEPS[hiwRole].length - 1) closeHowItWorksTour(true);
    else goHowItWorksStep(hiwStep + 1);
  });
  document.getElementById('hiw-back').addEventListener('click', () => goHowItWorksStep(hiwStep - 1));
  document.getElementById('hiw-skip').addEventListener('click', () => closeHowItWorksTour(false));
  document.getElementById('hiw-close').addEventListener('click', () => closeHowItWorksTour(false));
  document.getElementById('hiw-dots').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    goHowItWorksStep(+b.dataset.k);
    document.querySelector(`#hiw-dots [data-k="${hiwStep}"]`).focus();
  });
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeHowItWorksTour(false); });
  document.addEventListener('keydown', (e) => {
    if (scrim.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeHowItWorksTour(false); return; }
    if (e.key === 'Tab') {
      // Keep focus inside the dialog
      const f = [...scrim.querySelectorAll('button, input')].filter(el => !el.hidden && el.offsetParent !== null && el.style.visibility !== 'hidden');
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') goHowItWorksStep(hiwStep + 1);
    else if (e.key === 'ArrowLeft') goHowItWorksStep(hiwStep - 1);
  });
})();
