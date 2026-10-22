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
        box.innerHTML = `<div class="text-xs text-[#64748B]">Start the backend (python run_server.py) to set up a business.</div>`;
        return;
      }
      if (currentRole !== 'OWNER') {
        box.innerHTML = `<div class="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold">🔒 Only the Owner can set up a business.</div>`;
        return;
      }
      box.innerHTML = `
        <div class="text-xs font-bold text-[#042970]">1. Start from a template, or upload your product price list</div>
        <div class="flex flex-wrap items-center gap-2">
          <button onclick="changeSMEProfile('aircond')" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#0152FC]/40 text-[#0152FC] text-xs font-bold">🔧 Air-cond template</button>
          <button onclick="changeSMEProfile('software')" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#0152FC]/40 text-[#0152FC] text-xs font-bold">💻 Software template</button>
          <button onclick="changeSMEProfile('fnb')" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#0152FC]/40 text-[#0152FC] text-xs font-bold">🚚 F&B template</button>
          <span class="text-xs text-[#64748B]">or</span>
          <label class="px-3 py-1.5 rounded-lg bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold cursor-pointer">
            📥 Upload price list (.xlsx / .csv)
            <input type="file" accept=".xlsx,.xlsm,.csv" class="hidden" onchange="previewStockList(this.files[0]); this.value='';" />
          </label>
        </div>
        <div class="text-[11px] text-[#64748B]">Columns are matched automatically: SKU / item code, item name, unit cost, selling price.</div>

        ${onboardingWarnings.map(w => `<div class="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1.5">⚠️ ${escapeHtmlText(w)}</div>`).join('')}

        ${onboardingItems.length ? `
          <div class="max-h-56 overflow-y-auto bg-white rounded-xl border border-[#D5DFEE]">
            <table class="w-full text-xs">
              <thead class="bg-[#F2F6FF] text-[#64748B] sticky top-0"><tr>
                <th class="text-left px-2 py-1.5">SKU</th><th class="text-left px-2 py-1.5">Item</th>
                <th class="text-right px-2 py-1.5">Unit cost (RM)</th><th class="text-right px-2 py-1.5">Sell price (RM)</th>
              </tr></thead>
              <tbody>
                ${onboardingItems.map((i, idx) => `
                  <tr class="border-t border-[#EEF2F8]">
                    <td class="px-2 py-1 font-mono text-[#042970]">${escapeHtmlText(i.sku)}</td>
                    <td class="px-2 py-1 text-[#042970]">${escapeHtmlText(i.name)}</td>
                    ${['unitCost', 'sellPrice'].map(f => `
                      <td class="px-1 py-1 text-right"><input type="number" min="0" value="${i[f]}" onchange="onboardingItems[${idx}].${f} = Math.max(0, parseInt(this.value || '0', 10)); renderOnboarding();"
                        class="w-20 text-right bg-[#F2F6FF] border border-[#D5DFEE] rounded px-1.5 py-0.5" /></td>`).join('')}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="text-xs text-[#042970]"><b>${onboardingItems.length}</b> products loaded.</div>

          <div class="text-xs font-bold text-[#042970] pt-1">2. Business name, follow-up SLA & minimum margin floor</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <label class="text-[#64748B]">Business name<input id="ob-company" type="text" value="${escapeHtmlText(obForm.company)}" oninput="obForm.company = this.value" placeholder="e.g. Kedai Jaya" class="mt-0.5 w-full bg-white border border-[#D5DFEE] rounded-lg px-2 py-1.5 font-semibold text-[#042970]" /></label>
            <label class="text-[#64748B]">Follow-up SLA (hours)<input id="ob-followup" type="number" min="1" max="720" value="${obForm.followUpHours}" oninput="obForm.followUpHours = this.value" class="mt-0.5 w-full bg-white border border-[#D5DFEE] rounded-lg px-2 py-1.5 font-semibold text-[#042970]" /></label>
            <label class="text-[#64748B]">Min margin floor (%)<input id="ob-margin" type="number" min="0" max="100" value="${obForm.marginFloorPct}" oninput="obForm.marginFloorPct = this.value" class="mt-0.5 w-full bg-white border border-[#D5DFEE] rounded-lg px-2 py-1.5 font-semibold text-[#042970]" /></label>
          </div>
          <div class="flex justify-end gap-2">
            <button onclick="onboardingItems = []; onboardingWarnings = []; renderOnboarding();" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#D5DFEE] text-[#042970] text-xs font-bold">✕ Clear</button>
            <button onclick="applyOnboarding()" class="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">🚀 Start CashChase for my business</button>
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
            showToast(`⚠️ ${data.detail || 'Could not read the file.'}`);
            return;
          }
          onboardingItems = data.items || [];
          onboardingWarnings = data.warnings || [];
          renderOnboarding();
          showToast(onboardingItems.length ? `Read ${onboardingItems.length} products from ${file.name}.` : 'No items found in that file.');
        } catch (err) {
          showToast('⚠️ Backend offline — start it with python run_server.py');
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
        `${company}: ${setup.items.length} products, ${setup.followUpHours}h follow-up SLA, ${setup.marginFloorPct}% margin floor.

This configures the price list and CRM pipeline.`,
        async () => {
          const data = await backendAction('/api/onboarding/apply', setup, `🚀 ${company} is set up! Price list and rules are live.`);
          if (data) {
            onboardingItems = [];
            onboardingWarnings = [];
            closeSettingsModal();
            renderAll();
          }
        },
        '🚀 Start'
      );
    }
