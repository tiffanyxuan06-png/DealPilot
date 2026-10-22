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
                <div class="p-2.5 rounded-xl bg-white/70 border border-black/5 flex items-center gap-3">
                  <div class="w-9 h-9 rounded-lg bg-rose-500 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                    PDF
                  </div>
                  <div class="overflow-hidden text-left flex-1">
                    <div class="font-bold truncate text-[#042970]">${escapeHtmlText(hasAtt.name || 'Document.pdf')}</div>
                    <div class="text-[10px] text-[#5B6B85] flex items-center gap-2">
                      <span>${escapeHtmlText(hasAtt.size || '142 KB')}</span>
                      <span class="px-1.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Read by AI</span>
                    </div>
                  </div>
                </div>
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
          timeline: [{ time: 'Recent', note: 'Contact created in CashChase' }]
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
        ['RM 150 off', 'Knock off RM 150 discount for immediate DuitNow transfer'],
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
              <span class="block text-xs text-[#5B6B85] mt-0.5">${escapeHtmlText(plain(mem.tier))} · ${mem.totalOrders || 1} orders · RM ${(mem.totalPaidRM || 0).toLocaleString()} paid</span>
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

        <!-- What the customer wants + what CashChase checked -->
        <div class="pt-4 border-t border-[#DCE4F2]">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-[#5B6B85]">What's happening</div>
            <button onclick="triggerLiveAIForChat(getState().chats[currentChatIndex])" class="text-[11px] font-semibold text-[#0152FC] hover:underline flex items-center gap-1 cursor-pointer" title="Query LM Studio to re-analyze this chat with live AI">
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
            <div class="text-xs text-[#5B6B85]">Connecting to LM Studio (port 1234)… usually takes ~10–15s.</div>
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-[11px] text-[#0152FC] font-medium mt-1">
              <span class="w-1.5 h-1.5 rounded-full bg-[#0152FC] animate-ping"></span>
              Generating live tokens on local model
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
      const typeFor = { reserve: 'CREATE_QUOTE_HOLD', reply: 'CREATE_QUOTE_HOLD', rating: 'CREATE_QUOTE_HOLD', confirm: 'CONFIRM_DEPOSIT_DEDUCT', payment: 'CONFIRM_DEPOSIT_DEDUCT' };
      const chats = getState().chats;
      const idx = chats.findIndex(c => c.extActionType === typeFor[key]);
      if (idx >= 0) selectChat(idx);

      const targets = {
        reply: '.ext-adjust',
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
      const inv = st.invoices.find(i => i.id === 'INV-201');
      const baseAmt = inv ? inv.amount : 4800;
      const revised = Math.max(0, baseAmt - rebate);

      const newText = `Hi ${chat.customer}, sincere apologies for the leaking valve! If you prefer not to wait for a replacement, we can immediately deduct RM ${rebate.toLocaleString()} off #INV-201 (revised balance RM ${revised.toLocaleString()}).`;
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

    async function triggerLiveAIForChat(chat, instruction = '') {
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
            role: currentRole,
            smePreset: currentSME,
            companyName: st.name,
            stock: st.stock,
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
          showToast(`🤖 Live reply generated via LM Studio (${data.model_used || 'qwen2.5-3b-instruct'}) in ${elapsedSec}s!`);
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
      const item1 = st.stock[0] || { sku: 'ITEM-1', name: 'Standard Item', onHand: 10, onHold: 0 };
      const item2 = st.stock[1] || null;
      const itemsLabel = item1.name + (item2 ? ` + ${item2.name}` : '');
      const actionDesc = chat.extActionType === 'CREATE_QUOTE_HOLD'
        ? `Create Official Quote for ${chat.customer}, lock ${itemsLabel} ON HOLD for 48 hours, and insert reply into WhatsApp.`
        : chat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT'
          ? `Confirm deposit from ${chat.customer}, allocate ${itemsLabel}, add cash, and insert reply into WhatsApp.`
          : chat.extActionType === 'AFTERSALES_REPLACE'
            ? `Apply selected aftersales resolution for ${chat.customer} and insert reply into WhatsApp.`
            : `Release expired 48h reservation for ${chat.customer} and insert follow-up reply into WhatsApp.`;

      askUserConfirm(
        `Confirm WhatsApp Copilot Action`,
        `${actionDesc}\n\nSelected Reply:\n"${chat.extDraft}"`,
        () => {
          document.getElementById('wa-input-box').value = chat.extDraft;

          // Update Persistent Client Memory
          if (!chat.memory) chat.memory = { tier: 'Standard Client', score: 75, totalOrders: 1, totalPaidRM: 0, notes: [], timeline: [] };
          if (chat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT') {
            chat.memory.totalOrders = (chat.memory.totalOrders || 0) + 1;
            chat.memory.totalPaidRM = (chat.memory.totalPaidRM || 0) + (chat.amount || 2000);
            chat.memory.score = Math.min(100, (chat.memory.score || 75) + 3);
            chat.memory.timeline.unshift({ time: 'Just Now', note: `Confirmed deposit payment. Trust Score raised to ${chat.memory.score}/100.` });
          } else if (chat.extActionType === 'CREATE_QUOTE_HOLD') {
            chat.memory.timeline.unshift({ time: 'Just Now', note: `Created 48h reservation quote.` });
          } else if (chat.extActionType === 'AFTERSALES_REPLACE') {
            chat.memory.timeline.unshift({ time: 'Just Now', note: `Resolved aftersales issue promptly. Customer retained.` });
          } else if (chat.extActionType === 'RELEASE_EXPIRED_HOLD') {
            chat.memory.score = Math.max(20, (chat.memory.score || 50) - 5);
            chat.memory.timeline.unshift({ time: 'Just Now', note: `Released expired 48h hold without deposit. Trust Score adjusted.` });
          }

          const staffDeposit = !usesBackend() && chat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT' && currentRole === 'STAFF';
          if (!chat.done && usesBackend() && !staffDeposit && chat.extActionType !== 'REPLY_ONLY') {
            const msgs = {
              CREATE_QUOTE: `Quote created for ${chat.customer} and logged in Pipeline!`,
              CREATE_QUOTE_HOLD: `Quote created for ${chat.customer} and logged in Pipeline!`,
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
              items: chat.items || null,
              sku: chat.sku || item1.sku,
              qty: chat.qty || 1,
              discount: chat.discount || 0,
              depositRef: chat.depositRef || null,
              depositAmount: chat.depositAmount || null,
              reason: chat.lossReasonSuggestion || chat.reason || 'Customer declined on WhatsApp',
              note: chat.complaintNote || chat.note || null,
              tin: chat.tin || null,
              ssmBrn: chat.ssmBrn || null,
              role: currentRole
            }, msgs[chat.extActionType] || `${chat.extTitle || 'Action'} executed!`).then(d => { if (!d) chat.done = false; });
            return;
          }

          if (!chat.done) {
            const holdQty = 3;
            if (chat.extActionType === 'CREATE_QUOTE_HOLD') {
              item1.onHold += holdQty;
              item1.holdNote = `${item1.onHold}x Active Holds (48h left)`;
              if (item2) {
                item2.onHold += holdQty;
                item2.holdNote = `${item2.onHold}x Active Holds (48h left)`;
              }
              st.invoices.unshift({
                id: `QT-${Math.floor(100 + Math.random() * 900)}`,
                type: 'QUOTE_HOLD',
                party: chat.customer,
                phone: chat.phone || '+60 12-345 6789',
                holdTimer: '⏳ 48h Left (Active)',
                chatIdx: currentChatIndex,
                itemsText: `${holdQty}x ${itemsLabel} (ON HOLD — 48h timer)`,
                sku: item1.sku,
                qty: holdQty,
                extraSku: item2 ? item2.sku : null,
                extraQty: item2 ? holdQty : 0,
                amount: chat.amount || 3000,
                status: 'ON_HOLD_48H',
                lhdn: '🟢 LHDN Ready'
              });
              st.logs.unshift(`10:43 AM · [${currentRole}] Created Quote for ${chat.customer} (${itemsLabel}) & placed ${holdQty} units ON HOLD for 48h.`);
              showToast(`Quote created for ${chat.customer}! Stock placed ON HOLD for 48h & reply filled into WhatsApp!`);
            } else if (chat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT') {
              if (currentRole === 'STAFF') {
                st.logs.unshift(`10:43 AM · [STAFF] Submitted RM ${(chat.amount || 2000).toLocaleString()} Deposit from ${chat.customer} for Owner confirmation.`);
                showToast('Submitted to Owner! Click top-right role button to switch to Encik Hafiz (Owner).');
                renderAll();
                return;
              }
              const dedQty = 2;
              item1.onHold = Math.max(0, item1.onHold - dedQty);
              item1.onHand = Math.max(0, item1.onHand - dedQty);
              if (item2) {
                item2.onHold = Math.max(0, item2.onHold - dedQty);
                item2.onHand = Math.max(0, item2.onHand - dedQty);
              }
              const depAmt = chat.amount || (currentSME === 'software' ? 3120 : (currentSME === 'fnb' ? 1164 : 2000));
              st.cashOnHand += depAmt;
              st.invoices.unshift({
                id: `INV-${Math.floor(200 + Math.random() * 800)}`,
                type: 'PENDING',
                party: chat.customer,
                itemsText: `${dedQty}x ${itemsLabel} (Deposit RM ${depAmt.toLocaleString()} Paid · Scheduled)`,
                sku: item1.sku,
                qty: dedQty,
                amount: Math.round(depAmt * 1.5),
                status: 'PENDING_PAYMENT',
                lhdn: '🟢 LHDN Ready'
              });
              st.logs.unshift(`10:44 AM · [OWNER] Confirmed RM ${depAmt.toLocaleString()} Deposit from ${chat.customer} → Cash +RM ${depAmt.toLocaleString()}.`);
              showToast('Deposit confirmed! Order confirmed & scheduled for delivery!');
            } else if (chat.extActionType === 'AFTERSALES_REPLACE') {
              const repItem = item2 || item1;
              repItem.onHand = Math.max(0, repItem.onHand - 1);
              st.logs.unshift(`10:45 AM · [${currentRole}] Resolved aftersales complaint on ${repItem.name} for ${chat.customer}.`);
              showToast(`1x ${repItem.name} replacement dispatched as Aftersales Resolution!`);
            } else if (chat.extActionType === 'RELEASE_EXPIRED_HOLD') {
              item1.onHold = Math.max(0, item1.onHold - 3);
              item1.holdNote = item1.onHold > 0 ? `${item1.onHold}x Active Hold` : '-';
              st.logs.unshift(`10:46 AM · [${currentRole}] Released expired reservation for ${chat.customer} (+${item1.name} back to Available).`);
              showToast(`Released ${item1.name} reservation back to Available Stock!`);
            }
            chat.done = true;
          }

          renderAll();
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

    function simulateCustomerAction(actionKey) {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      chat.done = false;
      const cleanCust = cleanCustomerName(chat.customer);

      if (actionKey === 'BUYING_INQUIRY' || actionKey === 'MSG_BUY_INQUIRY') {
        const msg = 'Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah? Need quote urgently.';
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        showToast('💬 Simulated Customer asking for quote!');
        triggerLiveAIForChat(chat, 'Customer asks for 5x Daikin 1.5HP and 5x R32 gas quote');
      } else if (actionKey === 'DISCOUNT_REQUEST' || actionKey === 'MSG_DISCOUNT') {
        const msg = 'Boss, quote for 2 units Daikin 1.5HP can less or give discount sikit? Best price please.';
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        showToast('💬 Simulated Customer asking for discount!');
        triggerLiveAIForChat(chat, 'Customer asks for discount on Daikin 1.5HP. Offer margin-safe counter-offer.');
      } else if (actionKey === 'CUSTOMER_CONFIRMED' || actionKey === 'MSG_DEPOSIT_PAID' || actionKey === 'PDF_DUITNOW') {
        const msg = 'Ok boss confirm order for QT-2026-101! Just bank in RM 2,000 deposit via DuitNow (Ref: DN-99281).';
        chat.messages.push({
          from: 'customer',
          time: 'Just Now',
          text: msg,
          attachment: { name: 'DuitNow_Slip_DN-99281.pdf', size: '138 KB', type: 'pdf' }
        });
        chat.depositRef = 'DN-99281';
        chat.depositAmount = 2000;
        showToast('💬 Simulated Customer confirming deposit payment!');
        triggerLiveAIForChat(chat, 'Customer confirmed deposit with ref DN-99281. Mark Won and schedule delivery.');
      } else if (actionKey === 'FOLLOW_UP_DUE') {
        chat.messages.push({
          from: 'system',
          time: '48h elapsed',
          text: '⏳ 48-hour follow-up SLA reached. Deal #QT-2026-102 needs follow-up.'
        });
        showToast('⏰ Simulated 48h Follow-up SLA due!');
        triggerLiveAIForChat(chat, 'Follow-up due on open quote. Draft polite nudge.');
      } else if (actionKey === 'COMPLAINT' || actionKey === 'MSG_AFTERSALES') {
        const msg = 'Boss, 1 bottle R32 gas from last order valve leaking la. Very dangerous. Please check.';
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        chat.complaintNote = 'R32 gas cylinder nozzle leaking';
        showToast('⚠️ Simulated Customer reporting service issue!');
        triggerLiveAIForChat(chat, 'Customer reports leaking gas valve. Auto-pause reminders and offer free replacement.');
      } else if (actionKey === 'CUSTOMER_DECLINED') {
        const msg = 'Sorry boss, budget tak lepas kali ini. We pass first ya.';
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        chat.lossReasonSuggestion = 'Price / Budget';
        showToast('👋 Simulated Customer declining quote!');
        triggerLiveAIForChat(chat, 'Customer declined quote due to budget. Close warmly without pressure.');
      } else if (actionKey === 'SAVE_LHDN_TIN') {
        const msg = 'Boss, for e-Invoice, our Buyer TIN is C21884920000, SSM 202401009921.';
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        chat.tin = 'C21884920000';
        chat.ssmBrn = '202401009921';
        showToast('🧾 Simulated Customer sending LHDN TIN!');
        triggerLiveAIForChat(chat, 'Customer provided LHDN Buyer TIN C21884920000 and SSM 202401009921. Save details.');
      }
    }

    // =========================================================================
    // PHASE 3 COPILOT ENHANCEMENTS: SANDBOX, PHOTO-TO-QUOTE & SCENARIOS
    // =========================================================================

    function createNewBlankChat() {
      const st = getState();
      const name = prompt('Enter customer name for the new chat:', 'New Customer');
      if (!name || !name.trim()) return;
      const clean = name.trim();
      const phone = prompt('Enter WhatsApp phone number (e.g. +60 12-345 6789):', '+60 12-345 6789') || '+60 12-345 6789';
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
        extBtnLabel: 'Send quote & insert reply',
        extActionType: 'CREATE_QUOTE',
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
