// =========================================================================
    // WHATSAPP EXTENSION VIEW (1 GIANT OBVIOUS BUTTON)
    // =========================================================================
    function renderWhatsAppView() {
      const st = getState();
      if (currentChatIndex >= st.chats.length) currentChatIndex = 0;
      const chatListEl = document.getElementById('wa-chat-list');

      chatListEl.innerHTML = st.chats.map((c, idx) => {
        const active = idx === currentChatIndex;
        const last = c.messages && c.messages.length ? c.messages[c.messages.length - 1] : null;
        const initials = String(c.customer).replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('');
        return `
          <button onclick="selectChat(${idx})" class="wa-chat ${active ? 'is-active' : ''}" aria-current="${active}">
            <span class="wa-avatar">${initials}</span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-2">
                <span class="font-semibold text-sm text-[#042970] truncate">${escapeHtmlText(c.customer)}</span>
                ${c.done ? '<svg class="w-4 h-4 text-emerald-600 shrink-0" aria-label="Done"><use href="#i-check"/></svg>' : `<span class="text-[11px] text-[#5B6B85] shrink-0">${last ? last.time : ''}</span>`}
              </span>
              <span class="block text-xs text-[#5B6B85] truncate">${escapeHtmlText(last ? last.text : '')}</span>
              <span class="cc-pill !text-[11px] !py-0 mt-1">${escapeHtmlText(String(c.badge).replace(/^\d+\.\s*/, ''))}</span>
            </span>
          </button>
        `;
      }).join('');

      const activeChat = st.chats[currentChatIndex];
      if (!activeChat) {
        // Nothing loaded yet (backend offline) or no demo chats for this business
        document.getElementById('wa-active-name').textContent = '—';
        document.getElementById('wa-active-sub').textContent = '';
        document.getElementById('wa-scenario-badge').textContent = '';
        document.getElementById('wa-messages').innerHTML = `<p class="text-xs text-[#5B6B85] p-4">${backendOnline ? 'No demo chats for this business.' : 'Backend offline — start it with python run_server.py'}</p>`;
        const extBody = document.getElementById('ext-panel-body');
        if (extBody) extBody.innerHTML = '';
        return;
      }
      document.getElementById('wa-active-name').textContent = activeChat.customer;
      document.getElementById('wa-active-sub').textContent = activeChat.phone;
      document.getElementById('wa-scenario-badge').textContent = activeChat.badge;

      const msgContainer = document.getElementById('wa-messages');
      msgContainer.innerHTML = activeChat.messages.map(m => {
        const isStaff = m.from === 'staff';
        const hasAtt = m.attachment;
        return `
          <div class="flex ${isStaff ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs shadow-xs space-y-1.5 ${
              isStaff
                ? 'wa-bubble-out'
                : 'wa-bubble-in'
            }">
              ${hasAtt ? `
                <${hasAtt.url ? `a href="${escapeHtmlText(hasAtt.url)}" target="_blank" rel="noopener" title="Open ${escapeHtmlText(hasAtt.name || 'PDF')}"` : 'div'} class="p-2.5 rounded-xl bg-white/70 border border-black/5 flex items-center gap-3">
                  <div class="w-9 h-9 rounded-lg bg-rose-500 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                    PDF
                  </div>
                  <div class="overflow-hidden text-left flex-1">
                    <div class="font-bold truncate text-[#042970]">${escapeHtmlText(hasAtt.name || 'Document.pdf')}</div>
                    <div class="text-[10px] text-[#5B6B85] flex items-center gap-2">
                      <span>${escapeHtmlText(hasAtt.size || '142 KB')}</span>
                      ${hasAtt.url
                        ? '<span class="px-1.5 rounded-full bg-blue-100 text-blue-800 font-semibold">Open PDF</span>'
                        : '<span class="px-1.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Read by AI</span>'}
                    </div>
                  </div>
                </${hasAtt.url ? 'a' : 'div'}>
              ` : ''}
              <div>${escapeHtmlText(m.text)}</div>
              <div class="text-[10px] opacity-75 text-right">${m.time}</div>
            </div>
          </div>
        `;
      }).join('');

      const extBody = document.getElementById('ext-panel-body');
      const needsOwner = activeChat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT' || activeChat.extActionType === 'AFTERSALES_REPLACE';
      // Backend profile: follow the Owner's Team & Permissions settings; demo profiles keep the old Owner-only rule.
      const execPermissionKey = { SAVE_LHDN_TIN: 'invoice.set_tin', CREATE_QUOTE_HOLD: 'quote.create', CONFIRM_DEPOSIT_DEDUCT: 'deposit.confirm', AFTERSALES_REPLACE: 'aftersales.replace', RELEASE_EXPIRED_HOLD: 'quote.release' }[activeChat.extActionType];
      const roleMode = usesBackend() ? (execPermissionKey ? staffModeFor(execPermissionKey) : 'ALLOW') : (needsOwner && currentRole === 'STAFF' ? 'APPROVAL' : 'ALLOW');
      const blockedByRole = roleMode !== 'ALLOW';
      const replyOptions = getReplyOptionsForChat(activeChat);
      const selectedIdx = typeof activeChat.selectedReplyIdx === 'number' ? activeChat.selectedReplyIdx : 0;
      const selectedOpt = replyOptions[selectedIdx] || replyOptions[0];

      // Primary button label follows the chosen aftersales option
      let dynamicBtnLabel = activeChat.extBtnLabel;
      if (activeChat.extActionType === 'AFTERSALES_REPLACE') {
        const rebateVal = typeof activeChat.rebateAmount === 'number' ? activeChat.rebateAmount : 180;
        const techTimeVal = activeChat.techVisitTime || 'before 3:00 PM today';
        if (selectedIdx === 1 || (selectedOpt && selectedOpt.kind === 'REBATE')) {
          dynamicBtnLabel = `Give RM ${rebateVal.toLocaleString()} rebate & reply`;
        } else if (selectedIdx === 2 || (selectedOpt && selectedOpt.kind === 'TECH_VISIT')) {
          dynamicBtnLabel = `Book technician & reply`;
        } else {
          dynamicBtnLabel = `Send replacement & reply`;
        }
      }

      // Retrieve the real, persistent client memory for the active customer
      if (!activeChat.memory) {
        activeChat.memory = {
          tier: 'Standard Client',
          score: 75,
          totalOrders: 1,
          totalPaidRM: 1000,
          notes: ['Direct communication via WhatsApp · Fast response'],
          timeline: [{ time: 'Recent', note: 'Contact created in DealPilot' }]
        };
      }
      const mem = activeChat.memory;
      const isRiskClient = (mem.score || 75) < 60;

      // Panel copy comes from scenario data written with emoji; strip them so
      // the panel uses its own icons instead
      const plain = s => String(s || '')
        .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, '')
        .replace(/\s+/g, ' ').trim();
      const optName = label => plain(label).replace(/^Option \d+:\s*/i, '');
      const btnText = label => plain(label)
        .replace(/\s*&\s*Insert( Selected)? Reply/i, ' & reply')
        .replace(/^(.)/, c => c.toUpperCase());
      const checkIcon = '<svg class="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"><use href="#i-check"/></svg>';
      const infoDot = '<span class="cc-dot bg-[#01AAFC] mt-1.5 mx-1 shrink-0"></span>';
      const checkLines = String(activeChat.extCheck || '').split('\n').filter(l => l.trim()).map(line => {
        const isTotal = /total|received/i.test(line);
        return `
          <li class="flex items-start gap-2 ${isTotal ? 'pt-2 mt-1 border-t border-[#DCE4F2] font-semibold text-[#042970]' : ''}">
            ${line.trim().startsWith('✅') ? checkIcon : infoDot}
            <span class="min-w-0">${escapeHtmlText(plain(line))}</span>
          </li>`;
      }).join('');

      const offerChips = [
        ['5% VIP discount', 'Give 5% VIP Discount if deposit confirmed today'],
        ['Cash discount', 'Offer a small discount within the margin floor for immediate DuitNow transfer'],
        ['Free delivery', 'Offer free delivery or install promo instead of price cut'],
        ['Round down', 'Round down total to nearest hundred flat']
      ];

      // Customer rating: AI scores each customer from payment and chat behaviour
      const score = Math.max(0, Math.min(100, mem.score || 75));
      const rating = score >= 80
        ? { label: 'Trusted', color: '#059669', bg: '#ECFDF5', fg: '#065F46' }
        : score >= 60
          ? { label: 'Good', color: '#0152FC', bg: '#E6EEFF', fg: '#042970' }
          : { label: 'Watch closely', color: '#D97706', bg: '#FFFBEB', fg: '#92400E' };
      const firstNote = (mem.notes || [])[0];

      // Payment check: confirming an order needs the money seen in the bank first
      const needsPaymentCheck = activeChat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT' && !activeChat.done;
      const claimMatch = String(activeChat.extCheck || '').match(/RM\s*([\d,]+)/);
      const claimedAmt = activeChat.amount
        ? Number(activeChat.amount).toLocaleString()
        : (claimMatch ? claimMatch[1] : '');
      const lastCustomerMsg = [...(activeChat.messages || [])].reverse().find(m => m.from === 'customer');
      const refMatch = lastCustomerMsg ? String(lastCustomerMsg.text).match(/Ref:?\s*([A-Z]{2}-[\d-]+)/i) : null;
      const paymentBlocked = needsPaymentCheck && !activeChat.paymentSeen;

      const primaryLabel = activeChat.done
        ? 'Done · insert reply again'
        : blockedByRole ? 'Send to owner for approval' : btnText(dynamicBtnLabel);

      extBody.innerHTML = `
        <!-- Customer rating, always visible; reasons and history on demand -->
        <div id="ext-rating" class="ext-rating">
          <div class="flex items-center gap-3">
            <span class="ext-score" style="--score:${score * 3.6}deg; --score-color:${rating.color}" role="img" aria-label="Customer score ${score} out of 100">
              <span>${score}</span>
            </span>
            <span class="flex-1 min-w-0">
              <span class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm text-[#042970] truncate">${escapeHtmlText(activeChat.customer)}</span>
                <span class="cc-pill" style="background:${rating.bg}; color:${rating.fg}">${rating.label}</span>
              </span>
              <span class="block text-xs text-[#5B6B85] mt-0.5">${escapeHtmlText(plain(mem.tier).replace(/_/g, ' ').toLowerCase().replace(/^./, ch => ch.toUpperCase()))} · ${mem.totalOrders || 1} orders · RM ${(mem.totalPaidRM || 0).toLocaleString()} paid</span>
            </span>
          </div>
          ${firstNote ? `<p class="text-xs text-[#324564] mt-2.5"><span class="font-semibold text-[#042970]">AI says:</span> ${escapeHtmlText(plain(firstNote))}</p>` : ''}
          <details class="ext-customer group mt-2">
            <summary class="flex items-center gap-1.5 cursor-pointer list-none text-xs font-semibold text-[#0152FC] !min-h-[32px]">
              Why this score
              <svg class="w-3.5 h-3.5 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
            </summary>
            <div class="mt-1 space-y-3 text-xs">
              <ul class="space-y-1 text-[#324564] list-disc pl-4">
                ${(mem.notes || []).map(n => `<li>${escapeHtmlText(plain(n))}</li>`).join('')}
              </ul>
              <div>
                <div class="flex items-center justify-between mb-1">
                  <span class="font-semibold text-[#042970]">Recent</span>
                  <button onclick="promptAddMemoryNote()" class="font-semibold text-[#0152FC] hover:underline">Add note</button>
                </div>
                <div class="space-y-1 max-h-28 overflow-y-auto pr-1">
                  ${(mem.timeline || []).map(t => `
                    <div class="flex gap-2 text-[#5B6B85]">
                      <span class="font-mono text-[#042970] shrink-0">${t.time}</span>
                      <span>${escapeHtmlText(plain(t.note))}</span>
                    </div>`).join('')}
                </div>
              </div>
            </div>
          </details>
        </div>

        <!-- Sales Stage Stepper -->
        <div class="ext-stage-stepper flex flex-wrap items-center gap-1 mt-3 px-2 py-1.5 bg-[#F0F4FA] rounded-xl text-[11px] font-semibold text-[#5B6B85]" aria-label="Sales stage">
          ${(activeChat.stageSteps || ['Discovery', 'Recommend', 'Ready to Quote', 'Quote Confirmed', 'Closed']).map((step, sIdx) => {
            const curIdx = typeof activeChat.stageIndex === 'number' ? activeChat.stageIndex : 0;
            const isCur = sIdx === curIdx;
            const isDone = sIdx < curIdx;
            return `
              <span class="flex items-center gap-1 px-2 py-0.5 rounded-md ${isCur ? 'bg-[#0152FC] text-white shadow-xs font-bold' : (isDone ? 'text-emerald-700 bg-emerald-50' : 'opacity-60')}">
                ${isDone ? '<svg class="w-3 h-3" aria-hidden="true"><use href="#i-check"/></svg>' : ''}${escapeHtmlText(step)}
              </span>
            `;
          }).join('')}
        </div>

        <!-- AI Coach Tip Advice -->
        ${activeChat.coachTip ? `
          <div class="mt-2.5 p-2.5 rounded-xl bg-amber-50/90 border border-amber-200/70 flex items-start gap-2">
            <svg class="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true"><use href="#i-sparkle"/></svg>
            <div class="text-xs text-amber-950 leading-relaxed min-w-0">
              <span class="font-bold text-amber-900 block text-[11px] uppercase tracking-wider mb-0.5">Sales Coach Advice</span>
              ${escapeHtmlText(activeChat.coachTip)}
            </div>
          </div>
        ` : ''}

        <!-- Quick Action Chips -->
        ${Array.isArray(activeChat.chips) && activeChat.chips.length > 0 ? `
          <div class="flex flex-wrap gap-1.5 mt-2.5">
            ${activeChat.chips.map(chip => `
              <button onclick="handleSalesChipClick('${escapeHtmlText(chip.id)}')" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-[#0152FC] hover:bg-blue-100 hover:text-[#042970] transition-colors border border-blue-200/50 flex items-center gap-1 cursor-pointer">
                ${escapeHtmlText(chip.label)}
              </button>
            `).join('')}
          </div>
        ` : ''}

        <!-- Catalog Compare Table -->
        ${activeChat.compare && activeChat.compare.rows && activeChat.compare.rows.length > 0 ? `
          <div class="mt-3 p-3 rounded-xl bg-white border border-[#DCE4F2] shadow-xs">
            <div class="text-xs font-bold text-[#042970] mb-2 flex items-center justify-between">
              <span>⚖️ Model Comparison (Catalog Truth)</span>
              <span class="text-[10px] text-[#5B6B85] font-normal">Side-by-side</span>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-[11px] text-left">
                <thead>
                  <tr class="border-b border-[#EAEFF8] text-[#5B6B85]">
                    <th class="py-1 pr-2">Model</th>
                    <th class="py-1 px-1.5">Price</th>
                    <th class="py-1 px-1.5">HP</th>
                    <th class="py-1 px-1.5">Energy</th>
                    <th class="py-1 pl-1.5">Best For</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[#F0F4FA]">
                  ${activeChat.compare.rows.map(r => `
                    <tr>
                      <td class="py-1.5 pr-2 font-semibold text-[#042970]">${escapeHtmlText(r.name || r.sku)}</td>
                      <td class="py-1.5 px-1.5 font-bold text-emerald-600">${escapeHtmlText(r.price)}</td>
                      <td class="py-1.5 px-1.5 text-[#324564]">${escapeHtmlText(r.hp)}</td>
                      <td class="py-1.5 px-1.5 text-[#5B6B85]">${escapeHtmlText(r.energy)}</td>
                      <td class="py-1.5 pl-1.5 text-[#5B6B85]">${escapeHtmlText(r.best_for)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <!-- Quote Preview Card -->
        ${activeChat.quotePreview && activeChat.quotePreview.items && activeChat.quotePreview.items.length > 0 ? `
          <div class="mt-3 p-3 rounded-xl bg-blue-50/40 border border-blue-200/80 shadow-xs">
            <div class="text-xs font-bold text-[#042970] mb-2 flex items-center justify-between">
              <span>📄 Quotation Preview</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">40% Deposit</span>
            </div>
            <div class="space-y-1.5 text-xs text-[#324564] border-b border-blue-200/50 pb-2 mb-2">
              ${activeChat.quotePreview.items.map(it => `
                <div class="flex items-center justify-between">
                  <span class="truncate pr-2">${it.qty}x ${escapeHtmlText(it.name)}</span>
                  <span class="font-semibold text-[#042970] shrink-0">RM ${Number(it.lineTotal).toLocaleString()}</span>
                </div>
              `).join('')}
            </div>
            <div class="flex items-center justify-between text-xs font-bold text-[#042970]">
              <span>Total Price</span>
              <span class="text-sm text-emerald-600">RM ${Number(activeChat.quotePreview.total).toLocaleString()}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-[#5B6B85] mt-1">
              <span>Deposit to confirm slot (40%)</span>
              <span class="font-semibold text-[#0152FC]">RM ${Number(activeChat.quotePreview.depositRm).toLocaleString()}</span>
            </div>
          </div>
        ` : ''}

        <!-- What the customer wants + what DealPilot checked -->
        <div class="pt-4 border-t border-[#DCE4F2]">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-[#5B6B85]">What's happening</div>
            <button onclick="triggerLiveAIForChat(getState().chats[currentChatIndex])" class="text-[11px] font-semibold text-[#0152FC] hover:underline flex items-center gap-1 cursor-pointer" title="Re-analyze this chat with live AI">
              ⚡ Re-analyze with AI
            </button>
          </div>
          <div class="font-semibold text-[15px] text-[#042970] mt-0.5">${escapeHtmlText(plain(activeChat.extTitle))}</div>
          <ul class="mt-2 space-y-1 text-sm text-[#324564]">${checkLines}</ul>
        </div>

        ${needsPaymentCheck ? `
          <!-- Check payment before the order is confirmed -->
          <div id="ext-payment" class="ext-payment ${activeChat.paymentSeen ? 'is-ok' : ''}">
            <div class="flex items-center gap-2 text-sm font-semibold text-[#042970]">
              <svg class="w-4 h-4 text-purple-600"><use href="#i-wallet"/></svg> Check payment
            </div>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mt-2">
              <dt class="text-[#5B6B85]">Customer says</dt><dd class="font-semibold text-[#042970]">RM ${claimedAmt || '—'} paid</dd>
              ${refMatch ? `<dt class="text-[#5B6B85]">DuitNow ref</dt><dd class="font-mono font-semibold text-[#0152FC]">${refMatch[1]}</dd>` : ''}
            </dl>
            <label class="flex items-start gap-2.5 mt-3 cursor-pointer">
              <input id="ext-payment-seen" type="checkbox" ${activeChat.paymentSeen ? 'checked' : ''} onchange="setPaymentSeen(this.checked)" class="w-4 h-4 mt-0.5 accent-[#0152FC]" />
              <span class="text-sm text-[#042970]">I can see RM ${claimedAmt || 'this amount'} in our bank account</span>
            </label>
          </div>
        ` : ''}

        ${activeChat.isAILoading ? `
          <div class="pt-4 border-t border-[#DCE4F2] flex flex-col items-center text-center gap-2 py-6" role="status">
            <img src="img/mascot-laptop.png" alt="" width="257" height="223" class="w-24 h-auto m-laptop animate-pulse" />
            <div class="font-semibold text-sm text-[#042970]">Writing a reply…</div>
            <div class="text-xs text-[#5B6B85]">${(getState().aiProvider === 'lmstudio') ? 'Connecting to LM Studio (port 1234)… usually takes ~10–15s.' : 'Connecting to RunPod Cloud GPU… usually takes ~5–10s.'}</div>
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-[11px] text-[#0152FC] font-medium mt-1">
              <span class="w-1.5 h-1.5 rounded-full bg-[#0152FC] animate-ping"></span>
              ${(getState().aiProvider === 'lmstudio') ? 'Generating live tokens on local model' : 'Generating live tokens on RunPod GPU'}
            </div>
          </div>
        ` : `
          <!-- Reply picker: pick one, the chosen reply shows in full -->
          <div class="pt-4 border-t border-[#DCE4F2]">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-semibold text-[#5B6B85]">Pick a reply</span>
              <span class="text-xs text-[#5B6B85]">Goes into your reply box</span>
            </div>
            <div class="space-y-2" role="radiogroup" aria-label="Suggested replies">
              ${replyOptions.map((opt, rIdx) => {
                const isSelected = rIdx === selectedIdx;
                const isRebateOpt = activeChat.extActionType === 'AFTERSALES_REPLACE' && (rIdx === 1 || opt.kind === 'REBATE');
                const isTechOpt = activeChat.extActionType === 'AFTERSALES_REPLACE' && (rIdx === 2 || opt.kind === 'TECH_VISIT');
                const rebateVal = typeof activeChat.rebateAmount === 'number' ? activeChat.rebateAmount : 180;
                const techTimeVal = activeChat.techVisitTime || 'before 3:00 PM today';
                return `
                  <div class="ext-reply ${isSelected ? 'is-selected' : ''}">
                    <button onclick="selectRecommendedReply(${rIdx})" role="radio" aria-checked="${isSelected}" class="w-full text-left flex items-start gap-2.5 p-3">
                      <span class="ext-radio mt-0.5"></span>
                      <span class="min-w-0 flex-1">
                        <span class="block text-sm font-semibold text-[#042970]">${escapeHtmlText(optName(opt.label))}</span>
                        ${isSelected
                          ? `<span class="block text-sm text-[#324564] leading-relaxed mt-1" id="reply-opt-text-${rIdx}">${escapeHtmlText(opt.text)}</span>`
                          : `<span class="block text-xs text-[#5B6B85] truncate mt-0.5">${escapeHtmlText(opt.text)}</span>`}
                      </span>
                    </button>
                    ${isSelected && isRebateOpt ? `
                      <div class="px-3 pb-3 pl-[38px] flex items-center gap-2">
                        <label for="inline-rebate-input" class="text-xs font-semibold text-[#042970]">Rebate (RM)</label>
                        <input id="inline-rebate-input" type="number" min="10" step="10" value="${rebateVal}" oninput="updateAftersalesRebate(this.value)" class="cc-input !w-28 !min-h-[36px] font-semibold" />
                      </div>
                    ` : ''}
                    ${isSelected && isTechOpt ? `
                      <div class="px-3 pb-3 pl-[38px]">
                        <label for="inline-tech-time-input" class="block text-xs font-semibold text-[#042970] mb-1">Technician visit time</label>
                        <input id="inline-tech-time-input" type="text" value="${escapeHtmlText(techTimeVal)}" oninput="updateAftersalesTechTime(this.value)" placeholder="e.g. tomorrow 10:30 AM" class="cc-input !min-h-[36px]" />
                      </div>
                    ` : ''}
                  </div>`;
              }).join('')}
            </div>
          </div>
        `}

        <!-- Adjust: custom instructions and offers, closed until needed -->
        <details class="ext-adjust group" ${activeChat.lastCustomPrompt ? 'open' : ''}>
          <summary class="flex items-center gap-2 cursor-pointer list-none text-sm font-semibold text-[#0152FC]">
            <svg class="w-4 h-4"><use href="#i-sparkle"/></svg>
            Adjust reply
            <span class="text-xs font-normal text-[#5B6B85]">discount, terms, language</span>
            <svg class="w-4 h-4 ml-auto text-[#5B6B85] transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="mt-3 space-y-2.5">
            <div class="flex gap-2">
              <label for="wa-custom-quote-prompt" class="sr-only">Tell AI how to change the reply</label>
              <input id="wa-custom-quote-prompt" type="text" value="${escapeHtmlText(activeChat.lastCustomPrompt || '')}" onkeydown="if(event.key==='Enter') promptAiCustomQuote(this.value)" placeholder="e.g. 50% deposit, polite BM" class="cc-input !min-h-[38px]" />
              <button onclick="promptAiCustomQuote(document.getElementById('wa-custom-quote-prompt').value)" class="cc-btn cc-btn-ghost !min-h-[38px] shrink-0">Rewrite</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${offerChips.map(([label, prompt]) => `<button onclick="promptAiCustomQuote('${prompt}')" class="cc-chip !min-h-[30px] !text-xs">${label}</button>`).join('')}
            </div>
          </div>
        </details>

        <!-- One main action, pinned while the panel scrolls -->
        <div class="ext-footer">
          ${blockedByRole ? `
            <p class="flex items-center gap-1.5 text-xs text-amber-800 mb-2">
              <svg class="w-3.5 h-3.5 shrink-0"><use href="#i-shield"/></svg>
              ${roleMode === 'DENY' ? 'The owner turned this off for staff. Ask the owner to do it.' : 'Needs the owner\'s approval. Send it, and the owner will see it on the Dashboard.'}
            </p>
          ` : ''}
          ${paymentBlocked ? `<p class="text-xs text-[#5B6B85] mb-2">Tick the payment check first.</p>` : ''}
          <button id="ext-primary-action-btn" onclick="executeExtensionAction()" ${paymentBlocked ? 'disabled' : ''} class="cc-btn cc-btn-lg w-full ${activeChat.done ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'cc-btn-primary'}">
            ${escapeHtmlText(primaryLabel)}
          </button>
          <button onclick="openPdfFromChat()" class="w-full mt-2 text-xs font-semibold text-[#0152FC] hover:underline flex items-center justify-center gap-1.5">
            <svg class="w-3.5 h-3.5"><use href="#i-file"/></svg> Attach PDF document
          </button>
        </div>
      `;

      if (typeof updatePromptPreview === 'function') { try { updatePromptPreview(activeChat); } catch(e){ console.warn('updatePromptPreview error:', e); } }
    }

    function setPaymentSeen(seen) {
      const chat = getState().chats[currentChatIndex];
      chat.paymentSeen = !!seen;
      renderWhatsAppView();
      if (seen) showToast('Payment checked. You can confirm the order now.');
    }

    // Jump from a capability card to a chat that shows it, then point at the part
    function showCapability(key) {
      // Sales jobs first; the older cash-and-stock scenario types are the fallback
      const typesFor = {
        quote: ['CREATE_QUOTE', 'CREATE_QUOTE_HOLD'],
        counter: ['SEND_COUNTER_OFFER'],
        followup: ['SEND_FOLLOW_UP', 'RELEASE_EXPIRED_HOLD'],
        won: ['MARK_WON', 'CONFIRM_DEPOSIT_DEDUCT'],
        rating: ['CREATE_QUOTE', 'CREATE_QUOTE_HOLD'],
        reply: ['CREATE_QUOTE', 'CREATE_QUOTE_HOLD'],
        reserve: ['CREATE_QUOTE_HOLD'],
        confirm: ['CONFIRM_DEPOSIT_DEDUCT'],
        payment: ['CONFIRM_DEPOSIT_DEDUCT']
      };
      const chats = getState().chats;
      const types = typesFor[key] || [];
      let idx = -1;
      for (const t of types) { idx = chats.findIndex(c => c.extActionType === t); if (idx >= 0) break; }
      if (idx >= 0) selectChat(idx);

      const targets = {
        reply: '.ext-adjust',
        quote: '#ext-primary-action-btn',
        counter: '#ext-primary-action-btn',
        followup: '#ext-primary-action-btn',
        won: '#ext-primary-action-btn',
        reserve: '#ext-primary-action-btn',
        confirm: '#ext-primary-action-btn',
        payment: '#ext-payment',
        rating: '#ext-rating'
      };

      // The panel re-renders while the AI drafts a reply; wait for the target
      let tries = 0;
      const point = () => {
        const chat = getState().chats[currentChatIndex];
        const el = document.querySelector(targets[key]);
        if ((!el || (chat && chat.isAILoading)) && tries++ < 30) return setTimeout(point, 100);
        if (!el) return;
        if (key === 'reply') el.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('cc-spotlight');
        void el.offsetWidth;
        el.classList.add('cc-spotlight');
        if (key === 'reply') {
          const input = document.getElementById('wa-custom-quote-prompt');
          if (input) setTimeout(() => input.focus({ preventScroll: true }), 400);
        }
      };
      setTimeout(point, 120);
    }

    function updateAftersalesRebate(val) {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      const rebate = Math.max(0, parseInt(val || '0', 10));
      chat.rebateAmount = rebate;
      const deal = st.deals.find(d => d.id === chat.dealId);
      const revised = Math.max(0, (deal ? deal.amount : 0) - rebate);
      const ref = deal ? ` off #${deal.id} (revised total RM ${revised.toLocaleString()})` : '';

      const newText = `Hi ${chat.customer}, sincere apologies for the trouble! If you prefer not to wait for a replacement, we can take RM ${rebate.toLocaleString()}${ref}.`;
      if (chat.replyOptions && chat.replyOptions[1]) {
        chat.replyOptions[1].label = `💸 Option 2: Offer RM ${rebate.toLocaleString()} Instant Credit Rebate`;
        chat.replyOptions[1].text = newText;
      }
      chat.extDraft = newText;
      const textEl = document.getElementById('reply-opt-text-1');
      if (textEl) textEl.textContent = newText;
      const inputBox = document.getElementById('wa-input-box');
      if (inputBox) inputBox.value = newText;
      const btnEl = document.getElementById('ext-primary-action-btn');
      if (btnEl && !chat.done) {
        btnEl.textContent = `Give RM ${rebate.toLocaleString()} rebate & reply`;
      }
    }

    function updateAftersalesTechTime(val) {
      const chat = getState().chats[currentChatIndex];
      const timeStr = (val || 'before 3:00 PM today').trim();
      chat.techVisitTime = timeStr;

      const newText = `Sorry about that ${chat.customer}! Our technician is nearby and can drop by your clinic ${timeStr} to swap the faulty R32 cylinder on the spot.`;
      if (chat.replyOptions && chat.replyOptions[2]) {
        chat.replyOptions[2].text = newText;
      }
      chat.extDraft = newText;
      const textEl = document.getElementById('reply-opt-text-2');
      if (textEl) textEl.textContent = newText;
      const inputBox = document.getElementById('wa-input-box');
      if (inputBox) inputBox.value = newText;
      const btnEl = document.getElementById('ext-primary-action-btn');
      if (btnEl && !chat.done) {
        btnEl.textContent = `Book technician & reply`;
      }
    }

    function getReplyOptionsForChat(chat) {
      if (Array.isArray(chat.replyOptions) && chat.replyOptions.length > 0) {
        return chat.replyOptions;
      }
      const cleanCust = cleanCustomerName(chat.customer);
      return [
        { label: '💬 Option 1: Direct Reply', text: chat.extDraft },
        { label: '🤝 Option 2: Friendly Boss Style', text: `Hi ${cleanCust}! ${chat.extDraft}` },
        { label: '🇲🇾 Option 3: Bahasa Melayu', text: `Salam ${cleanCust}, ${chat.extDraft}` }
      ];
    }

    async function triggerLiveAIForChat(chat, instruction = '', goal = '') {
      if (!chat) return;
      if (chat.isAILoading) {
        showToast('⏳ AI is already analyzing the chat, please wait...');
        return;
      }
      const st = getState();
      const lastMsg = (chat.messages && chat.messages.length > 0)
        ? (chat.messages[chat.messages.length - 1].text || '')
        : '';

      if (!lastMsg && !instruction) {
        try { renderWhatsAppView(); } catch (e) {}
        return;
      }

      chat.isAILoading = true;
      if (instruction) chat.lastCustomPrompt = instruction;
      const inputBox = document.getElementById('wa-input-box');
      if (inputBox) {
        inputBox.value = '';
        inputBox.placeholder = '🤖 Generating live reply with AI Copilot (~10–15s)...';
        inputBox.disabled = true;
      }
      try {
        renderWhatsAppView();
      } catch (e) {
        console.warn('renderWhatsAppView pre-fetch error:', e);
      }

      const startTime = Date.now();
      try {
        const res = await fetch(`${BACKEND_API_BASE}/api/whatsapp/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: chat.customer,
            phone: chat.phone,
            message: lastMsg,
            userInstruction: instruction,
            goal: goal || null,
            role: currentRole,
            smePreset: st.preset,
            companyName: st.name,
            framework: st.framework,
            recentMessages: (chat.messages || []).map(m => ({
              sender: m.from === 'customer' ? 'Them' : 'ME',
              text: m.text
            }))
          })
        });

        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

        if (res.ok) {
          const data = await res.json();
          if (data.analysis) {
            const a = data.analysis;
            chat.badge = a.badge || chat.badge;
            chat.extTitle = a.extTitle || chat.extTitle;
            chat.extCheck = a.extCheck || chat.extCheck;
            chat.extDraft = a.extDraft || chat.extDraft;
            chat.stage = a.stage || chat.stage;
            chat.stageSteps = a.stageSteps || chat.stageSteps;
            chat.stageIndex = (typeof a.stageIndex === 'number') ? a.stageIndex : chat.stageIndex;
            chat.coachTip = a.coachTip || chat.coachTip;
            chat.chips = a.chips || chat.chips;
            chat.wants = a.wants || chat.wants;
            chat.missing = a.missing || chat.missing;
            chat.quotePreview = a.quotePreview || chat.quotePreview;
            chat.compare = a.compare || chat.compare;
            chat.pendingOffer = a.pendingOffer || chat.pendingOffer;
            if (Array.isArray(a.replyOptions) && a.replyOptions.length > 0) {
              chat.replyOptions = a.replyOptions;
            }
            chat.extBtnLabel = a.extBtnLabel || chat.extBtnLabel;
            chat.extActionType = a.extActionType || chat.extActionType;
            if (a.sku) {
              chat.sku = a.sku;
              chat.qty = a.qty;
              chat.extraSku = a.extraSku || null;
              chat.extraQty = a.extraQty || 0;
            }
            if (a.amount) chat.amount = a.amount;
            chat.tin = a.tin || null;
            chat.ssmBrn = a.ssmBrn || null;
            chat.selectedReplyIdx = 0;
            if (a.clientMemory) {
              chat.memory = {
                tier: a.clientMemory.tier,
                score: a.clientMemory.score,
                totalOrders: a.clientMemory.totalOrders,
                totalPaidRM: a.clientMemory.totalPaidRm,
                notes: [a.clientMemory.styleSummary, a.clientMemory.paymentBehavior],
                timeline: (chat.memory && chat.memory.timeline) || []
              };
            }
          }
          if (data.raw_prompt && typeof agentInspectorData !== 'undefined') {
            agentInspectorData.whatsapp.prompt = data.raw_prompt;
            agentInspectorData.whatsapp.output = data.raw_llm_output || JSON.stringify(data.analysis, null, 2);
            if (typeof currentInspectorAgent !== 'undefined' && currentInspectorAgent === 'whatsapp' && typeof renderAgentInspector === 'function') {
              try { renderAgentInspector(); } catch(e){}
            }
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          showToast(`⚠️ AI Service: ${errData.detail || 'Could not generate reply'}`);
        }
      } catch (err) {
        console.warn('AI prompt offline, keeping local options', err);
        showToast(`⚠️ Connection error: ${err.message || 'Could not reach backend'}`);
      } finally {
        chat.isAILoading = false;
        const opts = getReplyOptionsForChat(chat);
        const selIdx = typeof chat.selectedReplyIdx === 'number' ? chat.selectedReplyIdx : 0;
        const inputBox = document.getElementById('wa-input-box');
        if (inputBox) {
          inputBox.disabled = false;
          inputBox.placeholder = 'Type a message (or click the Big Button on the right)...';
          if (opts[selIdx]) inputBox.value = opts[selIdx].text;
        }
        if (typeof updatePromptPreview === 'function') {
          try { updatePromptPreview(chat); } catch (e) { console.warn('updatePromptPreview error:', e); }
        }
        try {
          renderWhatsAppView();
        } catch (e) {
          console.warn('renderWhatsAppView error:', e);
        }
      }
    }

    function applyCustomInstructionToChat(chat, instr) {
      triggerLiveAIForChat(chat, instr);
    }

    function promptAiCustomQuote(instructionText) {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      triggerLiveAIForChat(chat, (instructionText || '').trim());
    }

    function selectRecommendedReply(rIdx) {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      const opts = getReplyOptionsForChat(chat);
      if (!opts[rIdx]) return;
      chat.selectedReplyIdx = rIdx;
      chat.extDraft = opts[rIdx].text;
      const inputBox = document.getElementById('wa-input-box');
      if (inputBox) inputBox.value = opts[rIdx].text;
      renderWhatsAppView();
      showToast(`Selected "${opts[rIdx].label}" — ready in WhatsApp input box!`);
    }

    function selectChat(idx) {
      currentChatIndex = idx;
      renderWhatsAppView();
    }

    function executeExtensionAction() {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      if (!chat) return;
      const actionDesc = chat.extActionDesc || `${chat.extBtnLabel || 'Run this action'} for ${chat.customer}.`;

      // Quote lines come from the analysis (quote preview, photo, or sku + extra sku), never from guessed data.
      const execItems = (chat.quotePreview && chat.quotePreview.items) || chat.items
        || (chat.sku ? [{ sku: chat.sku, qty: chat.qty || 1 }].concat(chat.extraSku ? [{ sku: chat.extraSku, qty: chat.extraQty || 1 }] : []) : null);
      if (!chat.done && chat.extActionType === 'CREATE_QUOTE' && !execItems) {
        showToast('⚠️ Nothing to quote yet: send the customer\'s message and let the AI analyse it first.');
        return;
      }
      if (!usesBackend() && chat.extActionType !== 'REPLY_ONLY') {
        showToast('⚠️ Backend offline — start it with python run_server.py');
        return;
      }

      askUserConfirm(
        `Confirm WhatsApp Copilot Action`,
        `${actionDesc}\n\nSelected Reply:\n"${chat.extDraft}"`,
        () => {
          document.getElementById('wa-input-box').value = chat.extDraft;
          if (chat.done || chat.extActionType === 'REPLY_ONLY') {
            renderAll();
            return;
          }
          const msgs = {
            OFFER_QUOTE: `Quotation offer sent to ${chat.customer}! Awaiting customer confirmation.`,
            CREATE_QUOTE: `Quote created for ${chat.customer} and logged in Pipeline!`,
            SEND_COUNTER_OFFER: `Counter-offer discount sent to ${chat.customer}!`,
            ASK_OWNER: `Discount submitted to Owner for approval!`,
            SEND_FOLLOW_UP: `Follow-up sent to ${chat.customer}!`,
            MARK_WON: `Marked deal WON for ${chat.customer}! Order confirmed.`,
            MARK_LOST: `Marked deal LOST for ${chat.customer}.`,
            LOG_COMPLAINT: `Complaint logged and follow-ups paused for ${chat.customer}.`,
            SAVE_LHDN_TIN: `Saved LHDN TIN ${chat.tin || ''} for ${chat.customer}!`
          };
          chat.done = true;
          backendAction('/api/whatsapp/execute', {
            customer: chat.customer,
            phone: (chat.phone || '').split(' · ')[0],
            actionType: chat.extActionType,
            dealId: chat.dealId || null,
            items: execItems,
            sku: chat.sku || null,
            qty: chat.qty || 1,
            discount: chat.discount || 0,
            depositRef: chat.depositRef || null,
            depositAmount: chat.depositAmount || null,
            reason: chat.lossReasonSuggestion || chat.reason || 'Customer declined on WhatsApp',
            note: chat.complaintNote || chat.note || null,
            tin: chat.tin || null,
            ssmBrn: chat.ssmBrn || null,
            role: currentRole
          }, msgs[chat.extActionType] || `${chat.extTitle || 'Action'} executed!`).then(d => {
            if (!d) { chat.done = false; return; }
            if (chat.extActionType === 'CREATE_QUOTE' && typeof openPdfFromChat === 'function') {
              chat.dealId = d.createdDealId || d.createdId || chat.dealId;  // the PDF is for the quote just created
              openPdfFromChat();
            }
          });
        },
        '✅ Confirm & Execute'
      );
    }

        function sendWhatsAppInput() {
      const input = document.getElementById('wa-input-box');
      if (!input.value.trim()) return;
      const st = getState();
      const chat = st.chats[currentChatIndex];
      const msgToSend = input.value;
      askUserConfirm(
        `Send WhatsApp Message to ${chat.customer}?`,
        `Message to send:\n"${msgToSend}"`,
        () => {
          chat.messages.push({
            from: 'staff',
            time: '10:47 AM',
            text: msgToSend
          });
          input.value = '';
          const inputBox = document.getElementById('wa-input-box');
      if (inputBox && chat.extDraft) inputBox.value = chat.extDraft;
      renderWhatsAppView();
          showToast(`Sent WhatsApp message to ${chat.customer}!`);
        },
        '📤 Send Message'
      );
    }

    async function testLMStudioConnection() {
      const urlInput = document.getElementById('lmstudio-url-input');
      const keyInput = document.getElementById('lmstudio-key-input');
      const modelInput = document.getElementById('lmstudio-model-input');
      const lmUrl = (urlInput ? urlInput.value : 'http://127.0.0.1:1234/v1').trim();
      const lmKey = (keyInput ? keyInput.value : 'lm-studio').trim();
      const lmModel = (modelInput ? modelInput.value : 'local-model').trim();
      const pill = document.getElementById('lmstudio-conn-pill');
      try {
        await fetch(`${BACKEND_API_BASE}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: currentRole,
            lmstudioUrl: lmUrl,
            lmstudioApiKey: lmKey,
            lmstudioModel: lmModel,
            framework: getState().framework
          })
        });
        const res = await fetch(`${BACKEND_API_BASE}/api/health`);
        const data = await res.json();
        if (data.aiProvider === 'runpod') {
          // RunPod is set in .env on the server; the LM Studio fields here are not used.
          const up = data.lmstudio && data.lmstudio.connected;
          if (pill) {
            pill.className = `px-2.5 py-0.5 rounded-full font-bold text-xs ${up ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`;
            pill.textContent = up ? `🟢 RunPod (${(data.lmstudio.models || []).join(', ') || 'model ready'})` : '🟡 RunPod waking up · fallback answers meanwhile';
          }
          showToast(up ? 'Using RunPod (set in .env on the server).' : 'RunPod is set in .env but not answering yet (cold start). Built-in answers are used until it wakes up.');
        } else if (data.lmstudio && data.lmstudio.connected) {
          const models = (data.lmstudio.models || []).join(', ') || 'Loaded Model';
          if (pill) {
            pill.className = 'px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs';
            pill.textContent = `🟢 Connected (${models})`;
          }
          showToast(`Connected to LM Studio at ${lmUrl}! Models: ${models}`);
        } else {
          if (pill) {
            pill.className = 'px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-xs';
            pill.textContent = '🟡 Backend Ready · Start LM Studio on :1234';
          }
          showToast(`Backend connected! Start LM Studio Server on ${lmUrl} to use live local model.`);
        }
      } catch (err) {
        // Direct check to LM Studio if backend isn't running
        try {
          const directRes = await fetch(`${lmUrl.replace(/\/$/, '')}/models`);
          const directData = await directRes.json();
          const models = (directData.data || []).map(m => m.id).join(', ') || 'Local Model';
          if (pill) {
            pill.className = 'px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs';
            pill.textContent = `🟢 Direct LM Studio (${models})`;
          }
          showToast(`Direct connection to LM Studio at ${lmUrl} succeeded! Model: ${models}`);
        } catch (e2) {
          showToast('Start FastAPI backend (python run_server.py) or LM Studio Local Server on port 1234!');
        }
      }
    }

    async function simulateCustomerMessageWithLMStudio() {
      const msgEl = document.getElementById('wa-test-customer-msg');
      const msgText = (msgEl ? msgEl.value : '').trim();
      if (!msgText) return;
      if (msgEl) msgEl.value = '';

      const st = getState();
      const chat = st.chats[currentChatIndex];
      chat.messages.push({
        from: 'customer',
        time: 'Just Now',
        text: msgText
      });
      chat.done = false;

      triggerLiveAIForChat(chat);
    }

    // =========================================================================
    // PHASE 3 COPILOT ENHANCEMENTS: SANDBOX, PHOTO-TO-QUOTE & SCENARIOS
    // =========================================================================

    function createNewBlankChat() {
      askForm({
        title: 'Start a new chat',
        message: 'Type a customer message afterwards to test live AI pricing.',
        okText: 'Start chat',
        fields: [
          { name: 'name', label: 'Customer name', value: 'New Customer', required: true, requiredMsg: 'Enter a name.' },
          { name: 'phone', label: 'WhatsApp phone', value: '+60 12-345 6789' }
        ]
      }, v => startBlankChat(v.name, v.phone || '+60 12-345 6789'));
    }

    // The note on the customer card ("Why this score" > "Add note"), kept in the chat's memory
    function promptAddMemoryNote() {
      const chat = getState().chats[currentChatIndex];
      if (!chat) return;
      askForm({
        title: `Add a note about ${chat.customer}`,
        message: 'The AI uses notes like this when it writes replies and scores the customer.',
        okText: 'Save note',
        fields: [
          { name: 'note', label: 'Note', type: 'textarea', required: true, requiredMsg: 'Write a short note.',
            placeholder: 'e.g. Prefers WhatsApp quotes over phone, only accepts morning delivery' }
        ]
      }, v => {
        if (!chat.memory) chat.memory = { tier: 'NEW_CLIENT', score: 50, totalOrders: 0, totalPaidRM: 0, notes: [], timeline: [] };
        chat.memory.notes = chat.memory.notes || [];
        chat.memory.timeline = chat.memory.timeline || [];
        chat.memory.notes.push(v.note);
        chat.memory.timeline.unshift({ time: 'Just Now', note: `Owner recorded: "${v.note}"` });
        showToast(`Saved note into ${chat.customer}'s memory.`);
        renderWhatsAppView();
      });
    }

    function startBlankChat(name, phone) {
      const st = getState();
      const clean = name.trim();
      const newChat = {
        id: 'chat-' + Date.now(),
        customer: clean,
        phone: phone.trim(),
        badge: '0. Sandbox (Live LLM)',
        messages: [],
        extTitle: `🧪 Copilot for ${clean}`,
        extCheck: 'Type any customer inquiry below to test live AI pricing, intent detection, and margin rules.\nNo templated presets.',
        extActionDesc: 'Click "Send as customer" below to test live LLM replies.',
        extDraft: '',
        selectedReplyIdx: 0,
        replyOptions: [],
        extBtnLabel: 'Insert reply',  // the AI sets the real action once it has read a customer message
        extActionType: 'REPLY_ONLY',
        done: false,
        memory: {
          tier: 'NEW_CLIENT',
          score: 50,
          totalOrders: 0,
          totalPaidRM: 0,
          notes: ['New WhatsApp contact created in Sandbox'],
          timeline: [{ time: 'Just Now', note: 'Chat started' }]
        }
      };
      st.chats.unshift(newChat);
      currentChatIndex = 0;
      renderWhatsAppView();
      showToast(`Created blank chat for ${clean}! Type a message below to test live LLM.`);
    }

    let currentPhotoItems = [];
    let currentPhotoAnalysis = null;

    async function handleWhatsAppChatFileUpload(inputEl) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      const st = getState();
      const chat = st.chats[currentChatIndex];
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

      const reader = new FileReader();
      reader.onload = async function(e) {
        const dataUrl = e.target.result;
        chat.messages.push({
          from: 'customer',
          time: 'Just Now',
          text: `Attached: ${file.name}`,
          attachment: {
            name: file.name,
            size: `${Math.round(file.size / 1024)} KB`,
            type: isPdf ? 'pdf' : 'image'
          }
        });
        renderWhatsAppView();
        showToast(`Uploading ${file.name} to Photo-to-Quote OCR...`);

        try {
          const res = await fetch(`${BACKEND_API_BASE}/api/whatsapp/photo-quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer: chat.customer,
              phone: chat.phone,
              imageBase64: dataUrl,
              fileName: file.name,
              role: currentRole
            })
          });
          const data = await res.json();
          if (data.status === 'extracted' && Array.isArray(data.items) && data.items.length > 0) {
            currentPhotoItems = data.items;
            currentPhotoAnalysis = data.analysis;
            openPhotoQuoteModal(data.items, data.subtotal);
          } else {
            showToast((data.analysis && data.analysis.extTitle) || 'Could not read items from image. Please type in chat.');
          }
        } catch (err) {
          showToast('Error processing photo quote: ' + err.message);
        }
      };
      reader.readAsDataURL(file);
    }

    function openPhotoQuoteModal(items, subtotal) {
      const tbody = document.getElementById('photo-items-tbody');
      if (!tbody) return;
      tbody.innerHTML = items.map((it, idx) => `
        <tr>
          <td class="p-2.5 font-semibold text-[#042970]">${escapeHtmlText(it.name)} <span class="text-[10px] text-[#5B6B85] font-mono">(${it.sku})</span></td>
          <td class="p-2.5 text-center">
            <input type="number" min="1" value="${it.qty}" onchange="updatePhotoModalQty(${idx}, this.value)" class="cc-input !w-16 !p-1 text-center font-semibold text-xs" />
          </td>
          <td class="p-2.5 text-right font-mono">RM ${Number(it.unitPrice).toLocaleString()}</td>
          <td class="p-2.5 text-right font-mono font-bold text-[#042970]">RM ${Number(it.lineTotal).toLocaleString()}</td>
        </tr>
      `).join('');
      const totalEl = document.getElementById('photo-modal-total');
      if (totalEl) totalEl.textContent = `RM ${Number(subtotal).toLocaleString()}`;
      const modal = document.getElementById('photo-quote-modal');
      if (modal) modal.classList.remove('hidden');
    }

    function updatePhotoModalQty(idx, newQty) {
      const q = Math.max(1, parseInt(newQty, 10) || 1);
      if (currentPhotoItems[idx]) {
        currentPhotoItems[idx].qty = q;
        currentPhotoItems[idx].lineTotal = q * (currentPhotoItems[idx].unitPrice || 0);
      }
      const total = currentPhotoItems.reduce((sum, it) => sum + (it.lineTotal || 0), 0);
      openPhotoQuoteModal(currentPhotoItems, total);
    }

    function closePhotoQuoteModal() {
      const modal = document.getElementById('photo-quote-modal');
      if (modal) modal.classList.add('hidden');
    }

    function confirmPhotoQuoteItems() {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      const total = currentPhotoItems.reduce((sum, it) => sum + (it.lineTotal || 0), 0);
      const lines = currentPhotoItems.map(it => `${it.qty}x ${it.name}`).join(', ');
      const draft = `Hi ${cleanCustomerName(chat.customer)}! Based on your photo, here is the quotation: ${lines} = RM ${total.toLocaleString()}. Subject to stock availability · prices valid 7 days.`;

      chat.items = currentPhotoItems;
      chat.amount = total;
      chat.extTitle = `Photo Quote for ${cleanCustomerName(chat.customer)}`;
      chat.extCheck = `${currentPhotoItems.map(it => `${it.qty}x ${it.name} · RM ${it.lineTotal.toLocaleString()}`).join('\n')}\nTotal: RM ${total.toLocaleString()}\nSubject to stock availability · prices valid 7 days`;
      chat.extDraft = draft;
      chat.replyOptions = [
        { label: 'Photo Quote (Official)', text: draft }
      ];
      chat.selectedReplyIdx = 0;
      chat.extBtnLabel = 'Send quote & insert reply';
      chat.extActionType = 'CREATE_QUOTE';

      closePhotoQuoteModal();
      renderWhatsAppView();
      showToast('Photo items confirmed! Review the quotation on the right and click Send Quote.');
    }


window.handleSalesChipClick = function(chipId) {
  const st = getState();
  const chat = st.chats[currentChatIndex];
  if (!chat) return;
  triggerLiveAIForChat(chat, '', chipId);
};
