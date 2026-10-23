// =========================================================================
    // TEAM & PERMISSIONS (SETTINGS) + OWNER APPROVALS (DASHBOARD)
    // The backend enforces every rule; this file only shows and edits them.
    // =========================================================================
    let permissionDraft = {};      // action key -> mode the Owner picked but has not saved yet
    let marginFloorDraft = null;
    let followUpHoursDraft = null;

    // Short labels for the segmented switch; the backend's longer labels are the fallback.
    const modeShortLabel = { ALLOW: 'Allowed', APPROVAL: 'Needs approval', DENY: 'Off' };
    const modeDotColor = { ALLOW: '#12B76A', APPROVAL: '#F79009', DENY: '#98A2B3' };

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
      const countPill = document.getElementById('ov-approvals-count');
      countPill.textContent = pending.length ? `${pending.length} waiting` : 'All decided';
      countPill.className = `cc-pill ${pending.length ? 'cc-pill-warn' : 'cc-pill-ok'}`;
      document.getElementById('ov-approvals-sub').textContent = isOwner
        ? 'Staff requests that need your decision. Approve runs the action exactly as asked.'
        : 'Your requests waiting for the Owner. The decision shows up here.';

      const statusPill = {
        PENDING: '<span class="cc-pill cc-pill-warn"><svg aria-hidden="true"><use href="#i-clock"/></svg>Waiting for Owner</span>',
        APPROVED: '<span class="cc-pill cc-pill-ok"><svg aria-hidden="true"><use href="#i-check"/></svg>Approved</span>',
        REJECTED: '<span class="cc-pill cc-pill-bad"><svg aria-hidden="true"><use href="#i-x"/></svg>Rejected</span>',
        FAILED: '<span class="cc-pill cc-pill-muted"><svg aria-hidden="true"><use href="#i-alert"/></svg>Could not run</span>'
      };

      const rows = [...pending, ...list.filter(a => a.status !== 'PENDING').slice(0, 4)];
      document.getElementById('ov-approvals-list').innerHTML = rows.map(a => `
        <div class="ap-row ${a.status === 'PENDING' ? 'is-pending' : ''}">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-[#042970]">${escapeHtmlText(a.summary)}</div>
            <div class="ap-meta">
              <span class="font-mono">#AP-${a.id}</span>
              <span>${a.requestedBy === 'STAFF' ? 'Aina (Staff)' : escapeHtmlText(a.requestedBy)} · ${escapeHtmlText(a.createdAt)}</span>
              <span>Why: ${escapeHtmlText(a.reason)}</span>
              ${a.decisionNote ? `<span>Note: ${escapeHtmlText(a.decisionNote)}</span>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${a.status === 'PENDING' && isOwner ? `
              <button onclick="decideApproval(${a.id}, 'REJECT')" class="cc-btn cc-btn-danger">Reject</button>
              <button onclick="decideApproval(${a.id}, 'APPROVE')" class="cc-btn cc-btn-primary"><svg aria-hidden="true"><use href="#i-check"/></svg>Approve</button>
            ` : statusPill[a.status] || ''}
          </div>
        </div>
      `).join('');
    }

    function decideApproval(id, decision) {
      const req = backendApprovals.find(a => a.id === id);
      if (!req) return;
      if (decision === 'REJECT') {
        askUserConfirm(
          `Reject Staff Request #AP-${id}`,
          `${req.summary}\n\nReason it needed you: ${req.reason}\n\nRejecting changes nothing. Staff will see your note.`,
          note => backendAction(`/api/approvals/${id}/decide`, { decision, note }, `Rejected #AP-${id}. Nothing was changed.`),
          'Reject request',
          true,
          true
        );
        return;
      }
      askUserConfirm(
        `Approve Staff Request #AP-${id}`,
        `${req.summary}\n\nReason it needed you: ${req.reason}\n\nApproving runs this action now as the Owner.`,
        () => backendAction(`/api/approvals/${id}/decide`, { decision }, `Approved #AP-${id} and ran it.`),
        'Approve and run'
      );
    }

    function renderTeamPermissions() {
      const box = document.getElementById('team-perms-body');
      if (!box) return;
      if (!usesBackend() || !backendPermissions) {
        box.innerHTML = `<div class="cc-note cc-note-info"><svg aria-hidden="true"><use href="#i-alert"/></svg><span>Team &amp; permissions are stored in the backend. Start it with <span class="font-mono">python run_server.py</span> to view or change them.</span></div>`;
        return;
      }
      const p = backendPermissions;
      const isOwner = currentRole === 'OWNER';
      const groups = [...new Set(p.actions.map(a => a.group))];
      const threshold = marginFloorDraft ?? p.marginFloorPct ?? 20.0;
      const holdHours = followUpHoursDraft ?? p.followUpHours ?? 2;
      const changedCount = Object.keys(permissionDraft).length + (marginFloorDraft !== null ? 1 : 0) + (followUpHoursDraft !== null ? 1 : 0);

      box.innerHTML = `
        ${isOwner ? '' : `<div class="cc-note cc-note-warn"><svg aria-hidden="true"><use href="#i-lock"/></svg><span>Only the Owner can change permissions. This is what Staff are allowed to do.</span></div>`}

        <div class="space-y-3">
          ${groups.map(g => `
            <div class="cc-box">
              <div class="cc-eyebrow mb-2">${escapeHtmlText(g)}</div>
              ${p.actions.filter(a => a.group === g).map(a => {
                const mode = permissionDraft[a.key] || a.mode;
                const changed = permissionDraft[a.key] && permissionDraft[a.key] !== a.mode;
                return `
                  <div class="perm-row ${changed ? 'is-changed' : ''}">
                    <div class="perm-label" id="perm-label-${a.key}">
                      <div class="text-[13px] font-semibold text-[#042970]">${escapeHtmlText(a.label)}</div>
                      ${a.note ? `<div class="perm-note"><svg aria-hidden="true"><use href="#i-lock"/></svg>${escapeHtmlText(a.note)}</div>` : ''}
                    </div>
                    <div class="seg" role="radiogroup" aria-labelledby="perm-label-${a.key}">
                      ${a.modes.map(m => `
                        <button type="button" role="radio" aria-checked="${m === mode}" data-mode="${m}"
                          class="seg-btn ${m === mode ? 'is-on' : ''}" ${isOwner ? '' : 'disabled'}
                          title="${escapeHtmlText(p.modeLabels[m] || m)}"
                          onclick="setPermissionDraft('${a.key}', '${m}')"><span class="cc-dot" style="background:${modeDotColor[m] || '#98A2B3'}"></span>${escapeHtmlText(modeShortLabel[m] || p.modeLabels[m] || m)}</button>`).join('')}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          `).join('')}
        </div>

        <div class="cc-box grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="perm-threshold" class="cc-label">Lowest margin allowed (%)</label>
            <input id="perm-threshold" type="number" min="0" max="100" step="1" value="${threshold}" ${isOwner ? '' : 'disabled'}
              onchange="marginFloorDraft = Math.max(0, parseInt(this.value || '0', 10)); renderTeamPermissions();"
              class="cc-input cc-input-sm" />
            <p class="text-xs text-[#5B6B85] mt-1">A discount below this goes to you for approval.</p>
          </div>
          <div>
            <label for="perm-hold" class="cc-label">Follow up a quote after (hours)</label>
            <input id="perm-hold" type="number" min="1" max="720" step="1" value="${holdHours}" ${isOwner ? '' : 'disabled'}
              onchange="followUpHoursDraft = Math.max(1, parseInt(this.value || '48', 10)); renderTeamPermissions();"
              class="cc-input cc-input-sm" />
            <p class="text-xs text-[#5B6B85] mt-1">After this, the quote shows as follow-up due.</p>
          </div>
        </div>

        <details class="cc-box group">
          <summary class="flex items-center justify-between gap-2 cursor-pointer list-none text-[13px] font-semibold text-[#042970]">
            <span class="flex items-center gap-2"><svg class="w-4 h-4 text-[#0152FC]" aria-hidden="true"><use href="#i-shield"/></svg>Safety rules that are always on</span>
            <svg class="w-4 h-4 text-[#5B6B85] transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <ul class="mt-3 space-y-1.5 text-[13px] text-[#324564] list-disc pl-5">
            ${p.mandatoryRules.map(r => `<li>${escapeHtmlText(r)}</li>`).join('')}
          </ul>
          <div class="mt-3 text-[13px] text-[#5B6B85]"><b class="text-[#042970]">Owner only:</b> ${p.ownerOnly.map(escapeHtmlText).join(' · ')}</div>
        </details>

        ${isOwner ? `
          <div class="cc-box flex flex-wrap items-center justify-between gap-3 !border-dashed !border-[#0152FC]/40">
            <div class="flex items-start gap-2 text-[13px] text-[#042970] min-w-0 flex-[1_1_16rem]">
              <svg class="w-4 h-4 mt-0.5 shrink-0 text-[#0152FC]" aria-hidden="true"><use href="#i-clock"/></svg>
              <span><b>Demo clock.</b> Skip ahead to show quotes becoming follow-up due.</span>
            </div>
            <div class="flex gap-2">
              <button onclick="fastForwardHolds(24)" class="cc-btn cc-btn-ghost"><svg aria-hidden="true"><use href="#i-forward"/></svg>+24h</button>
              <button onclick="fastForwardHolds(48)" class="cc-btn cc-btn-ghost"><svg aria-hidden="true"><use href="#i-forward"/></svg>+48h</button>
            </div>
          </div>

          <div class="perm-savebar">
            <span class="text-[13px] ${changedCount ? 'font-semibold text-[#042970]' : 'text-[#5B6B85]'}" aria-live="polite">
              ${changedCount ? `${changedCount} unsaved change${changedCount > 1 ? 's' : ''}` : 'No changes'}
            </span>
            <div class="flex flex-wrap gap-2">
              <button onclick="resetPermissionDraftToDefaults()" class="cc-btn cc-btn-ghost"><svg aria-hidden="true"><use href="#i-undo"/></svg>Use defaults</button>
              <button onclick="savePermissions()" ${changedCount ? '' : 'disabled'} class="cc-btn cc-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"><svg aria-hidden="true"><use href="#i-check"/></svg>Save permissions</button>
            </div>
          </div>` : ''}
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
      marginFloorDraft = backendPermissions.threshold !== 1000 ? 1000 : null;
      followUpHoursDraft = backendPermissions.holdHours !== 48 ? 48 : null;
      renderTeamPermissions();
    }

    async function savePermissions() {
      const body = { staffModes: { ...permissionDraft } };
      if (marginFloorDraft !== null) body.threshold = marginFloorDraft;
      if (followUpHoursDraft !== null) body.holdHours = followUpHoursDraft;
      const data = await backendAction('/api/permissions', body, 'Saved Team & Permissions. The change is in the activity log.');
      if (data) {
        permissionDraft = {};
        marginFloorDraft = null;
        followUpHoursDraft = null;
        renderTeamPermissions();
      }
    }

    function fastForwardHolds(hours) {
      askUserConfirm(
        `Demo: skip ${hours} hours`,
        `Pretend ${hours} hours have passed for every open quote?\n\nQuotes past their follow-up time show as Follow-up due, so reps can send a reminder. This is logged.`,
        () => backendAction('/api/demo/fast-forward', { hours }, `Skipped ${hours}h. Quotes past their follow-up time are now due.`),
        `Skip ${hours}h`
      );
    }
