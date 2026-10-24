// =========================================================================
// CASHCHASE SALES CRM DASHBOARD & VIEW CONTROLLER
// Drives 5 core views: Pipeline/My Day, Deals, Catalog, Customers, Commission
// =========================================================================

let currentDealFilter = 'ALL';
let currentDealRepFilter = 'ALL';
let dealSearchQuery = '';

// Backend text still carries emoji markers; the UI uses its own icons
function noEmoji(text) {
  return String(text || '').replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
}

// Deals carry repId only; look the name up from the reps list
function repNameOf(st, d) {
  if (d.repName) return d.repName;
  const rep = (st.reps || []).find(r => r.id === d.repId);
  return rep ? rep.name : 'Unassigned';
}

const STAGE_META = {
  INQUIRY: { label: 'New inquiry', dot: '#0152FC', pill: 'background:#E6EEFF;color:#042970' },
  QUOTED: { label: 'Quoted', dot: '#01AAFC', pill: 'background:#E3F6FF;color:#04527A' },
  FOLLOW_UP: { label: 'Follow-up due', dot: '#F79009', pill: 'background:#FEF0C7;color:#93370D' },
  WON: { label: 'Won', dot: '#12B76A', pill: 'background:#ECFDF3;color:#05603A' },
  LOST: { label: 'Lost', dot: '#98A2B3', pill: 'background:#F2F4F7;color:#475467' }
};

function switchPage(page) {
  currentPage = page;
  const pages = ['pipeline', 'deals', 'catalog', 'customers', 'commission', 'wa', 'howitworks'];
  pages.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.toggle('hidden', p !== page);

    const nav = document.getElementById('nav-' + p);
    if (nav) nav.classList.toggle('is-active', p === page);
  });

  document.body.dataset.page = page;
  window.scrollTo({ top: 0 });
  if (window.revealIn) {
    const activeEl = document.getElementById('page-' + page);
    if (activeEl) window.revealIn(activeEl);
  }
  renderAll();
}

