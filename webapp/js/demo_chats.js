// WhatsApp demo chats and the "customer sends…" buttons for the demo WhatsApp page.
// Phase 3 moves these into backend/schema/seeds and serves them from the API (docs/19, option B).
// Until then they are the only demo data in the webapp; test_webapp_no_seed_data.py skips this file.
const DEMO_CHATS = {
  aircond: [
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
            extBtnLabel: 'Insert reply',  // the AI sets the real action once it has read a customer message
            extActionType: 'REPLY_ONLY',
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
  fnb: [
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
  ]
};

const DEMO_SIM_BAR_HTML = {
  aircond: `
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
        `,
  fnb: `
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
        `
};

// A fresh copy, so the page can add messages without changing the template.
function demoChatsFor(preset) {
  return JSON.parse(JSON.stringify(DEMO_CHATS[preset] || []));
}

// The "customer sends…" buttons on the demo WhatsApp page (scripted customer messages).
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
