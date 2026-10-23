// =========================================================================
    // 60-SECOND SETUP (SETTINGS): template OR own stock list -> starting cash -> hold time & threshold
    // =========================================================================
    let onboardingItems = [];
    let onboardingWarnings = [];
    const obForm = { company: '', cash: 0, hold: 48, threshold: 1000 };  // kept across re-renders

    // A business from the setup has no demo chats; give the WhatsApp page one neutral example.
    smeProfiles.custom = {
      name: 'My Business',
      cashOnHand: 0,
      framework: '',
      stock: [],
      invoices: [],
      logs: [],
      customers: [],
      chats: [{
        id: 'chat-custom-1',
        customer: 'New Customer',
        phone: '',
        badge: 'New Inquiry',
        messages: [{ from: 'customer', time: 'Now', text: 'Hi boss, got stock? How much?' }],
        extTitle: '💬 New Customer Inquiry',
        extCheck: 'Type what the customer asked, or use the WhatsApp extension on your real chats.',
        extActionDesc: 'Pick a reply below.',
        extDraft: 'Hi! Thanks for your message. Which item and how many units do you need?',
        selectedReplyIdx: 0,
        replyOptions: [{ label: '💬 Ask what they need', text: 'Hi! Thanks for your message. Which item and how many units do you need?' }],
        extBtnLabel: '💬 Insert Reply',
        extActionType: 'REPLY_ONLY',
        done: false,
        memory: { tier: 'New Client', score: 50, totalOrders: 0, totalPaidRM: 0, notes: [], timeline: [] }
      }]
    };

    function renderOnboarding() {
      const box = document.getElementById('onboarding-body');
      if (!box) return;
      if (!backendOnline) {
        box.innerHTML = `<div class="cc-note cc-note-info"><svg aria-hidden="true"><use href="#i-alert"/></svg><span>Start the backend (<span class="font-mono">python run_server.py</span>) to set up a business.</span></div>`;
        return;
      }
      if (currentRole !== 'OWNER') {
        box.innerHTML = `<div class="cc-note cc-note-warn"><svg aria-hidden="true"><use href="#i-lock"/></svg><span>Only the Owner can set up a business.</span></div>`;
        return;
      }
      const stockValue = onboardingItems.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
      const hasItems = onboardingItems.length > 0;
      box.innerHTML = `
        <div class="cc-box space-y-3">
          <div class="cc-step"><span class="step-num">1</span>Start from a template, or upload your stock list</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button onclick="changeSMEProfile('aircond')" class="cc-tile !p-3 text-left">
              <div class="font-semibold text-[13px] text-[#0152FC]">Air-cond contractor</div>
              <div class="text-xs text-[#5B6B85]">Units, piping, labour</div>
            </button>
            <button onclick="changeSMEProfile('software')" class="cc-tile !p-3 text-left">
              <div class="font-semibold text-[13px] text-[#0152FC]">Software studio</div>
              <div class="text-xs text-[#5B6B85]">Man-days, licences</div>
            </button>
            <button onclick="changeSMEProfile('fnb')" class="cc-tile !p-3 text-left">
              <div class="font-semibold text-[13px] text-[#0152FC]">Wholesale F&amp;B</div>
              <div class="text-xs text-[#5B6B85]">Cartons, delivery</div>
            </button>
          </div>
          <label class="cc-drop flex flex-col sm:flex-row items-center justify-center gap-2 !py-4 cursor-pointer i-hop">
            <svg class="w-5 h-5 text-[#0152FC]" aria-hidden="true"><use href="#i-upload"/></svg>
            <span class="text-[13px] font-semibold text-[#042970]">Upload your stock list</span>
            <span class="text-xs text-[#5B6B85]">.xlsx or .csv · we match SKU, name, qty, cost and price</span>
            <input type="file" accept=".xlsx,.xlsm,.csv" class="sr-only" onchange="previewStockList(this.files[0]); this.value='';" />
          </label>

          ${onboardingWarnings.map(w => `<div class="cc-note cc-note-warn"><svg aria-hidden="true"><use href="#i-alert"/></svg><span>${escapeHtmlText(w)}</span></div>`).join('')}

          ${hasItems ? `
            <div class="cc-table-wrap max-h-60 overflow-y-auto">
              <table class="cc-table">
                <thead><tr>
                  <th class="px-3 py-2">SKU</th><th class="px-3 py-2">Item</th>
                  <th class="px-3 py-2 text-right">Qty</th><th class="px-3 py-2 text-right">Unit cost (RM)</th><th class="px-3 py-2 text-right">Sell price (RM)</th>
                </tr></thead>
                <tbody>
                  ${onboardingItems.map((i, idx) => `
                    <tr class="border-t border-[#EEF2F8]">
                      <td class="px-3 font-mono text-[#042970]">${escapeHtmlText(i.sku)}</td>
                      <td class="px-3 text-[#042970]">${escapeHtmlText(i.name)} ${i.estimated ? '<span class="cc-pill cc-pill-warn ml-1" title="Estimated, please check">Check</span>' : ''}</td>
                      ${['qty', 'unitCost', 'sellPrice'].map(f => `
                        <td class="px-2 text-right"><input type="number" min="0" value="${i[f]}" aria-label="${f === 'qty' ? 'Quantity' : f === 'unitCost' ? 'Unit cost' : 'Sell price'} for ${escapeHtmlText(i.name)}" onchange="onboardingItems[${idx}].${f} = Math.max(0, parseInt(this.value || '0', 10)); renderOnboarding();"
                          class="cc-input cc-input-sm !w-24 text-right" /></td>`).join('')}
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="text-[13px] text-[#042970]"><b>${onboardingItems.length}</b> items · stock value <b>RM ${stockValue.toLocaleString()}</b></div>
          ` : ''}
        </div>

        ${hasItems ? `
          <div class="cc-box space-y-3">
            <div class="cc-step"><span class="step-num">2</span>Your business and today's cash</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label for="ob-company" class="cc-label">Business name</label><input id="ob-company" type="text" value="${escapeHtmlText(obForm.company)}" oninput="obForm.company = this.value" placeholder="e.g. Kedai Hardware Jaya" class="cc-input" /></div>
              <div><label for="ob-cash" class="cc-label">Cash on hand today (RM)</label><input id="ob-cash" type="number" min="0" value="${obForm.cash}" oninput="obForm.cash = this.value" class="cc-input" /></div>
            </div>
            <div class="cc-step pt-1"><span class="step-num">3</span>Your rules</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label for="ob-hold" class="cc-label">A quote holds stock for (hours)</label><input id="ob-hold" type="number" min="1" max="720" value="${obForm.hold}" oninput="obForm.hold = this.value" class="cc-input" /></div>
              <div><label for="ob-threshold" class="cc-label">Staff money-out needs approval above (RM)</label><input id="ob-threshold" type="number" min="0" value="${obForm.threshold}" oninput="obForm.threshold = this.value" class="cc-input" /></div>
            </div>
            <div class="flex flex-wrap justify-end gap-2 pt-1">
              <button onclick="onboardingItems = []; onboardingWarnings = []; renderOnboarding();" class="cc-btn cc-btn-ghost">Start over</button>
              <button onclick="applyOnboarding()" class="cc-btn cc-btn-primary"><svg aria-hidden="true"><use href="#i-check"/></svg>Start CashChase for my business</button>
            </div>
          </div>
        ` : ''}
      `;
    }

    function previewStockList(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await fetch(`${BACKEND_API_BASE}/api/onboarding/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CashChase-Role': currentRole },
            body: JSON.stringify({ role: currentRole, fileName: file.name, fileBase64: reader.result })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            showToast(data.detail || 'Could not read the file.');
            return;
          }
          onboardingItems = data.items;
          onboardingWarnings = data.warnings;
          renderOnboarding();
          showToast(data.items.length ? `Read ${data.items.length} items from ${file.name}. Check them, then fill in steps 2 and 3.` : 'No items found in that file.');
        } catch (err) {
          showToast('Backend offline. Start it with python run_server.py');
        }
      };
      reader.readAsDataURL(file);
    }

    function applyOnboarding() {
      const company = (document.getElementById('ob-company').value || '').trim();
      if (!company) {
        showToast('Enter your business name first.');
        return;
      }
      const setup = {
        companyName: company,
        startingCash: Math.max(0, parseInt(document.getElementById('ob-cash').value || '0', 10)),
        holdHours: Math.max(1, parseInt(document.getElementById('ob-hold').value || '48', 10)),
        threshold: Math.max(0, parseInt(document.getElementById('ob-threshold').value || '1000', 10)),
        items: onboardingItems
      };
      askUserConfirm(
        'Start CashChase for Your Business',
        `${company}: ${setup.items.length} stock items, RM ${setup.startingCash.toLocaleString()} cash on hand, ${setup.holdHours}h quote hold, RM ${setup.threshold.toLocaleString()} approval threshold.\n\nThis replaces the current demo data for everyone, including the WhatsApp extension.`,
        async () => {
          const data = await backendAction('/api/onboarding/apply', setup, `${company} is set up. Stock, cash and rules are live.`);
          if (data) {
            onboardingItems = [];
            onboardingWarnings = [];
            showProfileInUI('custom');
          }
        },
        'Start'
      );
    }
