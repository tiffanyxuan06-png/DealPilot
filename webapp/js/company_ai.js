// =========================================================================
// WEBPAGE COMPANY AI AGENT ("ASK ANYTHING ABOUT YOUR BUSINESS")
// =========================================================================
const companyAgentMessages = [
  {
    role: 'ai',
    text: 'Hello Boss! 👋 I can see your live pipeline: quotes, follow-ups, reps and commission, approvals and LHDN TINs. Tap a question above or ask me anything.'
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

async function askCompanyAgent(questionText) {
  if (!questionText || !questionText.trim()) return;
  const cleanQ = questionText.trim();

  companyAgentMessages.push({ role: 'user', text: cleanQ });
  const loadingIdx = companyAgentMessages.length;
  companyAgentMessages.push({ role: 'ai', text: '⚡ Thinking... reading your live pipeline...', loading: true });
  renderCompanyAgentMessages();

  // The backend answers every question: with the AI model when it is running, from the live data when it is not.
  let text = '⚠️ Could not reach the CashChase backend. Start it with python run_server.py and ask again.';
  try {
    const res = await fetch(`${BACKEND_API_BASE}/api/agent/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CashChase-Role': currentRole },
      body: JSON.stringify({ question: cleanQ, role: currentRole })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      text = data.answer || `⚠️ No answer: ${data.error || 'the AI model did not reply'}.`;

      if (data.raw_prompt && typeof agentInspectorData !== 'undefined') {
        agentInspectorData.company.prompt = data.raw_prompt;
        agentInspectorData.company.output = data.answer || '';
        if (typeof currentInspectorAgent !== 'undefined' && currentInspectorAgent === 'company' && typeof renderAgentInspector === 'function') {
          renderAgentInspector();
        }
      }
      const badge = document.getElementById('agent-lm-badge');
      if (badge) {
        badge.textContent = data.lmstudio_connected
          ? `⚡ Answered by the AI model (${data.model_used || 'LM Studio'})`
          : '🏢 AI offline: answered from your live sales data';
      }
    } else {
      text = `⚠️ ${data.detail || `Backend error (HTTP ${res.status})`}`;
    }
  } catch (err) {
    console.warn('Company agent: backend unreachable', err);
  }

  companyAgentMessages[loadingIdx] = { role: 'ai', text, loading: false };
  renderCompanyAgentMessages();
}
