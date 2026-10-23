// =========================================================================
// AGENT PROMPT INSPECTOR ("See agent prompts" in Settings)
// Shows the exact prompt and output the backend returned for the last call; nothing is made up here.
// =========================================================================
let currentInspectorAgent = 'whatsapp';
const agentInspectorData = {
  whatsapp: {
    title: '🤖 WhatsApp sales copilot (/api/whatsapp/analyze)',
    rules: '• Quotes only from the price list (code prices every RM amount) · Never shows costs, margin % or stock counts · Adds "subject to stock availability · prices valid 7 days" · Polite decline on "no" · Malaysian business tone',
    prompt: '',
    output: ''
  },
  company: {
    title: '💼 Ask AI about the pipeline (/api/agent/ask)',
    rules: '• Live data: deals by stage, reps and commission, follow-ups due, price list · Owner sees the whole team, Staff their own deals · Never sees unit costs or margin %',
    prompt: '',
    output: ''
  }
};

function switchInspectorAgent(agentKey) {
  currentInspectorAgent = agentKey;
  Object.keys(agentInspectorData).forEach(t => {
    const btn = document.getElementById('agent-tab-' + t);
    if (!btn) return;
    btn.className = t === agentKey
      ? 'px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0152FC] text-white shadow-xs transition'
      : 'px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-[#042970] hover:bg-[#E6EEFF] border border-[#D5DFEE] transition';
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
  if (inEl) inEl.textContent = data.prompt || '(Analyse a chat or ask a question to see the prompt the backend sent)';
  const outEl = document.getElementById('llm-output-preview');
  if (outEl) outEl.textContent = data.output || '(No answer yet)';
}

// Keeps "Rules the AI follows" showing the backend's value (unless the Owner is typing in it).
function updatePromptPreview() {
  const fwEl = document.getElementById('owner-framework-input');
  if (fwEl && document.activeElement !== fwEl) fwEl.value = getState().framework || '';
}

window.agentInspectorData = agentInspectorData;
window.updatePromptPreview = updatePromptPreview;
window.renderAgentInspector = renderAgentInspector;
window.switchInspectorAgent = switchInspectorAgent;