function showSettingsTab(key, focus) {
  document.querySelectorAll('#settings-modal .set-tab').forEach(t => {
    const on = t.id === `stab-${key}`;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  document.querySelectorAll('#settings-modal .set-panel').forEach(p => { p.hidden = p.id !== `spanel-${key}`; });
  const box = document.querySelector('#settings-modal .set-panels');
  if (box) box.scrollTop = 0;
}

// Arrow keys move between the sections, like a native tab bar
document.addEventListener('keydown', e => {
  const tab = e.target.closest && e.target.closest('#settings-modal .set-tab');
  if (!tab || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...document.querySelectorAll('#settings-modal .set-tab')];
  let i = tabs.indexOf(tab);
  if (e.key === 'Home') i = 0; else if (e.key === 'End') i = tabs.length - 1;
  else i = (i + (/Down|Right/.test(e.key) ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  showSettingsTab(tabs[i].id.replace('stab-', ''), true);
});

function openSettingsModal(tab) {
  if (typeof renderTeamPermissions === 'function') renderTeamPermissions();
  if (typeof renderOnboarding === 'function') renderOnboarding();
  // Staff can't change business settings, pricing rules or the AI, and don't get the activity log, so they
  // only see what they are allowed to do (read-only)
  const isOwner = currentRole === 'OWNER';
  ['business', 'pricing', 'activity', 'advanced'].forEach(k => { const t = document.getElementById(`stab-${k}`); if (t) t.hidden = !isOwner; });
  const title = document.getElementById('settings-title');
  if (title) title.textContent = isOwner ? 'Settings' : 'What you can do';
  showSettingsTab(isOwner ? (typeof tab === 'string' ? tab : 'business') : 'team');
  const m = document.getElementById('settings-modal');
  if (m) m.classList.remove('hidden');
}

function closeSettingsModal() {
  const m = document.getElementById('settings-modal');
  if (m) m.classList.add('hidden');
}

// =========================================================================
// 1. PIPELINE (OWNER) / MY DAY (STAFF) VIEW
// =========================================================================
function renderPipelineView() {
  const st = getState();
  // Staff see their own day; the Owner sees the whole pipeline
  const heroCopy = currentRole === 'OWNER'
    ? ['Pipeline', 'How the business is doing.', 'Paid orders, open deals and each rep\'s results this month.']
    : ['My day', 'Your follow-ups and wins today.', 'Send the reminders that are due, then close the deals that are ready.'];
  const logBtn = document.getElementById('pipeline-log-btn');
  if (logBtn) logBtn.style.display = currentRole === 'OWNER' ? 'none' : '';  // .cc-btn's display beats .hidden
  [['pipeline-hero-pill', 0], ['pipeline-hero-title', 1], ['pipeline-hero-sub', 2]].forEach(([id, n]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = heroCopy[n];
  });
  const isOwner = currentRole === 'OWNER';
  const pipeline = st.pipeline || { valueRm: 0, winRate: 0, overdue: 0, byStage: {} };
  const reps = st.reps || [];
  const deals = st.deals || [];

  // Update header text
  const navText = document.getElementById('nav-text-pipeline');
  if (navText) navText.textContent = isOwner ? 'Pipeline' : 'My day';
  const navDeals = document.getElementById('nav-text-deals');
  if (navDeals) navDeals.textContent = isOwner ? 'All deals' : 'Deals';

  const badgePipeline = document.getElementById('badge-pipeline');
  if (badgePipeline) {
    // Chasing is the rep's job, so only Staff get a "due" badge (for their own follow-ups and re-engage alerts)
    const dueCount = isOwner ? 0 : (pipeline.overdue || 0) + (st.reengage || []).length;
    badgePipeline.textContent = dueCount > 0 ? `${dueCount} Due` : `${deals.length}`;
    badgePipeline.className = dueCount > 0 ? 'nav-badge !bg-amber-500 !text-white' : 'nav-badge';
  }

  const badgeDeals = document.getElementById('badge-deals');
  if (badgeDeals) badgeDeals.textContent = deals.length;

  const badgeCatalog = document.getElementById('badge-catalog');
  if (badgeCatalog) badgeCatalog.textContent = (st.products || []).length;

  const badgeCustomers = document.getElementById('badge-customers');
  if (badgeCustomers) badgeCustomers.textContent = (st.customers || []).length;

  const badgeCommission = document.getElementById('badge-commission');
  if (badgeCommission) badgeCommission.textContent = reps.length;

  // Toggle Owner vs Staff container
  const ownerBox = document.getElementById('pipeline-owner-view');
  const staffBox = document.getElementById('pipeline-staff-view');
  if (ownerBox) ownerBox.classList.toggle('hidden', !isOwner);
  if (staffBox) staffBox.classList.toggle('hidden', isOwner);

  if (isOwner) {
    renderOwnerResults(st, deals, reps, pipeline);
  } else {
    renderStaffDay(st, deals, reps);
  }
}

const RM = n => 'RM ' + (n || 0).toLocaleString();
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));

// Customer health from the agent's rating, shown before the rep replies
const TIER_TAG = {
  VIP_FAST_PAYER: { label: 'Fast payer', tone: 'ok' },
  LONG_TERM_PARTNER: { label: 'Long-term', tone: 'ok' },
  PARTIAL_SHORT_PAYER: { label: 'Haggler', tone: 'warn' },
  SLOW_PAYER_GHOST_RISK: { label: 'Ghost risk', tone: 'warn' },
};
const LEVEL_TAG = {
  READY: { label: 'Ready to buy', tone: 'bad' },
  INTERESTED: { label: 'Interested', tone: 'warn' },
  BROWSING: { label: 'Browsing', tone: 'info' },
};
const tag = (t) => t ? `<span class="lvl-tag is-${t.tone}">${t.label}</span>` : '';

function quietText(stamp) {
  const t = stamp ? new Date(stamp.replace(' ', 'T')) : null;
  if (!t || isNaN(t)) return '';
  const h = Math.max(0, Math.floor((Date.now() - t.getTime()) / 3600000));
  return h < 1 ? 'Last wrote under an hour ago' : h < 48 ? `Last wrote ${h}h ago` : `Last wrote ${Math.floor(h / 24)} days ago`;
}

function renderOwnerResults(st, deals, reps, pipeline) {
  const month = new Date().toISOString().slice(0, 7);
  const paid = deals.filter(d => d.stage === 'WON' && (d.wonAt || '').startsWith(month))
    .sort((a, b) => (a.wonAt || '').localeCompare(b.wonAt || ''));
  const paidTotal = paid.reduce((sum, d) => sum + (d.amount || 0), 0);
  const won = deals.filter(d => d.stage === 'WON').length;
  const lost = deals.filter(d => d.stage === 'LOST').length;
  const commTotal = reps.reduce((sum, r) => sum + (r.commissionRm || 0), 0);

  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('kpi-won-month', RM(paidTotal));
  set('kpi-won-note', `${paid.length} order${paid.length === 1 ? '' : 's'} marked won with a payment slip`);
  // A percentage on a handful of deals swings wildly, so show the count until there are 20 closed deals
  set('kpi-win-rate', won + lost >= 20 ? Math.round(won / (won + lost) * 100) + '%' : `${won} of ${won + lost}`);
  set('kpi-win-note', `${won} won, ${lost} lost, all time`);
  set('kpi-comm-pay', RM(commTotal));
  set('kpi-comm-note', `This month, ${reps.length} rep${reps.length === 1 ? '' : 's'}`);

  // Paid orders: running total as a small line chart, with every order as a point you can hover or tap
  const chart = document.getElementById('pipeline-paid-chart');
  if (chart) {
    if (!paid.length) {
      chart.innerHTML = `<div class="cc-note cc-note-info"><svg aria-hidden="true"><use href="#i-trend"/></svg><span>No paid orders yet this month.</span></div>`;
    } else {
      const W = 520, H = 180, L = 44, R = 16, T = 14, B = 28;
      let run = 0;
      const pts = paid.map(d => ({ d, total: (run += d.amount || 0) }));
      const max = Math.max(1000, Math.ceil(run / 1000 / 2) * 2000);
      const x = i => pts.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (pts.length - 1);
      const y = v => T + (1 - v / max) * (H - T - B);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
      const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
      const day = s => new Date(s.replace(' ', 'T')).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
      chart.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" class="paid-chart" role="img" aria-label="Paid orders this month: ${RM(run)} from ${pts.length} orders">
          ${[0, max / 2, max].map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="pc-grid"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="pc-axis">${t ? (t / 1000) + 'k' : '0'}</text>`).join('')}
          <path d="${area}" class="pc-area"/><path d="${line}" class="pc-line"/>
          ${pts.map((p, i) => `<g class="pc-pt" tabindex="0" data-i="${i}"><rect x="${x(i) - 24}" y="${T}" width="48" height="${H - T - B}" fill="transparent"/><circle cx="${x(i)}" cy="${y(p.total)}" r="4.5"/><text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="pc-axis">${day(p.d.wonAt)}</text></g>`).join('')}
        </svg>
        <p id="paid-chart-readout" class="text-[13px] text-[#324564] mt-1" aria-live="polite"></p>`;
      const readout = i => {
        const p = pts[i];
        document.getElementById('paid-chart-readout').innerHTML = `<b class="tabular-nums">${RM(p.total)}</b> by ${day(p.d.wonAt)} · +${RM(p.d.amount)} from ${escapeHtmlText(p.d.customer)}`;
        chart.querySelectorAll('.pc-pt').forEach(g => g.classList.toggle('is-on', +g.dataset.i === i));
      };
      chart.querySelectorAll('.pc-pt').forEach(g => {
        const i = +g.dataset.i;
        g.addEventListener('mouseenter', () => readout(i));
        g.addEventListener('focus', () => readout(i));
        g.addEventListener('click', () => readout(i));
      });
      readout(pts.length - 1);
    }
  }

  // Open deals by stage: bars to one scale, each opens that stage on the Deals page
  const byStage = pipeline.byStage || {};
  const open = ['INQUIRY', 'QUOTED', 'FOLLOW_UP'].map(k => ({ k, ...(byStage[k] || { count: 0, valueRm: 0 }) }));
  const openMax = Math.max(1, ...open.map(o => o.valueRm || 0));
  const openTotal = open.reduce((sum, o) => sum + (o.valueRm || 0), 0);
  const openCount = open.reduce((sum, o) => sum + (o.count || 0), 0);
  const totalEl = document.getElementById('pipeline-open-total');
  if (totalEl) totalEl.textContent = `${RM(openTotal)} · ${openCount} deal${openCount === 1 ? '' : 's'}`;
  const stageContainer = document.getElementById('pipeline-stage-cards');
  if (stageContainer) {
    stageContainer.innerHTML = open.map(o => `
      <button onclick="filterDealsToStage('${o.k}')" class="stage-bar" aria-label="${STAGE_META[o.k].label}: ${RM(o.valueRm)}, ${o.count} deals">
        <span class="sb-label">${STAGE_META[o.k].label}</span>
        <span class="sb-track"><span class="sb-fill" style="width:${Math.max(2, (o.valueRm || 0) / openMax * 100)}%"></span></span>
        <span class="sb-value tabular-nums">${RM(o.valueRm)}<small>${o.count} deal${o.count === 1 ? '' : 's'}</small></span>
      </button>`).join('');
  }

  // Team this month: won and commission per rep, best first
  const repTable = document.getElementById('pipeline-reps-snippet');
  if (repTable) {
    repTable.innerHTML = [...reps].sort((a, b) => (b.wonRm || 0) - (a.wonRm || 0)).map(r => `
      <tr><td class="px-4 font-semibold text-[#042970]">${escapeHtmlText(r.name)}</td>
        <td class="px-4 text-right tabular-nums">${RM(r.wonRm)}</td>
        <td class="px-4 text-right tabular-nums">${RM(r.commissionRm)}</td></tr>`).join('');
  }

  // Why we lose: the reasons recorded on lost deals, most common first
  const lossBox = document.getElementById('pipeline-loss-reasons');
  if (lossBox) {
    const lostDeals = deals.filter(d => d.stage === 'LOST');
    const reasons = Object.entries(pipeline.lossReasons || {}).sort((a, b) => b[1] - a[1]);
    lossBox.innerHTML = `<div class="text-sm font-semibold text-[#042970]">Why we lose</div>` + (reasons.length
      ? reasons.map(([reason, n]) => {
          const value = lostDeals.filter(d => (d.lossReason || '').startsWith(reason)).reduce((sum, d) => sum + (d.amount || 0), 0);
          return `<div class="flex items-baseline justify-between gap-3 mt-2 text-sm"><span>${escapeHtmlText(reason)}</span><span class="tabular-nums text-[#5B6B85]">${n} deal${n === 1 ? '' : 's'} · ${RM(value)}</span></div>`;
        }).join('') + `<p class="text-xs text-[#5B6B85] mt-3">If one reason keeps coming up, review prices or the margin floor.</p>`
      : `<p class="text-sm text-[#5B6B85] mt-1">No lost deals yet.</p>`);
  }

  // Owner Activity Log
  const logList = document.getElementById('audit-log-list');
  if (logList) {
    logList.innerHTML = (st.logs || []).map(l => `
      <div class="flex items-start gap-2 py-1 text-xs text-[#324564]">
        <span class="cc-dot mt-1.5" style="background:#0152FC"></span>
        <span>${escapeHtmlText(noEmoji(l))}</span>
      </div>
    `).join('');
  }
}

// Re-engage alerts the rep sent or dismissed stay hidden in this browser until the customer writes again
function reengageKey(a) { return 'cc-reengage:' + a.customer + ':' + a.said; }
function reengageHidden(a) { try { return localStorage.getItem(reengageKey(a)) === '1'; } catch (e) { return false; } }
function hideReengage(a) { try { localStorage.setItem(reengageKey(a), '1'); } catch (e) { /* private window: shows again on reload */ } }

function renderStaffDay(st, deals, reps) {
  // The server sends Staff only their own rep row, deals, customers and chats
  const me = reps[0] || { name: 'You', commissionPct: 0, wonRm: 0, commissionRm: 0, potentialRm: 0, rank: 0 };
  const memories = st.clientMemories || {};
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('staff-kpi-rank', me.rank ? `${ordinal(me.rank)} of ${st.teamSize || reps.length}` : '-');
  set('staff-kpi-won', RM(me.wonRm));
  set('staff-kpi-comm', RM(me.commissionRm));
  set('staff-kpi-potential', '+' + RM(me.potentialRm));

  // Re-engage: customers who were about to buy and went quiet (the agent decides from their own words)
  const alerts = (st.reengage || []).filter(a => !reengageHidden(a));
  window.__reengage = alerts;
  const card = document.getElementById('staff-reengage-card');
  const list = document.getElementById('staff-reengage-list');
  if (card) card.classList.toggle('hidden', alerts.length === 0);
  if (list) {
    list.innerHTML = alerts.map((a, i) => `
      <div class="reengage">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-semibold text-sm text-[#042970]">${escapeHtmlText(a.customer)}${a.dealId ? ` <span class="deal-id">${a.dealId}</span>` : ''}</span>
          <span class="flex flex-wrap gap-1.5">${tag(LEVEL_TAG[a.level])}${tag(TIER_TAG[a.tier])}</span>
        </div>
        <blockquote class="reengage-said">"${escapeHtmlText(a.said)}"<span>${escapeHtmlText(a.reason)}${a.amount ? ' · ' + RM(a.amount) : ''}</span></blockquote>
        <label for="reengage-msg-${i}" class="cc-label">Suggested message (edit before sending)</label>
        <textarea id="reengage-msg-${i}" rows="2" class="cc-input">${escapeHtmlText(a.suggestedMessage)}</textarea>
        <div class="flex flex-wrap gap-2 mt-3">
          <button onclick="sendReengage(${i})" class="cc-btn cc-btn-primary i-swipe"><svg aria-hidden="true"><use href="#i-send"/></svg>Send on WhatsApp</button>
          <button onclick="dismissReengage(${i})" class="cc-btn cc-btn-ghost">Dismiss</button>
        </div>
      </div>`).join('');
  }

  // Next up: a short ranked list. Follow-ups due first, then quotes the customer is warm on, then new questions.
  const alerted = new Set(alerts.map(a => (a.customer || '').toLowerCase()));
  const memoryOf = name => memories[name] || Object.values(memories).find(m => m.customer.toLowerCase() === (name || '').toLowerCase());
  const open = deals.filter(d => ['INQUIRY', 'QUOTED', 'FOLLOW_UP'].includes(d.stage) && !d.paused && !alerted.has(d.customer.toLowerCase()));
  const rank = d => d.stage === 'FOLLOW_UP' ? 0 : d.stage === 'QUOTED' ? 1 : 2;
  const items = open.sort((a, b) => rank(a) - rank(b)).map(d => ({ deal: d, name: d.customer, mem: memoryOf(d.customer) }));
  // New chats with no deal yet (e.g. a price question) come last
  Object.values(memories).forEach(m => {
    const key = m.customer.toLowerCase();
    if (m.buyingLevel && !alerted.has(key) && !deals.some(d => d.customer.toLowerCase() === key && ['INQUIRY', 'QUOTED', 'FOLLOW_UP'].includes(d.stage))
      && !deals.some(d => d.customer.toLowerCase() === key && d.stage === 'WON' && (d.wonAt || '') >= (m.lastCustomerAt || ''))) {
      items.push({ deal: null, name: m.customer, mem: m });
    }
  });
  const top = items.slice(0, 3);
  const staffFollowList = document.getElementById('staff-followups-list');
  if (staffFollowList) {
    staffFollowList.innerHTML = top.length ? top.map((it, i) => {
      const d = it.deal, m = it.mem;
      const what = d ? `${d.id} · ${RM(d.amount)} · ${escapeHtmlText(noEmoji(d.followUpText) || STAGE_META[d.stage].label)}` : 'New chat · no quote yet';
      const tip = m && m.paymentBehavior ? noEmoji(m.paymentBehavior) : '';
      const action = d && d.stage === 'FOLLOW_UP'
        ? `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary i-swipe"><svg aria-hidden="true"><use href="#i-send"/></svg>Send follow-up</button>`
        : d && d.stage === 'INQUIRY'
          ? `<button onclick="sendQuoteDeal('${d.id}')" class="cc-btn cc-btn-primary">Send quote</button>`
          : `<button onclick="openCustomerChat(${escapeHtmlText(JSON.stringify(it.name))})" class="cc-btn ${d ? 'cc-btn-ghost' : 'cc-btn-primary'}"><svg aria-hidden="true"><use href="#i-chat"/></svg>Open chat</button>`;
      return `
        <li class="next-up">
          <span class="next-up-n tabular-nums">${i + 1}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-semibold text-sm text-[#042970]">${escapeHtmlText(it.name)}</span>
              ${m ? tag(LEVEL_TAG[m.buyingLevel]) + tag(TIER_TAG[m.tier]) : ''}
            </div>
            <div class="text-[13px] text-[#5B6B85] mt-0.5">${what}${m && quietText(m.lastCustomerAt) ? ' · <b>' + quietText(m.lastCustomerAt) + '</b>' : ''}</div>
            ${tip ? `<div class="text-[13px] text-[#324564] mt-1">${escapeHtmlText(tip)}</div>` : ''}
          </div>
          <div class="shrink-0">${action}</div>
        </li>`;
    }).join('') : `<li class="cc-note cc-note-ok"><svg aria-hidden="true"><use href="#i-check"/></svg><span>All caught up. Nothing waiting on you.</span></li>`;
  }

  // Staff Recent Wins
  const myWonDeals = deals.filter(d => d.stage === 'WON');
  const staffWinsList = document.getElementById('staff-recent-wins');
  if (staffWinsList) {
    staffWinsList.innerHTML = myWonDeals.slice(0, 4).map(d => `
      <div class="rep-card">
        <span class="cc-stat-icon !w-8 !h-8 bg-emerald-50 text-emerald-600"><svg aria-hidden="true"><use href="#i-check"/></svg></span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-[#042970] truncate">${escapeHtmlText(d.customer)}</span>
          <span class="block text-xs font-mono text-[#5B6B85]">#${d.orderNo || d.id}</span>
        </span>
        <span class="text-right">
          <span class="block text-sm font-semibold text-[#042970] tabular-nums">${RM(d.amount)}</span>
          <span class="block text-xs text-emerald-700 tabular-nums">+${RM(Math.round(d.amount * (me.commissionPct || 0) / 100))} commission</span>
        </span>
      </div>
    `).join('') || `<div class="cc-note cc-note-info"><svg aria-hidden="true"><use href="#i-trend"/></svg><span>No wins yet this month. Each quote you close adds commission.</span></div>`;
  }
}

// Opens WhatsApp Web (one reused tab, where the extension runs): the customer's chat when we have their number,
// otherwise WhatsApp Web itself. Local numbers (012-...) are taken as Malaysian. Returns false when there is no number.
function openWhatsAppChat(phone, text) {
  const digits = (phone || '').split(' · ')[0].replace(/\D/g, '').replace(/^0/, '60');
  window.open(digits ? `https://web.whatsapp.com/send?phone=${digits}${text ? '&text=' + encodeURIComponent(text) : ''}` : 'https://web.whatsapp.com/', 'dealpilot-whatsapp');
  return !!digits;
}

// Open chat: the number comes from the customer's deal or customer record
function openCustomerChat(name, text) {
  const st = getState();
  const key = (name || '').toLowerCase();
  const rec = [...(st.deals || []), ...(st.customers || [])].find(r => (r.customer || r.name || '').toLowerCase() === key && r.phone);
  if (!openWhatsAppChat(rec && rec.phone, text)) showToast(`Opened WhatsApp Web: search for ${name}. Save their number on the Customers page to open the chat directly.`);
}

// Send opens WhatsApp with the edited message. With an open deal it also counts as a follow-up (logged and the
// timer resets); otherwise it is logged on its own.
function sendReengage(i) {
  const a = (window.__reengage || [])[i];
  if (!a) return;
  const text = (document.getElementById(`reengage-msg-${i}`) || {}).value || a.suggestedMessage;
  openWhatsAppChat(a.phone, text);
  hideReengage(a);
  if (a.dealId) {
    logFollowUp(a.dealId);   // WhatsApp is already open with the rep's edited message
  } else {
    backendAction('/api/reengage', { customer: a.customer, action: 'SENT' }, `Re-engaged ${a.customer}.`);
  }
}

function dismissReengage(i) {
  const a = (window.__reengage || [])[i];
  if (!a) return;
  hideReengage(a);
  backendAction('/api/reengage', { customer: a.customer, action: 'DISMISSED' }, `Dismissed the alert for ${a.customer}.`);
}

function filterDealsToStage(stage) {
  currentDealFilter = stage;
  switchPage('deals');
}

// =========================================================================
// 2. DEALS & PIPELINE VIEW
// =========================================================================
function setDealFilter(stage) {
  currentDealFilter = stage;
  renderDealsView();
}

function setDealRepFilter(repName) {
  currentDealRepFilter = repName;
  renderDealsView();
}

function renderDealsView() {
  const st = getState();
  const isOwner = currentRole === 'OWNER';
  const deals = st.deals || [];
  const reps = st.reps || [];

  // The Owner reads every deal; the reps do the quoting and chasing on their own deals
  const dealsCopy = isOwner
    ? ['All deals', 'Every deal, every rep.', 'Read-only. Reps send the quotes and follow-ups; discounts and lost deals that need you come as approvals on the Pipeline page.']
    : ['Deals', 'One next step per deal.', 'Send the quote, follow up, or close it. Discounts below your margin go to the Owner.'];
  [['deals-hero-pill', 0], ['deals-hero-title', 1], ['deals-hero-sub', 2]].forEach(([id, n]) => { const el = document.getElementById(id); if (el) el.textContent = dealsCopy[n]; });
  const dealsLog = document.getElementById('deals-log-btn');
  if (dealsLog) dealsLog.style.display = isOwner ? 'none' : '';

  // Staff only get their own deals, so the rep filter is the Owner's alone
  const repFilter = document.getElementById('deals-rep-filter');
  if (repFilter) repFilter.classList.toggle('hidden', !isOwner);
  if (!isOwner) currentDealRepFilter = 'ALL';

  // Update Rep filter options
  const repSelect = document.getElementById('deals-rep-select');
  if (repSelect) {
    const curVal = repSelect.value;
    repSelect.innerHTML = `<option value="ALL">All reps</option>` +
      reps.map(r => `<option value="${escapeHtmlText(r.name)}">${escapeHtmlText(r.name)}</option>`).join('');
    if (curVal) repSelect.value = curVal;
  }

  // Filter deals
  const filtered = deals.filter(d => {
    if (currentDealFilter !== 'ALL' && d.stage !== currentDealFilter) return false;
    if (currentDealRepFilter !== 'ALL' && d.repName !== currentDealRepFilter) return false;
    if (dealSearchQuery) {
      const q = dealSearchQuery.toLowerCase();
      const matchCust = (d.customer || '').toLowerCase().includes(q);
      const matchId = (d.id || '').toLowerCase().includes(q);
      const matchOrder = (d.orderNo || '').toLowerCase().includes(q);
      if (!matchCust && !matchId && !matchOrder) return false;
    }
    return true;
  });

  // Filter chips active state
  document.querySelectorAll('#deals-filter-bar button').forEach(btn => {
    const f = btn.getAttribute('data-stage');
    btn.classList.toggle('is-active', f === currentDealFilter);
  });

  const listEl = document.getElementById('deals-list-container');
  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="cc-card p-8 text-center">
        <img src="img/mascot-question.png" alt="" width="240" height="246" class="w-16 h-auto mx-auto mb-3" aria-hidden="true" />
        <div class="text-sm font-semibold text-[#042970]">No deals here</div>
        <p class="text-[13px] text-[#5B6B85] mt-1">Pick another stage, or log a new inquiry.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(d => {
    const isWon = d.stage === 'WON';
    const isLost = d.stage === 'LOST';
    const isFollowUp = d.stage === 'FOLLOW_UP';
    const itemsSummary = (d.items || []).map(i => `${i.qty}x ${i.name || i.sku}`).join(', ') || 'Standard Quotation';

    const meta = STAGE_META[d.stage] || STAGE_META.INQUIRY;

    // Primary action button based on stage (the Owner sees where the deal is instead)
    let primaryBtn = '';
    if (isOwner && !isWon && !isLost) {
      primaryBtn = `<span class="cc-pill !py-1.5 !px-3" style="${meta.pill}">${d.stage === 'INQUIRY' ? 'Not quoted yet' : d.stage === 'QUOTED' ? 'Quote sent' : 'Follow-up due'}</span>`;
    } else if (d.stage === 'INQUIRY') {
      primaryBtn = `<button onclick="sendQuoteDeal('${d.id}')" class="cc-btn cc-btn-primary"><svg aria-hidden="true"><use href="#i-send"/></svg>Send quote</button>`;
    } else if (d.stage === 'QUOTED') {
      primaryBtn = `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary">Follow up</button>`;
    } else if (d.stage === 'FOLLOW_UP') {
      primaryBtn = `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary"><svg aria-hidden="true"><use href="#i-clock"/></svg>Send follow-up</button>`;
    } else if (isWon) {
      primaryBtn = `<span class="cc-pill cc-pill-ok !py-1.5 !px-3"><svg aria-hidden="true"><use href="#i-check"/></svg>Order #${d.orderNo || d.id}</span>`;
    } else if (isLost) {
      primaryBtn = `<span class="cc-pill cc-pill-muted !py-1.5 !px-3">Lost: ${escapeHtmlText(d.lossReason || 'Declined')}</span>`;
    }

    // Margin display: Owner sees %, Staff sees marginOk
    const marginBadge = isOwner
      ? (d.marginOk ? `<span class="text-xs text-emerald-700">${d.marginPct || 25}% margin</span>` : `<span class="text-xs font-semibold text-rose-700">${d.marginPct || 10}% margin · below floor</span>`)
      : (d.marginOk ? `<span class="text-xs text-emerald-700">Margin OK</span>` : `<span class="text-xs font-semibold text-amber-700">Needs Owner OK</span>`);

    // Owner approval state for this deal (the backend names the deal as "#ID (Customer)" in the summary)
    const forDeal = (typeof backendApprovals !== 'undefined' ? backendApprovals : []).filter(a => a.summary.includes(`#${d.id} (`));
    const waiting = forDeal.find(a => a.status === 'PENDING');
    const turnedDown = !waiting && forDeal[0]?.status === 'REJECTED' ? forDeal[0] : null;
    if (waiting) primaryBtn = `<span class="cc-pill cc-pill-warn !py-1.5 !px-3"><svg aria-hidden="true"><use href="#i-clock"/></svg>Waiting for Owner</span>`;
    const approvalNote = waiting ? `
          <div class="deal-approval is-waiting" role="status">
            <svg aria-hidden="true"><use href="#i-shield"/></svg>
            <div><b>Sent to the Owner.</b> ${escapeHtmlText(waiting.summary)}<br><span>#AP-${waiting.id} · ${escapeHtmlText(waiting.reason)}. We'll update this when they decide.</span></div>
          </div>` : turnedDown ? `
          <div class="deal-approval is-rejected" role="status">
            <svg aria-hidden="true"><use href="#i-x"/></svg>
            <div><b>Owner said no.</b> ${escapeHtmlText(turnedDown.summary)}${turnedDown.decisionNote ? `<br><span>Note: ${escapeHtmlText(turnedDown.decisionNote)}</span>` : ''}</div>
          </div>` : '';

    const followText = noEmoji(d.followUpText);
    return `
      <div class="deal-row ${(isFollowUp && !isOwner) || waiting ? 'is-attention' : ''}">
        <div class="min-w-0 flex-1 space-y-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="deal-id">${d.id}</span>
            <span class="font-semibold text-sm text-[#042970]">${escapeHtmlText(d.customer)}</span>
            <span class="cc-pill" style="${meta.pill}"><span class="cc-dot" style="background:${meta.dot}"></span>${meta.label}</span>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="deal-meta"><svg aria-hidden="true"><use href="#i-users"/></svg>${escapeHtmlText(repNameOf(st, d))}</span>
            ${d.phone ? `<span class="deal-meta"><svg aria-hidden="true"><use href="#i-chat"/></svg>${escapeHtmlText(d.phone)}</span>` : ''}
            ${d.paused ? `<span class="deal-meta !text-[#93370D]"><svg aria-hidden="true"><use href="#i-alert"/></svg>Follow-ups paused (complaint)</span>` : (followText ? `<span class="deal-meta ${isFollowUp ? '!text-[#93370D]' : ''}"><svg aria-hidden="true"><use href="#i-clock"/></svg>${escapeHtmlText(followText)}</span>` : '')}
          </div>
          ${!isWon && !isLost && d.followUpCount > 0 ? `<div class="deal-meta ${d.followUpCount >= 3 ? '!text-[#B42318]' : ''}"><svg aria-hidden="true"><use href="#i-chat"/></svg>${d.followUpCount >= 3 ? `${d.followUpCount} follow-ups sent, no reply. Consider marking it lost.` : `${d.followUpCount} of 3 follow-ups sent`}</div>` : ''}
          <div class="text-[13px] text-[#324564]">${escapeHtmlText(itemsSummary)}</div>
          ${approvalNote}
          <div class="deal-actions">
            <button onclick="openPdfForDeal('${d.id}')" class="deal-act"><svg aria-hidden="true"><use href="#i-file"/></svg>PDF</button>
            ${!isOwner && !isWon && !isLost && !waiting ? `
              <button onclick="markWonDeal('${d.id}')" class="deal-act"><svg aria-hidden="true"><use href="#i-check"/></svg>Mark won</button>
              <button onclick="discountDeal('${d.id}')" class="deal-act"><svg aria-hidden="true"><use href="#i-sparkle"/></svg>Discount</button>
              <button onclick="pauseResumeDeal('${d.id}', ${!d.paused})" class="deal-act">${d.paused ? 'Resume follow-ups' : 'Pause (complaint)'}</button>
              <button onclick="markLostDeal('${d.id}')" class="deal-act is-danger">Mark lost</button>
            ` : ''}
            ${isWon && isOwner ? `<button onclick="cancelWonDeal('${d.id}')" class="deal-act is-danger">Cancel order</button>` : ''}
            ${isOwner ? '' : `<button onclick="setTinDeal('${d.id}')" class="deal-act">Add TIN</button>`}
          </div>
        </div>

        <div class="flex items-center gap-4 shrink-0">
          <div class="text-right">
            <div class="text-base font-bold text-[#042970] tabular-nums">RM ${(d.amount || 0).toLocaleString()}</div>
            ${marginBadge}
          </div>
          ${primaryBtn}
        </div>
      </div>
    `;
  }).join('');
}

// Deal action API callers
function sendQuoteDeal(dealId) {
  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, { action: 'SEND_QUOTE' }, `Quote #${dealId} sent to customer!`);
}

// Follow up: opens the customer's WhatsApp chat with a follow-up typed in (the rep presses send), and records it
// so the timer resets.
function sendFollowUpDeal(dealId) {
  const d = (getState().deals || []).find(x => x.id === dealId);
  if (d) openCustomerChat(d.customer, `Hi ${d.customer}, just checking in on quotation #${d.id} (${RM(d.amount)}). Would you like to go ahead, or is there anything I can help with?`);
  logFollowUp(dealId);
}

function logFollowUp(dealId) {
  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, { action: 'SEND_FOLLOW_UP' }, `Follow-up on #${dealId} opened in WhatsApp.`);
}

function markWonDeal(dealId) {
  askForm({
    title: `Mark #${dealId} as won`,
    message: 'Record the customer\'s payment slip. The order number and commission are created for you.',
    okText: 'Mark won',
    fields: [
      { name: 'ref', label: 'Bank / DuitNow transfer slip ref', value: 'DN-20261023-889', required: true, requiredMsg: 'Enter the slip reference.' },
      { name: 'amount', label: 'Deposit or amount paid (RM)', type: 'number', value: 1000, min: 1, hint: 'Recorded with the order.' }
    ]
  }, v => backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'MARK_WON',
    depositRef: v.ref,
    depositAmount: v.amount
  }, `Deal #${dealId} marked WON! Order confirmed.`));
}

