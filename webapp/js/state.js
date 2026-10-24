let currentRole = 'OWNER';

    // Text from customers, the AI, uploads or the backend goes through this before it is put into innerHTML.
    function escapeHtmlText(text) {
      return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    let currentChatIndex = 0;
    let currentInvFilter = 'ALL';
    let currentPage = 'overview';
    let currentVerifyInvId = null;
    let pendingUniversalConfirmFn = null;

    function askUserConfirm(title, message, onConfirmCallback, okBtnText = '✅ Yes, Confirm & Proceed', isDanger = false, withNote = false) {
      document.getElementById('uconf-title').textContent = title;
      document.getElementById('uconf-note-wrap').classList.toggle('hidden', !withNote);
      document.getElementById('uconf-note').value = '';
      document.getElementById('uconf-message').textContent = message;
      const okBtn = document.getElementById('uconf-ok-btn');
      if (okBtn) {
        okBtn.textContent = okBtnText;
        okBtn.className = isDanger
          ? 'cc-btn bg-red-600 hover:bg-red-700 text-white'
          : 'cc-btn cc-btn-primary';
      }
      pendingUniversalConfirmFn = onConfirmCallback;
      document.getElementById('universal-confirm-modal').classList.remove('hidden');
    }

    function closeUniversalConfirm() {
      document.getElementById('universal-confirm-modal').classList.add('hidden');
      pendingUniversalConfirmFn = null;
    }

    function proceedUniversalConfirm() {
      const fn = pendingUniversalConfirmFn;
      const note = document.getElementById('uconf-note').value.trim();
      closeUniversalConfirm();
      if (typeof fn === 'function') {
        fn(note);
      }
    }

    // ---------------------------------------------------------------------
    // FORM DIALOG
    // One in-app dialog for every "ask for a few details" step. It replaces the browser's prompt(),
    // which many browsers and embedded views block (it then returns null and the button looks dead).
    //
    //   askForm({ title, message, okText, isDanger, fields: [
    //     { name, label, type: 'text'|'number'|'textarea'|'select', value, placeholder, hint, required,
    //       requiredMsg, min, max, step, options: [{ value, label }], chips: ['quick', 'picks'] }
    //   ] }, values => ...)
    //
    // `values` holds trimmed strings; number fields give a number, or null when left empty.
    // Required fields and number limits are checked inline, and the dialog stays open until they pass.
    // ---------------------------------------------------------------------
    let pendingForm = null;
    let formReturnFocus = null;

    function formFieldHtml(f) {
      const id = `form-field-${f.name}`;
      const describedBy = [f.hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' ');
      const common = `id="${id}" name="${f.name}" class="cc-input" aria-describedby="${describedBy}"${f.required ? ' aria-required="true"' : ''}`;
      const value = escapeHtmlText(String(f.value ?? ''));
      const placeholder = escapeHtmlText(f.placeholder || '');
      let control;
      if (f.type === 'select') {
        control = `<select ${common}>${(f.options || []).map(o =>
          `<option value="${escapeHtmlText(String(o.value))}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${escapeHtmlText(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        control = `<textarea ${common} rows="3" maxlength="500" placeholder="${placeholder}">${value}</textarea>`;
      } else if (f.type === 'number') {
        control = `<input ${common} type="number" inputmode="decimal" step="${f.step ?? 'any'}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''} value="${value}" placeholder="${placeholder}" autocomplete="off" />`;
      } else {
        control = `<input ${common} type="text" maxlength="200" value="${value}" placeholder="${placeholder}" autocomplete="off" />`;
      }
      const chips = (f.chips || []).length
        ? `<div class="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Quick picks">${f.chips.map(c =>
            `<button type="button" class="cc-chip !min-h-[30px] !text-xs" data-fill="${id}" data-value="${escapeHtmlText(c)}">${escapeHtmlText(c)}</button>`).join('')}</div>`
        : '';
      return `
        <div>
          <label for="${id}" class="cc-label">${escapeHtmlText(f.label)}${f.required ? '' : ' <span class="font-normal text-[#5B6B85]">(optional)</span>'}</label>
          ${control}
          ${chips}
          ${f.hint ? `<p id="${id}-hint" class="text-xs text-[#5B6B85] mt-1">${escapeHtmlText(f.hint)}</p>` : ''}
          <p id="${id}-error" class="login-error" hidden></p>
        </div>`;
    }

    function askForm(config, onSubmit) {
      const { title, message = '', fields = [], okText = 'Save', isDanger = false } = config;
      formReturnFocus = document.activeElement;
      document.getElementById('form-title').textContent = title;
      const msg = document.getElementById('form-message');
      msg.textContent = message;
      msg.classList.toggle('hidden', !message);
      document.getElementById('form-fields').innerHTML = fields.map(formFieldHtml).join('');
      const ok = document.getElementById('form-ok-btn');
      ok.textContent = okText;
      ok.className = isDanger ? 'cc-btn bg-red-600 hover:bg-red-700 text-white' : 'cc-btn cc-btn-primary';
      pendingForm = { fields, onSubmit };
      const modal = document.getElementById('form-modal');
      modal.classList.remove('hidden');
      setTimeout(() => {
        const first = modal.querySelector('#form-fields input, #form-fields select, #form-fields textarea');
        if (!first) return;
        first.focus();
        if (typeof first.select === 'function' && first.tagName !== 'SELECT') first.select();
      }, 50);
    }

    function closeForm() {
      document.getElementById('form-modal').classList.add('hidden');
      pendingForm = null;
      if (formReturnFocus && document.contains(formReturnFocus)) formReturnFocus.focus();
      formReturnFocus = null;
    }

    function submitForm(event) {
      event.preventDefault();
      if (!pendingForm) return;
      const { fields, onSubmit } = pendingForm;
      const values = {};
      let firstBad = null;
      fields.forEach(f => {
        const id = `form-field-${f.name}`;
        const el = document.getElementById(id);
        const raw = (el.value || '').trim();
        let problem = '';
        if (!raw) {
          if (f.required) problem = f.requiredMsg || 'This is required.';
          values[f.name] = f.type === 'number' ? null : '';
        } else if (f.type === 'number') {
          const n = parseFloat(raw.replace(/,/g, ''));
          if (isNaN(n)) problem = 'Enter a number.';
          else if (f.min !== undefined && n < f.min) problem = `Enter ${f.min} or more.`;
          else if (f.max !== undefined && n > f.max) problem = `Enter ${f.max} or less.`;
          else values[f.name] = n;
        } else {
          values[f.name] = raw;
        }
        const err = document.getElementById(`${id}-error`);
        err.textContent = problem;
        err.hidden = !problem;
        el.classList.toggle('is-invalid', !!problem);
        el.setAttribute('aria-invalid', problem ? 'true' : 'false');
        if (problem && !firstBad) firstBad = el;
      });
      if (firstBad) { firstBad.focus(); return; }
      closeForm();
      onSubmit(values);
    }

    // Quick-pick chips fill their field; Escape closes the dialog
    document.addEventListener('click', e => {
      const chip = e.target.closest && e.target.closest('[data-fill]');
      if (!chip) return;
      const input = document.getElementById(chip.dataset.fill);
      if (input) { input.value = chip.dataset.value; input.focus(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('form-modal').classList.contains('hidden')) closeForm();
    });

    // Everything the page shows comes from the backend: GET /api/state and the state each action returns.
    // Nothing here is demo data; with the backend unreachable the pages stay empty (docs/19).
    const appState = {
      name: '',
      preset: '',
      framework: '',
      followUpHours: 0,
      marginFloorPct: 0,
      products: [],
      reps: [],
      deals: [],
      pipeline: {},
      customers: [],
      clientMemories: {},
      logs: [],
      teamSize: 0,
      reengage: [],
      chats: []  // WhatsApp demo page only (demo_chats.js until Phase 3)
    };

    function getState() {
      return appState;
    }

    let toastHideTimer = null;
    function showToast(msg) {
      const box = document.getElementById('toast-box');
      if (!box) return;
      document.getElementById('toast-text').textContent = msg;
      box.classList.remove('hidden');
      box.style.opacity = '1';
      if (toastHideTimer) clearTimeout(toastHideTimer);
      toastHideTimer = setTimeout(() => {
        box.style.opacity = '0';
        setTimeout(() => box.classList.add('hidden'), 280);
      }, 2500);
    }


// --- API BASE URL ---
    // The backend serves this page, so talk to whichever port it is on; 8000 only when the file is opened directly.
    window.BACKEND_API_BASE = window.location.protocol.startsWith('http')
      ? window.location.origin
      : 'http://127.0.0.1:8000';
    var BACKEND_API_BASE = window.BACKEND_API_BASE;


// --- BACKEND SYNC ---
    // The active SME profile lives in the backend database (shared with the WhatsApp extension).
    // The Owner switches profile through the backend; the page follows whatever profile the backend has loaded.
    let backendOnline = false;
    let lastBackendSignature = '';
    let backendPresets = {};  // business key -> company name, from GET /api/presets (the seed files)

    function usesBackend() {
      return backendOnline;
    }

    // Copies one /api/state response into appState, field for field. The only place page data is set.
    function applyBackendState(data) {
      if (!data || !data.company) return;
      const presetChanged = appState.preset !== data.company.preset;
      appState.name = data.company.name || '';
      appState.preset = data.company.preset || '';
      appState.framework = data.company.framework || '';
      appState.followUpHours = data.company.followUpHours;
      appState.marginFloorPct = data.company.marginFloorPct;
      appState.products = data.products || [];
      appState.reps = data.reps || [];
      appState.deals = data.deals || [];
      appState.pipeline = data.pipeline || {};
      appState.customers = data.customers || [];
      appState.clientMemories = data.clientMemories || {};
      appState.logs = data.logs || [];
      appState.teamSize = data.teamSize || appState.reps.length;
      appState.reengage = data.reengage || [];
      if (presetChanged) {
        appState.chats = demoChatsFor(appState.preset);
        currentChatIndex = 0;
      }

      backendPermissions = data.permissions || backendPermissions;
      backendApprovals = data.approvals || [];
      backendLogs = data.logs || [];

      // Link each demo chat to its customer's open deal
      appState.chats.forEach(chat => {
        const openDeal = appState.deals.find(d => d.customer === chat.customer && (d.stage === 'QUOTED' || d.stage === 'FOLLOW_UP'));
        if (openDeal) chat.dealId = openDeal.id;
      });

      lastBackendSignature = backendSignature(data);
      renderRoleBadge();
      if (presetChanged) showProfileInUI();
    }

    async function loadPresets() {
      try {
        const res = await fetch(`${BACKEND_API_BASE}/api/presets`);
        if (res.ok) {
          const data = await res.json();
          backendPresets = data.businesses || {};
          window.pricingRulePresets = data.pricingRules || {};
        }
      } catch (err) {
        // backend offline: the business switcher stays empty
      }
      renderBusinessSwitcher();
    }

    function backendSignature(data) {
      return JSON.stringify([
        data.company,
        data.products,
        data.deals,
        data.reps,
        data.pipeline,
        data.reengage,
        data.logs,
        data.permissions,
        data.approvals
      ]);
    }

    let backendPermissions = null;
    let backendApprovals = [];
    let backendLogs = [];

    // Staff mode for one action key: ALLOW | APPROVAL | DENY. The Owner always has ALLOW.
    function staffModeFor(key) {
      if (currentRole === 'OWNER' || !usesBackend() || !backendPermissions) return 'ALLOW';
      const a = backendPermissions.actions.find(x => x.key === key);
      return a ? a.mode : 'ALLOW';
    }

    async function syncFromBackend() {
      try {
        // Say who is asking: Staff get only their own deals, customers and pay (with login on, the server decides)
        const res = await fetch(`${BACKEND_API_BASE}/api/state`, { headers: { "X-CashChase-Role": currentRole } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        backendOnline = true;
        const pill = document.getElementById('backend-status-pill');
        if (pill) {
          pill.className = 'cc-status mt-1 is-ok';
          pill.textContent = 'Backend connected';
        }
        if (!Object.keys(backendPresets).length) loadPresets();
        const signature = backendSignature(data);
        if (signature === lastBackendSignature) return;
        applyBackendState(data);  // re-labels the page if the Owner switched business in another tab
        renderAll();
      } catch (err) {
        backendOnline = false;
        renderBusinessSwitcher();
        const pill = document.getElementById('backend-status-pill');
        if (pill) {
          pill.className = 'cc-status mt-1 is-off';
          pill.textContent = 'Backend offline · run python run_server.py';
        }
      }
    }

    // POSTs one action to the backend, then re-renders from the state it returns.
    async function backendAction(path, body, successMsg) {
      try {
        const res = await fetch(`${BACKEND_API_BASE}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CashChase-Role': currentRole },
          body: JSON.stringify({ role: currentRole, ...body })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(res.status === 403 ? `🔒 ${data.detail}` : `⚠️ ${data.detail || `Backend error (HTTP ${res.status})`}`);
          return null;
        }
        applyBackendState(data.state);
        renderAll();
        if (data.status === 'pending_approval') {
          showToast(`📨 Sent to Owner for approval (${data.reason}). See "Owner Approvals" on the Dashboard.`);
        } else if (successMsg) {
          showToast(typeof successMsg === 'function' ? successMsg(data) : successMsg);
        }
        return data;
      } catch (err) {
        showToast('⚠️ Backend offline — start it with python run_server.py');
        return null;
      }
    }

    // Picks up changes made from the WhatsApp extension. Skips while the user is typing so inputs are not reset.
    setInterval(() => {
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const modalOpen = !document.getElementById('universal-confirm-modal')?.classList.contains('hidden')
        || !document.getElementById('settings-modal')?.classList.contains('hidden');
      if (!typing && !modalOpen) syncFromBackend();
    }, 4000);


// --- PROFILE & FRAMEWORK MANAGEMENT ---
    // Demo role badge. Staff shows the rep the backend links to the Staff login (the only rep in the Staff view).
    function renderRoleBadge() {
      const btn = document.getElementById('role-btn');
      if (!btn || btn.disabled) return;  // real login: auth.js shows the signed-in account
      const owner = currentRole === 'OWNER';
      const rep = !owner && appState.reps.length === 1 ? appState.reps[0].name : '';
      const label = owner ? 'Owner' : (rep ? `${rep} (Staff)` : 'Staff');
      const avatar = document.getElementById('role-avatar');
      avatar.textContent = (owner ? 'Owner' : (rep || 'Staff')).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      avatar.className = owner
        ? 'w-7 h-7 rounded-full bg-[#0152FC] text-white font-bold text-xs flex items-center justify-center'
        : 'w-7 h-7 rounded-full bg-[#042970] text-[#01E3FB] font-bold text-xs flex items-center justify-center';
      document.getElementById('role-name').textContent = label;
      document.getElementById('role-sub').textContent = owner ? 'Click to switch to Staff' : 'Click to switch to Owner';
    }

    function toggleRole() {
      currentRole = currentRole === 'OWNER' ? 'STAFF' : 'OWNER';
      renderRoleBadge();
      showToast(`Switched to the ${currentRole === 'OWNER' ? 'Owner' : 'Staff'} view.`);
      renderAll();
      // Each role gets its own data from the server (Staff only their own), so fetch it again
      if (usesBackend()) syncFromBackend();
    }

    function renderSimulationBar() {
      const container = document.getElementById('sim-buttons-container');
      if (!container) return;
      container.innerHTML = DEMO_SIM_BAR_HTML[appState.preset]
        || `<span class="text-xs text-[#64748B]">No demo chats for this business: use the WhatsApp extension on real chats, or type a customer message below.</span>`;
    }

    // Settings → Active business: the list comes from GET /api/presets (the seed files).
    function renderBusinessSwitcher() {
      const select = document.getElementById('sme-select');
      if (!select) return;
      const options = Object.entries(backendPresets).map(([key, name]) => ({ key, name }));
      if (appState.preset === 'custom') options.push({ key: 'custom', name: `My business · ${appState.name}` });
      select.innerHTML = options.length
        ? options.map(o => `<option value="${escapeHtmlText(o.key)}">${escapeHtmlText(o.name)}</option>`).join('')
        : '<option value="">Backend offline</option>';
      select.value = appState.preset;

      const tiles = document.getElementById('pricing-preset-tiles');
      if (tiles) {
        const rules = Object.entries((window.pricingRulePresets || {}));
        tiles.innerHTML = rules.map(([key, p]) => `
          <button onclick="applyPresetFramework('${escapeHtmlText(key)}')" class="cc-tile !p-3">
            <div class="font-semibold text-sm text-[#0152FC]">${escapeHtmlText(p.label)}</div>
            <div class="text-xs text-[#5B6B85]">${escapeHtmlText(p.hint)}</div>
          </button>`).join('');
      }
    }

    // Settings dropdown: the Owner loads another business's demo data on the server.
    function changeSMEProfile(val) {
      const select = document.getElementById('sme-select');
      if (select) select.value = appState.preset;  // only changes once the backend confirms
      if (!backendOnline || !val || val === appState.preset) return;
      askUserConfirm(
        `Switch business`,
        `Load the demo data for ${backendPresets[val] || val}?\n\nThis replaces the current deals, quotes, reps, approvals and permissions for everyone, including the WhatsApp extension. Only the Owner can do this.`,
        () => backendAction('/api/profile', { preset: val }),
        '🔄 Switch & Load Demo Data'
      );
    }

    // Re-labels the page after the backend reports a different business.
    function showProfileInUI() {
      const fwEl = document.getElementById('owner-framework-input');
      if (fwEl) fwEl.value = appState.framework;
      for (const id of ['sidebar-sme-label', 'top-company-title', 'pdf-company-name']) {
        const el = document.getElementById(id);
        if (el) el.textContent = appState.name;
      }
      renderBusinessSwitcher();
      renderSimulationBar();
      if (appState.chats[0] && typeof triggerLiveAIForChat === 'function') triggerLiveAIForChat(appState.chats[0]);
    }

    // "Rules the AI follows" are a backend setting (/api/settings, Owner only).
    async function saveFrameworkText(text) {
      const data = await backendAction('/api/settings', { framework: text }, 'Saved the rules the AI follows.');
      if (!data) {
        const fwEl = document.getElementById('owner-framework-input');
        if (fwEl) fwEl.value = appState.framework;  // not saved: show what the backend has
      }
    }

    function applyPresetFramework(key) {
      const preset = (window.pricingRulePresets || {})[key];
      if (!preset) return;
      askUserConfirm(
        `Use the "${preset.label}" rules?`,
        `Replace the rules the AI follows with:\n\n${preset.text}`,
        () => saveFrameworkText(preset.text),
        '✅ Use these rules'
      );
    }

    function generateCustomFrameworkFromPrompt() {
      const sentence = document.getElementById('custom-sme-prompt').value.trim();
      if (!sentence) return;
      const generated = `1. ${sentence}\n2. Quote from the price list. Prices are subject to stock availability.`;
      askUserConfirm(
        `Use these rules?`,
        `Replace the rules the AI follows with:\n\n${generated}`,
        () => saveFrameworkText(generated),
        '✨ Use these rules'
      );
    }


// --- CUSTOMER NAME CLEANING ---
    function cleanCustomerName(name) {
      if (!name) return 'Boss';
      const clean = name.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/^[^\w]+|[^\w]+$/g, '').trim();
      return clean || 'Boss';
    }
    window.cleanCustomerName = cleanCustomerName;
