// =========================================================================
// WEBPAGE COMPANY AI AGENT ("ASK ANYTHING ABOUT YOUR BUSINESS")
// =========================================================================
const companyAgentMessages = [
  {
    role: 'ai',
    text: 'Hello Boss! 👋 I am your Orbyte Company AI Copilot. I have live access to your Cash on Hand, Warehouse Stock, 48-Hour Quote Holders, Unverified Receipts, and LHDN TINs. Tap any question chip above or ask me anything!'
  }
];

function openCompanyAgentModal() {
  document.getElementById('company-agent-modal').classList.remove('hidden');
  renderCompanyAgentMessages();
}

function closeCompanyAgentModal() {
  document.getElementById('company-agent-modal').classList.add('hidden');
}

function renderCompanyAgentMessages() {
  const box = document.getElementById('company-agent-messages');
  if (!box) return;
  box.innerHTML = companyAgentMessages.map(m => `
    <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
      <div class="max-w-[88%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs whitespace-pre-wrap ${
        m.role === 'user'
          ? 'bg-[#0152FC] text-white font-semibold'
          : m.loading
            ? 'bg-blue-50 border border-blue-200 text-[#0152FC] animate-pulse'
            : 'bg-[#F2F6FF] border border-[#D5DFEE] text-[#042970]'
      }">${escapeHtmlText(m.text)}</div>
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

function sendCompanyAgentInput() {
  const inputEl = document.getElementById('company-agent-input');
  const q = (inputEl ? inputEl.value : '').trim();
  if (!q) return;
  inputEl.value = '';
  askCompanyAgent(q);
}

function buildLocalCompanyAnswer(q) {
  const st = getState();
  const qLow = q.toLowerCase();
  const stockVal = (st.stock || []).reduce((sum, s) => sum + (s.onHand * s.unitCost), 0);
  const coreNW = (st.cashOnHand || 0) + stockVal;
  const pendingIn = (st.invoices || [])
    .filter(i => i.type === 'PENDING' || i.type === 'AFTERSALES' || i.type === 'PENDING_VERIFY')
    .reduce((sum, i) => sum + i.amount, 0);
  const pendingOut = (st.invoices || [])
    .filter(i => i.type === 'SUPPLIER_COST' && i.status === 'UNPAID_PAYABLE')
    .reduce((sum, i) => sum + i.amount, 0);
  const fullNW = coreNW + pendingIn - pendingOut;

  if (qLow.includes('hold') || qLow.includes('who is holding') || qLow.includes('expired')) {
    const holds = (st.invoices || []).filter(i => i.type === 'QUOTE_HOLD' && i.status !== 'HOLD_RELEASED');
    if (holds.length === 0) {
      return `🎉 Zero units are currently locked on hold! All physical warehouse stock is 100% Available to Sell.`;
    }
    const lines = holds.map(h =>
      `• ${h.id} — 👤 ${h.party} (${h.phone || 'No Phone'}): Holding [${h.itemsText}] worth RM ${h.amount.toLocaleString()} · Status: ${h.holdTimer || h.status}`
    ).join('\n');
    return `⏳ Current 48-Hour Stock Holds (${holds.length} Active/Expired):\n${lines}\n\n💡 Tip: Go to "📦 3. Stock & Holds" to release expired holds or confirm deposits in 1 click.`;
  }

  if (qLow.includes('pending') || qLow.includes('verify') || qLow.includes('overdue') || qLow.includes('action') || qLow.includes('owe')) {
    const actionItems = (st.invoices || []).filter(i =>
      i.type === 'PENDING_VERIFY' || i.type === 'PENDING' || i.type === 'AFTERSALES' || (i.type === 'SUPPLIER_COST' && i.status === 'UNPAID_PAYABLE')
    );
    const lines = actionItems.map(i =>
      `• ${i.id} (${i.party}) — RM ${i.amount.toLocaleString()} [${i.status}]: ${i.itemsText}`
    ).join('\n');
    return `🕵️‍♂️ Items Needing Your Attention (${actionItems.length} records):\n${lines}\n\n💰 Total Receivables to Collect: RM ${pendingIn.toLocaleString()} | Supplier Bills to Pay: RM ${pendingOut.toLocaleString()}.`;
  }

  if (qLow.includes('stock') || qLow.includes('margin') || qLow.includes('profit') || qLow.includes('sku') || qLow.includes('daikin') || qLow.includes('available')) {
    const lines = (st.stock || []).map(s => {
      const avail = Math.max(0, s.onHand - s.onHold);
      const margin = s.sellPrice - s.unitCost;
      const pct = Math.round((margin / s.sellPrice) * 100);
      return `• ${s.sku} (${s.name}): On Hand=${s.onHand}, Held=${s.onHold}, Available=${avail} | Cost: RM ${s.unitCost}, Sell: RM ${s.sellPrice} (Profit: +RM ${margin}/unit · ${pct}%)`;
    }).join('\n');
    return `📦 Live Warehouse Stock & Unit Profit Margins:\n${lines}\n\n💎 Total Physical Stock Value (at cost): RM ${stockVal.toLocaleString()}.`;
  }

  if (qLow.includes('lhdn') || qLow.includes('tin') || qLow.includes('e-invoice') || qLow.includes('einvoice')) {
    const missing = (st.invoices || []).filter(i => (i.lhdn || '').includes('Missing'));
    const ready = (st.invoices || []).filter(i => !(i.lhdn || '').includes('Missing'));
    return `🟢 LHDN e-Invoice Compliance Summary:\n• Ready / Consolidated / Verified TIN: ${ready.length} record(s)\n• Missing Buyer TIN: ${missing.length} record(s) ${missing.length > 0 ? '(' + missing.map(m => `${m.id}: ${m.party}`).join(', ') + ')' : ''}\n\n💡 For walk-in/B2C buyers without a TIN, click "✏️ Key In Buyer TIN" and leave blank to classify under Monthly Consolidated e-Invoice (EI00000000010).`;
  }

  return `📊 Live Financial Snapshot for ${st.name}:\n• 💎 Core Net Worth (Cash + Stock): RM ${coreNW.toLocaleString()}\n  ├─ 💵 Verified Cash on Hand: RM ${(st.cashOnHand || 0).toLocaleString()}\n  └─ 📦 Physical Stock Value: RM ${stockVal.toLocaleString()}\n• 💰 Pending Customer Receivables: +RM ${pendingIn.toLocaleString()}\n• 🚚 Unpaid Supplier Payables: -RM ${pendingOut.toLocaleString()}\n• 🏦 Projected Full Net Worth: RM ${fullNW.toLocaleString()}`;
}

async function askCompanyAgent(questionText) {
  if (!questionText || !questionText.trim()) return;
  const cleanQ = questionText.trim();

  // Push user question
  companyAgentMessages.push({ role: 'user', text: cleanQ });
  // Push live thinking status bubble
  const loadingIdx = companyAgentMessages.length;
  companyAgentMessages.push({
    role: 'ai',
    text: '⚡ Thinking... querying live data & LM Studio (~3–8s)...',
    loading: true
  });
  renderCompanyAgentMessages();

  const localAns = buildLocalCompanyAnswer(cleanQ);

  try {
    const res = await fetch(`${BACKEND_API_BASE}/api/agent/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: cleanQ })
    });

    if (res.ok) {
      const data = await res.json();
      const finalAns = (data.lmstudio_connected && data.answer && !data.answer.includes('Not available'))
        ? data.answer
        : (localAns || data.answer);

      companyAgentMessages[loadingIdx] = {
        role: 'ai',
        text: finalAns,
        loading: false
      };

      if (data.raw_prompt && typeof agentInspectorData !== 'undefined') {
        agentInspectorData.company.prompt = data.raw_prompt;
        agentInspectorData.company.output = data.answer || localAns;
        if (typeof currentInspectorAgent !== 'undefined' && currentInspectorAgent === 'company' && typeof renderAgentInspector === 'function') {
          renderAgentInspector();
        }
      }

      const badge = document.getElementById('agent-lm-badge');
      if (badge) {
        badge.textContent = data.lmstudio_connected
          ? `⚡ Answered by LM Studio (${data.model_used || 'qwen2.5-3b-instruct'})`
          : `🏢 Answered by Live Company Analytics Engine`;
      }
      renderCompanyAgentMessages();
      return;
    }
  } catch (err) {
    console.warn('Backend ask offline, using local answer:', err);
  }

  // Fallback to local snapshot answer
  companyAgentMessages[loadingIdx] = {
    role: 'ai',
    text: localAns,
    loading: false
  };
  renderCompanyAgentMessages();
}
