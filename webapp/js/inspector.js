// =========================================================================
    // MULTI-AGENT PROMPT & LOGIC INSPECTOR STATE & FUNCTIONS
    // =========================================================================
    let currentInspectorAgent = 'whatsapp';
    const agentInspectorData = {
      whatsapp: {
        title: '🤖 WhatsApp SME Copilot Agent (/api/whatsapp/analyze)',
        rules: '• Strict Owner Rules: Never reveal internal stock count ("Available: X") · Never say "deducted stock" or "locked stock" · Graceful decline on "no" · Natural Malaysian merchant tone',
        prompt: '',
        output: ''
      },
      company: {
        title: '💼 Company Financial & Inventory AI Agent (/api/agent/ask)',
        rules: '• Live Data: Dynamic Cash on Hand + Physical Stock Valuation · Active 48h hold monitor · Unpaid debtor invoices & supplier bills',
        prompt: '',
        output: ''
      },
      ocr: {
        title: '📄 Receipt & Invoice OCR Agent (Stage 1 Direct PDF Decoded)',
        rules: '• Rules: Extract PayNet DuitNow Ref ID, Amount, Recipient TIN · Compare deposit with quotation total · Flag RM shortfalls',
        prompt: `=== STAGE 1 DIRECT PDF RECEIPT OCR SYSTEM PROMPT ===
Decode incoming DuitNow / Supplier Bill PDF text:
- Reference ID (e.g. DN-20261117-88412)
- Recipient Name & TIN matching SME profile
- Paid Amount vs Invoice Target Amount
- Status: VERIFIED vs SHORT_PAYMENT_FLAG`,
        output: `{
  "status": "VERIFIED_DUITNOW",
  "ref": "DN-20261117-88412",
  "matchedCompany": true,
  "amountClaimed": 2200,
  "amountTarget": 2400,
  "variance": -200,
  "action": "STAGE_FOR_BANK_VERIFY"
}`
      },
      autoguard: {
        title: '🛡️ Auto-Guard & Debt Chasing Agent',
        rules: '• Rules: Detect defect / leaking / aftersales complaints · Automatically pause payment chasing on affected invoice · Prevent debt chasing during customer disputes',
        prompt: `=== AUTO-GUARD REMINDER SYSTEM PROMPT ===
Analyze customer WhatsApp thread for defects/complaints:
- Trigger tokens: "leak", "rosak", "faulty", "bocor", "problem", "bug", "defect"
- Action: PAUSE payment reminder cron on invoice
- Set status: AFTERSALES_PAUSED`,
        output: `{
  "guardAction": "AUTO_PAUSE_REMINDERS",
  "invoiceTarget": "INV-201",
  "reason": "Customer reported leaking valve",
  "reminderStatus": "PAUSED_UNTIL_REPLACED"
}`
      }
    };

    function switchInspectorAgent(agentKey) {
      currentInspectorAgent = agentKey;
      const tabs = ['whatsapp', 'company', 'ocr', 'autoguard'];
      tabs.forEach(t => {
        const btn = document.getElementById('agent-tab-' + t);
        if (btn) {
          if (t === agentKey) {
            btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0152FC] text-white shadow-xs transition';
          } else {
            btn.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-[#042970] hover:bg-[#E6EEFF] border border-[#D5DFEE] transition';
          }
        }
      });
      renderAgentInspector();
    }

    function renderAgentInspector() {
      const data = agentInspectorData[currentInspectorAgent];
      if (!data) return;
      const titleEl = document.getElementById('inspector-agent-title');
      if (titleEl) titleEl.textContent = data.title;
      const rulesEl = document.getElementById('inspector-agent-rules');
      if (rulesEl) rulesEl.textContent = data.rules;
      const inEl = document.getElementById('llm-input-preview');
      if (inEl) inEl.textContent = data.prompt || '(Select a chat, simulate an action, or ask a question to view live agent prompt)';
      const outEl = document.getElementById('llm-output-preview');
      if (outEl) outEl.textContent = data.output || '(Awaiting LLM generation...)';
    }

    // =========================================================================
    // SETTINGS & AI LABOR PRESETS
    // =========================================================================
    function updatePromptPreview(chat) {
      const st = getState();
      if (!chat) return;
      const cleanCust = typeof cleanCustomerName === 'function' ? cleanCustomerName(chat.customer) : (chat.customer || 'Boss');
      const fwEl = document.getElementById('owner-framework-input');
      if (fwEl && document.activeElement !== fwEl) {
        fwEl.value = st.framework || '';
      }
      const catLines = (st.stock || []).map(s =>
        `- [SKU: ${s.sku}] ${s.name} | Cost: RM ${s.unitCost} | Sell: RM ${s.sellPrice} | Avail: ${s.onHand}`
      ).join('\n');

      const mem = chat.memory || {
        tier: 'Standard Client',
        score: 75,
        totalOrders: 1,
        totalPaidRM: 0,
        notes: ['Direct communication via WhatsApp'],
        timeline: []
      };

      const learnedNotesStr = (mem.notes || []).map(n => `    ${n}`).join('\n');
      const recentHistoryStr = (mem.timeline || []).slice(0, 3).map(t => `    [${t.time}] ${t.note}`).join('\n');
      const threadTurnsStr = (chat.messages || []).map(m =>
        `${m.from === 'staff' ? 'ASSISTANT' : 'CUSTOMER'}: "${m.text}"`
      ).join('\n');

      const inputStr = `=== CASHCHASE DYNAMIC PROMPT (qwen3:4b / SME Copilot) ===
COMPANY: ${st.name}
INDUSTRY_PRESET: ${currentSME.toUpperCase()}
USER_ROLE: ${currentRole}

[LIVE CATALOGUE & INVENTORY]
${catLines}

[OWNER PRICING & LABOR RULES]
${st.framework}

[CRITICAL SME NEGATIVE CONSTRAINTS]:
1. NEVER tell customer internal stock counts ("Available: X", "stock is back in pool", "stock is free again")
2. NEVER say "deducted stock", "remove stock", "locked stock", or "lock units"
3. Polite, zero-pressure decline if customer says "no", "cancel", "not now"
4. Keep replies 1-2 sentences in natural Malaysian business tone

[PERSISTENT CLIENT MEMORY: ${cleanCust}]
- Relationship Tier: ${mem.tier} (Trust Score: ${mem.score}/100)
- Verified Purchases: ${mem.totalOrders} past orders (RM ${(mem.totalPaidRM || 0).toLocaleString()} paid)
- Learned Preferences & Habits:
${learnedNotesStr || '  • No special conditions recorded.'}
- Recent Interaction Memory:
${recentHistoryStr || '  • New inquiry session started.'}

[MULTI-TURN WHATSAPP THREAD (CONVERSATION HISTORY)]
${threadTurnsStr}`;

      const outputObj = {
        intent: chat.extActionType,
        confidence: 0.96,
        stockEffect: chat.extActionType === 'CREATE_QUOTE_HOLD' ? 'HOLD_ONLY_48H' : (chat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT' ? 'ALLOCATE_STOCK_OR_CAPACITY' : 'STATUS_ONLY'),
        clientTierUsed: mem.tier,
        trustScoreUsed: mem.score,
        draftWhatsAppReply: chat.extDraft,
        replyOptions: chat.replyOptions || []
      };

      agentInspectorData.whatsapp.prompt = inputStr;
      agentInspectorData.whatsapp.output = JSON.stringify(outputObj, null, 2);
      if (currentInspectorAgent === 'whatsapp') {
        renderAgentInspector();
      }
    }

window.agentInspectorData = agentInspectorData;
window.updatePromptPreview = updatePromptPreview;
window.renderAgentInspector = renderAgentInspector;
window.switchInspectorAgent = switchInspectorAgent;