function markLostDeal(dealId) {
  askForm({
    title: `Mark #${dealId} as lost`,
    okText: 'Mark lost',
    isDanger: true,
    fields: [
      { name: 'reason', label: 'Why was it lost?', value: 'Customer declined on WhatsApp', required: true, requiredMsg: 'Enter a reason.',
        chips: ['Competitor price', 'No reply', 'Timing', 'Cancelled'] }
    ]
  }, v => backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'MARK_LOST',
    reason: v.reason
  }, `Deal #${dealId} marked LOST.`));
}

function discountDeal(dealId) {
  askForm({
    title: `Apply a discount to #${dealId}`,
    okText: 'Apply discount',
    fields: [
      { name: 'discount', label: 'Discount (RM)', type: 'number', value: 50, min: 1, required: true, requiredMsg: 'Enter the discount in RM.',
        hint: 'A discount that takes the margin below your floor needs Owner approval.' }
    ]
  }, v => backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'APPLY_DISCOUNT',
    discount: Math.round(v.discount)
  }, `Discount of RM ${Math.round(v.discount)} applied to #${dealId}!`));
}

function pauseResumeDeal(dealId, pause) {
  const send = note => backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: pause ? 'PAUSE' : 'RESUME',
    note: note || ''
  }, `${pause ? 'Paused' : 'Resumed'} follow-ups on #${dealId}.`);

  if (!pause) { send(''); return; }
  askForm({
    title: `Pause follow-ups on #${dealId}`,
    message: 'Reminders stop until you resume them.',
    okText: 'Pause follow-ups',
    fields: [
      { name: 'note', label: 'What happened?', value: 'Customer reported issue', required: true, requiredMsg: 'Add a short reason.' }
    ]
  }, v => send(v.note));
}

