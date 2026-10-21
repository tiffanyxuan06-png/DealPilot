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
              <span class="font-bold text-xs text-[#042970]">${c.customer}</span>
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
      // Backend profile: follow the Owner's Team & Permissions settings; demo profiles keep the old Owner-only rule.
      const execPermissionKey = { CREATE_QUOTE_HOLD: 'quote.create', CONFIRM_DEPOSIT_DEDUCT: 'deposit.confirm', AFTERSALES_REPLACE: 'aftersales.replace', RELEASE_EXPIRED_HOLD: 'quote.release' }[activeChat.extActionType];
      const roleMode = usesBackend() ? (execPermissionKey ? staffModeFor(execPermissionKey) : 'ALLOW') : (needsOwner && currentRole === 'STAFF' ? 'APPROVAL' : 'ALLOW');
      const blockedByRole = roleMode !== 'ALLOW';
      const replyOptions = getReplyOptionsForChat(activeChat);
      const selectedIdx = typeof activeChat.selectedReplyIdx === 'number' ? activeChat.selectedReplyIdx : 0;
      const selectedOpt = replyOptions[selectedIdx] || replyOptions[0];

      // Determine dynamic Primary Button label based on chosen Aftersales option
      let dynamicBtnLabel = activeChat.extBtnLabel;
      if (activeChat.extActionType === 'AFTERSALES_REPLACE') {
        const rebateVal = typeof activeChat.rebateAmount === 'number' ? activeChat.rebateAmount : 180;
        const techTimeVal = activeChat.techVisitTime || 'before 3:00 PM today';
        if (selectedIdx === 1 || (selectedOpt && selectedOpt.kind === 'REBATE')) {
          dynamicBtnLabel = `💸 Apply RM ${rebateVal.toLocaleString()} Credit Rebate & Insert Reply`;
        } else if (selectedIdx === 2 || (selectedOpt && selectedOpt.kind === 'TECH_VISIT')) {
          dynamicBtnLabel = `🛠️ Schedule Tech Drop-By (${techTimeVal}) & Insert Reply`;
        } else {
          dynamicBtnLabel = `📦 Send -1 Replacement Stock & Insert Reply`;
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

      extBody.innerHTML = `
        <!-- PERSISTENT CLIENT MEMORY & RELATIONSHIP CARD -->
        <div class="p-3.5 rounded-xl border ${isRiskClient ? 'bg-amber-50 border-amber-300' : 'bg-[#F2F6FF] border-[#D5DFEE]'} space-y-2.5 text-xs shadow-xs">
          <div class="flex items-center justify-between font-bold text-[#042970]">
            <span class="flex items-center gap-1.5">
              <span>🧠</span> <b>Persistent Memory:</b> ${mem.tier}
            </span>
            <span class="px-2 py-0.5 rounded-full ${isRiskClient ? 'bg-amber-200 text-amber-900 font-bold' : 'bg-[#E6EEFF] text-[#0152FC] font-bold'}">
              Trust Score: ${mem.score}/100
            </span>
          </div>

          <!-- Customer Past Record Summary -->
          <div class="p-2.5 rounded-lg bg-white border border-[#D5DFEE]/80 space-y-1">
            <div class="flex items-center justify-between text-[11px] font-bold text-[#042970]">
              <span class="text-[#64748B] uppercase tracking-wider text-[10px]">Track Record:</span>
              <span class="text-emerald-700 font-semibold">${mem.totalOrders || 1} past orders · RM ${(mem.totalPaidRM || 0).toLocaleString()} paid</span>
            </div>
            <ul class="list-disc pl-4 space-y-0.5 text-[11px] text-[#324564]">
              ${(mem.notes || []).map(n => `<li>${n}</li>`).join('')}
            </ul>
          </div>

          <!-- Live Memory Event Timeline -->
          <div class="space-y-1">
            <div class="flex items-center justify-between text-[11px] font-bold text-[#042970]">
              <span>Recent Activity & Retained Memory:</span>
              <button onclick="promptAddMemoryNote()" class="text-[#0152FC] hover:underline font-bold text-[10.5px] cursor-pointer">
                ✏️ + Add Memory Note
              </button>
            </div>
            <div class="space-y-1 max-h-24 overflow-y-auto pr-1">
              ${(mem.timeline || []).map(t => `
                <div class="text-[10.5px] text-[#64748B] flex gap-1.5 items-start">
                  <span class="font-semibold text-[#042970] shrink-0">• [${t.time}]</span>
                  <span>${t.note}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-[#F2F6FF] border border-[#D5DFEE] space-y-2">
          <div class="flex items-center justify-between">
            <div class="font-bold text-sm text-[#042970]">${activeChat.extTitle}</div>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">⚡ Auto-Cached</span>
          </div>
          <pre class="text-xs whitespace-pre-wrap font-sans font-semibold text-[#042970] bg-[#E3F6FF] p-3 rounded-xl border border-[#01AAFC]/40">${activeChat.extCheck}</pre>
          <p class="text-xs text-[#324564]">${activeChat.extActionDesc}</p>
        </div>

        <!-- ✨ PROMPT AI TO CUSTOMIZE QUOTATION / REPLY -->
        <div class="p-3 rounded-xl bg-[#E6EEFF]/70 border border-[#0152FC]/30 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-[#0152FC]">✨ Prompt AI to Customize Quote / Reply</span>
            <span class="text-[11px] text-[#324564] font-medium">Any SME instruction (price, terms, language)</span>
          </div>

          <!-- Custom User Instruction Input -->
          <div class="flex gap-1.5">
            <input id="wa-custom-quote-prompt" type="text" value="${activeChat.lastCustomPrompt || ''}" onkeydown="if(event.key==='Enter') promptAiCustomQuote(this.value)" placeholder="✨ Prompt AI (e.g. give 10% discount, quote 3 units, polite BM, 50% deposit)..." class="flex-1 bg-white border border-[#0152FC] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#042970] focus:outline-hidden" />
            <button onclick="promptAiCustomQuote(document.getElementById('wa-custom-quote-prompt').value)" class="px-3 py-1.5 rounded-lg bg-[#0152FC] hover:bg-[#0141C9] text-white text-xs font-bold shadow-xs transition cursor-pointer whitespace-nowrap">
              ✨ Ask AI
            </button>
          </div>

          <!-- Quick Negotiation & Discount Shortcut Chips -->
          <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span class="text-[10px] uppercase font-bold text-[#64748B]">Discount / Offer:</span>
            <button onclick="promptAiCustomQuote('Give 5% VIP Discount if deposit confirmed today')" class="px-2 py-0.5 rounded-md bg-white border border-[#0152FC]/40 hover:bg-[#0152FC] hover:text-white text-[11px] font-semibold text-[#0152FC] transition shadow-2xs cursor-pointer">
              💸 5% VIP Discount
            </button>
            <button onclick="promptAiCustomQuote('Knock off RM 150 discount for immediate DuitNow transfer')" class="px-2 py-0.5 rounded-md bg-white border border-[#0152FC]/40 hover:bg-[#0152FC] hover:text-white text-[11px] font-semibold text-[#0152FC] transition shadow-2xs cursor-pointer">
              💸 RM 150 Off
            </button>
            <button onclick="promptAiCustomQuote('Offer free delivery or install promo instead of price cut')" class="px-2 py-0.5 rounded-md bg-white border border-[#0152FC]/40 hover:bg-[#0152FC] hover:text-white text-[11px] font-semibold text-[#0152FC] transition shadow-2xs cursor-pointer">
              🚚 Free Delivery Promo
            </button>
            <button onclick="promptAiCustomQuote('Round down total to nearest hundred flat')" class="px-2 py-0.5 rounded-md bg-white border border-[#0152FC]/40 hover:bg-[#0152FC] hover:text-white text-[11px] font-semibold text-[#0152FC] transition shadow-2xs cursor-pointer">
              🤝 Round Down Flat
            </button>
          </div>
        </div>

        ${activeChat.isAILoading ? `
          <!-- HIDE OLD REPLIES: SHOW CLEAN LOADING SKELETON WHILE AI IS GENERATING -->
          <div class="p-6 rounded-2xl bg-white border-2 border-dashed border-[#0152FC]/40 text-center space-y-3.5 shadow-xs">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#0152FC]/10 text-[#0152FC]">
              <span class="inline-block w-6 h-6 border-3 border-[#0152FC] border-t-transparent rounded-full animate-spin"></span>
            </div>
            <div>
              <div class="text-sm font-bold text-[#042970]">🤖 AI Copilot is generating new reply...</div>
              <div class="text-xs text-[#64748B] mt-0.5">Hiding previous reply while analyzing pricing rules and warehouse stock.</div>
            </div>
            <!-- Loading Skeleton Bars -->
            <div class="space-y-2 pt-1 max-w-sm mx-auto">
              <div class="h-9 bg-[#E6EEFF] rounded-xl animate-pulse"></div>
              <div class="h-9 bg-[#E6EEFF]/60 rounded-xl animate-pulse"></div>
              <div class="h-9 bg-[#E6EEFF]/30 rounded-xl animate-pulse"></div>
            </div>
          </div>
        ` : `
          <!-- RECOMMENDED REPLY SELECTOR MENU -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold uppercase tracking-wider text-[#042970]">💬 Choose Recommended Reply (${replyOptions.length} Options)</span>
              <span class="text-xs text-[#0152FC] font-semibold">Click to pick</span>
            </div>
            <div class="space-y-2">
              ${replyOptions.map((opt, rIdx) => {
                const isSelected = rIdx === selectedIdx;
                const isRebateOpt = activeChat.extActionType === 'AFTERSALES_REPLACE' && (rIdx === 1 || opt.kind === 'REBATE');
                const isTechOpt = activeChat.extActionType === 'AFTERSALES_REPLACE' && (rIdx === 2 || opt.kind === 'TECH_VISIT');
                const rebateVal = typeof activeChat.rebateAmount === 'number' ? activeChat.rebateAmount : 180;
                const techTimeVal = activeChat.techVisitTime || 'before 3:00 PM today';

                return `
                  <div class="rounded-xl border transition ${
                    isSelected
                      ? 'bg-[#E6EEFF] border-2 border-[#0152FC] shadow-xs'
                      : 'bg-[#F2F6FF] border border-[#D5DFEE] hover:bg-[#E6EEFF]/60'
                  }">
                    <button onclick="selectRecommendedReply(${rIdx})" class="w-full text-left p-3">
                      <div class="flex items-center justify-between mb-1">
                        <span class="font-bold text-xs text-[#042970]">${isSelected ? '🔘' : '⚪'} ${opt.label}</span>
                        ${isSelected ? '<span class="px-2 py-0.5 rounded-full bg-[#0152FC] text-white text-xs font-bold">Selected</span>' : ''}
                      </div>
                      <div class="text-xs text-[#324564] leading-relaxed" id="reply-opt-text-${rIdx}">${opt.text}</div>
                    </button>

                    ${isSelected && isRebateOpt ? `
                      <div class="px-3 pb-3 pt-1 border-t border-[#0152FC]/20 flex flex-wrap items-center justify-between gap-2 bg-white/80 rounded-b-xl">
                        <label class="text-xs font-bold text-[#042970]">✏️ Edit Credit Rebate (RM):</label>
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs font-bold text-[#042970]">RM</span>
                          <input id="inline-rebate-input" type="number" min="10" step="10" value="${rebateVal}" oninput="updateAftersalesRebate(this.value)" class="w-24 bg-white border-2 border-[#0152FC] rounded-lg px-2.5 py-1 text-xs font-bold text-[#042970] focus:outline-none" />
                        </div>
                      </div>
                    ` : ''}

                    ${isSelected && isTechOpt ? `
                      <div class="px-3 pb-3 pt-1 border-t border-[#0152FC]/20 space-y-1.5 bg-white/80 rounded-b-xl">
                        <label class="block text-xs font-bold text-[#042970]">🕒 Edit Technician Drop-By Time / Slot:</label>
                        <input id="inline-tech-time-input" type="text" value="${techTimeVal}" oninput="updateAftersalesTechTime(this.value)" placeholder="e.g. before 3:00 PM today or tomorrow 10:30 AM" class="w-full bg-white border-2 border-[#0152FC] rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#042970] focus:outline-none" />
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          ${blockedByRole ? `
            <div class="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs">
              ${roleMode === 'DENY'
                ? '🔒 <b>Off for Staff:</b> the Owner turned this action off in Team & Permissions. Ask the Owner to do it.'
                : '📨 <b>Needs Owner approval:</b> press below to send it to the Owner Approvals list, or switch the top-right Role to <b>Encik Hafiz (Owner)</b>.'}
            </div>
          ` : ''}

          <!-- THE ONE BIG PRIMARY BUTTON IN THE EXTENSION -->
          <button id="ext-primary-action-btn" onclick="executeExtensionAction()" class="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white shadow-md transition ${
            activeChat.done
              ? 'bg-emerald-600'
              : blockedByRole
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-[#0152FC] hover:bg-[#0141C9]'
          }">
            ${activeChat.done ? '✓ Done! (Click to Re-Insert Selected Reply)' : blockedByRole ? '📤 Submit for Owner Approval' : dynamicBtnLabel}
          </button>
        `}

        <div class="pt-2 border-t border-[#D5DFEE] flex items-center justify-between text-xs">
          <span class="text-[#64748B]">Need formal PDF document?</span>
          <button onclick="openPdfFromChat()" class="font-bold text-[#0152FC] hover:underline">
            📄 Preview / Attach PDF →
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
        btnEl.textContent = `💸 Apply RM ${rebate.toLocaleString()} Credit Rebate & Insert Reply`;
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
        btnEl.textContent = `🛠️ Schedule Tech Drop-By (${timeStr}) & Insert Reply`;
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
            if (a.sku) {
              chat.sku = a.sku;
              chat.qty = a.qty;
              chat.extraSku = a.extraSku || null;
              chat.extraQty = a.extraQty || 0;
            }
            if (a.amount) chat.amount = a.amount;
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

          const staffDeposit = !usesBackend() && chat.extActionType === 'CONFIRM_DEPOSIT_DEDUCT' && currentRole === 'STAFF';
          if (!chat.done && usesBackend() && !staffDeposit && chat.extActionType !== 'REPLY_ONLY') {
            const msgs = {
              CREATE_QUOTE_HOLD: `Quote created for ${chat.customer}! Stock placed ON HOLD for 48h & reply filled into WhatsApp!`,
              CONFIRM_DEPOSIT_DEDUCT: 'Deposit confirmed! Order confirmed & scheduled for delivery!',
              AFTERSALES_REPLACE: `1x replacement dispatched as Aftersales Resolution for ${chat.customer}!`,
              RELEASE_EXPIRED_HOLD: `Released ${chat.customer}'s expired reservation back to Available Stock!`
            };
            chat.done = true;
            const rebateChosen = chat.extActionType === 'AFTERSALES_REPLACE'
              && (chat.selectedReplyIdx === 1 || (getReplyOptionsForChat(chat)[chat.selectedReplyIdx] || {}).kind === 'REBATE');
            const aftersalesInv = st.invoices.find(i => i.type === 'AFTERSALES' && i.party.includes(cleanCustomerName(chat.customer)));
            if (rebateChosen && aftersalesInv) {
              const rebate = typeof chat.rebateAmount === 'number' ? chat.rebateAmount : 180;
              backendAction(`/api/invoices/${encodeURIComponent(aftersalesInv.id)}/action`, { action: 'DISCOUNT', amount: rebate },
                `Applied RM ${rebate.toLocaleString()} credit rebate on ${aftersalesInv.id}!`).then(d => { if (!d) chat.done = false; });
              return;
            }
            backendAction('/api/whatsapp/execute', {
              customer: chat.customer,
              phone: (chat.phone || '').split(' · ')[0],
              actionType: chat.extActionType,
              sku: chat.sku || item1.sku,
              qty: chat.qty || 1,
              extraSku: chat.extraSku || null,
              extraQty: chat.extraQty || 0,
              amount: chat.amount || 0
            }, msgs[chat.extActionType]).then(d => { if (!d) chat.done = false; });
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
