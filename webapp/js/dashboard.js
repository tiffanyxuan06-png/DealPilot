// =========================================================================
// CASHCHASE SALES CRM DASHBOARD & VIEW CONTROLLER
// Drives 5 core views: Pipeline/My Day, Deals, Catalog, Customers, Commission
// =========================================================================

let currentDealFilter = 'ALL';
let currentDealRepFilter = 'ALL';
let dealSearchQuery = '';

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
    if (overdueEl) overdueEl.textContent = (pipeline.overdue || 0) + ' deals';

    // Stage breakdown cards
    const byStage = pipeline.byStage || {};
    const stages = [
      { key: 'INQUIRY', label: '1. Inquiries', color: 'border-blue-300 bg-blue-50/50' },
      { key: 'QUOTED', label: '2. Quoted (48h)', color: 'border-cyan-300 bg-cyan-50/50' },
      { key: 'FOLLOW_UP', label: '3. Follow-up Due', color: 'border-amber-300 bg-amber-50/50' },
      { key: 'WON', label: '4. Won Orders', color: 'border-emerald-300 bg-emerald-50/50' },
      { key: 'LOST', label: '5. Lost', color: 'border-slate-300 bg-slate-50/50' }
    ];

    const stageContainer = document.getElementById('pipeline-stage-cards');
    if (stageContainer) {
      stageContainer.innerHTML = stages.map(s => {
        const item = byStage[s.key] || { count: 0, valueRm: 0 };
        return `
          <div onclick="filterDealsToStage('${s.key}')" class="cursor-pointer p-4 rounded-xl border ${s.color} hover:shadow-md transition">
            <div class="text-xs font-bold uppercase tracking-wider text-[#5B6B85]">${s.label}</div>
            <div class="text-2xl font-bold text-[#042970] mt-1">${item.count}</div>
            <div class="text-xs font-semibold text-[#0152FC] mt-0.5">RM ${(item.valueRm || 0).toLocaleString()}</div>
          </div>
        `;
      }).join('');
    }

    // At-Risk Deals Section (suggestLost, paused complaint, or 3+ follow-ups)
    const atRiskDeals = deals.filter(d => d.suggestLost || d.paused || (d.followUpCount >= 2 && d.stage !== 'WON' && d.stage !== 'LOST'));
    const atRiskList = document.getElementById('pipeline-at-risk-list');
    if (atRiskList) {
      if (atRiskDeals.length === 0) {
        atRiskList.innerHTML = `<div class="text-xs text-[#5B6B85] p-3 bg-white rounded-lg border border-[#D5DFEE]">🎉 No at-risk deals right now! All quotes are progressing smoothly.</div>`;
      } else {
        atRiskList.innerHTML = atRiskDeals.map(d => `
          <div class="p-3.5 rounded-xl bg-white border border-amber-300 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">${d.id}</span>
                <span class="font-bold text-sm text-[#042970]">${escapeHtmlText(d.customer)}</span>
                <span class="text-xs text-[#5B6B85]">(${d.repName || 'Rep'})</span>
                <span class="font-bold text-xs text-[#0152FC]">· RM ${(d.amount || 0).toLocaleString()}</span>
              </div>
              <div class="text-xs text-amber-900 mt-1">
                ${d.paused ? '⚠️ <b>Paused (Complaint)</b>: ' + escapeHtmlText(d.notes || 'Awaiting resolution') : (d.followUpCount >= 3 ? '⚠️ No reply after 3 follow-ups (Ghost Risk)' : '⏳ Follow-up due')}
              </div>
            </div>
            <div class="flex items-center gap-2">
              ${d.paused
                ? `<button onclick="pauseResumeDeal('${d.id}', false)" class="cc-btn cc-btn-primary !min-h-[32px] !text-xs">Resume Follow-ups</button>`
                : `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary !min-h-[32px] !text-xs">Send Follow-up</button>`}
              <button onclick="markLostDeal('${d.id}')" class="cc-btn cc-btn-ghost !min-h-[32px] !text-xs text-rose-700">Mark Lost</button>
            </div>
          </div>
        `).join('');
      }
    }

    // Reps Leaderboard Snippet
    const repSnippet = document.getElementById('pipeline-reps-snippet');
    if (repSnippet) {
      repSnippet.innerHTML = reps.map((r, idx) => `
        <div class="flex items-center justify-between p-2.5 rounded-lg bg-white border border-[#D5DFEE] text-xs">
          <div class="flex items-center gap-2">
            <span class="w-5 h-5 rounded-full ${idx === 0 ? 'bg-amber-400 text-amber-900 font-bold' : 'bg-slate-200 text-slate-700'} flex items-center justify-center text-[10px] font-bold">${idx + 1}</span>
            <span class="font-bold text-[#042970]">${escapeHtmlText(r.name)}</span>
            <span class="text-[11px] text-[#5B6B85]">(${r.commissionPct}% rate)</span>
          </div>
          <div class="text-right">
            <span class="font-bold text-[#0152FC]">RM ${(r.wonRm || 0).toLocaleString()}</span>
            <span class="text-[11px] text-[#5B6B85] ml-1.5">(RM ${(r.commissionRm || 0).toLocaleString()} comm)</span>
          </div>
        </div>
      `).join('');
    }

    // Owner Activity Log
    const logList = document.getElementById('audit-log-list');
    if (logList) {
      logList.innerHTML = (st.logs || []).map(l => `
        <div class="p-2 rounded-lg bg-[#F8FAFC] border border-[#EEF2F8] text-xs text-[#042970] flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-[#0152FC] shrink-0"></span>
          <span>${escapeHtmlText(l)}</span>
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
        staffFollowList.innerHTML = `<div class="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-semibold">🎉 All caught up! Zero follow-ups overdue today.</div>`;
      } else {
        staffFollowList.innerHTML = myFollowUps.map(d => `
          <div class="p-4 rounded-xl bg-white border border-amber-300 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">${d.id}</span>
                <span class="font-bold text-sm text-[#042970]">${escapeHtmlText(d.customer)}</span>
                <span class="font-bold text-sm text-[#0152FC]">· RM ${(d.amount || 0).toLocaleString()}</span>
              </div>
              <div class="text-xs text-[#5B6B85]">${d.phone || 'WhatsApp'} · ${d.followUpText || 'Follow-up due now'}</div>
            </div>
            <div class="flex items-center gap-2">
              <button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary !min-h-[34px] !text-xs">💬 Send Follow-up</button>
              <button onclick="markWonDeal('${d.id}')" class="cc-btn cc-btn-ghost !min-h-[34px] !text-xs text-emerald-700 font-bold">Mark Won</button>
            </div>
          </div>
        `).join('');
      }
    }

    // Staff Recent Wins
    const staffWinsList = document.getElementById('staff-recent-wins');
    if (staffWinsList) {
      staffWinsList.innerHTML = myWonDeals.slice(0, 4).map(d => `
        <div class="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs">
          <div>
            <span class="font-bold text-[#042970]">${escapeHtmlText(d.customer)}</span>
            <span class="font-mono text-emerald-800 ml-1.5 font-semibold">#${d.orderNo || d.id}</span>
          </div>
          <div class="text-right">
            <span class="font-bold text-emerald-700">RM ${(d.amount || 0).toLocaleString()}</span>
            <span class="text-[11px] text-emerald-800 ml-1">(+RM ${Math.round(d.amount * myRep.commissionPct / 100)} comm)</span>
          </div>
        </div>
      `).join('') || `<div class="text-xs text-[#5B6B85]">No won deals yet this month. Close quotes to earn commission!</div>`;
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
    repSelect.innerHTML = `<option value="ALL">All Sales Reps</option>` +
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
      <div class="p-8 rounded-2xl bg-white border border-[#D5DFEE] text-center space-y-2">
        <div class="text-sm font-bold text-[#042970]">No deals match this filter</div>
        <p class="text-xs text-[#5B6B85]">Try selecting "All" or create a new quote via "Log Inquiry".</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(d => {
    const isWon = d.stage === 'WON';
    const isLost = d.stage === 'LOST';
    const isFollowUp = d.stage === 'FOLLOW_UP';
    const itemsSummary = (d.items || []).map(i => `${i.qty}x ${i.name || i.sku}`).join(', ') || 'Standard Quotation';

    const stagePill = {
      INQUIRY: 'bg-blue-100 text-blue-900 border-blue-300',
      QUOTED: 'bg-cyan-100 text-cyan-900 border-cyan-300',
      FOLLOW_UP: 'bg-amber-100 text-amber-900 border-amber-300',
      WON: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      LOST: 'bg-slate-200 text-slate-700 border-slate-300'
    }[d.stage] || 'bg-slate-100 text-slate-800';

    // Primary action button based on stage
    let primaryBtn = '';
    if (d.stage === 'INQUIRY') {
      primaryBtn = `<button onclick="sendQuoteDeal('${d.id}')" class="cc-btn cc-btn-primary !min-h-[34px] !text-xs">📄 Send Quote</button>`;
    } else if (d.stage === 'QUOTED') {
      primaryBtn = `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary !min-h-[34px] !text-xs">🔔 Follow Up</button>`;
    } else if (d.stage === 'FOLLOW_UP') {
      primaryBtn = `<button onclick="sendFollowUpDeal('${d.id}')" class="cc-btn cc-btn-primary !min-h-[34px] !text-xs">⚡ Send Follow-Up</button>`;
    } else if (isWon) {
      primaryBtn = `<span class="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 font-bold text-xs">✓ Order #${d.orderNo || d.id}</span>`;
    } else if (isLost) {
      primaryBtn = `<span class="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold text-xs">Lost: ${escapeHtmlText(d.lossReason || 'Declined')}</span>`;
    }

    // Margin display: Owner sees %, Staff sees marginOk
    const marginBadge = isOwner
      ? (d.marginOk ? `<span class="text-[11px] font-semibold text-emerald-700">Margin: ${d.marginPct || 25}%</span>` : `<span class="text-[11px] font-bold text-rose-700">Margin: ${d.marginPct || 10}% (Below floor)</span>`)
      : (d.marginOk ? `<span class="text-[11px] font-semibold text-emerald-700">Margin ✓</span>` : `<span class="text-[11px] font-bold text-amber-700">Margin ✗ (Needs Boss)</span>`);

    return `
      <div class="p-4 rounded-xl bg-white border border-[#D5DFEE] flex flex-wrap items-center justify-between gap-4 hover:border-[#0152FC]/40 transition shadow-xs">
        <div class="space-y-1.5 max-w-xl">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono font-bold text-xs px-2.5 py-0.5 rounded ${stagePill}">${d.id}</span>
            <span class="font-bold text-sm text-[#042970]">${escapeHtmlText(d.customer)}</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-[#F2F6FF] border border-[#D5DFEE] text-[#5B6B85]">👤 ${escapeHtmlText(d.repName || 'Rep')}</span>
            ${d.phone ? `<span class="text-xs text-[#5B6B85]">📞 ${escapeHtmlText(d.phone)}</span>` : ''}
            <span class="text-xs text-[#5B6B85]">${d.followUpText || ''}</span>
          </div>
          <div class="text-xs text-[#324564]">${escapeHtmlText(itemsSummary)}</div>
          <div class="flex flex-wrap items-center gap-3 pt-1">
            <button onclick="openPdfForDeal('${d.id}')" class="text-xs font-semibold text-[#0152FC] hover:underline cursor-pointer flex items-center gap-1">
              <svg class="w-3.5 h-3.5"><use href="#i-file"/></svg> Preview PDF
            </button>
            ${!isWon && !isLost ? `
              <button onclick="markWonDeal('${d.id}')" class="text-xs font-bold text-emerald-700 hover:underline cursor-pointer">Mark Won</button>
              <button onclick="discountDeal('${d.id}')" class="text-xs font-semibold text-amber-800 hover:underline cursor-pointer">Apply Discount</button>
              <button onclick="pauseResumeDeal('${d.id}', ${!d.paused})" class="text-xs font-semibold text-slate-600 hover:underline cursor-pointer">${d.paused ? 'Resume' : 'Pause (Complaint)'}</button>
              <button onclick="markLostDeal('${d.id}')" class="text-xs font-semibold text-rose-700 hover:underline cursor-pointer">Mark Lost</button>
            ` : ''}
            ${isWon && isOwner ? `
              <button onclick="cancelWonDeal('${d.id}')" class="text-xs font-semibold text-rose-700 hover:underline cursor-pointer">Cancel Order</button>
            ` : ''}
            <button onclick="setTinDeal('${d.id}')" class="text-xs font-semibold text-[#5B6B85] hover:underline cursor-pointer">Add TIN</button>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <div class="text-right">
            <div class="text-base font-bold text-[#042970]">RM ${(d.amount || 0).toLocaleString()}</div>
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
  const ref = prompt('Enter Bank / DuitNow Transfer Slip Ref (e.g. DN-20261023-889):', 'DN-20261023-889');
  if (ref === null) return;
  const amtStr = prompt('Enter deposit or paid amount (RM):', '1000');
  const depositAmount = amtStr ? parseInt(amtStr.replace(/,/g, ''), 10) : null;

  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'MARK_WON',
    depositRef: ref.trim(),
    depositAmount: depositAmount
  }, `Deal #${dealId} marked WON! Order confirmed.`);
}

function markLostDeal(dealId) {
  const reason = prompt('Choose / enter a reason the deal was lost:\n(e.g. Competitor price, No reply, Timing, Cancelled)', 'Customer declined on WhatsApp');
  if (!reason || !reason.trim()) return;

  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'MARK_LOST',
    reason: reason.trim()
  }, `Deal #${dealId} marked LOST.`);
}

function discountDeal(dealId) {
  const discStr = prompt('Enter discount amount to apply in RM (e.g. 50):', '50');
  if (!discStr) return;
  const discount = parseInt(discStr.replace(/,/g, ''), 10);
  if (isNaN(discount) || discount <= 0) return;

  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'APPLY_DISCOUNT',
    discount: discount
  }, `Discount of RM ${discount} applied to #${dealId}!`);
}