function setTinDeal(dealId) {
  askForm({
    title: `Add buyer TIN to #${dealId}`,
    message: 'The LHDN tax ID goes on the e-Invoice.',
    okText: 'Save TIN',
    fields: [
      { name: 'tin', label: 'Buyer LHDN TIN', value: 'C2588190021', required: true, requiredMsg: 'Enter the TIN.', hint: 'For example C2588190021' }
    ]
  }, v => backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'SET_TIN',
    tin: v.tin
  }, `Saved LHDN TIN ${v.tin} on #${dealId}!`));
}

function cancelWonDeal(dealId) {
  askForm({
    title: `Cancel won order #${dealId}`,
    message: 'The order is marked lost and its commission is taken off this month.',
    okText: 'Cancel order',
    isDanger: true,
    fields: [
      { name: 'reason', label: 'Why is it cancelled?', value: 'Customer requested cancellation', required: true, requiredMsg: 'Enter a reason.',
        chips: ['Customer returned units', 'Payment bounced', 'Customer requested cancellation'] }
    ]
  }, v => backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'CANCEL_WON',
    reason: v.reason
  }, `Cancelled won order #${dealId}.`));
}

function openPdfForDeal(dealId) {
  if (typeof openPdfForInvoice === 'function') {
    openPdfForInvoice(dealId);
  }
}

