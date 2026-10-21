// =========================================================================
    // WHATSAPP EXTENSION VIEW (1 GIANT OBVIOUS BUTTON)
    // =========================================================================
    function renderWhatsAppView() {
      const st = getState();
      if (currentChatIndex >= st.chats.length) currentChatIndex = 0;
      const chatListEl = document.getElementById('wa-chat-list');

      chatListEl.innerHTML = st.chats.map((c, idx) => {
        const active = idx === currentChatIndex;
        return `
          <button onclick="selectChat(${idx})" class="w-full text-left p-3 rounded-xl border transition ${
            active
              ? 'bg-[#E6EEFF] border-[#0152FC] text-[#042970]'
              : 'bg-[#F2F6FF] border-[#D5DFEE] hover:bg-[#E6EEFF]/60'
          }">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm text-[#042970]">${c.customer}</span>
              ${c.done ? '<span class="text-xs text-emerald-700 font-bold">✓ Done</span>' : ''}
            </div>
            <div class="text-xs text-[#0152FC] font-bold mt-0.5">${c.badge}</div>
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
                ? 'bg-[#0152FC] text-white'
                : 'bg-white border border-[#D5DFEE] text-[#042970]'
            }">
              ${hasAtt ? `
                <div class="p-2.5 rounded-xl ${isStaff ? 'bg-white/10 border border-white/20' : 'bg-[#F2F6FF] border border-[#D5DFEE]'} flex items-center gap-3">
                  <div class="w-9 h-9 rounded-lg bg-rose-500 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-xs">
                    PDF
                  </div>
                  <div class="overflow-hidden text-left flex-1">
                    <div class="font-bold truncate ${isStaff ? 'text-white' : 'text-[#042970]'}">${hasAtt.name || 'Document.pdf'}</div>
                    <div class="text-[10px] ${isStaff ? 'text-white/80' : 'text-[#64748B]'} flex items-center gap-2">
                      <span>${hasAtt.size || '142 KB'}</span>
                      <span class="px-1.5 py-0.2 rounded-full ${isStaff ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-800'} font-bold">⚡ Stage 1 Direct PDF Decoded</span>
                    </div>
                  </div>
                </div>
              ` : ''}
              <div>${m.text}</div>
              <div class="text-[10px] opacity-75 text-right">${m.time}</div>
            </div>
          </div>
        `;
      }).join('');

      const extBody = document.getElementById('ext-panel-body');
      const needsOwner = activeChat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT' || activeChat.extActionType === 'AFTERSALES_REPLACE';
      const blockedByRole = needsOwner && currentRole === 'STAFF';
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
            <span class="min-w-0">${plain(line)}</span>
          </li>`;
      }).join('');

      const offerChips = [
        ['5% VIP discount', 'Give 5% VIP Discount if deposit confirmed today'],
        ['RM 150 off', 'Knock off RM 150 discount for immediate DuitNow transfer'],
        ['Free delivery', 'Offer free delivery or install promo instead of price cut'],
        ['Round down', 'Round down total to nearest hundred flat']
      ];

      const primaryLabel = activeChat.done
        ? 'Done · insert reply again'
        : blockedByRole ? 'Send to owner for approval' : btnText(dynamicBtnLabel);

      extBody.innerHTML = `
        <!-- Customer: one summary line, history on demand -->
        <details class="ext-customer group">
          <summary class="flex items-center gap-3 cursor-pointer list-none">
            <span class="w-10 h-10 rounded-full bg-[#E6EEFF] text-[#0152FC] font-bold text-sm flex items-center justify-center shrink-0">
              ${plain(activeChat.customer).split(' ').map(w => w[0]).slice(0, 2).join('')}
            </span>
            <span class="flex-1 min-w-0">
              <span class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-sm text-[#042970] truncate">${activeChat.customer}</span>
                <span class="cc-pill ${isRiskClient ? '!bg-amber-50 !text-amber-800' : ''}">${plain(mem.tier)}</span>
              </span>
              <span class="block text-xs text-[#5B6B85] mt-0.5">
                ${mem.totalOrders || 1} orders · RM ${(mem.totalPaidRM || 0).toLocaleString()} paid · score ${mem.score}/100
              </span>
            </span>
            <svg class="w-4 h-4 text-[#5B6B85] shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
          </summary>
          <div class="mt-3 pl-[52px] space-y-3 text-xs">
            <ul class="space-y-1 text-[#324564] list-disc pl-4">
              ${(mem.notes || []).map(n => `<li>${plain(n)}</li>`).join('')}
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
                    <span>${plain(t.note)}</span>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </details>

        <!-- What the customer wants + what CashChase checked -->
        <div class="pt-4 border-t border-[#DCE4F2]">
          <div class="text-xs font-semibold text-[#5B6B85]">What's happening</div>
          <div class="font-semibold text-[15px] text-[#042970] mt-0.5">${plain(activeChat.extTitle)}</div>
          <ul class="mt-2 space-y-1 text-sm text-[#324564]">${checkLines}</ul>
        </div>

        ${activeChat.isAILoading ? `
          <div class="pt-4 border-t border-[#DCE4F2] flex flex-col items-center text-center gap-2 py-6" role="status">
            <img src="img/mascot-laptop.png" alt="" width="257" height="223" class="w-24 h-auto m-laptop" />
            <div class="font-semibold text-sm text-[#042970]">Writing a reply…</div>
            <div class="text-xs text-[#5B6B85]">Checking your prices and stock first.</div>
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
                        <span class="block text-sm font-semibold text-[#042970]">${optName(opt.label)}</span>
                        ${isSelected
                          ? `<span class="block text-sm text-[#324564] leading-relaxed mt-1" id="reply-opt-text-${rIdx}">${opt.text}</span>`
                          : `<span class="block text-xs text-[#5B6B85] truncate mt-0.5">${opt.text}</span>`}
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
                        <input id="inline-tech-time-input" type="text" value="${techTimeVal}" oninput="updateAftersalesTechTime(this.value)" placeholder="e.g. tomorrow 10:30 AM" class="cc-input !min-h-[36px]" />
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
              <input id="wa-custom-quote-prompt" type="text" value="${activeChat.lastCustomPrompt || ''}" onkeydown="if(event.key==='Enter') promptAiCustomQuote(this.value)" placeholder="e.g. 50% deposit, polite BM" class="cc-input !min-h-[38px]" />
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
              Only the owner can do this. Switch role at the top, or send it for approval.
            </p>
          ` : ''}
          <button id="ext-primary-action-btn" onclick="executeExtensionAction()" class="cc-btn cc-btn-lg w-full ${activeChat.done ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'cc-btn-primary'}">
            ${primaryLabel}
          </button>
          <button onclick="openPdfFromChat()" class="w-full mt-2 text-xs font-semibold text-[#0152FC] hover:underline flex items-center justify-center gap-1.5">
            <svg class="w-3.5 h-3.5"><use href="#i-file"/></svg> Attach PDF document
          </button>
        </div>
      `;

      updatePromptPreview(activeChat);
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
      const st = getState();
      const lastMsg = (chat.messages && chat.messages.length > 0)
        ? (chat.messages[chat.messages.length - 1].text || '')
        : '';

      chat.isAILoading = true;
      if (instruction) chat.lastCustomPrompt = instruction;
      const inputBox = document.getElementById('wa-input-box');
      if (inputBox) {
        inputBox.value = '';
        inputBox.placeholder = '🤖 Generating live reply with AI Copilot...';
        inputBox.disabled = true;
      }
      renderWhatsAppView();

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
          if (data.raw_prompt) {
            agentInspectorData.whatsapp.prompt = data.raw_prompt;
            agentInspectorData.whatsapp.output = data.raw_llm_output || JSON.stringify(data.analysis, null, 2);
            if (currentInspectorAgent === 'whatsapp') {
              renderAgentInspector();
            }
          }
        }
      } catch (err) {
        console.warn('AI prompt offline, keeping local options', err);
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
        updatePromptPreview(chat);
        renderWhatsAppView();
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
      const st = getState();
      const chat = st.chats[idx];
      triggerLiveAIForChat(chat);
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
            lmstudioUrl: lmUrl,
            lmstudioApiKey: lmKey,
            lmstudioModel: lmModel,
            framework: getState().framework
          })
        });
        const res = await fetch(`${BACKEND_API_BASE}/api/health`);
        const data = await res.json();
        if (data.lmstudio && data.lmstudio.connected) {
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

      const st = getState();
      const chat = st.chats[currentChatIndex];
      chat.messages.push({
        from: 'customer',
        time: 'Just Now',
        text: msgText
      });
      chat.done = false;

      const low = msgText.toLowerCase().trim();
      const cleanCust = cleanCustomerName(chat.customer);
      const isDecline = ['no', 'nope', 'not now', 'tak', 'takpe', 'tak nak', 'tak jadi', 'cancel', 'batal', 'pass', 'no thanks', 'next time'].includes(low) || low.startsWith('no ') || low.startsWith('tak ');
      if (isDecline && !low.includes('bank in') && !low.includes('deposit') && !low.includes('quote')) {
        const opt1 = `Understood ${cleanCust}, no problem at all! Thanks for letting us know. Reach out anytime if you need anything in the future!`;
        const opt2 = `Alright Boss, noted with thanks! Reach out anytime if you need supply down the road.`;
        const opt3 = `Baik ${cleanCust}, tidak mengapa. Terima kasih kerana maklumkan. Hubungi kami bila-bila masa jika perlukan bekalan nanti ya!`;
        chat.badge = 'Decline Acknowledged';
        chat.extTitle = `🤝 ${cleanCust} Passed / Declined`;
        chat.extCheck = `🟢 Customer politely declined the quotation or follow-up.\nNo payment chasing or deposit required.`;
        chat.extActionDesc = 'Insert a friendly, zero-pressure reply to keep the customer relationship warm.';
        chat.extDraft = opt1;
        chat.replyOptions = [
          { label: '🤝 Option 1: Polite & Friendly Close (Recommended)', text: opt1 },
          { label: '👍 Option 2: Casual Boss Style', text: opt2 },
          { label: '🇲🇾 Option 3: Bahasa Melayu (Terima Kasih)', text: opt3 }
        ];
        chat.selectedReplyIdx = 0;
        chat.extBtnLabel = '💬 Insert Polite Acknowledgment';
        chat.extActionType = 'NO_ACTION';
      }

      const inputBox = document.getElementById('wa-input-box');
      if (inputBox && chat.extDraft) inputBox.value = chat.extDraft;
      renderWhatsAppView();

      try {
        const res = await fetch(`${BACKEND_API_BASE}/api/whatsapp/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: chat.customer,
            phone: chat.phone,
            message: msgText,
            role: currentRole,
            smePreset: currentSME,
            companyName: st.name,
            stock: st.stock,
            framework: st.framework,
            recentMessages: (chat.messages || []).map(m => ({ sender: m.from === 'customer' ? 'Them' : 'ME', text: m.text }))
          })
        });
        const data = await res.json();
        const a = data.analysis;
        if (a) {
          chat.badge = a.badge || a.intent;
          chat.extTitle = a.extTitle || chat.extTitle;
          chat.extCheck = a.extCheck || chat.extCheck;
          chat.extActionDesc = a.extActionDesc || chat.extActionDesc;
          chat.extDraft = a.extDraft || chat.extDraft;
          if (Array.isArray(a.replyOptions) && a.replyOptions.length > 0) {
            chat.replyOptions = a.replyOptions;
            chat.selectedReplyIdx = 0;
            chat.extDraft = a.replyOptions[0].text;
          }
          chat.extBtnLabel = a.extBtnLabel || chat.extBtnLabel;
          chat.extActionType = a.extActionType || chat.extActionType;
        }
        if (data.raw_prompt) {
          document.getElementById('llm-input-preview').textContent = data.raw_prompt;
        }
        if (data.raw_llm_output) {
          document.getElementById('llm-output-preview').textContent = data.raw_llm_output;
        }
        const inputBox = document.getElementById('wa-input-box');
      if (inputBox && chat.extDraft) inputBox.value = chat.extDraft;
      renderWhatsAppView();
        showToast(
          data.lmstudio_connected
            ? `🤖 Analyzed via LM Studio (${data.model_used})! Click the Big Blue Button on the right.`
            : `🤖 Analyzed via Backend Engine (Start LM Studio on :1234 for live LLM)!`
        );
      } catch (err) {
        showToast('Message added! Start backend (python run_server.py) to run live /api/whatsapp/analyze.');
      }
    }

    function simulateCustomerAction(actionKey) {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      chat.done = false;
      const cleanCust = cleanCustomerName(chat.customer);

      if (actionKey === 'PDF_DUITNOW') {
        const amt = currentSME === 'software' ? 3120 : (currentSME === 'fnb' ? 1164 : 2000);
        const refNo = currentSME === 'software' ? 'DN-20261117-88410' : (currentSME === 'fnb' ? 'DN-20261117-77319' : 'DN-20261117-99102');
        chat.messages.push({
          from: 'customer',
          time: 'Just Now',
          text: `Hi Boss! I just transferred RM ${amt.toLocaleString()} deposit via DuitNow (Ref: ${refNo}). Please check and confirm the order for us!`,
          attachment: {
            name: `DuitNow_Receipt_${refNo}.pdf`,
            size: '138 KB',
            type: 'pdf'
          }
        });
        chat.amount = amt;
        showToast(`📎 Simulated Customer sending DuitNow PDF Receipt for ${st.name}!`);
        triggerLiveAIForChat(chat, `Customer sent DuitNow receipt RM ${amt} (Ref: ${refNo}). Confirm order and scheduled delivery without leaking internal stock counts.`);
      } else if (actionKey === 'PDF_SUPPLIER') {
        let billNo = 'SUP-902';
        let billTxt = 'Penghawa Dingin Supplies: Delivery Order & Stock Bill SUP-902 attached. 20x R32 Gas delivered today.';
        if (currentSME === 'software') {
          billNo = 'SUP-402';
          billTxt = 'Cloud Infra Global: Monthly High-Availability Cloud Server Bill SUP-402 attached (RM 1,800).';
        } else if (currentSME === 'fnb') {
          billNo = 'SUP-601';
          billTxt = 'Nusantara Coffee Importers: Delivery Order & Green Coffee Bean Bill SUP-601 attached (30x Arabica 5kg bags).';
        }
        chat.messages.push({
          from: 'customer',
          time: 'Just Now',
          text: billTxt,
          attachment: { name: `${billNo}_Bill.pdf`, size: '184 KB', type: 'pdf' }
        });
        showToast('📎 Simulated Supplier sending Bill PDF!');
        triggerLiveAIForChat(chat, `Supplier bill ${billNo} received. Acknowledge and verify payment details.`);
      } else if (actionKey === 'MSG_BUY_INQUIRY') {
        let msg = 'Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? Urgent quotation needed.';
        let instr = 'Quote 5x Daikin 1.5HP + 5x R32 gas with standard installation. 40% deposit required.';
        if (currentSME === 'software') {
          msg = 'Hi team, expanding 5 outlets. Need 5x Cloud POS License Seats and 3 Developer Sprint Days. Urgent quote needed.';
          instr = 'Quote 5x Cloud POS License Seats + 3 Dev Man-Days. 40% deposit required.';
        } else if (currentSME === 'fnb') {
          msg = 'Hi boss, can quote 6 bags of Arabica Coffee 5kg and 10 cartons Barista Oat Milk with cold delivery?';
          instr = 'Quote 6x Arabica 5kg + 10x Oat Milk cartons with free cold delivery. 40% deposit required.';
        }
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        showToast(`💬 Simulated Customer asking for ${st.name} Quote!`);
        triggerLiveAIForChat(chat, instr);
      } else if (actionKey === 'MSG_DEPOSIT_PAID') {
        const amt = currentSME === 'software' ? 3120 : (currentSME === 'fnb' ? 1164 : 2000);
        const refNo = currentSME === 'software' ? 'DN-88410' : (currentSME === 'fnb' ? 'DN-77319' : 'DN-99102');
        chat.messages.push({ from: 'customer', time: 'Just Now', text: `Ok Boss confirm order! I just transferred RM ${amt.toLocaleString()} deposit via DuitNow (Ref: ${refNo}).` });
        chat.amount = amt;
        showToast('💬 Simulated Customer confirming deposit payment!');
        triggerLiveAIForChat(chat, `Deposit RM ${amt} received via DuitNow (Ref: ${refNo}). Confirm order and scheduled delivery.`);
      } else if (actionKey === 'MSG_AFTERSALES') {
        let msg = 'Boss, 1 of the R32 gas bottles is leaking from the valve, please send technician or replace ASAP!';
        let instr = 'Aftersales complaint reported. Auto-pause reminders. Offer free replacement or credit rebate.';
        if (currentSME === 'software') {
          msg = 'Team, 1 of our POS terminals cannot export LHDN MyInvois XML, throwing a 500 error! Please hotfix ASAP!';
          instr = 'Urgent bug report on POS XML export. Pause reminder chasing. Offer urgent hotfix deployment today.';
        } else if (currentSME === 'fnb') {
          msg = 'Boss, 1 carton of Barista Oat Milk arrived punctured and leaking from the delivery van. Please replace ASAP!';
          instr = 'Damaged carton reported. Auto-pause reminders. Offer free replacement on afternoon van dispatch.';
        }
        chat.messages.push({ from: 'customer', time: 'Just Now', text: msg });
        showToast('💬 Simulated Customer reporting Aftersales issue!');
        triggerLiveAIForChat(chat, instr);
      } else if (actionKey === 'MSG_DISCOUNT') {
        const text = 'Boss, can give special VIP discount if I confirm order and transfer deposit right now?';
        chat.messages.push({ from: 'customer', time: 'Just Now', text });
        showToast('💬 Simulated Customer requesting VIP discount!');
        triggerLiveAIForChat(chat, 'Customer requested special discount. Give 5% VIP Discount if confirmed today.');
      } else if (actionKey === 'MSG_BM') {
        let text = 'Salam tuan, boleh dapatkan sebut harga rasmi berserta urusan tempahan hari ini?';
        if (currentSME === 'software') text = 'Salam tuan, boleh berikan sebut harga rasmi untuk 3 lesen POS tahunan berserta pemasangan?';
        else if (currentSME === 'fnb') text = 'Salam tuan, boleh sebut harga rasmi untuk 5 beg biji kopi Arabica dan penghantaran?';
        chat.messages.push({ from: 'customer', time: 'Just Now', text });
        showToast('💬 Simulated Customer sending inquiry in Bahasa Melayu!');
        triggerLiveAIForChat(chat, 'Sebut harga rasmi dalam Bahasa Melayu yang sopan');
      }
    }

    function handleWhatsAppChatFileUpload(inputEl) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      const st = getState();
      const chat = st.chats[currentChatIndex];
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

      const reader = new FileReader();
      reader.onload = function(e) {
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

        if (isPdf) {
          simulateCustomerAction('PDF_DUITNOW');
        } else {
          chat.badge = 'Image Receipt Attached';
          chat.extTitle = `📷 Receipt Photo Attached (${file.name})`;
          chat.extCheck = `👁️ Vision VLM OCR processing image receipt...\n• Amount Claimed: RM 2,000.00\n• Counterparty: ${chat.customer}`;
          chat.extBtnLabel = '💰 Confirm RM 2,000 Received in Bank (+Cash)';
          chat.extActionType = 'CONFIRM_DEPOSIT_DEDUCT';
          const inputBox = document.getElementById('wa-input-box');
      if (inputBox && chat.extDraft) inputBox.value = chat.extDraft;
      renderWhatsAppView();
        }
        showToast(`📎 Attached "${file.name}" to WhatsApp Chat!`);
      };
      reader.readAsDataURL(file);
    }