function pauseResumeDeal(dealId, pause) {
  const note = pause ? prompt('Enter complaint / pause reason:', 'Customer reported issue') : '';
  if (pause && note === null) return;

  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: pause ? 'PAUSE' : 'RESUME',
    note: note || ''
  }, `${pause ? 'Paused' : 'Resumed'} follow-ups on #${dealId}.`);
}

function setTinDeal(dealId) {
  const tin = prompt('Enter Buyer LHDN TIN (e.g. C2588190021):', 'C2588190021');
  if (!tin || !tin.trim()) return;

  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'SET_TIN',
    tin: tin.trim()
  }, `Saved LHDN TIN ${tin.trim()} on #${dealId}!`);
}

function cancelWonDeal(dealId) {
  const reason = prompt('Reason for cancelling this won sales order:\n(e.g. Customer returned units, payment bounced)', 'Customer requested cancellation');
  if (!reason || !reason.trim()) return;

  backendAction(`/api/deals/${encodeURIComponent(dealId)}/action`, {
    action: 'CANCEL_WON',
    reason: reason.trim()
  }, `Cancelled won order #${dealId}.`);
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
      <tr class="hover:bg-[#F2F6FF] transition align-top">
        <td class="py-3.5 px-4 font-mono font-bold text-[#0152FC]">${escapeHtmlText(p.sku)}</td>
        <td class="py-3.5 px-4">
          <div class="font-bold text-[#042970]">${escapeHtmlText(p.name)}</div>
          <div class="text-xs text-[#5B6B85] mt-0.5">${escapeHtmlText(specsSummary)}</div>
        </td>
        <td class="py-3.5 px-4 font-bold text-[#042970]">RM ${p.sellPrice.toLocaleString()}</td>
        <td class="py-3.5 px-4 font-semibold text-[#5B6B85]">
          ${isOwner ? 'RM ' + cost.toLocaleString() : '🔒 Owner only'}
        </td>
        <td class="py-3.5 px-4 font-bold ${marginPct >= 15 ? 'text-emerald-700' : 'text-amber-700'}">
          ${isOwner ? `+RM ${margin} (${marginPct}%)` : (marginPct >= 15 ? 'Margin ✓' : 'Margin ✗')}
        </td>
        <td class="py-3.5 px-4 text-right">
          ${isOwner ? `
            <button onclick="openEditProductModal('${p.sku}')" class="text-xs font-bold text-[#0152FC] hover:underline">Edit Price</button>
          ` : `<span class="text-xs text-[#5B6B85]">Active</span>`}
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
    showToast('⚠️ Please enter a valid SKU, Name, and Selling Price.');
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

  tbody.innerHTML = customers.map(c => {
    const isReady = c.lhdnReady || !!c.tin;
    const tinBadge = isReady
      ? `<span class="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">🟢 ${escapeHtmlText(c.tin || 'LHDN Ready')}</span>`
      : `<span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-xs">🟡 Missing Buyer TIN</span>`;

    return `
      <tr class="hover:bg-[#F2F6FF] transition align-middle">
        <td class="py-3 px-4 font-bold text-[#042970]">${escapeHtmlText(c.name)}</td>
        <td class="py-3 px-4 text-[#5B6B85] text-xs font-mono">${escapeHtmlText(c.phone || '-')}</td>
        <td class="py-3 px-4">${tinBadge}</td>
        <td class="py-3 px-4 text-xs font-bold text-[#0152FC]">${c.openRecords || 0} open deal(s)</td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-2">
            <button onclick="promptCustomerTin('${escapeHtmlText(c.name)}')" class="text-xs font-bold text-[#0152FC] hover:underline">
              ${isReady ? 'Update TIN' : '✏️ Key in TIN'}
            </button>
            ${isOwner ? `
              <button onclick="promptReassignCustomer('${escapeHtmlText(c.name)}')" class="text-xs font-semibold text-slate-600 hover:underline">Reassign Rep</button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function promptCustomerTin(customerName) {
  const tin = prompt(`Enter Buyer LHDN TIN for ${customerName} (e.g. C2588190021):`, 'C2588190021');
  if (!tin || !tin.trim()) return;

  // Find latest deal for this customer if any
  const st = getState();
  const d = (st.deals || []).find(x => x.customer === customerName);
  if (d) {
    setTinDeal(d.id);
  } else {
    showToast(`Saved TIN ${tin.trim()} for ${customerName}!`);
  }
}

function promptReassignCustomer(customerName) {
  const st = getState();
  const reps = st.reps || [];
  const repNames = reps.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
  const choice = prompt(`Reassign open deals for ${customerName} to which rep?\n\n${repNames}\n\nEnter rep number (1-${reps.length}):`, '2');
  if (!choice) return;
  const idx = parseInt(choice, 10) - 1;
  const targetRep = reps[idx];
  if (!targetRep) {
    showToast('⚠️ Invalid rep selected.');
    return;
  }

  // Find a rep to move from
  const d = (st.deals || []).find(x => x.customer === customerName);
  const fromRepId = d ? d.repId : 1;
  backendAction(`/api/reps/${fromRepId}/reassign`, {
    toRepId: targetRep.id
  }, `Reassigned open deals for ${customerName} to ${targetRep.name}!`);
}

function addCustomerPrompt() {
  const name = prompt('Enter customer or company name:');
  if (!name || !name.trim()) return;
  const phone = prompt('Enter customer WhatsApp phone (+60...):', '+60 12-345 6789');

  backendAction('/api/customers', {
    name: name.trim(),
    phone: (phone || '').trim()
  }, `Added ${name.trim()} to customer directory!`);
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
    <tr class="hover:bg-[#F2F6FF] transition align-middle">
      <td class="py-3 px-4 font-bold text-[#042970] flex items-center gap-2">
        <span class="w-6 h-6 rounded-full ${idx === 0 ? 'bg-amber-400 text-amber-900 font-bold' : 'bg-slate-200 text-slate-700'} flex items-center justify-center text-xs font-bold">${idx + 1}</span>
        <span>${escapeHtmlText(r.name)}</span>
      </td>
      <td class="py-3 px-4 font-mono font-bold text-[#0152FC]">${r.commissionPct}%</td>
      <td class="py-3 px-4 font-bold text-[#042970]">RM ${(r.wonRm || 0).toLocaleString()}</td>
      <td class="py-3 px-4 font-bold text-emerald-700">RM ${(r.commissionRm || 0).toLocaleString()}</td>
      <td class="py-3 px-4 text-xs font-semibold text-[#5B6B85]">${r.openDeals || 0} active</td>
      <td class="py-3 px-4 text-xs font-semibold ${r.overdue > 0 ? 'text-amber-800 font-bold' : 'text-emerald-700'}">${r.overdue || 0} overdue</td>
      <td class="py-3 px-4 text-right">
        ${isOwner ? `
          <button onclick="promptEditRepRate(${r.id}, '${escapeHtmlText(r.name)}', ${r.commissionPct})" class="text-xs font-bold text-[#0152FC] hover:underline">Change Rate</button>
        ` : `<span class="text-xs text-emerald-700 font-bold">Active</span>`}
      </td>
    </tr>
  `).join('');
}

function promptEditRepRate(repId, repName, currentPct) {
  const newRateStr = prompt(`Update commission rate for ${repName} (%):`, currentPct);
  if (!newRateStr) return;
  const newPct = parseFloat(newRateStr);
  if (isNaN(newPct) || newPct < 0) return;

  backendAction('/api/reps', {
    id: repId,
    name: repName,
    commissionPct: newPct,
    active: true
  }, `Updated ${repName}'s commission to ${newPct}%!`);
}

function promptAddNewRep() {
  const name = prompt('Enter Sales Rep name:');
  if (!name || !name.trim()) return;
  const rateStr = prompt('Enter sales commission percentage (%):', '3.0');
  const rate = rateStr ? parseFloat(rateStr) : 3.0;

  backendAction('/api/reps', {
    name: name.trim(),
    commissionPct: rate,
    active: true
  }, `Added sales rep ${name.trim()} (${rate}% commission)!`);
}

// Master render invoked by main.js
function renderWebAppView() {
  renderPipelineView();
  renderDealsView();
  renderCatalogView();
  renderCustomersView();
  renderCommissionView();
}
