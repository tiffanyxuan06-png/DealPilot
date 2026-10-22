let currentRole = 'OWNER';

    // Text from customers, the AI, uploads or the backend goes through this before it is put into innerHTML.
    function escapeHtmlText(text) {
      return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    let currentSME = 'aircond';
    let currentChatIndex = 0;
    let currentInvFilter = 'ALL';
    let currentPage = 'overview';
    let currentVerifyInvId = null;
    let pendingUniversalConfirmFn = null;

    function askUserConfirm(title, message, onConfirmCallback, okBtnText = '✅ Yes, Confirm & Proceed', isDanger = false) {
      document.getElementById('uconf-title').textContent = title;
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
      closeUniversalConfirm();
      if (typeof fn === 'function') {
        fn();
      }
    }

    const smeProfiles = {
      aircond: {
        name: 'Sejuk Jaya Aircond Sdn Bhd',
        cashOnHand: 9800,
        framework: `1. Standard installation labor: RM 250/unit (Installer subcon cost: RM 120/unit).\n2. Extra copper piping: RM 150 per 3m set (deducts PIP-COP-3M stock; cost RM 96).\n3. Quotes hold stock for 48h; deduct physical stock only after deposit is confirmed.`,
        stock: [
          { sku: 'ACN-DAI-15', name: 'Daikin 1.5HP Inverter Unit', onHand: 8, onHold: 3, holdNote: '3x QT-101 (Expired 50h)', unitCost: 850, sellPrice: 1150 },
          { sku: 'GAS-R32', name: 'R32 Refrigerant Gas (3kg)', onHand: 15, onHold: 0, holdNote: '-', unitCost: 130, sellPrice: 180 },
          { sku: 'PIP-COP-3M', name: 'Copper Pipe 3m Set', onHand: 15, onHold: 2, holdNote: '2x QT-102 (41h left)', unitCost: 96, sellPrice: 150 }
        ],
        invoices: [
          { id: 'INV-205', type: 'PENDING_VERIFY', party: 'Wisma Perdana Sdn Bhd', itemsText: '2x Daikin 1.5HP (Customer sent DuitNow Screenshot RM 2,200 · Ref: DN-88412 · RM 200 Short)', sku: 'ACN-DAI-15', qty: 2, amount: 2400, claimedAmount: 2200, receiptRef: 'DN-20261117-88412', status: 'PENDING_BANK_VERIFY', lhdn: '🟢 LHDN TIN: C20991820' },
          { id: 'QT-101', type: 'QUOTE_HOLD', party: 'Kedai Runcit Ah Seng', phone: '+60 19-221 0091', holdTimer: '⚠️ Expired (50h ago)', chatIdx: 3, itemsText: '3x Daikin 1.5HP (ON HOLD — 50h ago, EXPIRED)', sku: 'ACN-DAI-15', qty: 3, amount: 3450, status: 'HOLD_EXPIRED', lhdn: '🟡 Missing TIN' },
          { id: 'QT-102', type: 'QUOTE_HOLD', party: 'Syarikat Bina Jaya', phone: '+60 12-773 8810', holdTimer: '⏳ 41h Left (Active)', chatIdx: null, itemsText: '2x Copper Pipe 3m Set (ON HOLD — 41h left)', sku: 'PIP-COP-3M', qty: 2, amount: 300, status: 'ON_HOLD_48H', lhdn: '🟢 LHDN TIN: C21884920' },
          { id: 'INV-201', type: 'AFTERSALES', party: 'Klinik Dr. Lim', itemsText: '4x Daikin 1.5HP, 4x R32 Gas (1x R32 reported leaking)', sku: 'GAS-R32', qty: 1, amount: 4800, status: 'AFTERSALES_PAUSED', lhdn: '🟢 LHDN Ready' },
          { id: 'INV-202', type: 'PENDING', party: 'Restoran Selera Kampung', itemsText: '1x Daikin 1.5HP + Standard Install', sku: 'ACN-DAI-15', qty: 1, amount: 1650, status: 'PENDING_PAYMENT', lhdn: '🟢 LHDN Ready' },
          { id: 'SUP-881', type: 'SUPPLIER_COST', party: 'Penghawa Dingin Supplies (Supplier)', itemsText: '10x Copper Pipe Set (Stock-In Bill)', sku: 'PIP-COP-3M', qty: 10, amount: 1500, status: 'UNPAID_PAYABLE', lhdn: '🟢 Supplier e-Inv' }
        ],
        chats: [
          {
            id: 'chat-0',
            customer: 'Tan Bros Trading',
            phone: '+60 12-345 6789',
            badge: '0. Sandbox (Live LLM)',
            messages: [],
            extTitle: '🧪 Live LLM Sales Sandbox',
            extCheck: 'Type any customer inquiry below to test live AI pricing, intent detection, and margin rules.\nNo templated presets.',
            extActionDesc: 'Use "Play the customer" below to send custom WhatsApp messages to your live model.',
            extDraft: '',
            selectedReplyIdx: 0,
            replyOptions: [],
            extBtnLabel: 'Send quote & insert reply',
            extActionType: 'CREATE_QUOTE',
            done: false,
            memory: {
              tier: 'VIP_FAST_PAYER',
              score: 94,
              totalOrders: 6,
              totalPaidRM: 28400,
              notes: ['Sandbox active · Live LLM evaluation enabled'],
              timeline: [{ time: 'Just Now', note: 'Sandbox ready' }]
            }
          },
          {
            id: 'chat-1',
            customer: 'Tan Bros Trading',
            phone: '+60 12-345 6789',
            badge: '1. Buying Inquiry',
            messages: [
              { from: 'customer', time: '10:38 AM', text: 'Boss, got 5 units Daikin 1.5HP and 5 bottles R32 gas? How much ah? Need quote urgently.' }
            ],
            extTitle: '🤖 Buying Inquiry → Quote Deal',
            extCheck: '✅ 5x Daikin 1.5HP = RM 5,750\n✅ 5x R32 Gas = RM 900\n💰 Total Quote: RM 6,650\nSubject to stock availability · prices valid 7 days',
            extActionDesc: 'Generates formal sales quote from the price list and logs deal in Pipeline.',
            extDraft: 'Hi Tan Bros! 5x Daikin 1.5HP + 5x R32 Gas total RM 6,650. Subject to stock availability · prices valid 7 days.',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '💼 Option 1: Official Quote (Manglish)',
                text: 'Hi Tan Bros! 5x Daikin 1.5HP + 5x R32 Gas total RM 6,650. Subject to stock availability · prices valid 7 days.'
              },
              {
                label: '🤝 Option 2: Friendly Boss Style',
                text: 'Ready stock Boss! 5x Daikin + 5x R32 total RM 6,650. Can arrange lorry today. Subject to stock availability · prices valid 7 days.'
              },
              {
                label: '🇲🇾 Option 3: Bahasa Melayu (Sebut Harga)',
                text: 'Salam Tan Bros! 5x Daikin 1.5HP + 5x R32 Gas jumlah RM 6,650. Tertakluk kepada stok sedia ada · sah 7 hari.'
              }
            ],
            extBtnLabel: 'Send quote & insert reply',
            extActionType: 'CREATE_QUOTE',
            items: [{ sku: 'ACN-DAI-15', name: 'Daikin 1.5HP Inverter', qty: 5, unitPrice: 1150 }, { sku: 'GAS-R32', name: 'R32 Refrigerant Gas Cylinder', qty: 5, unitPrice: 180 }],
            amount: 6650,
            done: false,
            memory: {
              tier: 'VIP_FAST_PAYER',
              score: 94,
              totalOrders: 6,
              totalPaidRM: 28400,
              notes: ['Direct business owner · Prefers fast quotes via WhatsApp', 'Always pays promptly via corporate DuitNow'],
              timeline: [{ time: '10:38 AM', note: 'Inquired for 5x Daikin + 5x R32' }]
            }
          },
          {
            id: 'chat-2',
            customer: 'Restoran Selera Kampung',
            phone: '+60 17-332 1190',
            badge: '2. Discount Request',
            messages: [
              { from: 'customer', time: '11:02 AM', text: 'Boss, quote for 2 units Daikin 1.5HP can less or give discount sikit? Best price please.' }
            ],
            extTitle: '🏷️ Discount Request → Counter-Offer',
            extCheck: '🛡️ Margin Floor Guard: 15% minimum\n💡 Recommended: Offer Free Delivery (Protects Margin)\nTotal: RM 2,300 · Subject to stock availability · prices valid 7 days',
            extActionDesc: 'Send a margin-safe counter offer without cutting unit prices.',
            extDraft: 'Hi Boss! For 2 units Daikin 1.5HP, our price is RM 2,300 nett. We can throw in free delivery to your shop today! Subject to stock availability · prices valid 7 days.',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '🚚 Option 1: Value-Add Free Delivery (Margin Safe)',
                text: 'Hi Boss! For 2 units Daikin 1.5HP, our price is RM 2,300 nett. We can throw in free delivery to your shop today! Subject to stock availability · prices valid 7 days.'
              },
              {
                label: '💰 Option 2: Round Down RM 50 (Owner Allowed)',
                text: 'Hi Boss, we can round down to RM 2,250 as a gesture for your restaurant! Subject to stock availability · prices valid 7 days.'
              }
            ],
            extBtnLabel: 'Send counter-offer & reply',
            extActionType: 'SEND_COUNTER_OFFER',
            discount: 50,
            amount: 2250,
            done: false,
            memory: {
              tier: 'REPEAT_CLIENT',
              score: 75,
              totalOrders: 2,
              totalPaidRM: 4500,
              notes: ['Restaurant owner · Often asks for best price, pays promptly when confirmed'],
              timeline: [{ time: '11:02 AM', note: 'Requested discount on 2 units Daikin' }]
            }
          },
          {
            id: 'chat-3',
            customer: 'Wisma Perdana Sdn Bhd',
            phone: '+60 12-998 4410',
            badge: '3. Customer Confirmed',
            messages: [
              { from: 'customer', time: '11:15 AM', text: 'Ok boss confirm order for QT-2026-101! Just bank in RM 2,000 deposit via DuitNow (Ref: DN-99281).' }
            ],
            extTitle: '🎉 Order Confirmed → Mark Won',
            extCheck: '💵 Deposit Slip Ref: DN-99281\n💰 Deposit Amount: RM 2,000\nDeal: #QT-2026-101 moves to WON',
            extActionDesc: 'Marks deal as WON and records deposit reference.',
            extDraft: 'Thanks Wisma Perdana! Received your RM 2,000 deposit (Ref: DN-99281). Order is confirmed and scheduled for delivery tomorrow morning!',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '✅ Option 1: Confirm Deposit & Schedule',
                text: 'Thanks Wisma Perdana! Received your RM 2,000 deposit (Ref: DN-99281). Order is confirmed and scheduled for delivery tomorrow morning!'
              },
              {
                label: '🇲🇾 Option 2: Bahasa Melayu (Pengesahan)',
                text: 'Terima kasih Wisma Perdana! Deposit RM 2,000 diterima (Ref: DN-99281). Pesanan disahkan untuk penghantaran esok pagi.'
              }
            ],
            extBtnLabel: 'Mark Won & insert reply',
            extActionType: 'MARK_WON',
            depositRef: 'DN-99281',
            depositAmount: 2000,
            dealId: 'QT-2026-101',
            done: false,
            memory: {
              tier: 'VIP_FAST_PAYER',
              score: 92,
              totalOrders: 4,
              totalPaidRM: 18400,
              notes: ['Commercial client · Pays promptly via corporate DuitNow'],
              timeline: [{ time: '11:15 AM', note: 'Sent DuitNow deposit slip DN-99281' }]
            }
          },
          {
            id: 'chat-4',
            customer: 'Kedai Runcit Ah Seng',
            phone: '+60 19-221 0091',
            badge: '4. Follow-Up Due',
            messages: [
              { from: 'staff', time: '2 Days Ago', text: 'Quote sent for 3x Daikin 1.5HP (RM 3,450). Prices valid 7 days.' },
              { from: 'system', time: '48h elapsed', text: '⏳ 48-hour follow-up SLA timer reached. No customer reply yet.' }
            ],
            extTitle: '⏰ 48h SLA Follow-Up Due',
            extCheck: 'Deal #QT-2026-102: Follow-up 1 of 3\nCustomer has not responded for 48 hours.',
            extActionDesc: 'Sends polite non-pushy follow-up and increments follow-up count.',
            extDraft: 'Hi Boss! Just checking in on your 3x Daikin 1.5HP quotation. Let us know if you would like us to reserve stock for delivery this week!',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '💬 Option 1: Friendly Follow-Up',
                text: 'Hi Boss! Just checking in on your 3x Daikin 1.5HP quotation. Let us know if you would like us to reserve stock for delivery this week!'
              },
              {
                label: '🇲🇾 Option 2: Bahasa Melayu (Santai)',
                text: 'Salam Boss! Sekadar bertanya khabar mengenai sebut harga Daikin hari itu. Maklumkan jika ingin teruskan pesanan ya!'
              }
            ],
            extBtnLabel: 'Send follow-up & reply',
            extActionType: 'SEND_FOLLOW_UP',
            dealId: 'QT-2026-102',
            done: false,
            memory: {
              tier: 'SLOW_PAYER_GHOST_RISK',
              score: 42,
              totalOrders: 1,
              totalPaidRM: 1200,
              notes: ['Often goes quiet after quote · Follow up early with gentle tone'],
              timeline: [{ time: '2 Days Ago', note: 'Quoted RM 3,450' }]
            }
          },
          {
            id: 'chat-5',
            customer: 'Klinik Dr. Lim',
            phone: '+60 16-882 1920',
            badge: '5. Complaint / Pause',
            messages: [
              { from: 'customer', time: '09:50 AM', text: 'Boss, 1 bottle R32 gas from last order valve leaking la. Very dangerous. Please check.' }
            ],
            extTitle: '⚠️ Complaint Reported → Auto Pause',
            extCheck: '🛡️ Follow-up reminders AUTO-PAUSED on customer deal.\nLog complaint and notify service team.',
            extActionDesc: 'Pauses active follow-up timers and drafts apology response.',
            extDraft: 'So sorry Dr. Lim! We have paused all reminders. Our technician is heading over before 2:00 PM today to swap the R32 cylinder at no charge.',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '🛠️ Option 1: Apology & Free Swap Today',
                text: 'So sorry Dr. Lim! We have paused all reminders. Our technician is heading over before 2:00 PM today to swap the R32 cylinder at no charge.'
              }
            ],
            extBtnLabel: 'Log complaint & pause deal',
            extActionType: 'LOG_COMPLAINT',
            complaintNote: 'R32 gas cylinder valve leaking',
            done: false,
            memory: {
              tier: 'VIP_FAST_PAYER',
              score: 88,
              totalOrders: 4,
              totalPaidRM: 19200,
              notes: ['Medical clinic · Values prompt technical support and safety'],
              timeline: [{ time: '09:50 AM', note: 'Reported leaking valve on R32' }]
            }
          },
          {
            id: 'chat-6',
            customer: 'Pelanggan Batal',
            phone: '+60 11-234 5678',
            badge: '6. Customer Declined',
            messages: [
              { from: 'customer', time: '11:40 AM', text: 'Sorry boss, budget tak lepas kali ini. We pass first ya.' }
            ],
            extTitle: '👋 Customer Declined → Mark Lost',
            extCheck: 'Objection Detected: Price / Budget\nDefault Loss Reason: Customer declined on WhatsApp\nPreserve relationship with warm closing.',
            extActionDesc: 'Marks deal as LOST with reason and keeps the door open for future business.',
            extDraft: 'Understood Boss, no problem at all! Thanks for letting us know. Reach out anytime if you need supply down the road!',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '🤝 Option 1: Warm Zero-Pressure Close',
                text: 'Understood Boss, no problem at all! Thanks for letting us know. Reach out anytime if you need supply down the road!'
              },
              {
                label: '🇲🇾 Option 2: Bahasa Melayu (Terima Kasih)',
                text: 'Baik Boss, tidak mengapa. Terima kasih kerana maklumkan. Hubungi kami bila-bila masa jika perlukan bekalan nanti ya!'
              }
            ],
            extBtnLabel: 'Mark Lost & insert reply',
            extActionType: 'MARK_LOST',
            lossReasonSuggestion: 'Price / Budget',
            done: false,
            memory: {
              tier: 'NEW_CLIENT',
              score: 50,
              totalOrders: 0,
              totalPaidRM: 0,
              notes: ['Declined quote due to budget · Zero pressure closing'],
              timeline: [{ time: '11:40 AM', note: 'Customer politely declined quote' }]
            }
          },
          {
            id: 'chat-7',
            customer: 'Syarikat Bina Jaya',
            phone: '+60 12-773 8810',
            badge: '7. LHDN TIN Captured',
            messages: [
              { from: 'customer', time: '12:10 PM', text: 'Boss, for e-Invoice, our Buyer TIN is C21884920000, SSM 202401009921.' }
            ],
            extTitle: '🧾 LHDN TIN → Save e-Invoice Details',
            extCheck: '🟢 Valid Malaysian Buyer TIN: C21884920000\n🟢 Valid SSM BRN: 202401009921\nApplies to open deals for accountant CSV export.',
            extActionDesc: 'Saves Buyer TIN & SSM directly to customer record in database.',
            extDraft: 'Thank you Syarikat Bina Jaya! We have recorded your LHDN TIN (C21884920000) and SSM (202401009921). Your e-Invoice will be processed accordingly.',
            selectedReplyIdx: 0,
            replyOptions: [
              {
                label: '🧾 Option 1: Confirm TIN Received',
                text: 'Thank you Syarikat Bina Jaya! We have recorded your LHDN TIN (C21884920000) and SSM (202401009921). Your e-Invoice will be processed accordingly.'
              }
            ],
            extBtnLabel: 'Save LHDN TIN & reply',
            extActionType: 'SAVE_LHDN_TIN',
            tin: 'C21884920000',
            ssmBrn: '202401009921',
            done: false,
            memory: {
              tier: 'REPEAT_CLIENT',
              score: 80,
              totalOrders: 2,
              totalPaidRM: 300,
              notes: ['Contractor client · LHDN e-Invoice ready'],
              timeline: [{ time: '12:10 PM', note: 'Submitted LHDN TIN' }]
            }
          }
        ],
        logs: [
          '10:30 AM · [System] Flagged QT-101 (Kedai Ah Seng): 48h Stock Hold expired (3x Daikin ready to release).',
          '09:51 AM · [Guard] Auto-paused reminders on INV-201 (Klinik Dr. Lim) due to aftersales complaint.'
        ]
      },
      software: {
        name: 'NexaByte Software Studio Sdn Bhd',
        cashOnHand: 14500,
        framework: `1. Base software modules use catalogue price (annual seat license).\n2. Custom features / Change Requests are billed at RM 600 per Developer Man-Day (Internal dev labor cost: RM 250/day).\n3. Quotes hold sprint capacity / licenses for 48h; lock sprint only after 40% deposit.`,
        stock: [
          { sku: 'SW-POS-PRO', name: 'Cloud POS Annual License Seat', onHand: 25, onHold: 5, holdNote: '5x QT-701 (36h left)', unitCost: 300, sellPrice: 1200 },
          { sku: 'LAB-DEV-DAY', name: 'Developer Sprint Man-Day (Capacity)', onHand: 20, onHold: 3, holdNote: '3d QT-701', unitCost: 250, sellPrice: 600 }
        ],
        invoices: [
          { id: 'QT-701', type: 'QUOTE_HOLD', party: 'Mega Retail Sdn Bhd', phone: '+60 12-309 8821', holdTimer: '⏳ 36h Left (Active)', itemsText: '5x Cloud POS Seat + 3x Dev Man-Days (ON HOLD — 36h left)', sku: 'SW-POS-PRO', qty: 5, extraSku: 'LAB-DEV-DAY', extraQty: 3, amount: 7800, status: 'ON_HOLD_48H', lhdn: '🟢 LHDN Ready' },
          { id: 'INV-801', type: 'PENDING', party: 'Klinik Medika Group', itemsText: '3x Cloud POS License (Deployed · Waiting Balance)', sku: 'SW-POS-PRO', qty: 3, amount: 3600, status: 'PENDING_PAYMENT', lhdn: '🟢 LHDN Ready' },
          { id: 'SUP-402', type: 'SUPPLIER_COST', party: 'Cloud Infra Global Ltd', itemsText: 'High-Availability Server Cluster Hosting (Monthly)', sku: 'SW-POS-PRO', qty: 1, amount: 1800, status: 'UNPAID_PAYABLE', lhdn: '🟢 Supplier e-Inv' }
        ],
        chats: [
          {
            id: 'chat-sw-1',
            customer: 'Mega Retail Sdn Bhd',
            phone: '+60 12-309 8821 · TIN: C22998811',
            badge: '1. License & Sprint Inquiry',
            messages: [
              { from: 'customer', time: '10:20 AM', text: 'Hi NexaByte team! Expanding 5 outlets. Need 5x Cloud POS License Seats and 3 Developer Sprint Days for custom ERP sync. Can quote urgently?' }
            ],
            extTitle: '🤖 Software License & Sprint Quote → Hold Capacity',
            extCheck: '✅ Cloud POS Seats: 25 Available (RM 1,200/seat)\n✅ Dev Capacity: 20 Days Available (RM 600/day)\n💰 Quote Total: RM 7,800 (40% Deposit: RM 3,120)',
            extActionDesc: 'Choose recommended quote reply below, then click to reserve 5 licenses + 3 sprint days.',
            extDraft: 'Hi Mega Retail! Quote for 5x Cloud POS Licenses (RM 6,000) + 3 Dev Man-Days (RM 1,800) = Total RM 7,800. Let us know if you want to proceed with 40% deposit (RM 3,120) to confirm your order!',
            selectedReplyIdx: 0,
            replyOptions: [
              { label: '💼 Option 1: Official Software Quote (40% Deposit)', text: 'Hi Mega Retail! Quote for 5x Cloud POS Licenses (RM 6,000) + 3 Dev Man-Days (RM 1,800) = Total RM 7,800. Let us know if you want to proceed with 40% deposit (RM 3,120) to confirm your order!' },
              { label: '🤝 Option 2: Friendly Direct Style', text: 'Ready stock Boss! 5 POS seats + 3 Dev days total RM 7,800. Just DuitNow RM 3,120 deposit when ready and our lead dev will confirm your sprint schedule!' },
              { label: '🇲🇾 Option 3: Bahasa Melayu (Sebut Harga Perisian)', text: 'Salam Mega Retail! Sebut harga untuk 5 lesen POS (RM 6,000) + 3 hari pembangunan (RM 1,800) = RM 7,800. Deposit 40% (RM 3,120) untuk pengesahan pesanan dan penjadualan.' }
            ],
            extBtnLabel: '✅ Hold Sprint Capacity (48h) & Insert Quote',
            extActionType: 'CREATE_QUOTE_HOLD',
            done: false,
            memory: {
              tier: 'High-Value Enterprise',
              score: 91,
              totalOrders: 3,
              totalPaidRM: 24500,
              notes: [
                'Retail chain client · Requires milestone invoicing & SLA',
                'Always pays 40% deposit upon quotation acceptance'
              ],
              timeline: [
                { time: '10:20 AM', note: 'Customer requested 5x POS + 3 Dev Man-Days quote' }
              ]
            }
          },
          {
            id: 'chat-sw-2',
            customer: 'Bintang E-Commerce Sdn Bhd',
            phone: '+60 13-441 9901 · Quote #QT-701',
            badge: '2. Deposit Paid',
            messages: [
              { from: 'customer', time: '11:40 AM', text: 'Hi team, confirmed! We just transferred RM 3,120 deposit via DuitNow (Ref: DN-20261117-88410). Please lock our sprint.' }
            ],
            extTitle: '💰 Deposit Paid (RM 3,120) → Confirm Sprint & License',
            extCheck: '💵 Deposit Received: RM 3,120\n📦 Allocates 5x Cloud POS Licenses & 3x Developer Days',
            extActionDesc: 'Choose confirmation reply below, then press button to confirm deposit and lock sprint slot.',
            extDraft: 'Thanks Bintang E-Commerce! Received RM 3,120 DuitNow deposit (Ref: DN-88410). Your Cloud POS order is confirmed and onboarding starts Monday!',
            selectedReplyIdx: 0,
            replyOptions: [
              { label: '✅ Option 1: Confirm Deposit & Schedule Kick-Off', text: 'Thanks Bintang E-Commerce! Received RM 3,120 DuitNow deposit (Ref: DN-88410). Your Cloud POS order is confirmed and onboarding starts Monday!' },
              { label: '🤝 Option 2: Friendly Direct Style', text: 'Thanks Boss! Received RM 3,120 DuitNow already. Our team will start provisioning your 5 POS seats today!' },
              { label: '🇲🇾 Option 3: Bahasa Melayu (Pengesahan Deposit)', text: 'Terima kasih Bintang E-Commerce! Deposit RM 3,120 telah diterima. Slot pembangunan dan 5 lesen POS telah disahkan.' }
            ],
            extBtnLabel: '💰 Confirm RM 3,120 Deposit & Lock Sprint',
            extActionType: 'CONFIRM_DEPOSIT_DEDUCT',
            done: false,
            memory: {
              tier: 'High-Value Enterprise',
              score: 93,
              totalOrders: 3,
              totalPaidRM: 24500,
              notes: [
                'Fast payer · Promptly transferred 40% deposit for sprint',
                'Lead contact: Procurement Manager Mr Daniel'
              ],
              timeline: [
                { time: '10:20 AM', note: 'Requested Quote #QT-701' },
                { time: '11:40 AM', note: 'Paid RM 3,120 deposit via DuitNow (Ref: DN-88410)' }
              ]
            }
          },
          {
            id: 'chat-sw-3',
            customer: 'Klinik Medika Group',
            phone: '+60 12-880 4411 · Project #INV-801',
            badge: '3. Technical Support Issue',
            messages: [
              { from: 'customer', time: '09:30 AM', text: 'Hi team, on POS v2.4 the LHDN MyInvois XML export is throwing a 500 server error when generating batch invoices. Please check and fix urgently!' }
            ],
            extTitle: '⚠️ Critical Bug Reported (Chasing Auto-Paused)',
            extCheck: '🛡️ Payment chasing on #INV-801 is AUTO-PAUSED.\n💡 Recommended Fix: Hotfix patch deployment today (-1 Dev Day) OR Senior Engineer remote session.',
            extActionDesc: 'Choose resolution reply below, then click to deploy resolution and notify customer.',
            extDraft: 'So sorry about the XML export error Klinik Medika! We have paused invoice chasing and our engineer is building an urgent hotfix patch for deployment today.',
            selectedReplyIdx: 0,
            replyOptions: [
              { kind: 'REPLACE', label: '🛠️ Option 1: Urgent Hotfix Patch Today', text: 'So sorry about the XML export error Klinik Medika! We have paused invoice chasing and our engineer is building an urgent hotfix patch for deployment today.' },
              { kind: 'REBATE', label: '💸 Option 2: Apply RM 300 Maintenance Rebate', text: 'Sincere apologies Klinik Medika! We will apply an immediate RM 300 service credit rebate off #INV-801 while our engineer resolves the sync issue.' },
              { kind: 'TECH_VISIT', label: '💻 Option 3: Remote Live Debugging Session', text: 'Sorry about that! Our senior developer is available right now for a remote session to debug the API connection on your server.' }
            ],
            extBtnLabel: '🛠️ Deploy Hotfix & Insert Reply',
            extActionType: 'AFTERSALES_REPLACE',
            done: false,
            memory: {
              tier: 'Reliable Healthcare Client',
              score: 87,
              totalOrders: 4,
              totalPaidRM: 18600,
              notes: [
                'Clinic group · High sensitivity to software uptime during clinic operating hours',
                'Prompt payer · Demands prompt bug resolutions'
              ],
              timeline: [
                { time: 'Last Week', note: 'Deployed POS v2.4 (#INV-801)' },
                { time: '09:30 AM', note: 'Reported LHDN XML 500 error. Invoice reminders paused.' }
              ]
            }
          },
          {
            id: 'chat-sw-4',
            customer: 'Apex Logistics Sdn Bhd',
            phone: '+60 19-332 9901 · Quote #QT-705',
            badge: '4. Expired 48h Sprint Hold',
            messages: [
              { from: 'staff', time: '2 Days Ago', text: 'Sent Quote #QT-705 for 2x POS Seats + 4 Dev Days (RM 4,800). Sprint reserved for 48 hours.' },
              { from: 'customer', time: 'Today', text: '(No deposit after 50 hours — Sprint Hold Expired)' }
            ],
            extTitle: '⏳ 48h Sprint Capacity Hold Expired (#QT-705)',
            extCheck: '📦 4 Developer Man-Days held for >48h without deposit.',
            extActionDesc: 'Choose follow-up message below, then click to release developer capacity back to available pool.',
            extDraft: 'Hi Apex Logistics! Just following up on your development quote. Do you still need our team arranged for your project this sprint?',
            selectedReplyIdx: 0,
            replyOptions: [
              { label: '🔓 Option 1: Friendly Follow-Up', text: 'Hi Apex Logistics! Just following up on your development quote. Do you still need our team arranged for your project this sprint?' },
              { label: '⏳ Option 2: Last-Call Check Before Release', text: 'Hi Apex Logistics! Just checking if you would like us to reserve the development schedule for your project? Let us know whenever you are ready!' },
              { label: '🇲🇾 Option 3: Bahasa Melayu (Pertanyaan Susulan)', text: 'Salam Boss, nak tanya sebut harga #QT-705 untuk 4 hari pembangunan masih nak teruskan? Boleh maklumkan hari ini ya.' }
            ],
            extBtnLabel: '🔓 Release 4 Dev Days & Insert Follow-Up',
            extActionType: 'RELEASE_EXPIRED_HOLD',
            done: false,
            memory: {
              tier: 'Cautious Corporate',
              score: 65,
              totalOrders: 1,
              totalPaidRM: 4200,
              notes: [
                'Slow decision making cycle (requires multi-department signoffs)',
                'Do not hold sprint capacity beyond 48 hours without firm deposit'
              ],
              timeline: [
                { time: '2 Days Ago', note: 'Quoted 4 Dev Days (#QT-705)' },
                { time: 'Today', note: '48h hold expired without deposit confirmation' }
              ]
            }
          }
        ],
        logs: [
          '10:15 AM · [Setup] Loaded Software Studio profile & Man-Day Labor Framework.',
          '09:31 AM · [Guard] Auto-paused reminders on INV-801 (Klinik Medika) due to LHDN XML bug.'
        ]
      },
      fnb: {
        name: 'Kopi & Bakery Wholesale Sdn Bhd',
        cashOnHand: 6400,
        framework: `1. Wholesale items use catalogue carton/bag pricing.\n2. Standard cold-chain delivery labor/van fee: RM 50 per trip (Driver cost: RM 35), FREE for orders > RM 1,500.\n3. Urgent same-day lorry dispatch: +RM 120 charge (Lorry cost: RM 80).`,
        stock: [
          { sku: 'BEAN-ARA-5K', name: 'Arabica Coffee Beans (5kg Bag)', onHand: 20, onHold: 4, holdNote: '4x QT-301 (30h left)', unitCost: 180, sellPrice: 260 },
          { sku: 'MLK-OAT-CTN', name: 'Barista Oat Milk (Carton 12x1L)', onHand: 30, onHold: 0, holdNote: '-', unitCost: 90, sellPrice: 135 }
        ],
        invoices: [
          { id: 'QT-301', type: 'QUOTE_HOLD', party: 'Cafe Hipster KL', phone: '+60 17-998 1122', holdTimer: '⏳ 30h Left (Active)', itemsText: '4x Arabica 5kg (ON HOLD — 30h left)', sku: 'BEAN-ARA-5K', qty: 4, amount: 1040, status: 'ON_HOLD_48H', lhdn: '🟢 LHDN Ready' },
          { id: 'INV-501', type: 'PENDING', party: 'Bistro Bintang', itemsText: '10x Oat Milk Carton', sku: 'MLK-OAT-CTN', qty: 10, amount: 1350, status: 'PENDING_PAYMENT', lhdn: '🟡 Missing TIN' },
          { id: 'SUP-601', type: 'SUPPLIER_COST', party: 'Nusantara Coffee Importers Sdn Bhd', itemsText: '30x Arabica 5kg Green Beans (Stock-In Bill)', sku: 'BEAN-ARA-5K', qty: 30, amount: 3600, status: 'UNPAID_PAYABLE', lhdn: '🟢 Supplier e-Inv' }
        ],
        chats: [
          {
            id: 'chat-fnb-1',
            customer: 'Cafe Hipster KL',
            phone: '+60 17-998 1122',
            badge: '1. Wholesale Inquiry',
            messages: [
              { from: 'customer', time: '10:15 AM', text: 'Hi, can quote 6 bags of Arabica 5kg and 10 cartons Barista Oat Milk with cold delivery?' }
            ],
            extTitle: '🤖 Wholesale Inquiry → 48h Stock Hold',
            extCheck: '✅ Arabica 5kg: 16 Available · ✅ Oat Milk: 30 Available\n💰 Quote Total: RM 2,910 (Free Delivery > RM 1,500 applied)',
            extActionDesc: 'Holds stock for 48h and inserts wholesale quote reply.',
            extDraft: 'Hi Cafe Hipster! Quote ready for 6x Arabica 5kg (RM 1,560) + 10x Oat Milk (RM 1,350) = RM 2,910 with free delivery. Let us know if you want to confirm with 40% deposit (RM 1,164)!',
            selectedReplyIdx: 0,
            replyOptions: [
              { label: '💼 Option 1: Wholesale Quote (Free Cold Delivery)', text: 'Hi Cafe Hipster! Quote ready for 6x Arabica 5kg (RM 1,560) + 10x Oat Milk (RM 1,350) = RM 2,910 with free delivery. Let us know if you want to confirm with 40% deposit (RM 1,164)!' },
              { label: '🤝 Option 2: Friendly Direct Style', text: 'Ready stock Boss! 6 bags Arabica + 10 cartons Oat Milk total RM 2,910 with free van dispatch. Just DuitNow RM 1,164 deposit and we will confirm your order and delivery!' },
              { label: '🇲🇾 Option 3: Bahasa Melayu (Sebut Harga Borong)', text: 'Salam Cafe Hipster! Sebut harga 6 beg kopi Arabica + 10 karton susu oat = RM 2,910 (penghantaran percuma). Deposit 40% (RM 1,164) untuk tempahan.' }
            ],
            extBtnLabel: '✅ Hold Wholesale Stock & Insert Quote',
            extActionType: 'CREATE_QUOTE_HOLD',
            done: false,
            memory: {
              tier: 'Popular Cafe Partner',
              score: 92,
              totalOrders: 8,
              totalPaidRM: 16800,
              notes: [
                'Artisan cafe chain · Regular weekly orders of Arabica beans and Oat Milk',
                'Always pays deposit on time via DuitNow QR'
              ],
              timeline: [
                { time: '10:15 AM', note: 'Customer sent wholesale inquiry for 6x Arabica + 10x Oat Milk' }
              ]
            }
          },
          {
            id: 'chat-fnb-2',
            customer: 'Urban Roasters TTDI',
            phone: '+60 18-332 5590 · Quote #QT-301',
            badge: '2. Deposit Paid',
            messages: [
              { from: 'customer', time: '11:10 AM', text: 'Hi Boss! Just transferred RM 1,164 deposit via DuitNow (Ref: DN-20261117-77319). Please send tomorrow morning!' }
            ],
            extTitle: '💰 Deposit Paid (RM 1,164) → Confirm Wholesale Order',
            extCheck: '💵 Deposit Received: RM 1,164\n📦 Deducts 6x Arabica 5kg & 10x Oat Milk for dispatch',
            extActionDesc: 'Choose confirmation reply below, then click to confirm deposit and schedule cold van delivery.',
            extDraft: 'Thanks Urban Roasters! Received RM 1,164 DuitNow deposit (Ref: DN-77319). Your coffee & oat milk order is confirmed for tomorrow morning delivery!',
            selectedReplyIdx: 0,
            replyOptions: [
              { label: '✅ Option 1: Confirm Deposit & Schedule Van Delivery', text: 'Thanks Urban Roasters! Received RM 1,164 DuitNow deposit (Ref: DN-77319). Your coffee & oat milk order is confirmed for tomorrow morning delivery!' },
              { label: '🤝 Option 2: Friendly Direct Style', text: 'Thanks Boss! Received RM 1,164 already. Our cold-chain driver will deliver tomorrow before 11 AM!' },
              { label: '🇲🇾 Option 3: Bahasa Melayu (Pengesahan Deposit)', text: 'Terima kasih Urban Roasters! Deposit RM 1,164 telah disahkan. Penghantaran van sejuk beku dijadualkan esok pagi.' }
            ],
            extBtnLabel: '💰 Confirm RM 1,164 Deposit & Schedule Delivery',
            extActionType: 'CONFIRM_DEPOSIT_DEDUCT',
            done: false,
            memory: {
              tier: 'Popular Cafe Partner',
              score: 93,
              totalOrders: 8,
              totalPaidRM: 16800,
              notes: [
                'Fast payer · Weekly standing wholesale client',
                'Requires morning drop-off before 11:30 AM'
              ],
              timeline: [
                { time: '10:15 AM', note: 'Sent Quote #QT-301' },
                { time: '11:10 AM', note: 'Paid RM 1,164 DuitNow deposit (Ref: DN-77319)' }
              ]
            }
          },
          {
            id: 'chat-fnb-3',
            customer: 'Bistro Bintang',
            phone: '+60 13-441 2290 · Invoice #INV-501',
            badge: '3. Damaged Carton in Transit',
            messages: [
              { from: 'customer', time: '09:20 AM', text: 'Boss, 1 carton of Barista Oat Milk from INV-501 arrived punctured and leaking from the delivery van. Can you send 1 replacement carton or rebate?' }
            ],
            extTitle: '⚠️ Damaged Item Reported (Reminders Paused)',
            extCheck: '🛡️ Payment chasing on #INV-501 is AUTO-PAUSED.\n💡 Recommended Fix: Send 1x replacement Oat Milk carton (-1 Stock) OR Credit Rebate (RM 135).',
            extActionDesc: 'Choose resolution reply below, then click to execute.',
            extDraft: 'So sorry about the punctured carton Bistro Bintang! We have paused invoice chasing and will send 1x replacement Oat Milk carton on today\'s afternoon route at no charge.',
            selectedReplyIdx: 0,
            replyOptions: [
              { kind: 'REPLACE', label: '📦 Option 1: Free 1-to-1 Replacement Today', text: 'So sorry about the punctured carton Bistro Bintang! We have paused invoice chasing and will send 1x replacement Oat Milk carton on today\'s afternoon route at no charge.' },
              { kind: 'REBATE', label: '💸 Option 2: Offer RM 135 Instant Credit Rebate', text: 'Sincere apologies Bistro Bintang! We can deduct RM 135 off #INV-501 immediately (revised balance RM 1,215) if that is more convenient.' },
              { kind: 'TECH_VISIT', label: '🚚 Option 3: Driver Swap Before 3:00 PM', text: 'Sorry about that! Our delivery driver is still in your area and will swap the damaged carton before 3:00 PM today.' }
            ],
            extBtnLabel: '📦 Send -1 Replacement Carton & Insert Reply',
            extActionType: 'AFTERSALES_REPLACE',
            done: false,
            memory: {
              tier: 'Reliable Restaurant',
              score: 85,
              totalOrders: 5,
              totalPaidRM: 8900,
              notes: [
                'Busy bistro · Strict QA on packaging seals',
                'Prompt payer once delivery condition is verified'
              ],
              timeline: [
                { time: 'Yesterday', note: 'Delivered INV-501 (10x Oat Milk)' },
                { time: '09:20 AM', note: 'Reported punctured carton. Reminders auto-paused.' }
              ]
            }
          },
          {
            id: 'chat-fnb-4',
            customer: 'Daily Roast Cafe',
            phone: '+60 18-771 9022 · Quote #QT-305',
            badge: '4. Expired 48h Wholesale Hold',
            messages: [
              { from: 'staff', time: '2 Days Ago', text: 'Sent Quote #QT-305 for 4x Arabica 5kg (RM 1,040). Stock held for 48 hours.' },
              { from: 'customer', time: 'Today', text: '(No deposit after 50 hours — Wholesale Hold Expired)' }
            ],
            extTitle: '⏳ 48h Wholesale Stock Hold Expired (#QT-305)',
            extCheck: '📦 4x Arabica 5kg held for >48h without deposit.',
            extActionDesc: 'Choose follow-up message below, then click to release beans back to open stock.',
            extDraft: 'Hi Daily Roast! Just following up on your coffee bean inquiry. Do you still need these bags delivered to your cafe this week?',
            selectedReplyIdx: 0,
            replyOptions: [
              { label: '🔓 Option 1: Friendly Follow-Up', text: 'Hi Daily Roast! Just following up on your coffee bean inquiry. Do you still need these bags delivered to your cafe this week?' },
              { label: '⏳ Option 2: Last-Call Check Before Release', text: 'Hi Daily Roast! Following up to see if your cafe needs fresh delivery arranged this week? Let us know anytime!' },
              { label: '🇲🇾 Option 3: Bahasa Melayu (Pertanyaan Susulan)', text: 'Salam Boss, nak tanya sebut harga #QT-305 untuk 4 beg kopi Arabica masih nak teruskan? Boleh maklumkan hari ini ya.' }
            ],
            extBtnLabel: '🔓 Release 4x Arabica Stock & Insert Follow-Up',
            extActionType: 'RELEASE_EXPIRED_HOLD',
            done: false,
            memory: {
              tier: 'Occasional Buyer',
              score: 68,
              totalOrders: 2,
              totalPaidRM: 2600,
              notes: [
                'Smaller volume cafe · Irregular ordering schedule',
                'Release stock promptly after 48h if no deposit'
              ],
              timeline: [
                { time: '2 Days Ago', note: 'Quoted 4x Arabica 5kg (#QT-305)' },
                { time: 'Today', note: '48h hold expired without deposit confirmation' }
              ]
            }
          }
        ],
        logs: [
          '10:00 AM · [Setup] Loaded Wholesale F&B profile.',
          '09:21 AM · [Guard] Auto-paused reminders on INV-501 (Bistro Bintang) due to damaged carton.'
        ]
      }
    };

    function getState() {
      return smeProfiles[currentSME];
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
    const BACKEND_API_BASE = (window.location.protocol.startsWith('http') && (window.location.port === '8000' || window.location.port === ''))
      ? window.location.origin
      : 'http://127.0.0.1:8000';


// --- BACKEND SYNC ---
    // The active SME profile lives in the backend database (shared with the WhatsApp extension).
    // The Owner switches profile through the backend; the page follows whatever profile the backend has loaded.
    let backendOnline = false;
    let backendPreset = 'aircond';
    let lastBackendSignature = '';

    function usesBackend() {
      return backendOnline && currentSME === backendPreset;
    }

    function applyBackendState(data) {
      if (!data || !data.company) return;
      backendPreset = (data.company.preset && smeProfiles[data.company.preset]) ? data.company.preset : 'aircond';
      const st = smeProfiles[backendPreset];
      st.name = data.company.name;
      if (data.company.framework) st.framework = data.company.framework;
      st.cashOnHand = data.company.cashOnHand;
      st.stock = data.stock;
      st.invoices = data.invoices;
      st.logs = data.logs;
      st.customers = data.customers || [];
      backendPermissions = data.permissions || backendPermissions;
      backendApprovals = data.approvals || [];
      lastBackendSignature = backendSignature(data);
    }

    function backendSignature(data) {
      return JSON.stringify([data.company, data.stock, data.invoices, data.logs, data.permissions, data.approvals]);
    }

    // Permissions set by the Owner in Settings → Team & Permissions (enforced by the backend).
    let backendPermissions = null;
    let backendApprovals = [];

    // Staff mode for one action key: ALLOW | APPROVAL | DENY. The Owner always has ALLOW.
    function staffModeFor(key) {
      if (currentRole === 'OWNER' || !usesBackend() || !backendPermissions) return 'ALLOW';
      const a = backendPermissions.actions.find(x => x.key === key);
      return a ? a.mode : 'ALLOW';
    }

    async function syncFromBackend() {
      try {
        const res = await fetch(`${BACKEND_API_BASE}/api/state`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        backendOnline = true;
        const pill = document.getElementById('backend-status-pill');
        if (pill) {
          pill.className = 'mt-1 inline-block px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-300 text-[11px] font-semibold text-emerald-800';
          pill.textContent = '● Backend Connected · Port 8000';
        }
        const signature = backendSignature(data);
        if (signature === lastBackendSignature) return;
        applyBackendState(data);
        if (currentSME !== backendPreset) {
          showProfileInUI(backendPreset);  // e.g. the Owner switched profile in another tab
        } else {
          renderAll();
        }
      } catch (err) {
        backendOnline = false;
        const pill = document.getElementById('backend-status-pill');
        if (pill) {
          pill.className = 'mt-1 inline-block px-2 py-0.5 rounded-md bg-amber-50 border border-amber-300 text-[11px] font-semibold text-amber-900';
          pill.textContent = '○ Backend Offline · Run python run_server.py';
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
    function toggleRole() {
      currentRole = currentRole === 'OWNER' ? 'STAFF' : 'OWNER';
      if (currentRole === 'OWNER') {
        document.getElementById('role-avatar').textContent = 'EH';
        document.getElementById('role-avatar').className = 'w-7 h-7 rounded-full bg-[#0152FC] text-white font-bold text-xs flex items-center justify-center';
        document.getElementById('role-name').textContent = 'Encik Hafiz (Owner)';
        document.getElementById('role-sub').textContent = 'Click to switch to Staff';
      } else {
        document.getElementById('role-avatar').textContent = 'AI';
        document.getElementById('role-avatar').className = 'w-7 h-7 rounded-full bg-[#042970] text-[#01E3FB] font-bold text-xs flex items-center justify-center';
        document.getElementById('role-name').textContent = 'Aina (Staff)';
        document.getElementById('role-sub').textContent = 'Click to switch to Owner';
      }
      showToast(`Switched role to ${currentRole === 'OWNER' ? 'Encik Hafiz (Owner)' : 'Aina (Staff)'}.`);
      renderAll();
    }

    function renderSimulationBar() {
      const container = document.getElementById('sim-buttons-container');
      if (!container) return;
      if (currentSME === 'custom') {
        container.innerHTML = `<span class="text-xs text-[#64748B]">Your own business: use the WhatsApp extension on real chats, or type a customer message below.</span>`;
        return;
      }
      if (currentSME === 'software') {
        container.innerHTML = `
          <button onclick="simulateCustomerAction('PDF_DUITNOW')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-purple-50 border border-purple-200 text-xs font-bold text-purple-900 shadow-2xs transition">
            📎 DuitNow RM 3,120 PDF
          </button>
          <button onclick="simulateCustomerAction('PDF_SUPPLIER')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 shadow-2xs transition">
            📎 Cloud Hosting Bill SUP-402
          </button>
          <button onclick="simulateCustomerAction('MSG_BUY_INQUIRY')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-blue-200 text-xs font-bold text-[#0152FC] shadow-2xs transition">
            💬 Asks for 5x POS + 3 Dev Days
          </button>
          <button onclick="simulateCustomerAction('MSG_DEPOSIT_PAID')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 shadow-2xs transition">
            💰 "Paid RM 3,120 Deposit"
          </button>
          <button onclick="simulateCustomerAction('MSG_AFTERSALES')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 shadow-2xs transition">
            🛠️ "LHDN XML Error, Need Patch!"
          </button>
          <button onclick="simulateCustomerAction('MSG_DISCOUNT')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-900 shadow-2xs transition">
            🎁 "Can give 10% discount?"
          </button>
          <button onclick="simulateCustomerAction('MSG_BM')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 shadow-2xs transition">
            🇲🇾 "Salam, sebut harga lesen POS"
          </button>
        `;
      } else if (currentSME === 'fnb') {
        container.innerHTML = `
          <button onclick="simulateCustomerAction('PDF_DUITNOW')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-purple-50 border border-purple-200 text-xs font-bold text-purple-900 shadow-2xs transition">
            📎 DuitNow RM 1,164 PDF
          </button>
          <button onclick="simulateCustomerAction('PDF_SUPPLIER')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 shadow-2xs transition">
            📎 Coffee Green Beans Bill SUP-601
          </button>
          <button onclick="simulateCustomerAction('MSG_BUY_INQUIRY')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-blue-200 text-xs font-bold text-[#0152FC] shadow-2xs transition">
            💬 Asks for 6x Arabica + 10x Oat Milk
          </button>
          <button onclick="simulateCustomerAction('MSG_DEPOSIT_PAID')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 shadow-2xs transition">
            💰 "Paid RM 1,164 Deposit"
          </button>
          <button onclick="simulateCustomerAction('MSG_AFTERSALES')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 shadow-2xs transition">
            🛠️ "Milk Carton Punctured, Replace!"
          </button>
          <button onclick="simulateCustomerAction('MSG_DISCOUNT')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-900 shadow-2xs transition">
            🎁 "Can give 5% VIP discount?"
          </button>
          <button onclick="simulateCustomerAction('MSG_BM')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 shadow-2xs transition">
            🇲🇾 "Salam, sebut harga kopi borong"
          </button>
        `;
      } else {
        container.innerHTML = `
          <button onclick="simulateCustomerAction('PDF_DUITNOW')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-purple-50 border border-purple-200 text-xs font-bold text-purple-900 shadow-2xs transition">
            📎 Sends DuitNow Receipt PDF
          </button>
          <button onclick="simulateCustomerAction('PDF_SUPPLIER')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 shadow-2xs transition">
            📎 Sends Supplier Bill PDF
          </button>
          <button onclick="simulateCustomerAction('MSG_BUY_INQUIRY')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-blue-200 text-xs font-bold text-[#0152FC] shadow-2xs transition">
            💬 Asks for 5x Daikin + R32 Quote
          </button>
          <button onclick="simulateCustomerAction('MSG_DEPOSIT_PAID')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 shadow-2xs transition">
            💰 "Paid RM 2,000 Deposit"
          </button>
          <button onclick="simulateCustomerAction('MSG_AFTERSALES')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 shadow-2xs transition">
            🛠️ "Gas Leaking, Replace!"
          </button>
          <button onclick="simulateCustomerAction('MSG_DISCOUNT')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-900 shadow-2xs transition">
            🎁 "Can give 5% discount?"
          </button>
          <button onclick="simulateCustomerAction('MSG_BM')" class="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 shadow-2xs transition">
            🇲🇾 "Salam, sebut harga 3 unit"
          </button>
        `;
      }
    }

    // Settings dropdown: with the backend running, the Owner loads that business's demo data on the server.
    function changeSMEProfile(val) {
      const select = document.getElementById('sme-select');
      if (!backendOnline) {
        showProfileInUI(val);
        return;
      }
      if (val === backendPreset) return;
      askUserConfirm(
        `Switch SME Profile`,
        `Load the demo data for ${smeProfiles[val].name}?\n\nThis replaces the current demo data (stock, invoices, approvals, permissions) for everyone, including the WhatsApp extension. Only the Owner can do this.`,
        async () => {
          const data = await backendAction('/api/profile', { preset: val });
          if (data) {
            showProfileInUI(val);
          } else if (select) {
            select.value = currentSME;
          }
        },
        '🔄 Switch & Load Demo Data'
      );
      if (select) select.value = currentSME;  // only changes once the backend confirms
    }

    function showProfileInUI(val) {
      currentSME = val;
      const select = document.getElementById('sme-select');
      if (select && ![...select.options].some(o => o.value === val)) {
        select.add(new Option(`My Business · ${smeProfiles[val].name}`, val));  // business from the 60-second setup
      }
      if (select) select.value = val;
      currentChatIndex = 0;
      const st = getState();
      const fwEl = document.getElementById('owner-framework-input');
      if (fwEl) fwEl.value = st.framework;
      const lbl = document.getElementById('sidebar-sme-label');
      if (lbl) lbl.textContent = st.name;
      const topTitle = document.getElementById('top-company-title');
      if (topTitle) topTitle.textContent = st.name;
      const pdfComp = document.getElementById('pdf-company-name');
      if (pdfComp) pdfComp.textContent = st.name;

      const aiPromptInput = document.getElementById('wa-custom-quote-prompt');
      if (aiPromptInput) {
        if (val === 'software') {
          aiPromptInput.placeholder = '✨ Prompt AI (e.g. 5 POS licenses, 3 dev days, 10% discount, polite BM)...';
        } else if (val === 'fnb') {
          aiPromptInput.placeholder = '✨ Prompt AI (e.g. 6 bags Arabica, 10 cartons Oat Milk, free cold delivery)...';
        } else {
          aiPromptInput.placeholder = '✨ Prompt AI (e.g. give 10% discount, 5 units Daikin, standard install)...';
        }
      }

      renderSimulationBar();
      showToast(`Switched SME Profile to ${st.name}!`);
      renderAll();
      triggerLiveAIForChat(st.chats[0]);
    }

    function updateFrameworkText(val) {
      getState().framework = val;
      const st = getState();
      updatePromptPreview(st.chats[currentChatIndex]);
    }

    const presetFrameworks = {
      contractor: `1. Standard installation labor: RM 250/unit (Installer subcon cost: RM 120/unit).\n2. Extra copper piping: RM 150 per 3m set (deducts PIP-COP-3M stock; cost RM 96).\n3. Quotes hold stock for 48h; deduct physical stock only after deposit is confirmed.`,
      software: `1. Base software modules use catalogue price (annual seat license).\n2. Custom features / Change Requests are billed at RM 600 per Developer Man-Day (Internal dev labor cost: RM 250/day).\n3. Quotes hold sprint capacity / licenses for 48h; lock sprint only after 40% deposit.`,
      wholesale: `1. Wholesale items use catalogue carton/bag pricing.\n2. Standard cold-chain delivery labor/van fee: RM 50 per trip (Driver cost: RM 35), FREE for orders > RM 1,500.\n3. Urgent same-day lorry dispatch: +RM 120 charge (Lorry cost: RM 80).`,
      custom_retail: `1. Custom assembly / setup labor: RM 80 flat fee per order (Technician cost: RM 35).\n2. Extra custom parts / upgrades deduct directly from physical SKU stock.\n3. Quotes hold parts for 48h; require 50% deposit before assembly starts.`
    };

    function applyPresetFramework(key) {
      const text = presetFrameworks[key];
      if (!text) return;
      askUserConfirm(
        `Confirm Apply Industry Labor Preset`,
        `Replace your current AI Labor & Pricing Rules with the "${key.toUpperCase()}" preset?\n\n${text}`,
        () => {
          getState().framework = text;
          const fwEl = document.getElementById('owner-framework-input');
          if (fwEl) fwEl.value = text;
          const st = getState();
          updatePromptPreview(st.chats[currentChatIndex]);
          showToast('Applied 1-Click Industry Labor Preset!');
        },
        '✅ Apply Preset'
      );
    }

    function generateCustomFrameworkFromPrompt() {
      const promptInput = document.getElementById('custom-sme-prompt').value.trim();
      if (!promptInput) return;
      const generated = `1. Owner Custom Labor & Pricing Rule: ${promptInput}.\n2. Extra materials/addons mentioned on WhatsApp or phone calls are added to Customer Invoice at selling rate and internal labor/subcon cost is deducted from Cash/Payables.\n3. Quotes place stock/capacity ON HOLD for 48h; deduct only after deposit confirmation.`;
      askUserConfirm(
        `Confirm Generate Custom AI Labor Rules`,
        `Apply these AI-generated Labor & Pricing Rules to your company?\n\n${generated}`,
        () => {
          getState().framework = generated;
          const fwEl = document.getElementById('owner-framework-input');
          if (fwEl) fwEl.value = generated;
          const st = getState();
          updatePromptPreview(st.chats[currentChatIndex]);
          showToast('Generated custom AI Labor Rules from your 1-sentence description!');
        },
        '✨ Confirm & Apply Rules'
      );
    }


// --- CUSTOMER NAME CLEANING ---
    function cleanCustomerName(name) {
      if (!name) return 'Boss';
      const clean = name.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/^[^\w]+|[^\w]+$/g, '').trim();
      return clean || 'Boss';
    }
