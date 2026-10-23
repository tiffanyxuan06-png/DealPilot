// =========================================================================
    // 60-SECOND SETUP (SETTINGS): template OR price list -> follow-up SLA & margin floor
    // =========================================================================
    let onboardingItems = [];
    let onboardingWarnings = [];
    const obForm = { company: '', followUpHours: 48, marginFloorPct: 20 };

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
      const hasItems = onboardingItems.length > 0;
      box.innerHTML = `
        <div class="cc-box space-y-3">
          <div class="cc-step"><span class="step-num">1</span>Start from a template, or upload your price list</div>
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
            <span class="text-[13px] font-semibold text-[#042970]">Upload your price list</span>
            <span class="text-xs text-[#5B6B85]">.xlsx or .csv · we match SKU, name, unit cost and selling price</span>
            <input type="file" accept=".xlsx,.xlsm,.csv" class="sr-only" onchange="previewStockList(this.files[0]); this.value='';" />
          </label>

          ${onboardingWarnings.map(w => `<div class="cc-note cc-note-warn"><svg aria-hidden="true"><use href="#i-alert"/></svg><span>${escapeHtmlText(w)}</span></div>`).join('')}

          ${hasItems ? `
            <div class="cc-table-wrap max-h-60 overflow-y-auto">
              <table class="cc-table">
                <thead><tr>
                  <th class="px-3 py-2">SKU</th><th class="px-3 py-2">Item</th>
                  <th class="px-3 py-2 text-right">Unit cost (RM)</th><th class="px-3 py-2 text-right">Selling price (RM)</th>
                </tr></thead>
                <tbody>
                  ${onboardingItems.map((i, idx) => `
                    <tr class="border-t border-[#EEF2F8]">
                      <td class="px-3 font-mono text-[#042970]">${escapeHtmlText(i.sku)}</td>
                      <td class="px-3 text-[#042970]">${escapeHtmlText(i.name)}</td>
                      ${['unitCost', 'sellPrice'].map(f => `
                        <td class="px-2 text-right"><input type="number" min="0" value="${i[f]}" aria-label="${f === 'unitCost' ? 'Unit cost' : 'Selling price'} for ${escapeHtmlText(i.name)}" onchange="onboardingItems[${idx}].${f} = Math.max(0, parseInt(this.value || '0', 10)); renderOnboarding();"
                          class="cc-input cc-input-sm !w-24 text-right" /></td>`).join('')}
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <div class="text-[13px] text-[#042970]"><b>${onboardingItems.length}</b> products loaded</div>
          ` : ''}
        </div>

        ${hasItems ? `
          <div class="cc-box space-y-3">
            <div class="cc-step"><span class="step-num">2</span>Your business and your rules</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label for="ob-company" class="cc-label">Business name</label><input id="ob-company" type="text" value="${escapeHtmlText(obForm.company)}" oninput="obForm.company = this.value" placeholder="e.g. Kedai Jaya" class="cc-input" /></div>
              <div><label for="ob-followup" class="cc-label">Follow up after (hours)</label><input id="ob-followup" type="number" min="1" max="720" value="${obForm.followUpHours}" oninput="obForm.followUpHours = this.value" class="cc-input" /></div>
              <div><label for="ob-margin" class="cc-label">Lowest margin allowed (%)</label><input id="ob-margin" type="number" min="0" max="100" value="${obForm.marginFloorPct}" oninput="obForm.marginFloorPct = this.value" class="cc-input" /></div>
            </div>
            <p class="text-xs text-[#5B6B85]">A discount that takes the margin below this goes to the Owner for approval.</p>
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
            showToast(data.detail || 'Could not read that file.');
            return;
          }
          onboardingItems = data.items || [];
          onboardingWarnings = data.warnings || [];
          renderOnboarding();
          showToast(onboardingItems.length ? `Read ${onboardingItems.length} products from ${file.name}.` : 'No items found in that file.');
        } catch (err) {
          showToast('The backend is offline. Start it with python run_server.py.');
        }
      };
      reader.readAsDataURL(file);
    }

    function applyOnboarding() {
      const company = (document.getElementById('ob-company')?.value || '').trim();
      if (!company) {
        showToast('Enter your business name first.');
        return;
      }
      const setup = {
        role: currentRole,
        companyName: company,
        followUpHours: Math.max(1, parseInt(document.getElementById('ob-followup')?.value || '48', 10)),
        marginFloorPct: Math.max(0, parseFloat(document.getElementById('ob-margin')?.value || '20.0')),
        items: onboardingItems.map(i => ({
          sku: i.sku,
          name: i.name,
          unitCost: i.unitCost,
          sellPrice: i.sellPrice
        }))
      };
      askUserConfirm(
        'Start CashChase for Your Business',
        `${company}: ${setup.items.length} products, follow up after ${setup.followUpHours}h, lowest margin ${setup.marginFloorPct}%.

This configures the price list and CRM pipeline.`,
        async () => {
          const data = await backendAction('/api/onboarding/apply', setup, `${company} is set up. Price list and rules are live.`);
          if (data) {
            onboardingItems = [];
            onboardingWarnings = [];
            closeSettingsModal();
            renderAll();
          }
        },
        'Start'
      );
    }
