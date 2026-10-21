// =========================================================================
    // TEAM & PERMISSIONS (SETTINGS) + OWNER APPROVALS (DASHBOARD)
    // The backend enforces every rule; this file only shows and edits them.
    // =========================================================================
    let permissionDraft = {};      // action key -> mode the Owner picked but has not saved yet
    let permissionThresholdDraft = null;
    let holdHoursDraft = null;

    function escapeHtmlText(text) {
      return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const modePillClass = {
      ALLOW: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      APPROVAL: 'bg-amber-100 text-amber-900 border-amber-300',
      DENY: 'bg-slate-200 text-slate-700 border-slate-300'
    };

    function renderApprovalsCard() {
      const card = document.getElementById('ov-approvals-card');
      if (!card) return;
      const list = usesBackend() ? backendApprovals : [];
      if (!list.length) {
        card.classList.add('hidden');
        return;
      }
      card.classList.remove('hidden');
      const pending = list.filter(a => a.status === 'PENDING');
      const isOwner = currentRole === 'OWNER';
      document.getElementById('ov-approvals-count').textContent = `${pending.length} waiting`;
      document.getElementById('ov-approvals-sub').textContent = isOwner
        ? 'Staff requests that need your decision. Approving runs the action exactly as requested.'
        : 'Your requests waiting for the Owner. You will see the decision here.';

      const statusPill = {
        PENDING: '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-bold">⏳ Waiting for Owner</span>',
        APPROVED: '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">✅ Approved</span>',
        REJECTED: '<span class="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold">❌ Rejected</span>',
        FAILED: '<span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-xs font-bold">⚠️ Could not run</span>'
      };

      const rows = [...pending, ...list.filter(a => a.status !== 'PENDING').slice(0, 4)];
      document.getElementById('ov-approvals-list').innerHTML = rows.map(a => `
        <div class="p-3 rounded-xl border ${a.status === 'PENDING' ? 'border-amber-300 bg-amber-50' : 'border-[#D5DFEE] bg-[#F8FAFC]'} flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs font-bold text-[#042970]">#AP-${a.id} · ${escapeHtmlText(a.summary)}</div>
            <div class="text-xs text-[#64748B]">
              Requested by ${a.requestedBy === 'STAFF' ? 'Aina (Staff)' : escapeHtmlText(a.requestedBy)} · ${escapeHtmlText(a.createdAt)} · Why: ${escapeHtmlText(a.reason)}
              ${a.decisionNote ? ` · Note: ${escapeHtmlText(a.decisionNote)}` : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${a.status === 'PENDING' && isOwner ? `
              <button onclick="decideApproval(${a.id}, 'APPROVE')" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">✅ Approve</button>
              <button onclick="decideApproval(${a.id}, 'REJECT')" class="px-3.5 py-1.5 rounded-lg bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold">❌ Reject</button>
            ` : statusPill[a.status] || ''}
          </div>
        </div>
      `).join('');
    }

    function decideApproval(id, decision) {
      const req = backendApprovals.find(a => a.id === id);
      if (!req) return;
      if (decision === 'REJECT') {
        const note = prompt(`Reject #AP-${id}: "${req.summary}"?\n\nOptional note for Staff:`, '');
        if (note === null) return;
        backendAction(`/api/approvals/${id}/decide`, { decision, note }, `Rejected #AP-${id}. Nothing was changed.`);
        return;
      }
      askUserConfirm(
        `Approve Staff Request #AP-${id}`,
        `${req.summary}\n\nReason it needed you: ${req.reason}\n\nApproving runs this action now as the Owner.`,
        () => backendAction(`/api/approvals/${id}/decide`, { decision }, `Approved #AP-${id} and ran it.`),
        '✅ Approve & Run'
      );
    }

    function renderTeamPermissions() {
      const box = document.getElementById('team-perms-body');
      if (!box) return;
      if (!usesBackend() || !backendPermissions) {
        box.innerHTML = `<div class="text-xs text-[#64748B]">Team & Permissions apply to the live Sejuk Jaya profile stored in the backend. Switch to the Air-cond profile with the backend running (python run_server.py).</div>`;
        return;
      }
      const p = backendPermissions;
      const isOwner = currentRole === 'OWNER';
      const groups = [...new Set(p.actions.map(a => a.group))];
      const threshold = permissionThresholdDraft ?? p.threshold;
      const holdHours = holdHoursDraft ?? p.holdHours;
      const changedCount = Object.keys(permissionDraft).length + (permissionThresholdDraft !== null ? 1 : 0) + (holdHoursDraft !== null ? 1 : 0);

      box.innerHTML = `
        ${isOwner ? '' : `<div class="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold">🔒 Only the Owner can change permissions. You are viewing what Staff are allowed to do.</div>`}

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
          ${groups.map(g => `
            <div class="bg-white rounded-xl border border-[#D5DFEE] p-3">
              <div class="text-xs font-bold uppercase tracking-wide text-[#0152FC] mb-2">${escapeHtmlText(g)}</div>
              <div class="space-y-2">
                ${p.actions.filter(a => a.group === g).map(a => {
                  const mode = permissionDraft[a.key] || a.mode;
                  const changed = permissionDraft[a.key] && permissionDraft[a.key] !== a.mode;
                  return `
                    <div class="flex items-center justify-between gap-2 ${changed ? 'bg-blue-50 -mx-1.5 px-1.5 py-1 rounded-lg' : ''}">
                      <div class="min-w-0">
                        <div class="text-xs font-semibold text-[#042970]">${escapeHtmlText(a.label)}</div>
                        ${a.note ? `<div class="text-[11px] text-[#64748B]">🔒 ${escapeHtmlText(a.note)}</div>` : ''}
                      </div>
                      <select onchange="setPermissionDraft('${a.key}', this.value)" ${isOwner ? '' : 'disabled'}
                        class="shrink-0 border rounded-lg px-2 py-1 text-xs font-bold ${modePillClass[mode]} ${isOwner ? 'cursor-pointer' : 'opacity-80 cursor-not-allowed'}">
                        ${a.modes.map(m => `<option value="${m}" ${m === mode ? 'selected' : ''}>${escapeHtmlText(p.modeLabels[m])}</option>`).join('')}
                      </select>
                    </div>`;
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-[#D5DFEE] p-3">
          <label class="text-xs font-semibold text-[#042970] flex items-center gap-2">
            💰 Staff money-out approval threshold: RM
            <input type="number" min="0" step="100" value="${threshold}" ${isOwner ? '' : 'disabled'}
              onchange="permissionThresholdDraft = Math.max(0, parseInt(this.value || '0', 10)); renderTeamPermissions();"
              class="w-24 bg-[#F2F6FF] border border-[#D5DFEE] rounded-lg px-2 py-1 text-xs font-bold text-[#042970]" />
          </label>
          <label class="text-xs font-semibold text-[#042970] flex items-center gap-2">
            ⏳ Quote holds stock for
            <input type="number" min="1" max="720" step="1" value="${holdHours}" ${isOwner ? '' : 'disabled'}
              onchange="holdHoursDraft = Math.max(1, parseInt(this.value || '48', 10)); renderTeamPermissions();"
              class="w-16 bg-[#F2F6FF] border border-[#D5DFEE] rounded-lg px-2 py-1 text-xs font-bold text-[#042970]" /> hours
          </label>
          ${isOwner ? `
            <div class="flex gap-2">
              <button onclick="resetPermissionDraftToDefaults()" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#D5DFEE] text-[#042970] text-xs font-bold">↺ Defaults</button>
              <button onclick="savePermissions()" ${changedCount ? '' : 'disabled'}
                class="px-4 py-1.5 rounded-lg text-xs font-bold ${changedCount ? 'bg-[#0152FC] hover:bg-[#0141C9] text-white' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}">
                💾 Save ${changedCount ? `(${changedCount} change${changedCount > 1 ? 's' : ''})` : 'Permissions'}
              </button>
            </div>` : ''}
        </div>

        ${isOwner ? `
          <div class="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-dashed border-[#0152FC]/40 p-3">
            <div class="text-xs text-[#042970]"><b>🕒 Demo clock:</b> pretend time has passed so you can show a quote hold expiring and its stock coming back.</div>
            <div class="flex gap-2">
              <button onclick="fastForwardHolds(24)" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#0152FC]/40 text-[#0152FC] text-xs font-bold">⏩ +24h</button>
              <button onclick="fastForwardHolds(48)" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#0152FC]/40 text-[#0152FC] text-xs font-bold">⏩ +48h</button>
            </div>
          </div>` : ''}

        <details class="bg-white rounded-xl border border-[#D5DFEE] p-3">
          <summary class="text-xs font-bold text-[#042970] cursor-pointer">🛡️ Mandatory safety rules (always on, cannot be changed)</summary>
          <ul class="mt-2 space-y-1 text-xs text-[#324564] list-disc pl-5">
            ${p.mandatoryRules.map(r => `<li>${escapeHtmlText(r)}</li>`).join('')}
          </ul>
          <div class="mt-2 text-xs text-[#64748B]"><b>Owner only:</b> ${p.ownerOnly.map(escapeHtmlText).join(' · ')}</div>
        </details>
      `;
    }

    function setPermissionDraft(key, mode) {
      const current = backendPermissions.actions.find(a => a.key === key);
      if (current && current.mode === mode) {
        delete permissionDraft[key];
      } else {
        permissionDraft[key] = mode;
      }
      renderTeamPermissions();
    }

    function resetPermissionDraftToDefaults() {
      permissionDraft = {};
      backendPermissions.actions.forEach(a => {
        if (a.mode !== a.default) permissionDraft[a.key] = a.default;
      });
      permissionThresholdDraft = backendPermissions.threshold !== 1000 ? 1000 : null;
      holdHoursDraft = backendPermissions.holdHours !== 48 ? 48 : null;
      renderTeamPermissions();
    }

    async function savePermissions() {
      const body = { staffModes: { ...permissionDraft } };
      if (permissionThresholdDraft !== null) body.threshold = permissionThresholdDraft;
      if (holdHoursDraft !== null) body.holdHours = holdHoursDraft;
      const data = await backendAction('/api/permissions', body, 'Saved Team & Permissions. The change is in the activity log.');
      if (data) {
        permissionDraft = {};
        permissionThresholdDraft = null;
        holdHoursDraft = null;
        renderTeamPermissions();
      }
    }

    function fastForwardHolds(hours) {
      askUserConfirm(
        `Demo: Fast-Forward ${hours}h`,
        `Pretend ${hours} hours have passed for every quote hold?\n\nQuotes past their hold time expire and their stock goes back to Available to Sell. This is logged.`,
        () => backendAction('/api/demo/fast-forward', { hours }, `⏩ Fast-forwarded ${hours}h. Expired holds released their stock.`),
        `⏩ Fast-Forward ${hours}h`
      );
    }
