// =========================================================================
    // CLEAN SIDEBAR NAVIGATION
    // =========================================================================
    function switchPage(page) {
      currentPage = page;
      const pages = ['overview', 'invoices', 'stock', 'ledger', 'wa'];
      pages.forEach(p => {
        const el = document.getElementById('page-' + p);
        if (el) el.classList.toggle('hidden', p !== page);

        const nav = document.getElementById('nav-' + p);
        if (nav && p !== 'wa') {
          nav.className = p === page
            ? 'w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-bold bg-[#0152FC] text-white shadow-sm transition'
            : 'w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-medium text-white/85 hover:bg-white/10 transition';
        }
      });

      const waNav = document.getElementById('nav-wa');
      if (waNav) {
        waNav.className = page === 'wa'
          ? 'w-full flex items-center justify-between px-3.5 py-3.5 rounded-xl text-sm font-bold bg-[#0152FC] border-2 border-[#01E3FB] text-white shadow-md transition'
          : 'w-full flex items-center justify-between px-3.5 py-3.5 rounded-xl text-sm font-bold bg-[#073794] hover:bg-[#0152FC] border border-[#01E3FB]/50 text-white shadow-md transition';
      }

      renderAll();
    }

    function openSettingsModal() {
      document.getElementById('settings-modal').classList.remove('hidden');
    }

    function closeSettingsModal() {
      document.getElementById('settings-modal').classList.add('hidden');
    }

    // =========================================================================
    // NET WORTH & DASHBOARD SUMMARY CALCULATIONS
    // =========================================================================
    function renderTopNumbers() {
      const st = getState();
      const stockVal = st.stock.reduce((sum, item) => sum + (item.onHand * item.unitCost), 0);
      const holdUnits = st.stock.reduce((sum, item) => sum + item.onHold, 0);
      const coreNW = st.cashOnHand + stockVal;

      const pendingIn = st.invoices
        .filter(i => i.type === 'PENDING' || i.type === 'AFTERSALES' || i.type === 'PENDING_VERIFY')
        .reduce((sum, i) => sum + i.amount, 0);
      const pendingOut = st.invoices
        .filter(i => i.type === 'SUPPLIER_COST' && i.status === 'UNPAID_PAYABLE')
        .reduce((sum, i) => sum + i.amount, 0);

      const fullNW = coreNW + pendingIn - pendingOut;

      document.getElementById('top-company-title').textContent = st.name;
      document.getElementById('ov-core-nw').textContent = 'RM ' + coreNW.toLocaleString();
      document.getElementById('ov-core-sub').textContent = `Cash: RM ${st.cashOnHand.toLocaleString()} · Stock: RM ${stockVal.toLocaleString()}`;
      document.getElementById('ov-receivables').textContent = 'RM ' + pendingIn.toLocaleString();
      document.getElementById('ov-payables').textContent = 'RM ' + pendingOut.toLocaleString();
      document.getElementById('ov-full-nw').textContent = 'RM ' + fullNW.toLocaleString();

      const summaryEl = document.getElementById('stock-table-summary');
      if (summaryEl) {
        summaryEl.textContent = `Total Stock Value: RM ${stockVal.toLocaleString()} | Cash: RM ${st.cashOnHand.toLocaleString()}`;
      }

      document.getElementById('badge-invoices').textContent = st.invoices.length;
      document.getElementById('badge-stock').textContent = holdUnits > 0 ? `${holdUnits} Held` : 'OK';
    }

    // =========================================================================
    // HELPER: BUILDS THE 1 BIG OBVIOUS ACTION BUTTON FOR ANY RECORD
    // =========================================================================
    function getBigActionButton(inv) {
      if (inv.type === 'PENDING_VERIFY') {
        return `<button onclick="openVerifyModal('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold shadow-sm transition">🔍 Verify Receipt Against Bank</button>`;
      }
      if (inv.type === 'QUOTE_HOLD' && inv.status === 'HOLD_EXPIRED') {
        return `<button onclick="releaseQuoteFromTable('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-sm transition">🔓 Release Expired 48h Hold</button>`;
      }
      if (inv.type === 'QUOTE_HOLD' && inv.status !== 'HOLD_RELEASED') {
        return `<button onclick="confirmQuoteFromTable('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold shadow-sm transition">💰 Confirm Deposit & Deduct Stock</button>`;
      }
      if (inv.type === 'AFTERSALES') {
        if (inv.status === 'REPLACEMENT_SENT' || inv.status === 'DISCOUNT_APPLIED') {
          return `<button onclick="resolveAftersales('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition">✓ Mark Aftersales Resolved</button>`;
        }
        return `<button onclick="replaceFromTable('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-sm transition">📦 Send -1 Replacement Stock</button>`;
      }
      if (inv.type === 'PENDING') {
        return `<button onclick="markInvoicePaid('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold shadow-sm transition">🔍 Verify & Mark Paid (+RM ${inv.amount.toLocaleString()})</button>`;
      }
      if (inv.type === 'SUPPLIER_COST' && inv.status === 'UNPAID_PAYABLE') {
        return `<button onclick="paySupplierBill('${inv.id}')" class="px-5 py-2.5 rounded-xl bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold shadow-sm transition">💳 Pay Supplier Bill (-RM ${inv.amount.toLocaleString()})</button>`;
      }
      return `<span class="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">✓ Completed</span>`;
    }

    // =========================================================================
    // RENDER DASHBOARD, INVOICES & STOCK
    // =========================================================================
    function renderWebAppView() {
      const st = getState();

      // 1. Dashboard Priority Queue (1 Big Button per row)
      const queueEl = document.getElementById('ov-action-queue');
      const activeItems = st.invoices.filter(i => i.status !== 'PAID' && i.status !== 'HOLD_RELEASED' && i.status !== 'PAID_SUPPLIER' && i.status !== 'PAID_STOCK_IN' && i.status !== 'PAID_EXPENSE');
      document.getElementById('badge-overview').textContent = activeItems.length;

      queueEl.innerHTML = activeItems.map(inv => {
        const pillStyle = inv.type === 'PENDING_VERIFY'
          ? 'bg-purple-100 text-purple-900 border border-purple-300'
          : inv.type === 'AFTERSALES'
            ? 'bg-amber-100 text-amber-800'
            : inv.status === 'HOLD_EXPIRED'
              ? 'bg-red-100 text-red-700'
              : 'bg-[#E6EEFF] text-[#0152FC]';

        return `
          <div class="p-4 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] flex flex-wrap items-center justify-between gap-4">
            <div class="space-y-1 max-w-xl">
              <div class="flex items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${pillStyle}">${inv.id}</span>
                <span class="font-bold text-sm text-[#042970]">${inv.party}</span>
                <span class="font-bold text-sm text-[#0152FC]">· RM ${inv.amount.toLocaleString()}</span>
              </div>
              <div class="text-xs text-[#324564]">${inv.itemsText}</div>
            </div>
            <div class="flex items-center gap-2">
              ${getBigActionButton(inv)}
            </div>
          </div>
        `;
      }).join('');

      // Populate Walk-In Item Dropdown
      const skuSelect = document.getElementById('walkin-sku');
      if (skuSelect) {
        const prevVal = skuSelect.value;
        skuSelect.innerHTML = st.stock.map((s, idx) =>
          `<option value="${idx}">${s.name} (RM ${s.sellPrice}) — ${Math.max(0, s.onHand - s.onHold)} Avail</option>`
        ).join('');
        if (prevVal && st.stock[prevVal]) skuSelect.value = prevVal;
      }

      // 2. Page 2: Clean Invoice Cards (1 Big Primary Action + clean secondary links)
      const invContainer = document.getElementById('invoice-list-container');
      const filtered = st.invoices.filter(i => currentInvFilter === 'ALL' || i.type === currentInvFilter);

      invContainer.innerHTML = filtered.map(inv => `
        <div class="p-4 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] flex flex-wrap items-center justify-between gap-4">
          <div class="space-y-1 max-w-xl">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono font-bold text-xs px-2.5 py-0.5 rounded bg-white border border-[#D5DFEE] text-[#0152FC]">${inv.id}</span>
              <span class="font-bold text-sm text-[#042970]">${inv.party}</span>
              <span class="text-xs px-2 py-0.5 rounded-full bg-white border border-[#D5DFEE] font-semibold text-[#042970]">${inv.lhdn}</span>
            </div>
            <div class="text-xs text-[#324564]">${inv.itemsText}</div>
            <div class="flex flex-wrap items-center gap-3 pt-1">
              <button onclick="openPdfForInvoice('${inv.id}')" class="text-xs font-semibold text-[#0152FC] hover:underline cursor-pointer">📄 Preview / Print PDF</button>
              ${inv.receiptRef ? `<button onclick="viewReceiptCopy('${inv.id}')" class="text-xs font-bold text-purple-700 hover:underline cursor-pointer flex items-center gap-1"><span>🧾</span> View Receipt Copy (${inv.receiptRef})</button>` : ''}
              ${inv.lhdn.includes('Missing TIN') ? `<button onclick="setInvoiceTin('${inv.id}')" class="text-xs font-bold text-amber-700 hover:underline cursor-pointer">✏️ Key In Buyer TIN (or Set Consolidated)</button>` : ''}
              ${inv.type === 'PENDING' ? `<button onclick="addExtraPipingAndLabor('${inv.id}')" class="text-xs font-semibold text-[#042970] hover:underline cursor-pointer">➕ Add Extra Piping & Labor</button>` : ''}
              ${inv.type === 'AFTERSALES' ? `<button onclick="discountFromTable('${inv.id}')" class="text-xs font-semibold text-amber-800 hover:underline cursor-pointer">💸 Or Give RM 180 Discount Instead</button>` : ''}
            </div>
          </div>

          <div class="flex items-center gap-4">
            <div class="text-right">
              <div class="text-xs text-[#64748B]">Amount</div>
              <div class="text-base font-bold text-[#042970]">RM ${inv.amount.toLocaleString()}</div>
            </div>
            ${getBigActionButton(inv)}
          </div>
        </div>
      `).join('');

      // 3. Page 3: Stock Table (Shows WHO is holding each SKU + Quick Access Inspector)
      const stockTbody = document.getElementById('stock-tbody');
      stockTbody.innerHTML = st.stock.map((s, idx) => {
        const avail = Math.max(0, s.onHand - s.onHold);
        const val = s.onHand * s.unitCost;
        const holders = getHoldersForSku(s.sku);

        const holdersHtml = holders.length > 0
          ? `<div class="space-y-1.5">
               <div class="flex items-center gap-2">
                 <span class="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-xs">⏳ ${s.onHold} Held</span>
                 <button onclick="openHoldInspector(${idx})" class="text-xs font-bold text-[#0152FC] hover:underline">🔍 Quick View All</button>
               </div>
               <div class="flex flex-wrap gap-1.5">
                 ${holders.map(h => `
                   <button onclick="openHoldInspector(${idx})" class="text-left px-2.5 py-1 rounded-lg border text-xs font-semibold transition flex items-center gap-1.5 ${
                     h.inv.status === 'HOLD_EXPIRED'
                       ? 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
                       : 'bg-[#F2F6FF] border-[#D5DFEE] text-[#042970] hover:bg-[#E6EEFF]'
                   }">
                     <span>👤 <b>${h.inv.party}</b> · ${h.heldQty}x (${h.inv.id})</span>
                     <span class="text-xs px-1.5 py-0.2 rounded ${h.inv.status === 'HOLD_EXPIRED' ? 'bg-red-200 text-red-900 font-bold' : 'bg-[#E6EEFF] text-[#0152FC]'}">${h.inv.holdTimer || (h.inv.status === 'HOLD_EXPIRED' ? '⚠️ Expired' : '⏳ 48h Hold')}</span>
                   </button>
                 `).join('')}
               </div>
             </div>`
          : s.onHold > 0
            ? `<button onclick="openHoldInspector(${idx})" class="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold hover:bg-amber-200 transition">⏳ ${s.onHold} Held (${s.holdNote}) 🔍</button>`
            : `<span class="text-[#64748B]">0 (None Held)</span>`;

        return `
          <tr class="hover:bg-[#F2F6FF] transition align-top">
            <td class="py-3.5 px-4 font-mono font-bold text-[#0152FC]">${s.sku}</td>
            <td class="py-3.5 px-4 font-bold text-[#042970]">${s.name}</td>
            <td class="py-3.5 px-4 font-bold text-[#042970]">${s.onHand} units</td>
            <td class="py-3.5 px-4">${holdersHtml}</td>
            <td class="py-3.5 px-4 font-bold text-emerald-700">${avail} Available</td>
            <td class="py-3.5 px-4 font-bold text-[#042970]">RM ${val.toLocaleString()}</td>
            <td class="py-3.5 px-4 text-right">
              <div class="flex flex-col items-end gap-1.5">
                <div class="flex items-center gap-1.5">
                  <button onclick="quickRestockRow(${idx})" class="px-3 py-1.5 rounded-xl bg-[#E6EEFF] hover:bg-[#0152FC] text-[#0152FC] hover:text-white font-bold text-xs border border-[#0152FC]/30 transition">
                    ➕ Restock (+Qty)
                  </button>
                  ${s.onHold > 0 ? `
                    <button onclick="openHoldInspector(${idx})" class="px-3.5 py-1.5 rounded-xl bg-[#0152FC] hover:bg-[#0141C9] text-white font-bold text-xs shadow-xs transition">
                      🔍 Who's Holding (${s.onHold})
                    </button>
                  ` : ''}
                </div>
                ${s.onHold > 0
                  ? `<button onclick="releaseStockRow(${idx})" class="text-xs font-bold text-amber-700 hover:underline">🔓 Release All ${s.onHold} Held Units</button>`
                  : `<span class="text-emerald-700 font-semibold text-xs">✓ Ready</span>`
                }
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // 3B. Page 3 Lower Section: "Who Is Holding Stock Right Now" Quick Access Cards
      const activeHolds = st.invoices.filter(i => i.type === 'QUOTE_HOLD' && i.status !== 'HOLD_RELEASED');
      const holdsCountBadge = document.getElementById('active-holds-count-badge');
      if (holdsCountBadge) {
        holdsCountBadge.textContent = `${activeHolds.length} Active / Expired Quote Hold(s)`;
      }
      const holdersListEl = document.getElementById('stock-holders-list');
      if (holdersListEl) {
        if (activeHolds.length === 0) {
          holdersListEl.innerHTML = `
            <div class="p-5 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] text-center text-xs text-[#64748B]">
              🎉 <b>Zero stock is currently locked on hold!</b> 100% of your physical warehouse inventory is Available to Sell.
            </div>
          `;
        } else {
          holdersListEl.innerHTML = activeHolds.map(inv => {
            const isExpired = inv.status === 'HOLD_EXPIRED';
            const timerLabel = inv.holdTimer || (isExpired ? '⚠️ Expired (>48h ago)' : '⏳ 48h Hold Active');
            return `
              <div class="p-4 rounded-xl bg-[#F2F6FF] border ${isExpired ? 'border-red-300 bg-red-50/40' : 'border-[#D5DFEE]'} flex flex-wrap items-center justify-between gap-4">
                <div class="space-y-1.5 max-w-2xl">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono font-bold text-xs px-2.5 py-0.5 rounded bg-white border border-[#D5DFEE] text-[#0152FC]">${inv.id}</span>
                    <span class="font-bold text-sm text-[#042970]">👤 ${inv.party}</span>
                    ${inv.phone ? `<span class="text-xs text-[#64748B] font-medium">📞 ${inv.phone}</span>` : ''}
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isExpired ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-amber-100 text-amber-900'}">${timerLabel}</span>
                    <span class="text-xs px-2 py-0.5 rounded-full bg-white border border-[#D5DFEE] font-semibold text-[#042970]">${inv.lhdn}</span>
                  </div>
                  <div class="text-xs font-semibold text-[#042970]">
                    📦 Holding: <span class="text-[#0152FC]">${inv.itemsText}</span> · Quote Value: <b>RM ${inv.amount.toLocaleString()}</b>
                  </div>
                  <!-- Quick Access Bar -->
                  <div class="flex flex-wrap items-center gap-3 pt-1">
                    <button onclick="openPdfForInvoice('${inv.id}')" class="px-3 py-1 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#D5DFEE] text-xs font-bold text-[#0152FC] transition">
                      📄 View Quote PDF
                    </button>
                    <button onclick="jumpToQuoteChat('${inv.id}')" class="px-3 py-1 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#D5DFEE] text-xs font-bold text-[#042970] transition">
                      💬 Open Customer WhatsApp Chat ↗
                    </button>
                    ${!isExpired ? `
                      <button onclick="releaseQuoteFromTable('${inv.id}')" class="px-3 py-1 rounded-lg bg-white hover:bg-amber-50 border border-amber-300 text-xs font-bold text-amber-800 transition">
                        🔓 Release Hold Early (+Return Stock)
                      </button>
                    ` : ''}
                    ${inv.lhdn.includes('Missing TIN') ? `
                      <button onclick="setInvoiceTin('${inv.id}')" class="text-xs font-bold text-amber-700 hover:underline">
                        ✏️ Key In Buyer TIN
                      </button>
                    ` : ''}
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  ${getBigActionButton(inv)}
                </div>
              </div>
            `;
          }).join('');
        }
      }

      // 4. Audit Log (Dashboard preview)
      const logList = document.getElementById('audit-log-list');
      logList.innerHTML = st.logs.map(l => `
        <div class="p-2.5 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] font-mono text-xs text-[#324564]">${l}</div>
      `).join('');

      // 5. Page 4: ALL DATA & MASTER LEDGER ("SEE EVERYTHING" VIEW)
      const badgeLedger = document.getElementById('badge-ledger');
      if (badgeLedger) {
        badgeLedger.textContent = `${st.invoices.length + st.stock.length} Rows`;
      }

      const searchQ = (document.getElementById('ledger-search-input')?.value || '').trim().toLowerCase();
      const ledgerTbody = document.getElementById('master-ledger-tbody');
      if (ledgerTbody) {
        const ledgerRows = st.invoices.filter(inv => {
          if (!searchQ) return true;
          return (
            inv.id.toLowerCase().includes(searchQ) ||
            inv.party.toLowerCase().includes(searchQ) ||
            inv.itemsText.toLowerCase().includes(searchQ) ||
            inv.lhdn.toLowerCase().includes(searchQ) ||
            inv.status.toLowerCase().includes(searchQ)
          );
        });

        ledgerTbody.innerHTML = ledgerRows.map(inv => {
          const isOutflow = inv.type === 'SUPPLIER_COST';
          const isPaidIn = inv.status === 'PAID';
          const isPaidOut = inv.status === 'PAID_SUPPLIER' || inv.status === 'PAID_STOCK_IN' || inv.status === 'PAID_EXPENSE';
          const isPendingVerify = inv.type === 'PENDING_VERIFY';

          let catBadge = `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-[#E6EEFF] text-[#0152FC] font-bold text-xs whitespace-nowrap shadow-xs">💰 Customer Sale</span>`;
          if (inv.type === 'QUOTE_HOLD') catBadge = `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-bold text-xs whitespace-nowrap shadow-xs">⏳ 48h Quote Hold</span>`;
          if (inv.type === 'PENDING_VERIFY') catBadge = `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-purple-100 text-purple-900 font-bold text-xs whitespace-nowrap shadow-xs">🕵️‍♂️ Pending Bank Verify</span>`;
          if (inv.type === 'AFTERSALES') catBadge = `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-bold text-xs whitespace-nowrap shadow-xs">⚠️ Aftersales Claim</span>`;
          if (inv.type === 'SUPPLIER_COST') catBadge = `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-bold text-xs whitespace-nowrap shadow-xs">🚚 Supplier / Expense</span>`;

          let statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-[11px] border border-blue-200 whitespace-nowrap">${inv.status}</span>`;
          if (inv.status === 'PENDING_BANK_VERIFY') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 font-bold text-[11px] border border-purple-200 whitespace-nowrap">Bank Verification</span>`;
          else if (inv.status === 'HOLD_EXPIRED') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 font-bold text-[11px] border border-rose-200 whitespace-nowrap">Hold Expired</span>`;
          else if (inv.status === 'ON_HOLD_48H') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 font-bold text-[11px] border border-amber-200 whitespace-nowrap">48h Hold Active</span>`;
          else if (inv.status === 'AFTERSALES_PAUSED') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 font-bold text-[11px] border border-amber-200 whitespace-nowrap">Chasing Paused</span>`;
          else if (inv.status === 'PENDING_PAYMENT') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-[11px] border border-blue-200 whitespace-nowrap">Pending Payment</span>`;
          else if (inv.status === 'UNPAID_PAYABLE') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-red-50 text-red-700 font-bold text-[11px] border border-red-200 whitespace-nowrap">Unpaid Payable</span>`;
          else if (inv.status === 'PAID' || inv.status === 'PAID_SUPPLIER') statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[11px] border border-emerald-200 whitespace-nowrap">Settled / Paid</span>`;

          let cashEffectHtml = `<span class="font-bold text-[#0152FC] whitespace-nowrap">Pending +RM ${inv.amount.toLocaleString()}</span>`;
          if (isPaidIn) cashEffectHtml = `<span class="font-bold text-emerald-700 whitespace-nowrap">+RM ${inv.amount.toLocaleString()} (Banked)</span>`;
          else if (isPaidOut) cashEffectHtml = `<span class="font-bold text-red-600 whitespace-nowrap">-RM ${inv.amount.toLocaleString()} (Paid Out)</span>`;
          else if (isOutflow) cashEffectHtml = `<span class="font-bold text-red-600 whitespace-nowrap">Payable -RM ${inv.amount.toLocaleString()}</span>`;
          else if (isPendingVerify) cashEffectHtml = `<span class="font-bold text-purple-800 whitespace-nowrap">🕵️‍♂️ Unverified RM ${inv.amount.toLocaleString()}</span>`;
          else if (inv.type === 'QUOTE_HOLD') cashEffectHtml = `<span class="text-[#64748B] font-semibold whitespace-nowrap">RM ${inv.amount.toLocaleString()} (Quote Only)</span>`;

          return `
            <tr class="hover:bg-[#F2F6FF] transition">
              <td class="py-3 px-4 font-mono font-bold text-[#0152FC] whitespace-nowrap">
                <button onclick="openPdfForInvoice('${inv.id}')" class="hover:underline">${inv.id} 📄</button>
              </td>
              <td class="py-3 px-4 whitespace-nowrap">${catBadge}</td>
              <td class="py-3 px-4 font-bold text-[#042970] whitespace-nowrap">${inv.party}</td>
              <td class="py-3 px-4 text-[#324564]">${inv.itemsText}</td>
              <td class="py-3 px-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-white border border-[#D5DFEE] font-semibold text-[#042970] text-xs whitespace-nowrap shadow-xs">${inv.lhdn}</span>
              </td>
              <td class="py-3 px-4 whitespace-nowrap">${statusBadge}</td>
              <td class="py-3 px-4 text-right whitespace-nowrap">${cashEffectHtml}</td>
            </tr>
          `;
        }).join('');
      }

      // Directory of All Customers & Suppliers
      const custTbody = document.getElementById('master-customers-tbody');
      if (custTbody) {
        const partyMap = {};
        st.invoices.forEach(inv => {
          if (!partyMap[inv.party]) {
            partyMap[inv.party] = {
              party: inv.party,
              isSupplier: inv.type === 'SUPPLIER_COST',
              lhdn: inv.lhdn,
              count: 0,
              totalRM: 0,
              sampleId: inv.id
            };
          }
          partyMap[inv.party].count += 1;
          partyMap[inv.party].totalRM += inv.amount;
          if (inv.lhdn && !inv.lhdn.includes('Missing')) {
            partyMap[inv.party].lhdn = inv.lhdn;
          }
        });

        const parties = Object.values(partyMap).filter(p => {
          if (!searchQ) return true;
          return p.party.toLowerCase().includes(searchQ) || p.lhdn.toLowerCase().includes(searchQ);
        });

        custTbody.innerHTML = parties.map(p => `
          <tr class="hover:bg-[#F2F6FF] transition">
            <td class="py-3 px-4 font-bold text-[#042970] whitespace-nowrap">${p.party}</td>
            <td class="py-3 px-4 whitespace-nowrap">
              ${p.isSupplier
                ? '<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-bold border border-red-200 text-xs whitespace-nowrap shadow-xs">🏭 Supplier / Vendor</span>'
                : '<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-[#E6EEFF] text-[#0152FC] font-bold text-xs whitespace-nowrap shadow-xs">👤 Customer (B2B / Walk-In)</span>'
              }
            </td>
            <td class="py-3 px-4 whitespace-nowrap">
              <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-white border border-[#D5DFEE] font-semibold text-[#042970] text-xs whitespace-nowrap shadow-xs">${p.lhdn}</span>
            </td>
            <td class="py-3 px-4 font-bold text-[#324564] whitespace-nowrap">${p.count} record(s)</td>
            <td class="py-3 px-4 font-bold text-[#042970] whitespace-nowrap">RM ${p.totalRM.toLocaleString()}</td>
            <td class="py-3 px-4 text-right whitespace-nowrap">
              <button onclick="setInvoiceTin('${p.sampleId}')" class="px-3.5 py-1.5 rounded-xl bg-[#F2F6FF] hover:bg-[#E6EEFF] border border-[#D5DFEE] text-[#0152FC] font-bold text-xs transition whitespace-nowrap cursor-pointer shadow-xs">
                ✏️ Edit TIN / Consolidated
              </button>
            </td>
          </tr>
        `).join('');
      }

      // Full Audit Log in Page 4
      const masterLogList = document.getElementById('master-audit-log-list');
      const masterLogCount = document.getElementById('master-log-count');
      if (masterLogList) {
        if (masterLogCount) masterLogCount.textContent = `${st.logs.length} Events Logged`;
        masterLogList.innerHTML = st.logs.map(l => `
          <div class="p-3 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] font-mono text-xs text-[#042970]">${l}</div>
        `).join('');
      }
    }

    function exportAllDataCSV() {
      const st = getState();
      askUserConfirm(
        `Export Full System Ledger (.xlsx / .csv)`,
        `Download all ${st.invoices.length} Invoices/Quotes/Supplier Bills, ${st.stock.length} Warehouse Stock SKUs, Client Memory Profiles, and ${st.logs.length} Audit Logs as an Excel (.xlsx) workbook?`,
        () => {
          triggerRealXlsxOrCsvDownload('CashChase_Master_Ledger.xlsx');
        },
        '📥 Download Excel (.xlsx)'
      );
    }

    // Clean customer name to avoid showing tags like (Deposit), (Walk-in), etc.
    function promptAddMemoryNote() {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      if (!chat.memory) {
        chat.memory = { tier: 'Standard Client', score: 75, totalOrders: 1, totalPaidRM: 1000, notes: [], timeline: [] };
      }
      const note = prompt(`Add a persistent memory note for ${chat.customer}:\n(e.g., "Prefers WhatsApp quotes over phone", "Only accepts morning delivery", "Requested 5% discount on volume")`);
      if (note && note.trim()) {
        chat.memory.notes.push(note.trim());
        chat.memory.timeline.unshift({
          time: 'Just Now',
          note: `Owner recorded: "${note.trim()}"`
        });
        showToast(`Saved note into ${chat.customer}'s persistent memory!`);
        renderWhatsAppView();
      }
    }

    function handlePhoneOrder() {
      const st = getState();
      const nameInput = document.getElementById('walkin-name');
      const tinInput = document.getElementById('walkin-tin');
      const skuIdx = parseInt(document.getElementById('walkin-sku').value || '0', 10);
      const qty = Math.max(1, parseInt(document.getElementById('walkin-qty').value || '1', 10));
      const mode = document.getElementById('walkin-mode').value;

      const customerName = (nameInput.value || 'Walk-In Customer').trim();
      const buyerTin = (tinInput.value || '').trim();
      const item = st.stock[skuIdx] || st.stock[0];
      const totalAmount = item.sellPrice * qty;

      const lhdnStatus = buyerTin
        ? `🟢 LHDN TIN: ${buyerTin}`
        : `🔵 Consolidated e-Invoice (No Buyer TIN Needed)`;

      const confirmMsg = mode === 'PAID_NOW'
        ? `Record Immediate Walk-In Sale for ${customerName}?\n\n• Item: ${qty}x ${item.name} (${item.sku})\n• Physical Stock: -${qty} units deducted immediately\n• Cash on Hand: +RM ${totalAmount.toLocaleString()}\n• LHDN Status: ${lhdnStatus}`
        : `Create 48-Hour Phone Quote Hold for ${customerName}?\n\n• Item: ${qty}x ${item.name} (${item.sku})\n• Stock Effect: +${qty} units locked ON HOLD for 48h\n• Quote Total: RM ${totalAmount.toLocaleString()}`;

      askUserConfirm(
        mode === 'PAID_NOW' ? `Confirm Walk-In Sale` : `Confirm 48h Phone Quote Hold`,
        confirmMsg,
        () => {
          if (usesBackend()) {
            backendAction('/api/orders/walkin', { customerName, buyerTin, sku: item.sku, qty, mode: mode === 'PAID_NOW' ? 'PAID_NOW' : 'QUOTE_HOLD' },
              d => mode === 'PAID_NOW' ? `Walk-In Sale ${d.createdId} recorded!` : `Phone Quote ${d.createdId} created! ${qty}x ${item.name} placed ON HOLD for 48h.`);
            return;
          }
          if (mode === 'PAID_NOW') {
            item.onHand = Math.max(0, item.onHand - qty);
            st.cashOnHand += totalAmount;
            const newId = 'INV-' + Math.floor(300 + Math.random() * 90);
            st.invoices.unshift({
              id: newId,
              type: 'PAID_DONE',
              party: customerName + ' (Walk-In)',
              itemsText: `${qty}x ${item.name} (Walk-In Paid Immediately · Stock Deducted)`,
              sku: item.sku,
              qty: qty,
              amount: totalAmount,
              status: 'PAID',
              lhdn: lhdnStatus
            });
            st.logs.unshift(`10:49 AM · [${currentRole}] Walk-In Sale ${newId} (${customerName}) → Deducted ${qty}x ${item.name} from Physical Stock, Cash +RM ${totalAmount.toLocaleString()} (${lhdnStatus}).`);
            showToast(`Walk-In Sale ${newId} recorded! Deducted ${qty}x ${item.name} from Stock & added +RM ${totalAmount.toLocaleString()} to Cash!`);
          } else {
            item.onHold += qty;
            item.holdNote = `${item.onHold}x Active Quote Holds (48h)`;
            const newId = 'QT-' + Math.floor(110 + Math.random() * 80);
            st.invoices.unshift({
              id: newId,
              type: 'QUOTE_HOLD',
              party: customerName + ' (Phone Order)',
              phone: 'Phone / Walk-In',
              holdTimer: '⏳ 48h Left (Just Held)',
              itemsText: `${qty}x ${item.name} (ON HOLD — 48h timer)`,
              sku: item.sku,
              qty: qty,
              amount: totalAmount,
              status: 'ON_HOLD_48H',
              lhdn: buyerTin ? `🟢 LHDN TIN: ${buyerTin}` : `🟡 Missing TIN`
            });
            st.logs.unshift(`10:49 AM · [${currentRole}] Phone Quote ${newId} (${customerName}) → Placed ${qty}x ${item.name} ON HOLD for 48h.`);
            showToast(`Phone Quote ${newId} created! ${qty}x ${item.name} placed ON HOLD for 48h.`);
          }
          renderAll();
        },
        '✅ Confirm & Save Entry'
      );
    }

    function getHoldersForSku(sku) {
      const st = getState();
      const results = [];
      st.invoices.forEach(inv => {
        if (inv.type === 'QUOTE_HOLD' && inv.status !== 'HOLD_RELEASED') {
          if (inv.sku === sku) {
            results.push({ inv, heldQty: inv.qty });
          } else if (inv.extraSku === sku && inv.extraQty > 0) {
            results.push({ inv, heldQty: inv.extraQty });
          }
        }
      });
      return results;
    }

    let currentInspectSkuIdx = null;

    function openHoldInspector(stockIdx) {
      const st = getState();
      const s = st.stock[stockIdx];
      if (!s) return;
      currentInspectSkuIdx = stockIdx;

      const avail = Math.max(0, s.onHand - s.onHold);
      document.getElementById('hold-modal-sku-pill').textContent = `⏳ Stock Hold Breakdown · ${s.sku}`;
      document.getElementById('hold-modal-title').textContent = s.name;
      document.getElementById('hold-modal-subtitle').textContent =
        `Physical On Hand: ${s.onHand} units · Currently Held: ${s.onHold} units · Available to Sell: ${avail} units`;

      const holders = getHoldersForSku(s.sku);
      const listEl = document.getElementById('hold-modal-list');

      if (holders.length === 0) {
        listEl.innerHTML = `
          <div class="p-4 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] text-xs text-[#64748B] text-center">
            No active customer quotes are holding <b>${s.name}</b> right now.
          </div>
        `;
      } else {
        listEl.innerHTML = holders.map(h => {
          const inv = h.inv;
          const isExpired = inv.status === 'HOLD_EXPIRED';
          const timerLabel = inv.holdTimer || (isExpired ? '⚠️ Expired (>48h ago)' : '⏳ 48h Hold Active');
          return `
            <div class="p-4 rounded-xl bg-[#F2F6FF] border ${isExpired ? 'border-red-300 bg-red-50/40' : 'border-[#D5DFEE]'} space-y-2.5">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono font-bold text-xs px-2.5 py-0.5 rounded bg-white border border-[#D5DFEE] text-[#0152FC]">${inv.id}</span>
                  <span class="font-bold text-sm text-[#042970]">👤 ${inv.party}</span>
                  ${inv.phone ? `<span class="text-xs text-[#64748B]">📞 ${inv.phone}</span>` : ''}
                </div>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isExpired ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-amber-100 text-amber-900'}">${timerLabel}</span>
              </div>

              <div class="text-xs text-[#324564] flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-lg border border-[#D5DFEE]">
                <div>
                  <b>Holding this SKU:</b> <span class="text-[#0152FC] font-bold">${h.heldQty} units (${s.sku})</span>
                  <div class="text-[#64748B] mt-0.5">Full Quote Scope: ${inv.itemsText}</div>
                </div>
                <div class="text-right">
                  <div class="text-[#64748B]">Quote Total</div>
                  <div class="text-sm font-bold text-[#042970]">RM ${inv.amount.toLocaleString()}</div>
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div class="flex flex-wrap items-center gap-2">
                  <button onclick="closeHoldInspector(); openPdfForInvoice('${inv.id}')" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#D5DFEE] text-xs font-bold text-[#0152FC] transition">
                    📄 View Quote PDF
                  </button>
                  <button onclick="closeHoldInspector(); jumpToQuoteChat('${inv.id}')" class="px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6EEFF] border border-[#D5DFEE] text-xs font-bold text-[#042970] transition">
                    💬 Open WhatsApp Chat ↗
                  </button>
                  <button onclick="releaseQuoteFromTable('${inv.id}'); closeHoldInspector();" class="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-xs font-bold text-amber-900 transition">
                    🔓 Release Hold (+${h.heldQty} Avail)
                  </button>
                </div>

                <button onclick="confirmQuoteFromTable('${inv.id}'); closeHoldInspector();" class="px-4 py-2 rounded-xl bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold shadow-xs transition">
                  💰 Confirm Deposit & Deduct Stock
                </button>
              </div>
            </div>
          `;
        }).join('');
      }

      document.getElementById('hold-inspector-modal').classList.remove('hidden');
    }

    function closeHoldInspector() {
      document.getElementById('hold-inspector-modal').classList.add('hidden');
    }

    function jumpToQuoteChat(quoteId) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === quoteId);
      let targetIdx = 0;
      if (inv && typeof inv.chatIdx === 'number') {
        targetIdx = inv.chatIdx;
      } else if (inv) {
        const foundIdx = st.chats.findIndex(c =>
          c.customer.toLowerCase().includes(inv.party.toLowerCase().replace(' (phone order)', '')) ||
          c.phone.includes(quoteId)
        );
        if (foundIdx >= 0) targetIdx = foundIdx;
      }
      currentChatIndex = targetIdx;
      switchPage('wa');
      showToast(`Opened WhatsApp chat for ${inv ? inv.party : quoteId}!`);
    }

    function setInvoiceTin(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      const entered = prompt(
        `Enter Buyer LHDN TIN for ${inv.party} (e.g. C2588190021),\nOR leave blank and click OK to mark as Monthly Consolidated e-Invoice (EI00000000010):`,
        'C2588190021'
      );
      if (entered === null) return;
      const tinClean = entered.trim();
      askUserConfirm(
        `Confirm LHDN e-Invoice TIN · #${id}`,
        tinClean
          ? `Save Buyer LHDN TIN "${tinClean}" for ${inv.party} on #${id}?`
          : `Classify #${id} (${inv.party}) under Monthly Consolidated e-Invoice (General TIN EI00000000010)?`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'SET_TIN', tin: tinClean },
              tinClean ? `Saved Buyer TIN ${tinClean} on ${id} — LHDN e-Invoice Ready!` : `Marked ${id} as Monthly Consolidated e-Invoice!`);
            return;
          }
          if (tinClean) {
            inv.lhdn = `🟢 LHDN TIN: ${tinClean}`;
            st.logs.unshift(`10:50 AM · [${currentRole}] Keyed in Buyer LHDN TIN (${tinClean}) on ${id}.`);
            showToast(`Saved Buyer TIN ${tinClean} on ${id} — LHDN e-Invoice Ready!`);
          } else {
            inv.lhdn = `🔵 Consolidated e-Invoice`;
            st.logs.unshift(`10:50 AM · [${currentRole}] Set ${id} to Monthly Consolidated e-Invoice (General TIN EI00000000010).`);
            showToast(`Marked ${id} as Monthly Consolidated e-Invoice!`);
          }
          renderAll();
        },
        '✅ Save LHDN Status'
      );
    }

    function releaseStockRow(idx) {
      const st = getState();
      const s = st.stock[idx];
      if (!s) return;
      const released = s.onHold;
      askUserConfirm(
        `Confirm Release Held Stock · ${s.sku}`,
        `Release all ${released} held units of ${s.name} (${s.sku}) back to Available Stock?`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/stock/${encodeURIComponent(s.sku)}/release`, {}, `Released ${released} units of ${s.name} back to Available Stock!`);
            return;
          }
          s.onHold = 0;
          s.holdNote = '-';
          st.invoices.forEach(inv => {
            if (inv.type === 'QUOTE_HOLD' && inv.status !== 'HOLD_RELEASED') {
              if (inv.sku === s.sku) {
                inv.status = 'HOLD_RELEASED';
                inv.type = 'PAID_DONE';
              } else if (inv.extraSku === s.sku) {
                inv.extraQty = 0;
              }
            }
          });
          st.logs.unshift(`10:50 AM · [${currentRole}] Released ${released}x ${s.name} back to Available Stock.`);
          showToast(`Released ${released} units of ${s.name} back to Available Stock!`);
          renderAll();
        },
        '🔓 Yes, Release Stock'
      );
    }

    function confirmQuoteFromTable(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      const item = st.stock.find(s => s.sku === inv.sku) || st.stock[0];
      const deposit = Math.round(inv.amount * 0.4);
      askUserConfirm(
        `Confirm Deposit & Deduct Stock · #${id}`,
        `Confirm 40% Deposit (RM ${deposit.toLocaleString()}) from ${inv.party} on #${id}?\n\n• Deduct ${inv.qty}x ${item.name} from Physical Stock\n• Add +RM ${deposit.toLocaleString()} to Cash on Hand\n• Convert Quote to Active Invoice (Balance RM ${(inv.amount - deposit).toLocaleString()})`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'CONFIRM_QUOTE' },
              `Order ${id} confirmed! Deducted ${inv.qty} units from Stock & added RM ${deposit} deposit to Cash.`);
            return;
          }
          item.onHold = Math.max(0, item.onHold - inv.qty);
          item.onHand = Math.max(0, item.onHand - inv.qty);
          if (inv.extraSku && inv.extraQty > 0) {
            const extraItem = st.stock.find(s => s.sku === inv.extraSku);
            if (extraItem) {
              extraItem.onHold = Math.max(0, extraItem.onHold - inv.extraQty);
              extraItem.onHand = Math.max(0, extraItem.onHand - inv.extraQty);
            }
          }
          st.cashOnHand += deposit;
          inv.type = 'PENDING';
          inv.amount = inv.amount - deposit;
          inv.status = 'PENDING_PAYMENT';
          inv.itemsText = `${inv.qty}x ${item.name} (STOCK DEDUCTED · Deposit RM ${deposit} Paid)`;
          st.logs.unshift(`10:50 AM · [OWNER] Confirmed Deposit RM ${deposit} on ${id} → Deducted ${inv.qty} units from Physical Stock.`);
          showToast(`Order ${id} confirmed! Deducted ${inv.qty} units from Stock & added RM ${deposit} deposit to Cash.`);
          renderAll();
        },
        '💰 Confirm Deposit & Deduct'
      );
    }

    function releaseQuoteFromTable(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      const item = st.stock.find(s => s.sku === inv.sku) || st.stock[0];
      askUserConfirm(
        `Confirm Release Quote Hold · #${id}`,
        `Release Quote Hold #${id} for ${inv.party}?\n\n• Returns +${inv.qty}x ${item.name} back to Available to Sell Stock.`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'RELEASE_QUOTE' },
              `Released Quote ${id}! +${inv.qty} units returned to Available Stock.`);
            return;
          }
          item.onHold = Math.max(0, item.onHold - inv.qty);
          if (inv.extraSku && inv.extraQty > 0) {
            const extraItem = st.stock.find(s => s.sku === inv.extraSku);
            if (extraItem) {
              extraItem.onHold = Math.max(0, extraItem.onHold - inv.extraQty);
            }
          }
          inv.status = 'HOLD_RELEASED';
          inv.type = 'PAID_DONE';
          st.logs.unshift(`10:51 AM · [${currentRole}] Released Quote Hold ${id} (+${inv.qty} units returned to Available Stock).`);
          showToast(`Released Quote ${id}! +${inv.qty} units returned to Available Stock.`);
          renderAll();
        },
        '🔓 Yes, Release Hold'
      );
    }

    function replaceFromTable(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      const item = st.stock.find(s => s.sku === inv.sku) || st.stock[1] || st.stock[0];
      askUserConfirm(
        `Confirm Aftersales Replacement · #${id}`,
        `Send 1x Replacement ${item.name} (${item.sku}) to ${inv.party}?\n\n• Deducts -1 unit from Physical Warehouse Stock.`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'REPLACE_ONE', sku: item.sku },
              `Deducted 1x ${item.name} as Aftersales Replacement! Now click 'Mark Aftersales Resolved' when done.`);
            return;
          }
          item.onHand = Math.max(0, item.onHand - 1);
          inv.status = 'REPLACEMENT_SENT';
          inv.itemsText = `4x Daikin, 4x R32 (1x Replacement ${item.name} Sent — Ready to Mark Resolved)`;
          st.logs.unshift(`10:51 AM · [OWNER] Sent 1x Replacement ${item.name} for ${id} (-1 Physical Stock).`);
          showToast(`Deducted 1x ${item.name} as Aftersales Replacement! Now click 'Mark Aftersales Resolved' when done.`);
          renderAll();
        },
        '🔄 Confirm Send Replacement'
      );
    }

    function discountFromTable(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      const entered = prompt(`Enter Credit Rebate / Discount Amount (RM) to deduct from ${id} (${inv.party}):`, '180');
      if (entered === null) return;
      const rebate = Math.max(0, parseInt(entered.trim() || '180', 10));
      askUserConfirm(
        `Confirm Aftersales Credit Rebate · #${id}`,
        `Apply RM ${rebate.toLocaleString()} Credit Rebate to #${id} (${inv.party})?\n\n• Current Balance: RM ${inv.amount.toLocaleString()}\n• New Balance After Rebate: RM ${Math.max(0, inv.amount - rebate).toLocaleString()}`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'DISCOUNT', amount: rebate },
              `Applied RM ${rebate.toLocaleString()} credit rebate on ${id}!`);
            return;
          }
          inv.amount = Math.max(0, inv.amount - rebate);
          inv.status = 'DISCOUNT_APPLIED';
          inv.itemsText = `4x Daikin, 4x R32 (RM ${rebate.toLocaleString()} Credit Rebate Applied — Ready to Mark Resolved)`;
          st.logs.unshift(`10:52 AM · [OWNER] Applied RM ${rebate.toLocaleString()} Aftersales Credit Rebate on ${id}.`);
          showToast(`Applied RM ${rebate.toLocaleString()} credit rebate on ${id}!`);
          renderAll();
        },
        `💸 Confirm RM ${rebate.toLocaleString()} Rebate`
      );
    }

    function resolveAftersales(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      askUserConfirm(
        `Confirm Resolve Aftersales · #${id}`,
        `Mark Aftersales issue for ${inv.party} (#${id}) as RESOLVED and resume normal payment collection (RM ${inv.amount.toLocaleString()})?`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'MARK_RESOLVED' },
              `${id} marked Resolved! Payment follow-up resumed.`);
            return;
          }
          inv.type = 'PENDING';
          inv.status = 'PENDING_PAYMENT';
          st.logs.unshift(`10:52 AM · [OWNER] Marked Aftersales Issue on ${id} RESOLVED → Resumed normal Pending Invoice status.`);
          showToast(`${id} marked Resolved! Payment follow-up resumed.`);
          renderAll();
        },
        '✅ Confirm Resolved'
      );
    }

    function markInvoicePaid(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      askUserConfirm(
        `Confirm Full Payment Received · #${id}`,
        `Mark Invoice #${id} (${inv.party}) as 100% PAID?\n\n• Adds +RM ${inv.amount.toLocaleString()} to Verified Cash on Hand.`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'MARK_PAID' },
              `Invoice ${id} marked PAID! Cash on Hand +RM ${inv.amount.toLocaleString()}.`);
            return;
          }
          st.cashOnHand += inv.amount;
          inv.status = 'PAID';
          inv.type = 'PAID_DONE';
          st.logs.unshift(`10:53 AM · [OWNER] Confirmed full payment of RM ${inv.amount} on ${id} (+Cash on Hand).`);
          showToast(`Invoice ${id} marked PAID! Cash on Hand +RM ${inv.amount.toLocaleString()}.`);
          renderAll();
        },
        `✅ Confirm +RM ${inv.amount.toLocaleString()} Paid`
      );
    }

    function addExtraPipingAndLabor(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      const pipe = st.stock[2] || st.stock[0];
      const pipeCharge = pipe.sellPrice * 2;
      const laborCustomerCharge = 350;
      const laborInstallerCost = 150;
      askUserConfirm(
        `Confirm Add Extra Piping & Labor · #${id}`,
        `Add Extra Piping & Installer Labor to #${id} (${inv.party})?\n\n• Physical Stock: -2x ${pipe.name} (${pipe.sku})\n• Customer Invoice: +RM ${(pipeCharge + laborCustomerCharge).toLocaleString()}\n• Installer Subcon Cost: -RM ${laborInstallerCost.toLocaleString()} from Cash`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'ADD_PIPE_LABOR', sku: pipe.sku },
              `Added Extra Piping & Labor to ${id}! Invoice +RM ${pipeCharge + laborCustomerCharge}, Installer Cost -RM ${laborInstallerCost}.`);
            return;
          }
          pipe.onHand = Math.max(0, pipe.onHand - 2);
          inv.amount += (pipeCharge + laborCustomerCharge);
          st.cashOnHand -= laborInstallerCost;
          inv.itemsText += ` + [2x ${pipe.name} (RM ${pipeCharge}) & Labor (RM ${laborCustomerCharge})]`;
          st.logs.unshift(`10:54 AM · [${currentRole}] Added Extra Piping (-2 Stock, +RM ${pipeCharge}) & Labor (+RM ${laborCustomerCharge}, -RM ${laborInstallerCost} Installer Cost) on ${id}.`);
          showToast(`Added Extra Piping & Labor to ${id}! Invoice +RM ${pipeCharge + laborCustomerCharge}, Installer Cost -RM ${laborInstallerCost}.`);
          renderAll();
        },
        '🔧 Confirm Add Piping & Labor'
      );
    }

    function paySupplierBill(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      askUserConfirm(
        `Confirm Pay Supplier Bill · #${id}`,
        `Record payment of RM ${inv.amount.toLocaleString()} to ${inv.party} (#${id})?\n\n• Deducts -RM ${inv.amount.toLocaleString()} from Cash on Hand.`,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(id)}/action`, { action: 'PAY_SUPPLIER' },
              `Paid Supplier Bill ${id}! Cash on Hand -RM ${inv.amount.toLocaleString()}.`);
            return;
          }
          st.cashOnHand -= inv.amount;
          inv.status = 'PAID_SUPPLIER';
          st.logs.unshift(`10:55 AM · [OWNER] Paid Supplier Bill ${id} (-RM ${inv.amount} Cash on Hand).`);
          showToast(`Paid Supplier Bill ${id}! Cash on Hand -RM ${inv.amount.toLocaleString()}.`);
          renderAll();
        },
        `💸 Confirm Pay RM ${inv.amount.toLocaleString()}`
      );
    }

    function setInvoiceFilter(f) {
      currentInvFilter = f;
      renderWebAppView();
    }
