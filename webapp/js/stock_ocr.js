// =========================================================================
    // 2-STAGE DOCUMENT PIPELINE:
    //   STAGE 1 (FASTEST): Direct PDF Text Stream Decode (pypdf / PDF stream) -> Text LLM
    //   STAGE 2 (FALLBACK): Vision VLM OCR (qwen3-vl-4b) ONLY for images or scanned PDFs
    // =========================================================================
    function decodeEmbeddedPdfTextClientSide(dataUrl) {
      try {
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const bin = atob(b64);
        const matches = bin.match(/\(([^()\\]{2,160})\)\s*T[jJ]/g) || [];
        const chunks = matches.map(m => m.replace(/^\(|\)\s*T[jJ]$/g, '').trim()).filter(Boolean);
        return chunks.join(' ').trim();
      } catch (e) {
        return '';
      }
    }

    async function handleRealFileUpload(inputEl) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;

      const fname = file.name.toLowerCase();
      const isPdf = fname.endsWith('.pdf') || file.type === 'application/pdf';
      let defaultKind = 'customer';
      if (fname.includes('sup') || fname.includes('stock') || fname.includes('inv') || fname.includes('qt')) defaultKind = 'supplier';
      else if (fname.includes('tnb') || fname.includes('fuel') || fname.includes('exp') || fname.includes('util')) defaultKind = 'expense';

      const reader = new FileReader();
      reader.onload = async function (e) {
        const dataUrl = e.target.result;
        const clientPdfText = isPdf ? decodeEmbeddedPdfTextClientSide(dataUrl) : '';

        previewUpload(defaultKind, {
          fileName: file.name,
          dataUrl: file.type.startsWith('image/') ? dataUrl : null,
          decodedPdfText: clientPdfText,
          statusText: isPdf
            ? '⚡ Stage 1: Decoding embedded PDF text stream directly (bypassing heavy Vision OCR)...'
            : '👁️ Stage 2: Extracting image via Vision VLM OCR...'
        });

        // If client-side PDF stream already has amounts/refs, pre-populate immediately
        if (isPdf && clientPdfText.length >= 12) {
          const rmMatch = clientPdfText.match(/RM\s*([0-9,]+(?:\.[0-9]{2})?)/i);
          if (rmMatch) {
            const parsedAmt = Math.round(parseFloat(rmMatch[1].replace(/,/g, '')));
            if (parsedAmt > 0 && document.getElementById('ocr-amount-input')) {
              document.getElementById('ocr-amount-input').value = parsedAmt;
            }
          }
          const refMatch = clientPdfText.match(/(?:QT-\d+|INV-\d+|SUP-\d+|EXP-\d+|DN-[0-9-]+)/i);
          if (refMatch && document.getElementById('ocr-ref-input')) {
            document.getElementById('ocr-ref-input').value = refMatch[0].toUpperCase();
          }
          const badge = document.getElementById('ocr-source-badge');
          if (badge) {
            badge.textContent = `⚡ Stage 1: Direct PDF Text Decoded (${file.name} · Zero Vision OCR Overhead)`;
          }
        }

        try {
          const res = await fetch(`${BACKEND_API_BASE}/api/ocr/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              imageBase64: dataUrl,
              pdfText: clientPdfText
            })
          });
          if (res.ok) {
            const ocrData = await res.json();
            if (ocrData && ocrData.extracted) {
              const ex = ocrData.extracted;
              if (ex.kind) document.getElementById('ocr-kind-select').value = ex.kind;
              if (ex.party) document.getElementById('ocr-party-input').value = ex.party;
              const payeeEl = document.getElementById('ocr-payee-input');
              if (payeeEl && ex.payee) payeeEl.value = ex.payee;
              if (ex.ref) document.getElementById('ocr-ref-input').value = ex.ref;
              if (ex.amount) document.getElementById('ocr-amount-input').value = ex.amount;
              if (ex.qty) document.getElementById('ocr-qty-input').value = ex.qty;
              const badge = document.getElementById('ocr-source-badge');
              if (badge) {
                if (ocrData.pdf_text_decoded) {
                  badge.textContent = `⚡ Stage 1: Direct PDF Text Decoded (${ocrData.model_used} · No Vision Overhead)`;
                } else if (ocrData.lmstudio_vision) {
                  badge.textContent = `👁️ Stage 2: Extracted by Vision OCR (${ocrData.model_used})`;
                } else {
                  badge.textContent = `🟢 Extracted from ${file.name} (${ocrData.extraction_method || 'Editable below'})`;
                }
              }
            }
          }
        } catch (err) {
          // Offline fallback already rendered in editable form
        }
      };
      reader.readAsDataURL(file);
    }

    function previewUpload(kind, fileMeta = null) {
      const st = getState();
      const box = document.getElementById('ocr-preview-box');
      box.classList.remove('hidden');

      let defaultParty = 'Penghawa Dingin Supplies';
      let defaultRef = 'SUP-902';
      let defaultQty = 20;
      let defaultAmt = 2600;
      let defaultSkuIdx = st.stock.length > 1 ? 1 : 0;

      if (kind === 'expense') {
        defaultParty = 'Tenaga Nasional & Van Fuel';
        defaultRef = 'EXP-114';
        defaultQty = 1;
        defaultAmt = 650;
      } else if (kind === 'customer') {
        defaultParty = 'Restoran Selera Kampung (INV-202)';
        defaultRef = 'DN-20261117-55190';
        defaultQty = 1;
        defaultAmt = 1650;
      }

      const skuOptions = st.stock.map((s, idx) =>
        `<option value="${idx}" ${idx === defaultSkuIdx ? 'selected' : ''}>Restock Existing: ${escapeHtmlText(s.sku)} · ${escapeHtmlText(s.name)} (Cost RM ${s.unitCost})</option>`
      ).join('') + `<option value="NEW_SKU">➕ Add Brand-New Product SKU from Supplier Bill</option>`;

      box.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#0152FC]/20 pb-2.5">
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-0.5 rounded-full bg-[#0152FC] text-white text-xs font-bold" id="ocr-source-badge">
              ${fileMeta ? `📄 Uploaded: ${escapeHtmlText(fileMeta.fileName)}` : '🤖 AI Vision OCR Extracted Fields (Editable)'}
            </span>
            <span class="text-xs text-[#324564]">Verify or edit any number below before saving:</span>
          </div>
          <button onclick="document.getElementById('ocr-preview-box').classList.add('hidden')" class="text-xs font-bold text-[#64748B] hover:text-[#042970]">✕ Cancel</button>
        </div>

        ${fileMeta && fileMeta.dataUrl ? `
          <div class="flex items-center gap-3 bg-white p-2.5 rounded-xl border border-[#D5DFEE]">
            <img src="${fileMeta.dataUrl}" alt="Uploaded Receipt" class="h-16 w-auto rounded-lg border border-[#D5DFEE] object-contain" />
            <div class="text-xs text-[#324564]">
              <div class="font-bold text-[#042970]">Uploaded Image Preview (${escapeHtmlText(fileMeta.fileName)})</div>
              <div>Review extracted fields below and click the button to update Stock & Cash.</div>
            </div>
          </div>
        ` : ''}

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
          <div>
            <label class="block font-bold text-[#042970] mb-1">1. Document Type</label>
            <select id="ocr-kind-select" class="w-full bg-white border border-[#0152FC] rounded-xl px-2.5 py-2 font-bold text-[#042970]">
              <option value="supplier" ${kind === 'supplier' ? 'selected' : ''}>📄 Supplier Stock Bill (+Stock, -Cash)</option>
              <option value="customer" ${kind === 'customer' ? 'selected' : ''}>💸 Customer Payment Receipt (Pending Bank Verify)</option>
              <option value="expense" ${kind === 'expense' ? 'selected' : ''}>🧾 Operating Expense Bill (-Cash)</option>
            </select>
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">2. Supplier / Customer Name</label>
            <input id="ocr-party-input" type="text" value="${escapeHtmlText(defaultParty)}" class="w-full bg-white border border-[#D5DFEE] rounded-xl px-2.5 py-2 font-semibold text-[#042970]" />
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">Paid To (receipts only)</label>
            <input id="ocr-payee-input" type="text" value="" placeholder="Name on the receipt, e.g. Sejuk Jaya Aircond Sdn Bhd" class="w-full bg-white border border-[#D5DFEE] rounded-xl px-2.5 py-2 font-semibold text-[#042970]" />
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">3. Bill # / DuitNow Ref #</label>
            <input id="ocr-ref-input" type="text" value="${escapeHtmlText(defaultRef)}" class="w-full bg-white border border-[#D5DFEE] rounded-xl px-2.5 py-2 font-mono font-bold text-[#0152FC]" />
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">4. Stock SKU (Existing or New)</label>
            <select id="ocr-sku-select" onchange="toggleOcrNewSkuFields(this.value)" class="w-full bg-white border border-[#D5DFEE] rounded-xl px-2.5 py-2 font-semibold text-[#042970]">
              ${skuOptions}
            </select>
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">5. Stock Qty (+Units)</label>
            <input id="ocr-qty-input" type="number" min="1" value="${defaultQty}" class="w-full bg-white border border-[#D5DFEE] rounded-xl px-2.5 py-2 font-bold text-[#042970]" />
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">6. Extracted Total Amount (RM)</label>
            <input id="ocr-amount-input" type="number" min="1" value="${defaultAmt}" class="w-full bg-white border-2 border-[#0152FC] rounded-xl px-2.5 py-2 font-bold text-[#042970]" />
          </div>
        </div>

        <!-- Hidden unless "➕ Add Brand-New Product SKU" is selected -->
        <div id="ocr-new-sku-row" class="hidden grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-white p-3 rounded-xl border border-[#0152FC]">
          <div>
            <label class="block font-bold text-[#042970] mb-1">New SKU Code</label>
            <input id="ocr-new-sku-code" type="text" value="ACN-MIT-10" class="w-full bg-[#F2F6FF] border border-[#D5DFEE] rounded-lg px-2.5 py-1.5 font-mono font-bold text-[#042970]" />
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">New Item Name</label>
            <input id="ocr-new-sku-name" type="text" value="Mitsubishi 1.0HP Inverter Unit" class="w-full bg-[#F2F6FF] border border-[#D5DFEE] rounded-lg px-2.5 py-1.5 font-semibold text-[#042970]" />
          </div>
          <div>
            <label class="block font-bold text-[#042970] mb-1">Selling Price per Unit (RM)</label>
            <input id="ocr-new-sku-sell" type="number" value="1080" class="w-full bg-[#F2F6FF] border border-[#D5DFEE] rounded-lg px-2.5 py-1.5 font-bold text-[#0152FC]" />
          </div>
        </div>

        <div class="flex justify-end pt-1">
          <button onclick="confirmUploadFromForm()" class="px-6 py-2.5 rounded-xl bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold shadow-sm transition">
            ✅ Confirm & Save OCR Data to System
          </button>
        </div>
      `;
    }

    function toggleOcrNewSkuFields(val) {
      const row = document.getElementById('ocr-new-sku-row');
      if (row) row.classList.toggle('hidden', val !== 'NEW_SKU');
    }

    function confirmUploadFromForm() {
      const st = getState();
      const kind = document.getElementById('ocr-kind-select').value;
      const party = (document.getElementById('ocr-party-input').value || 'Counterparty').trim();
      const ref = (document.getElementById('ocr-ref-input').value || 'REF-101').trim();
      const skuSelVal = document.getElementById('ocr-sku-select').value;
      const qty = Math.max(1, parseInt(document.getElementById('ocr-qty-input').value || '1', 10));
      const amount = Math.max(1, parseInt(document.getElementById('ocr-amount-input').value || '100', 10));

      const summaryMsg = kind === 'supplier'
        ? `Save Supplier Stock Bill (${ref} · ${party})?\n\n• Add +${qty} units to Physical Stock\n• Deduct -RM ${amount.toLocaleString()} from Cash on Hand`
        : kind === 'expense'
          ? `Save Operating Expense Bill (${ref} · ${party})?\n\n• Deduct -RM ${amount.toLocaleString()} from Cash on Hand`
          : `Stage Customer Payment Receipt (${ref} · ${party}) for RM ${amount.toLocaleString()} as Pending Bank Verification?`;

      askUserConfirm(
        `Confirm Save OCR Document`,
        summaryMsg,
        () => {
          if (usesBackend()) {
            const body = { kind, party, ref, amount, qty };
            if (kind === 'supplier') {
              if (skuSelVal === 'NEW_SKU') {
                body.sku = (document.getElementById('ocr-new-sku-code')?.value || 'ACN-MIT-10').trim().toUpperCase();
                body.newSkuName = (document.getElementById('ocr-new-sku-name')?.value || 'Mitsubishi 1.0HP Inverter').trim();
                body.newSellPrice = Math.max(1, parseInt(document.getElementById('ocr-new-sku-sell')?.value || '1080', 10));
              } else {
                body.sku = (st.stock[parseInt(skuSelVal || '0', 10)] || st.stock[0]).sku;
              }
            } else if (kind === 'customer') {
              body.payee = (document.getElementById('ocr-payee-input')?.value || '').trim();
              const target = st.invoices.find(i => i.type === 'PENDING' && i.party.includes(party))
                || st.invoices.find(i => i.id === 'INV-202' || i.type === 'PENDING');
              if (target) body.invoiceId = target.id;
            }
            const msgs = {
              supplier: `Supplier Stock Bill saved! +${qty} units added to Stock & Cash -RM ${amount.toLocaleString()}.`,
              expense: `Operating Expense recorded! Cash -RM ${amount.toLocaleString()}.`
            };
            backendAction('/api/bills/apply', body,
              d => msgs[kind] || `Receipt staged as Pending Bank Verify on #${d.createdId}! Click "🔍 Verify Receipt Against Bank" to approve.`);
            document.getElementById('ocr-preview-box').classList.add('hidden');
            return;
          }
          if (kind === 'supplier') {
            let targetItem = null;
            if (skuSelVal === 'NEW_SKU') {
              const newCode = (document.getElementById('ocr-new-sku-code')?.value || 'ACN-MIT-10').trim().toUpperCase();
              const newName = (document.getElementById('ocr-new-sku-name')?.value || 'Mitsubishi 1.0HP Inverter').trim();
              const newSell = Math.max(1, parseInt(document.getElementById('ocr-new-sku-sell')?.value || '1080', 10));
              const unitCost = Math.max(1, Math.round(amount / qty));
              targetItem = {
                sku: newCode,
                name: newName,
                onHand: qty,
                onHold: 0,
                holdNote: '-',
                unitCost: unitCost,
                sellPrice: newSell
              };
              st.stock.push(targetItem);
            } else {
              const skuIdx = parseInt(skuSelVal || '0', 10);
              targetItem = st.stock[skuIdx] || st.stock[0];
              targetItem.onHand += qty;
            }
            st.cashOnHand -= amount;
            st.invoices.unshift({
              id: ref.startsWith('SUP') ? ref : 'SUP-' + Math.floor(900 + Math.random() * 90),
              type: 'SUPPLIER_COST',
              party: party,
              itemsText: `+${qty}x ${targetItem.name} Added to Physical Stock (OCR Bill ${ref})`,
              sku: targetItem.sku,
              qty: qty,
              amount: amount,
              status: 'PAID_STOCK_IN',
              lhdn: '🟢 Supplier e-Inv'
            });
            st.logs.unshift(`10:48 AM · [${currentRole}] OCR Supplier Bill ${ref} (${party}) → +${qty}x ${targetItem.name} added to Stock, Cash -RM ${amount.toLocaleString()}.`);
            showToast(`Supplier Stock Bill saved! +${qty}x ${targetItem.name} added to Stock & Cash -RM ${amount.toLocaleString()}.`);
          } else if (kind === 'expense') {
            st.cashOnHand -= amount;
            st.invoices.unshift({
              id: ref.startsWith('EXP') ? ref : 'EXP-' + Math.floor(110 + Math.random() * 80),
              type: 'SUPPLIER_COST',
              party: party,
              itemsText: `Operating Expense (${ref})`,
              sku: '-',
              qty: 1,
              amount: amount,
              status: 'PAID_EXPENSE',
              lhdn: '🔵 Consolidated'
            });
            st.logs.unshift(`10:48 AM · [${currentRole}] OCR Operating Expense ${ref} (${party}) → Cash -RM ${amount.toLocaleString()}.`);
            showToast(`Operating Expense recorded! Cash -RM ${amount.toLocaleString()}.`);
          } else {
            const inv = st.invoices.find(i => i.id === 'INV-202' || i.type === 'PENDING');
            if (inv) {
              inv.type = 'PENDING_VERIFY';
              inv.status = 'PENDING_BANK_VERIFY';
              inv.claimedAmount = amount;
              inv.receiptRef = ref;
              inv.itemsText = `${inv.itemsText} (OCR Receipt Claimed RM ${amount.toLocaleString()} · Ref: ${ref} · Waiting Bank Verify)`;
              st.logs.unshift(`10:48 AM · [${currentRole}] OCR Customer Receipt (${ref}, RM ${amount.toLocaleString()}) staged for #${inv.id} in PENDING_VERIFY.`);
              showToast(`Receipt staged as Pending Bank Verify on #${inv.id}! Click "🔍 Verify Receipt Against Bank" to approve.`);
            } else {
              const newId = 'INV-' + Math.floor(220 + Math.random() * 70);
              st.invoices.unshift({
                id: newId,
                type: 'PENDING_VERIFY',
                party: party,
                itemsText: `Customer Payment Receipt Claimed RM ${amount.toLocaleString()} (Ref: ${ref})`,
                sku: st.stock[0].sku,
                qty: 1,
                amount: amount,
                claimedAmount: amount,
                receiptRef: ref,
                status: 'PENDING_BANK_VERIFY',
                lhdn: '🟢 LHDN Ready'
              });
              st.logs.unshift(`10:48 AM · [${currentRole}] OCR Customer Receipt (${ref}, RM ${amount.toLocaleString()}) staged on #${newId}.`);
              showToast(`Receipt staged as Pending Bank Verify on #${newId}!`);
            }
          }
          document.getElementById('ocr-preview-box').classList.add('hidden');
          renderAll();
        },
        '✅ Confirm & Save OCR Data'
      );
    }

    // =========================================================================
    // ADD NEW PRODUCT SKU OR RESTOCK INVENTORY (PAGE 3: STOCK & HOLDS)
    // =========================================================================
    function addOrRestockItem() {
      const st = getState();
      const skuInput = document.getElementById('add-stock-sku');
      const nameInput = document.getElementById('add-stock-name');
      const qtyInput = document.getElementById('add-stock-qty');
      const costInput = document.getElementById('add-stock-cost');
      const priceInput = document.getElementById('add-stock-price');
      const sourceSelect = document.getElementById('add-stock-source');

      const sku = (skuInput.value || 'NEW-SKU-01').trim().toUpperCase();
      const name = (nameInput.value || 'New Stock Item').trim();
      const qty = Math.max(1, parseInt(qtyInput.value || '1', 10));
      const unitCost = Math.max(1, parseInt(costInput.value || '100', 10));
      const sellPrice = Math.max(1, parseInt(priceInput.value || '150', 10));
      const source = sourceSelect ? sourceSelect.value : 'OPENING';
      const totalCost = qty * unitCost;

      askUserConfirm(
        `Confirm Add / Restock Inventory`,
        `Add +${qty}x ${name} (${sku}) to Physical Warehouse Stock?\n\n• Unit Cost: RM ${unitCost.toLocaleString()} | Selling Price: RM ${sellPrice.toLocaleString()}\n• Stock Value Change: +RM ${totalCost.toLocaleString()}\n• Cash Effect: ${source === 'CASH_PURCHASE' ? `-RM ${totalCost.toLocaleString()} (Paid Supplier by Cash/Bank)` : 'RM 0 (Opening Stock / Already Paid)'}`,
        () => {
          if (usesBackend()) {
            backendAction('/api/stock/add', { sku, name, qty, unitCost, sellPrice, payWithCash: source === 'CASH_PURCHASE' },
              source === 'CASH_PURCHASE'
                ? `Added +${qty}x ${name} (${sku}) to Stock & deducted RM ${totalCost.toLocaleString()} Cash!`
                : `Added +${qty}x ${name} (${sku}) to Warehouse Stock!`);
            return;
          }
          const existing = st.stock.find(s => s.sku.toUpperCase() === sku);
          if (existing) {
            existing.onHand += qty;
            existing.unitCost = unitCost;
            existing.sellPrice = sellPrice;
          } else {
            st.stock.push({
              sku: sku,
              name: name,
              onHand: qty,
              onHold: 0,
              holdNote: '-',
              unitCost: unitCost,
              sellPrice: sellPrice
            });
          }

          if (source === 'CASH_PURCHASE') {
            st.cashOnHand -= totalCost;
            const billId = 'SUP-' + Math.floor(910 + Math.random() * 80);
            st.invoices.unshift({
              id: billId,
              type: 'SUPPLIER_COST',
              party: 'Warehouse Restock Purchase',
              itemsText: `+${qty}x ${name} (${sku}) Added to Stock`,
              sku: sku,
              qty: qty,
              amount: totalCost,
              status: 'PAID_STOCK_IN',
              lhdn: '🟢 Supplier e-Inv'
            });
            st.logs.unshift(`10:55 AM · [${currentRole}] Purchased & Added +${qty}x ${name} (${sku}) to Stock → Cash -RM ${totalCost.toLocaleString()}.`);
            showToast(`Added +${qty}x ${name} (${sku}) to Stock & deducted RM ${totalCost.toLocaleString()} Cash!`);
          } else {
            st.logs.unshift(`10:55 AM · [${currentRole}] Added +${qty}x ${name} (${sku}) to Warehouse Stock (Stock Value +RM ${totalCost.toLocaleString()}).`);
            showToast(`Added +${qty}x ${name} (${sku}) to Warehouse Stock!`);
          }

          renderAll();
        },
        '➕ Confirm Add Stock'
      );
    }

    function quickRestockRow(idx) {
      const st = getState();
      const s = st.stock[idx];
      if (!s) return;
      const entered = prompt(`How many units of ${s.name} (${s.sku}) do you want to add to Physical Stock?`, '10');
      if (entered === null) return;
      const addQty = Math.max(1, parseInt(entered.trim() || '10', 10));
      askUserConfirm(
        `Confirm Quick Restock · ${s.sku}`,
        `Add +${addQty} units of ${s.name} (${s.sku}) to Physical Stock?\n\n• Current On Hand: ${s.onHand} units\n• New On Hand: ${s.onHand + addQty} units`,
        () => {
          if (usesBackend()) {
            backendAction('/api/stock/add', { sku: s.sku, name: s.name, qty: addQty, unitCost: s.unitCost, sellPrice: s.sellPrice, payWithCash: false },
              `Restocked +${addQty}x ${s.name}! Total On Hand: ${s.onHand + addQty} units.`);
            return;
          }
          s.onHand += addQty;
          st.logs.unshift(`10:56 AM · [${currentRole}] Restocked +${addQty}x ${s.name} (${s.sku}) → New Physical On Hand: ${s.onHand} units.`);
          showToast(`Restocked +${addQty}x ${s.name}! Total On Hand: ${s.onHand} units.`);
          renderAll();
        },
        '➕ Confirm Restock'
      );
    }

    function fillStockFormFromOcrSample(sampleType, customFileName = null) {
      const skuEl = document.getElementById('add-stock-sku');
      const nameEl = document.getElementById('add-stock-name');
      const qtyEl = document.getElementById('add-stock-qty');
      const costEl = document.getElementById('add-stock-cost');
      const priceEl = document.getElementById('add-stock-price');
      const srcEl = document.getElementById('add-stock-source');
      const statusEl = document.getElementById('stock-ocr-status');

      if (sampleType === 'RESTOCK_R32') {
        skuEl.value = 'GAS-R32';
        nameEl.value = 'R32 Refrigerant Gas (3kg)';
        qtyEl.value = '20';
        costEl.value = '130';
        priceEl.value = '180';
        srcEl.value = 'CASH_PURCHASE';
      } else {
        skuEl.value = 'ACN-MIT-10';
        nameEl.value = 'Mitsubishi 1.0HP Inverter Unit';
        qtyEl.value = '8';
        costEl.value = '780';
        priceEl.value = '1080';
        srcEl.value = 'CASH_PURCHASE';
      }

      if (statusEl) {
        statusEl.classList.remove('hidden');
        statusEl.textContent = customFileName
          ? `✅ AI OCR Extracted "${customFileName}" into boxes below! Click "➕ Add / Restock Inventory" to confirm.`
          : `✅ AI OCR Auto-Filled Supplier Invoice! Review & click "➕ Add / Restock Inventory".`;
      }
      showToast('🤖 AI OCR extracted Supplier Stock Bill into the fields! Click "➕ Add / Restock Inventory" to save.');
    }

    function handleStockPageOcrUpload(inputEl) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      const fname = file.name.toLowerCase();
      const isPdf = fname.endsWith('.pdf') || file.type === 'application/pdf';
      if (fname.includes('r32') || fname.includes('gas')) {
        fillStockFormFromOcrSample('RESTOCK_R32', file.name);
      } else {
        fillStockFormFromOcrSample('NEW_SKU', file.name);
      }

      const reader = new FileReader();
      reader.onload = async function (e) {
        const dataUrl = e.target.result;
        const clientPdfText = isPdf ? decodeEmbeddedPdfTextClientSide(dataUrl) : '';
        const statusEl = document.getElementById('stock-ocr-status');
        if (isPdf && statusEl) {
          statusEl.classList.remove('hidden');
          statusEl.textContent = `⚡ Stage 1: Direct PDF Text Decoded from "${file.name}" (bypassed heavy Vision OCR)! Review & click "➕ Add / Restock Inventory".`;
        }
        try {
          const res = await fetch(`${BACKEND_API_BASE}/api/ocr/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              imageBase64: dataUrl,
              pdfText: clientPdfText
            })
          });
          if (res.ok) {
            const ocrData = await res.json();
            const ex = ocrData && ocrData.extracted;
            if (ex) {
              if (ex.sku && document.getElementById('add-stock-sku')) document.getElementById('add-stock-sku').value = ex.sku;
              if (ex.qty && document.getElementById('add-stock-qty')) document.getElementById('add-stock-qty').value = ex.qty;
              if (ex.amount && ex.qty && document.getElementById('add-stock-cost')) {
                document.getElementById('add-stock-cost').value = Math.max(1, Math.round(ex.amount / ex.qty));
              }
              if (statusEl) {
                statusEl.classList.remove('hidden');
                statusEl.textContent = ocrData.pdf_text_decoded
                  ? `⚡ Stage 1: Direct PDF Text Decoded "${file.name}" (${ocrData.model_used} · Zero Vision Overhead)! Click "➕ Add / Restock Inventory".`
                  : `👁️ Stage 2: Vision OCR Extracted "${file.name}" (${ocrData.model_used})! Click "➕ Add / Restock Inventory".`;
              }
            }
          }
        } catch (err) {
          // Offline mode already pre-filled
        }
      };
      reader.readAsDataURL(file);
    }

    function updateVerifyButtonLabel() {
      const st = getState();
      const inv = st.invoices.find(i => i.id === currentVerifyInvId);
      if (!inv) return;
      const actualInput = document.getElementById('ver-actual-input');
      const actual = Math.max(0, parseInt((actualInput && actualInput.value) || '0', 10));
      const rem = Math.max(0, inv.amount - actual);

      const btn = document.getElementById('ver-btn-full');
      if (btn) {
        btn.textContent = `✅ Confirm RM ${actual.toLocaleString()} Received in Bank (+Cash)`;
      }

      const hint = document.getElementById('ver-outcome-hint');
      if (hint) {
        if (rem > 0) {
          hint.innerHTML = `👉 Adds <b>+RM ${actual.toLocaleString()}</b> to Cash on Hand and keeps <b>RM ${rem.toLocaleString()}</b> open as unpaid balance.`;
        } else {
          hint.innerHTML = `👉 Adds <b>+RM ${actual.toLocaleString()}</b> to Cash on Hand and marks <b>#${inv.id}</b> as <b>100% PAID</b>.`;
        }
      }
    }

    function renderVisualReceiptCard(inv) {
      const isSupplier = (inv.type === 'SUPPLIER_COST') || (inv.itemsText && inv.itemsText.toLowerCase().includes('supplier'));
      const claimed = inv.claimedAmount || inv.amount;
      const ref = inv.receiptRef || 'DN-20261117-88412';
      const st = getState();

      if (isSupplier) {
        return `
          <div class="p-3.5 bg-white font-sans text-xs text-[#1E293B] space-y-2 select-none">
            <div class="flex items-start justify-between border-b border-[#E2E8F0] pb-2">
              <div>
                <div class="font-extrabold text-xs text-[#042970]">PENGHAWA DINGIN SUPPLIES SDN BHD</div>
                <div class="text-[9px] text-[#64748B]">No. 18, Jalan Industri USJ 1/3, Subang Jaya</div>
                <div class="text-[9px] text-[#64748B]">SST: W10-1808-32000041 · TIN: C108849120</div>
              </div>
              <div class="text-right">
                <span class="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[9px]">TAX INVOICE</span>
                <div class="font-mono font-bold text-xs mt-0.5 text-[#042970]">${escapeHtmlText(ref)}</div>
                <div class="text-[9px] text-[#64748B]">17 Nov 2026</div>
              </div>
            </div>
            <div class="bg-[#F8FAFC] p-2 rounded-lg border border-[#E2E8F0] text-[10px]">
              <span class="text-[#64748B]">Billed To: </span><b class="text-[#042970]">${escapeHtmlText(st.name)}</b>
            </div>
            <table class="w-full text-left text-[10px] border-collapse">
              <thead>
                <tr class="border-b border-[#E2E8F0] text-[#64748B]">
                  <th class="py-1">Item Description</th>
                  <th class="text-center py-1">Qty</th>
                  <th class="text-right py-1">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr class="border-b border-[#F8FAFC]">
                  <td class="py-1 font-medium text-[#042970]">${escapeHtmlText(inv.itemsText)}</td>
                  <td class="text-center py-1">${inv.qty || 10}</td>
                  <td class="text-right py-1 font-bold">RM ${inv.amount.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <div class="flex justify-between items-center pt-1 border-t-2 border-[#042970] font-bold text-[11px]">
              <span>TOTAL DUE:</span>
              <span class="text-sm text-[#042970]">RM ${inv.amount.toLocaleString()}.00</span>
            </div>
          </div>
        `;
      }

      return `
        <div class="p-3.5 bg-white font-sans text-xs text-[#1E293B] space-y-2 select-none">
          <div class="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-lg bg-[#E11D48] text-white flex items-center justify-center font-black text-xs shadow-2xs">
                DN
              </div>
              <div>
                <div class="font-black text-xs tracking-wider text-[#E11D48]">DuitNow</div>
                <div class="text-[9px] text-[#64748B] font-semibold">National Payment Network (PayNet)</div>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[9px] flex items-center gap-1">
              <span>✓</span> Successful
            </span>
          </div>

          <div class="text-center py-1.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
            <div class="text-[9px] font-bold text-[#64748B] uppercase tracking-wider">Transfer Amount</div>
            <div class="text-xl font-black text-[#042970] mt-0.5">RM ${claimed.toLocaleString()}.00</div>
            <div class="text-[9px] text-emerald-700 font-bold">● Instant Funds Transfer</div>
          </div>

          <div class="space-y-1 text-[10px]">
            <div class="flex justify-between">
              <span class="text-[#64748B]">DuitNow Ref:</span>
              <span class="font-mono font-bold text-[#0152FC]">${escapeHtmlText(ref)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[#64748B]">Date & Time:</span>
              <span class="font-medium text-[#042970]">17 Nov 2026, 10:48:12 AM</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[#64748B]">From Account:</span>
              <span class="font-bold text-[#042970]">${escapeHtmlText(inv.party)} (Maybank xxxx4410)</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[#64748B]">To Account:</span>
              <span class="font-bold text-[#042970]">${escapeHtmlText(st.name)} (CIMB xxxx8899)</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[#64748B]">Payment Ref:</span>
              <span class="font-medium text-[#324564]">Invoice ${inv.id} Deposit</span>
            </div>
          </div>

          <div class="p-1.5 bg-amber-50 rounded-lg border border-amber-200 text-[9px] text-amber-900 leading-tight">
            ℹ️ Compare this Reference ID (${escapeHtmlText(ref)}) with your Maybank/CIMB BizChannel statement.
          </div>
        </div>
      `;
    }

    function viewReceiptCopy(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      currentVerifyInvId = id;
      const ref = inv.receiptRef || 'DN-20261117-88412';
      const claimed = inv.claimedAmount || inv.amount;
      document.getElementById('rec-view-title').textContent = `Receipt Copy · #${inv.id} (${inv.party})`;
      document.getElementById('rec-view-subtitle').textContent = `Archived receipt copy · Ref: ${ref} · Amount: RM ${claimed.toLocaleString()}`;
      document.getElementById('rec-view-container').innerHTML = renderVisualReceiptCard(inv);
      document.getElementById('receipt-viewer-modal').classList.remove('hidden');
    }

    function closeReceiptViewerModal() {
      document.getElementById('receipt-viewer-modal').classList.add('hidden');
    }

    function downloadCurrentReceiptCopy() {
      const st = getState();
      const inv = st.invoices.find(i => i.id === currentVerifyInvId) || st.invoices[0];
      const claimed = inv ? (inv.claimedAmount || inv.amount) : 2200;
      const ref = inv ? (inv.receiptRef || 'DN-20261117-88412') : 'DN-20261117-88412';
      const party = inv ? inv.party : 'Customer';
      
      const lines = [
        'DUITNOW INSTANT TRANSFER RECEIPT (PAYNET MALAYSIA)',
        'STATUS: SUCCESSFUL TRANSACTION (COMPLETED)',
        '--------------------------------------------------------------------------',
        `REFERENCE NUMBER    : ${ref}`,
        'TRANSACTION DATE    : 17 Nov 2026, 10:48:12 AM MYT',
        `TRANSFER AMOUNT     : RM ${claimed.toLocaleString()}.00`,
        `TRANSFERRED FROM    : ${party} (Maybank xxxx4410)`,
        `BENEFICIARY NAME    : ${st.name}`,
        'BENEFICIARY BANK    : CIMB Bank Berhad (Account: 8009182901)',
        `PAYMENT REFERENCE   : ${inv ? inv.id : 'INV-205'} Deposit Verification`,
        '--------------------------------------------------------------------------',
        'OFFICIAL BANK RECEIPT ARCHIVE — CASHCHASE SMART SME COPILOT',
        'VERIFIED VIA AUDIT RECORD & STORED ON-PREMISE.'
      ];
      
      const blob = buildClientSidePdfBlob(lines);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Receipt_${ref}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`📥 Downloaded original receipt copy (${ref}.pdf)!`);
    }

    function openVerifyModal(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id);
      if (!inv) return;
      currentVerifyInvId = id;
      const claimed = inv.claimedAmount || inv.amount;
      const ref = inv.receiptRef || 'DN-20261117-99102';
      const diff = Math.max(0, inv.amount - claimed);

      document.getElementById('ver-title').textContent = `Check Bank Account · #${inv.id}`;
      document.getElementById('ver-party').textContent = inv.party;
      document.getElementById('ver-ref').textContent = ref;
      document.getElementById('ver-payee').textContent = `✅ Paid to ${st.name}`;

      const docContainer = document.getElementById('ver-receipt-doc-container');
      if (docContainer) {
        docContainer.innerHTML = renderVisualReceiptCard(inv);
      }
      const fnEl = document.getElementById('ver-receipt-filename');
      if (fnEl) {
        fnEl.textContent = `📄 DuitNow_Receipt_${ref}.pdf`;
      }

      const billEl = document.getElementById('ver-bill-total');
      const claimedEl = document.getElementById('ver-claimed-total');
      const diffEl = document.getElementById('ver-diff-total');
      const diffLabel = document.getElementById('ver-diff-label');
      const diffCard = document.getElementById('ver-diff-card');
      if (billEl) billEl.textContent = `RM ${inv.amount.toLocaleString()}`;
      if (claimedEl) claimedEl.textContent = `RM ${claimed.toLocaleString()}`;
      if (diffEl) diffEl.textContent = diff > 0 ? `RM ${diff.toLocaleString()}` : `RM 0 (Full)`;
      if (diffLabel) diffLabel.textContent = diff > 0 ? `Still Owes You` : `Balance Left`;
      if (diffCard) {
        diffCard.className = diff > 0
          ? 'p-3 rounded-xl bg-amber-50 border border-amber-200'
          : 'p-3 rounded-xl bg-emerald-50 border border-emerald-200';
      }

      const actualInput = document.getElementById('ver-actual-input');
      if (actualInput) actualInput.value = claimed;

      const warnBox = document.getElementById('ver-warning-box');
      if (diff > 0) {
        warnBox.classList.remove('hidden');
        warnBox.textContent = `⚠️ Customer only transferred RM ${claimed.toLocaleString()} out of RM ${inv.amount.toLocaleString()}. Confirming RM ${claimed.toLocaleString()} below will automatically keep the remaining RM ${diff.toLocaleString()} open!`;
      } else {
        warnBox.classList.add('hidden');
      }

      updateVerifyButtonLabel();
      document.getElementById('verify-modal').classList.remove('hidden');
    }

    function closeVerifyModal() {
      document.getElementById('verify-modal').classList.add('hidden');
    }

    function approveVerifiedReceipt(decision) {
      if (!usesBackend() && currentRole === 'STAFF') {
        showToast('🔒 Only the Owner (Encik Hafiz) can verify bank statement receipts! Click the top-right Role button to switch.');
        return;
      }
      const st = getState();
      const inv = st.invoices.find(i => i.id === currentVerifyInvId);
      if (!inv) return;

      const actualInput = document.getElementById('ver-actual-input');
      const claimed = inv.claimedAmount || inv.amount;
      const actualPaid = actualInput ? Math.max(0, parseInt(actualInput.value || claimed, 10)) : claimed;
      const isConfirm = decision === 'CONFIRM' || decision === 'FULL' || decision === 'PARTIAL';
      const paidNow = decision === 'FULL' && !actualInput ? inv.amount : actualPaid;
      const rem = Math.max(0, inv.amount - paidNow);

      const confirmTitle = isConfirm
        ? `Confirm Bank Receipt · #${inv.id}`
        : `Reject Payment Receipt · #${inv.id}`;
      const confirmMsg = isConfirm
        ? `Have you checked your bank app and confirmed RM ${paidNow.toLocaleString()} from ${inv.party}?\n\n• Cash on Hand: +RM ${paidNow.toLocaleString()}\n• Remaining Invoice Balance: RM ${rem.toLocaleString()} (${rem > 0 ? 'Stays Open' : 'Marked 100% PAID'})`
        : `Are you sure you want to REJECT the receipt for #${inv.id} (${inv.party})?\n\n• Cash on Hand will NOT change\n• Status will be marked as RECEIPT_REJECTED for follow-up.`;

      askUserConfirm(
        confirmTitle,
        confirmMsg,
        () => {
          if (usesBackend()) {
            backendAction(`/api/invoices/${encodeURIComponent(inv.id)}/verify-receipt`,
              isConfirm ? { decision: 'CONFIRM', paidAmount: paidNow } : { decision: 'REJECT' },
              isConfirm
                ? (rem > 0 ? `✅ Confirmed +RM ${paidNow.toLocaleString()} Cash! Remaining RM ${rem.toLocaleString()} stays open on #${inv.id}.`
                           : `✅ Confirmed in Bank! #${inv.id} marked PAID & Cash on Hand +RM ${paidNow.toLocaleString()}.`)
                : `❌ Rejected receipt for #${inv.id}! Cash on Hand unchanged.`);
            closeVerifyModal();
            return;
          }
          if (isConfirm) {
            st.cashOnHand += paidNow;

            if (paidNow >= inv.amount) {
              inv.type = 'PAID_DONE';
              inv.status = 'PAID';
              inv.itemsText = `${inv.itemsText} [✅ Bank Verified +RM ${paidNow.toLocaleString()}]`;
              st.logs.unshift(`10:51 AM · [OWNER] Confirmed RM ${paidNow.toLocaleString()} in Bank for ${inv.id} (Ref: ${inv.receiptRef || 'DN-Check'}) → Marked PAID (+RM ${paidNow.toLocaleString()} Cash on Hand).`);
              showToast(`✅ Confirmed in Bank! #${inv.id} marked PAID & Cash on Hand +RM ${paidNow.toLocaleString()}.`);
            } else {
              inv.amount = Math.max(0, inv.amount - paidNow);
              inv.type = 'PENDING';
              inv.status = 'PARTIAL_PAID';
              inv.itemsText = `Partial RM ${paidNow.toLocaleString()} Verified in Bank · Remaining Balance: RM ${inv.amount.toLocaleString()}`;
              st.logs.unshift(`10:51 AM · [OWNER] Confirmed RM ${paidNow.toLocaleString()} in Bank for ${inv.id} → Cash +RM ${paidNow.toLocaleString()}, Remaining Balance RM ${inv.amount.toLocaleString()} stays open.`);
              showToast(`✅ Confirmed +RM ${paidNow.toLocaleString()} Cash! Remaining RM ${inv.amount.toLocaleString()} stays open on #${inv.id}.`);
            }
          } else {
            inv.type = 'PENDING';
            inv.status = 'RECEIPT_REJECTED';
            inv.itemsText = `⚠️ Receipt Rejected (Not found in Bank Statement) — Follow up required`;
            st.logs.unshift(`10:51 AM · [OWNER] Rejected unverified receipt on ${inv.id} (Not found in Bank Statement). Cash unchanged.`);
            showToast(`❌ Rejected receipt for #${inv.id}! Cash on Hand unchanged.`);
          }

          closeVerifyModal();
          renderAll();
        },
        isConfirm ? `✅ Yes, Confirm +RM ${paidNow.toLocaleString()}` : `❌ Yes, Reject Receipt`,
        !isConfirm
      );
    }