function downloadWonOrdersCsv() {
  window.open(`${BACKEND_API_BASE}/api/export/orders.csv?role=${encodeURIComponent(currentRole)}`, '_blank');
  showToast('📥 Downloading Won Orders CSV for accounting...');
}

// Log inquiry modal & form
function openLogInquiryModal() {
  const st = getState();
  const skuSelect = document.getElementById('inquiry-sku-select');
  if (skuSelect) {
    skuSelect.innerHTML = (st.products || []).map(p =>
      `<option value="${p.sku}">${escapeHtmlText(p.name)} — RM ${p.sellPrice}</option>`
    ).join('');
  }
  const modal = document.getElementById('log-inquiry-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeLogInquiryModal() {
  const modal = document.getElementById('log-inquiry-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitLogInquiry() {
  const custInput = document.getElementById('inquiry-customer-name');
  const phoneInput = document.getElementById('inquiry-phone');
  const skuSelect = document.getElementById('inquiry-sku-select');
  const qtyInput = document.getElementById('inquiry-qty');
  const quoteNowCheck = document.getElementById('inquiry-quote-now');

  const customer = (custInput?.value || '').trim();
  if (!customer) {
    showToast('⚠️ Please enter a customer name.');
    return;
  }
  const phone = (phoneInput?.value || '').trim();
  const sku = skuSelect?.value;
  if (!sku) {
    showToast('⚠️ Pick a product from the price list.');
    return;
  }
  const qty = Math.max(1, parseInt(qtyInput?.value || '1', 10));
  const quoteNow = quoteNowCheck?.checked ?? true;

  const data = await backendAction('/api/deals', {
    customer: customer,
    phone: phone,
    items: [{ sku: sku, qty: qty }],
    quote: quoteNow
  }, d => `Deal #${d.createdId} created for ${customer}!`);

  if (data) {
    closeLogInquiryModal();
    if (custInput) custInput.value = '';
    if (phoneInput) phoneInput.value = '';
  }
}

// =========================================================================
// 3. CATALOG (PRICE LIST) VIEW
// =========================================================================
function renderCatalogView() {
  const st = getState();
  const isOwner = currentRole === 'OWNER';
  const products = st.products || [];

  const addBtn = document.getElementById('catalog-add-btn');
  if (addBtn) addBtn.classList.toggle('hidden', !isOwner);

  const tbody = document.getElementById('catalog-tbody');
  if (!tbody) return;

  tbody.innerHTML = products.map(p => {
    const cost = p.unitCost !== undefined && p.unitCost !== null ? p.unitCost : Math.round(p.sellPrice * 0.7);
    const margin = p.sellPrice - cost;
    const marginPct = p.sellPrice > 0 ? Math.round((margin / p.sellPrice) * 100) : 0;
    const specs = p.specs || {};
    const specsSummary = [
      specs.hp ? `${specs.hp}HP` : '',
      specs.brand || '',
      specs.best_for ? `Best for: ${specs.best_for}` : ''
    ].filter(Boolean).join(' · ') || 'Standard catalog SKU';

    return `
      <tr class="align-top">
        <td class="px-4 font-mono text-[13px] font-semibold text-[#0152FC]">${escapeHtmlText(p.sku)}</td>
        <td class="px-4 min-w-[240px]">
          <div class="font-semibold text-[#042970]">${escapeHtmlText(p.name)}</div>
          <div class="text-xs text-[#5B6B85] mt-0.5">${escapeHtmlText(specsSummary)}</div>
        </td>
        <td class="px-4 text-right font-semibold text-[#042970] tabular-nums whitespace-nowrap">RM ${p.sellPrice.toLocaleString()}</td>
        <td class="px-4 text-right text-[#5B6B85] tabular-nums whitespace-nowrap">
          ${isOwner ? 'RM ' + cost.toLocaleString() : '<span class="inline-flex items-center gap-1"><svg class="w-3.5 h-3.5" aria-hidden="true"><use href="#i-lock"/></svg>Owner only</span>'}
        </td>
        <td class="px-4 text-right whitespace-nowrap">
          ${isOwner
            ? `<span class="font-semibold tabular-nums ${marginPct >= 15 ? 'text-emerald-700' : 'text-amber-700'}">RM ${margin}</span> <span class="text-xs text-[#5B6B85]">(${marginPct}%)</span>`
            : `<span class="text-xs font-semibold ${marginPct >= 15 ? 'text-emerald-700' : 'text-amber-700'}">${marginPct >= 15 ? 'OK' : 'Low'}</span>`}
        </td>
        <td class="px-4 text-right whitespace-nowrap">
          ${isOwner ? `<button onclick="openEditProductModal('${p.sku}')" class="deal-act">Edit price</button>` : `<span class="text-xs text-[#5B6B85]">Active</span>`}
        </td>
      </tr>
    `;
  }).join('');
}

function openEditProductModal(sku = '') {
  const st = getState();
  const p = (st.products || []).find(x => x.sku === sku);
  const skuEl = document.getElementById('prod-modal-sku');
  const nameEl = document.getElementById('prod-modal-name');
  const sellEl = document.getElementById('prod-modal-sell');
  const costEl = document.getElementById('prod-modal-cost');

  if (p) {
    if (skuEl) { skuEl.value = p.sku; skuEl.readOnly = true; }
    if (nameEl) nameEl.value = p.name;
    if (sellEl) sellEl.value = p.sellPrice;
    if (costEl) costEl.value = p.unitCost || Math.round(p.sellPrice * 0.7);
  } else {
    if (skuEl) { skuEl.value = ''; skuEl.readOnly = false; }
    if (nameEl) nameEl.value = '';
    if (sellEl) sellEl.value = '1000';
    if (costEl) costEl.value = '700';
  }
  const modal = document.getElementById('edit-product-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeEditProductModal() {
  const modal = document.getElementById('edit-product-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveProductFromModal() {
  const sku = (document.getElementById('prod-modal-sku')?.value || '').trim().toUpperCase();
  const name = (document.getElementById('prod-modal-name')?.value || '').trim();
  const sellPrice = parseInt(document.getElementById('prod-modal-sell')?.value || '0', 10);
  const unitCost = parseInt(document.getElementById('prod-modal-cost')?.value || '0', 10);

  if (!sku || !name || sellPrice <= 0) {
    showToast('Enter a SKU, a name and a selling price.');
    return;
  }

  const data = await backendAction('/api/products', {
    sku,
    name,
    sellPrice,
    unitCost
  }, `Saved ${sku} to Price List!`);

  if (data) {
    closeEditProductModal();
  }
}

// =========================================================================
// 4. CUSTOMERS & LHDN TIN DIRECTORY VIEW
// =========================================================================
function renderCustomersView() {
  const st = getState();
  const customers = st.customers || [];
  const tbody = document.getElementById('customers-tbody');
  if (!tbody) return;

  const deals = st.deals || [];
  tbody.innerHTML = customers.map(c => {
    const isReady = c.lhdnReady || !!c.tin;
    const tinBadge = isReady
      ? `<span class="cc-pill cc-pill-ok font-mono">${escapeHtmlText(c.tin || 'LHDN ready')}</span>`
      : `<span class="cc-pill cc-pill-warn">Missing TIN</span>`;
    const won = deals.filter(d => d.customer === c.name && d.stage === 'WON');
    const wonRm = won.reduce((sum, d) => sum + (d.amount || 0), 0);
    const rep = (st.reps || []).find(r => r.id === c.repId);

    return `
      <tr>
        <td class="px-4 font-semibold text-[#042970] min-w-[150px]">${escapeHtmlText(c.name)}</td>
        <td class="px-4 text-[#5B6B85] text-xs font-mono whitespace-nowrap">${escapeHtmlText(c.phone || '-')}</td>
        <td class="px-4 whitespace-nowrap">${tinBadge}</td>
        <td class="px-4 text-[#324564] whitespace-nowrap">${rep ? escapeHtmlText(rep.name) : '<span class="text-[#5B6B85]">Unassigned</span>'}</td>
        <td class="px-4 text-right tabular-nums">${c.openRecords || 0}</td>
        <td class="px-4 text-right tabular-nums">${won.length}</td>
        <td class="px-4 text-right font-semibold text-[#042970] tabular-nums whitespace-nowrap">RM ${wonRm.toLocaleString()}</td>
        <td class="px-4 text-right whitespace-nowrap">
          <div class="inline-flex flex-col items-end gap-0.5">
            <button onclick="promptCustomerTin('${escapeHtmlText(c.name)}')" class="deal-act">${isReady ? 'Update TIN' : 'Add TIN'}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function promptCustomerTin(customerName) {
  askForm({
    title: `Buyer TIN for ${customerName}`,
    message: 'The LHDN tax ID goes on their e-Invoices.',
    okText: 'Save TIN',
    fields: [
      { name: 'tin', label: 'Buyer LHDN TIN', value: 'C2588190021', required: true, requiredMsg: 'Enter the TIN.', hint: 'For example C2588190021' }
    ]
  }, v => {
    // Find latest deal for this customer if any
    const st = getState();
    const d = (st.deals || []).find(x => x.customer === customerName);
    if (d) {
      backendAction(`/api/deals/${encodeURIComponent(d.id)}/action`, { action: 'SET_TIN', tin: v.tin }, `Saved LHDN TIN ${v.tin} on #${d.id}!`);
    } else {
      showToast(`Saved TIN ${v.tin} for ${customerName}!`);
    }
  });
}

function addCustomerPrompt() {
  askForm({
    title: 'Add a customer',
    okText: 'Add customer',
    fields: [
      { name: 'name', label: 'Customer or company name', required: true, requiredMsg: 'Enter a name.', placeholder: 'Customer or company name' },
      { name: 'phone', label: 'WhatsApp phone', value: '+60 12-345 6789' }
    ]
  }, v => backendAction('/api/customers', {
    name: v.name,
    phone: v.phone
  }, `Added ${v.name} to customer directory!`));
}

// =========================================================================
// 5. COMMISSION TRACKER & LEADERBOARD VIEW
// =========================================================================
function renderCommissionView() {
  const st = getState();
  const isOwner = currentRole === 'OWNER';
  const reps = st.reps || [];
  const tbody = document.getElementById('commission-tbody');
  if (!tbody) return;

  // Staff get only their own row from the server, so the page speaks to them about their own pay
  const say = (id, owner, staff) => { const el = document.getElementById(id); if (el) el.textContent = isOwner ? owner : staff; };
  say('comm-hero-sub', "Each rep's sales and commission, worked out from the deals they closed.", 'Your sales and commission, worked out from the deals you closed.');
  say('comm-won-label', 'Won sales', 'Your won sales');
  say('comm-won-note', 'All won deals added together', 'Orders you closed this month');
  say('comm-pay-label', 'Commission to pay', 'Your commission');
  say('comm-pay-note', 'Owed across all reps', 'Estimated; the Owner confirms your pay');
  const addRep = document.getElementById('comm-add-rep');
  if (addRep) addRep.style.display = isOwner ? '' : 'none';

  const totalWon = reps.reduce((sum, r) => sum + (r.wonRm || 0), 0);
  const totalComm = reps.reduce((sum, r) => sum + (r.commissionRm || 0), 0);

  const wonTotalEl = document.getElementById('comm-total-won');
  if (wonTotalEl) wonTotalEl.textContent = 'RM ' + totalWon.toLocaleString();

  const commTotalEl = document.getElementById('comm-total-payout');
  if (commTotalEl) commTotalEl.textContent = 'RM ' + totalComm.toLocaleString();

  tbody.innerHTML = reps.map((r, idx) => `
    <tr>
      <td class="px-4">
        <span class="inline-flex items-center gap-2.5 font-semibold text-[#042970] whitespace-nowrap">
          <span class="rep-rank ${idx === 0 ? 'is-top' : ''}">${idx + 1}</span>${escapeHtmlText(r.name)}
        </span>
      </td>
      <td class="px-4 text-right tabular-nums">${r.commissionPct}%</td>
      <td class="px-4 text-right font-semibold text-[#042970] tabular-nums whitespace-nowrap">RM ${(r.wonRm || 0).toLocaleString()}</td>
      <td class="px-4 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">RM ${(r.commissionRm || 0).toLocaleString()}</td>
      <td class="px-4 text-right tabular-nums">${r.openDeals || 0}</td>
      <td class="px-4 text-right tabular-nums">${r.overdue > 0 ? `<span class="cc-pill cc-pill-warn">${r.overdue}</span>` : '<span class="text-[#5B6B85]">0</span>'}</td>
      <td class="px-4 text-right whitespace-nowrap">
        ${isOwner ? `<button onclick="promptEditRepRate(${r.id}, '${escapeHtmlText(r.name)}', ${r.commissionPct})" class="deal-act">Change rate</button>` : `<span class="text-xs text-[#5B6B85]">Active</span>`}
      </td>
    </tr>
  `).join('');
}

function promptEditRepRate(repId, repName, currentPct) {
  askForm({
    title: `Commission rate for ${repName}`,
    okText: 'Save rate',
    fields: [
      { name: 'rate', label: 'Commission (%)', type: 'number', value: currentPct, min: 0, max: 100, step: 0.5, required: true, requiredMsg: 'Enter a percentage.',
        hint: 'Paid on won orders only.' }
    ]
  }, v => backendAction('/api/reps', {
    id: repId,
    name: repName,
    commissionPct: v.rate,
    active: true
  }, `Updated ${repName}'s commission to ${v.rate}%!`));
}

function promptAddNewRep() {
  askForm({
    title: 'Add a sales rep',
    okText: 'Add rep',
    fields: [
      { name: 'name', label: 'Rep name', required: true, requiredMsg: 'Enter a name.', placeholder: 'First name, e.g. as on WhatsApp' },
      { name: 'rate', label: 'Commission (%)', type: 'number', value: 3, min: 0, max: 100, step: 0.5, required: true, requiredMsg: 'Enter a percentage.', hint: 'Paid on won orders only.' }
    ]
  }, v => backendAction('/api/reps', {
    name: v.name,
    commissionPct: v.rate,
    active: true
  }, `Added sales rep ${v.name} (${v.rate}% commission)!`));
}

// Master render invoked by main.js
function renderWebAppView() {
  renderPipelineView();
  renderDealsView();
  renderCatalogView();
  renderCustomersView();
  renderCommissionView();
}
