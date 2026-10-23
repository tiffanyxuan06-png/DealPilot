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
  const pages = ['pipeline', 'deals', 'catalog', 'customers', 'commission', 'wa'];
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

function openSettingsModal() {
  if (typeof renderTeamPermissions === 'function') renderTeamPermissions();
  if (typeof renderOnboarding === 'function') renderOnboarding();
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
    ? ['Pipeline', 'Every deal, from chat to order.', 'See what is quoted, what needs a follow-up and what you won this month.']
    : ['My day', 'Your follow-ups and wins today.', 'Send the reminders that are due, then close the deals that are ready.'];
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
  if (navText) navText.textContent = isOwner ? 'Pipeline' : 'My Day';

  const badgePipeline = document.getElementById('badge-pipeline');
  if (badgePipeline) {
    const overdueCount = pipeline.overdue || 0;
    badgePipeline.textContent = overdueCount > 0 ? `${overdueCount} Due` : `${deals.length}`;
    badgePipeline.className = overdueCount > 0 ? 'nav-badge !bg-amber-500 !text-white' : 'nav-badge';
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
    // Top numbers for Owner
    const wonThisMonth = reps.reduce((sum, r) => sum + (r.wonRm || 0), 0);
    const winRatePct = Math.round((pipeline.winRate || 0) * 100);

    const valEl = document.getElementById('kpi-pipeline-val');
    if (valEl) valEl.textContent = 'RM ' + (pipeline.valueRm || 0).toLocaleString();

    const wonEl = document.getElementById('kpi-won-month');
    if (wonEl) wonEl.textContent = 'RM ' + wonThisMonth.toLocaleString();

    const rateEl = document.getElementById('kpi-win-rate');
    if (rateEl) rateEl.textContent = winRatePct + '%';

    const overdueEl = document.getElementById('kpi-overdue-count');
    if (overdueEl) overdueEl.textContent = (pipeline.overdue || 0) + ((pipeline.overdue || 0) === 1 ? ' deal' : ' deals');

    // Stage breakdown cards
    const byStage = pipeline.byStage || {};
    const stages = ['INQUIRY', 'QUOTED', 'FOLLOW_UP', 'WON', 'LOST'];

    const stageContainer = document.getElementById('pipeline-stage-cards');
    if (stageContainer) {
      stageContainer.innerHTML = stages.map((key, i) => {
        const meta = STAGE_META[key];
        const item = byStage[key] || { count: 0, valueRm: 0 };
        return `
          <button onclick="filterDealsToStage('${key}')" class="stage-card" style="--stage:${meta.dot}">
            <span class="flex items-center gap-2 text-[13px] font-semibold text-[#324564]"><span class="step-num !w-5 !h-5 !text-[11px]">${i + 1}</span>${meta.label}</span>
            <span class="block text-2xl font-bold text-[#042970] mt-2 tabular-nums">${item.count}</span>
            <span class="block text-xs text-[#5B6B85] tabular-nums">RM ${(item.valueRm || 0).toLocaleString()}</span>
          </button>
        `;
      }).join('');
    }

    // At-Risk Deals Section (suggestLost, paused complaint, or 3+ follow-ups)
    const atRiskDeals = deals.filter(d => d.suggestLost || d.paused || (d.followUpCount >= 2 && d.stage !== 'WON' && d.stage !== 'LOST'));
    const atRiskList = document.getElementById('pipeline-at-risk-list');
    if (atRiskList) {
      if (atRiskDeals.length === 0) {
        atRiskList.innerHTML = `<div class="cc-note cc-note-ok"><svg aria-hidden="true"><use href="#i-check"/></svg><span>Nothing needs attention right now.</span></div>`;
      } else {
        atRiskList.innerHTML = atRiskDeals.map(d => `
          <div class="deal-row is-attention">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="deal-id">${d.id}</span>
                <span class="font-semibold text-sm text-[#042970]">${escapeHtmlText(d.customer)}</span>
                <span class="deal-meta"><svg aria-hidden="true"><use href="#i-users"/></svg>${escapeHtmlText(repNameOf(st, d))}</span>
                <span class="text-sm font-semibold text-[#042970] tabular-nums">RM ${(d.amount || 0).toLocaleString()}</span>
              </div>
              <div class="text-[13px] text-[#93370D] mt-1.5">
                ${d.paused ? '<b>Paused for a complaint:</b> ' + escapeHtmlText(noEmoji(d.notes).replace(/^paused:\s*/i, '') || 'Waiting for it to be sorted') : (d.followUpCount >= 3 ? 'No reply after 3 follow-ups. Consider marking it lost.' : 'Follow-up due')}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button onclick="markLostDeal('${d.id}')" class="cc-btn cc-btn-ghost">Mark lost</button>
              ${d.paused
                ? `<button onclick="pauseResumeDeal('${d.id}', false)" class="cc-btn cc-btn-primary">Resume follow-ups</button>`
                : `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary">Send follow-up</button>`}
            </div>
          </div>
        `).join('');
      }
    }

    // Reps Leaderboard Snippet
    const repSnippet = document.getElementById('pipeline-reps-snippet');
    if (repSnippet) {
      repSnippet.innerHTML = reps.map((r, idx) => `
        <div class="rep-card">
          <span class="rep-rank ${idx === 0 ? 'is-top' : ''}">${idx + 1}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-[#042970] truncate">${escapeHtmlText(r.name)}</span>
            <span class="block text-xs text-[#5B6B85]">${r.commissionPct}% commission</span>
          </span>
          <span class="text-right">
            <span class="block text-sm font-semibold text-[#042970] tabular-nums">RM ${(r.wonRm || 0).toLocaleString()}</span>
            <span class="block text-xs text-[#5B6B85] tabular-nums">RM ${(r.commissionRm || 0).toLocaleString()} earned</span>
          </span>
        </div>
      `).join('');
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

  } else {
    // STAFF ("MY DAY") DASHBOARD
    // Assume logged in rep is Aina (id = 1) or first rep
    const myRep = reps.find(r => r.name.toLowerCase().includes('aina')) || reps[0] || { id: 1, name: 'Aina', commissionPct: 3, wonRm: 0, commissionRm: 0 };
    const myDeals = deals.filter(d => d.repId === myRep.id);
    const myFollowUps = myDeals.filter(d => d.stage === 'FOLLOW_UP');
    const myWonDeals = myDeals.filter(d => d.stage === 'WON');
    const myOpenQuotes = myDeals.filter(d => d.stage === 'QUOTED');
    const potentialComm = myOpenQuotes.reduce((sum, d) => sum + Math.round((d.amount * myRep.commissionPct) / 100), 0);

    const sFollowEl = document.getElementById('staff-kpi-followups');
    if (sFollowEl) sFollowEl.textContent = myFollowUps.length;

    const sWonEl = document.getElementById('staff-kpi-won');
    if (sWonEl) sWonEl.textContent = 'RM ' + (myRep.wonRm || 0).toLocaleString();

    const sCommEl = document.getElementById('staff-kpi-comm');
    if (sCommEl) sCommEl.textContent = 'RM ' + (myRep.commissionRm || 0).toLocaleString();

    const sPotEl = document.getElementById('staff-kpi-potential');
    if (sPotEl) sPotEl.textContent = '+RM ' + potentialComm.toLocaleString();

    // Staff Follow-up action list
    const staffFollowList = document.getElementById('staff-followups-list');
    if (staffFollowList) {
      if (myFollowUps.length === 0) {
        staffFollowList.innerHTML = `<div class="cc-note cc-note-ok"><svg aria-hidden="true"><use href="#i-check"/></svg><span>All caught up. No follow-ups due today.</span></div>`;
      } else {
        staffFollowList.innerHTML = myFollowUps.map(d => `
          <div class="deal-row is-attention">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="deal-id">${d.id}</span>
                <span class="font-semibold text-sm text-[#042970]">${escapeHtmlText(d.customer)}</span>
                <span class="text-sm font-semibold text-[#042970] tabular-nums">RM ${(d.amount || 0).toLocaleString()}</span>
              </div>
              <div class="text-[13px] text-[#5B6B85] mt-1">${escapeHtmlText(d.phone || 'WhatsApp')} · ${escapeHtmlText(noEmoji(d.followUpText) || 'Follow-up due now')}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button onclick="markWonDeal('${d.id}')" class="cc-btn cc-btn-ghost">Mark won</button>
              <button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary i-swipe"><svg aria-hidden="true"><use href="#i-send"/></svg>Send follow-up</button>
            </div>
          </div>
        `).join('');
      }
    }

    // Staff Recent Wins
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
            <span class="block text-sm font-semibold text-[#042970] tabular-nums">RM ${(d.amount || 0).toLocaleString()}</span>
            <span class="block text-xs text-emerald-700 tabular-nums">+RM ${Math.round(d.amount * myRep.commissionPct / 100)} commission</span>
          </span>
        </div>
      `).join('') || `<div class="cc-note cc-note-info"><svg aria-hidden="true"><use href="#i-trend"/></svg><span>No wins yet this month. Each quote you close adds commission.</span></div>`;
    }
  }
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

    // Primary action button based on stage
    let primaryBtn = '';
    if (d.stage === 'INQUIRY') {
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
      <div class="deal-row ${isFollowUp || waiting ? 'is-attention' : ''}">
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
            ${!isWon && !isLost && !waiting ? `
              <button onclick="markWonDeal('${d.id}')" class="deal-act"><svg aria-hidden="true"><use href="#i-check"/></svg>Mark won</button>
              <button onclick="discountDeal('${d.id}')" class="deal-act"><svg aria-hidden="true"><use href="#i-sparkle"/></svg>Discount</button>
              <button onclick="pauseResumeDeal('${d.id}', ${!d.paused})" class="deal-act">${d.paused ? 'Resume follow-ups' : 'Pause (complaint)'}</button>
              <button onclick="markLostDeal('${d.id}')" class="deal-act is-danger">Mark lost</button>
            ` : ''}
            ${isWon && isOwner ? `<button onclick="cancelWonDeal('${d.id}')" class="deal-act is-danger">Cancel order</button>` : ''}
            <button onclick="setTinDeal('${d.id}')" class="deal-act">Add TIN</button>
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

function sendFollowUpDeal(dealId) {
  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, { action: 'SEND_FOLLOW_UP' }, `Follow-up sent on #${dealId}!`);
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
  const sku = skuSelect?.value || 'ACN-DAI-15';
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
  const isOwner = currentRole === 'OWNER';
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
            ${isOwner ? `<button onclick="promptReassignCustomer('${escapeHtmlText(c.name)}')" class="deal-act">Reassign</button>` : ''}
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

function promptReassignCustomer(customerName) {
  const st = getState();
  const reps = st.reps || [];
  if (!reps.length) { showToast('There are no sales reps yet. Add one on the Commission page.'); return; }
  // Find the rep the customer's deals currently belong to
  const d = (st.deals || []).find(x => x.customer === customerName);
  const fromRepId = d ? d.repId : 1;
  const firstOther = reps.find(r => r.id !== fromRepId) || reps[0];
  askForm({
    title: `Reassign ${customerName}`,
    message: 'Their open deals move to the rep you pick.',
    okText: 'Reassign',
    fields: [
      { name: 'repId', label: 'New rep', type: 'select', value: firstOther.id, required: true,
        options: reps.map(r => ({ value: r.id, label: r.id === fromRepId ? `${r.name} (current)` : r.name })) }
    ]
  }, v => {
    const targetRep = reps.find(r => String(r.id) === String(v.repId));
    if (!targetRep) { showToast('Pick a rep from the list.'); return; }
    backendAction(`/api/reps/${fromRepId}/reassign`, {
      toRepId: targetRep.id
    }, `Reassigned open deals for ${customerName} to ${targetRep.name}!`);
  });
}

function addCustomerPrompt() {
  askForm({
    title: 'Add a customer',
    okText: 'Add customer',
    fields: [
      { name: 'name', label: 'Customer or company name', required: true, requiredMsg: 'Enter a name.', placeholder: 'e.g. Tan Bros Trading' },
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
      { name: 'name', label: 'Rep name', required: true, requiredMsg: 'Enter a name.', placeholder: 'e.g. Siti' },
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
