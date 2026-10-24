// =========================================================================
// WON-ORDERS CSV AND QUOTE / SALES ORDER PDF
// Both files are made by the backend from its deals; the page only previews and downloads them.
// =========================================================================

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Owner only: GET /api/export/orders.csv (won orders, one line item per row).
async function downloadWonOrdersCsv() {
  try {
    const res = await fetch(`${BACKEND_API_BASE}/api/export/orders.csv?role=${encodeURIComponent(currentRole)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(res.status === 403 ? `🔒 ${data.detail}` : `⚠️ ${data.detail || `Backend error (HTTP ${res.status})`}`);
      return;
    }
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'Sales_Orders.csv';
    downloadBlob(await res.blob(), name);
    showToast(`📥 Downloaded ${name}`);
  } catch (err) {
    showToast('⚠️ Backend offline — start it with python run_server.py');
  }
}

let currentPdfDocId = null;  // the deal shown in the PDF preview

// GET /api/deals/{id}/pdf; null (with a toast) when the backend can't make it.
async function dealPdfBlob(dealId) {
  try {
    const res = await fetch(`${BACKEND_API_BASE}/api/deals/${encodeURIComponent(dealId)}/pdf`);
    if (res.ok) return await res.blob();
    const data = await res.json().catch(() => ({}));
    showToast(`⚠️ ${data.detail || `Could not make the PDF (HTTP ${res.status})`}`);
  } catch (err) {
    showToast('⚠️ Backend offline — start it with python run_server.py');
  }
  return null;
}

// Fills the preview with one deal: the same numbers the backend PDF prints.
function openPdfForDeal(dealId) {
  const st = getState();
  const deal = st.deals.find(d => d.id === dealId);
  if (!deal) {
    showToast('⚠️ That quote is not loaded. Refresh the page and try again.');
    return;
  }
  const won = deal.stage === 'WON';
  const total = 'RM ' + Number(deal.amount || 0).toLocaleString();
  const tin = (st.customers.find(c => c.name === deal.customer) || {}).tin;
  currentPdfDocId = deal.id;
  document.getElementById('pdf-company-name').textContent = st.name;
  document.getElementById('pdf-doc-id').textContent = '#' + (won && deal.orderNo ? deal.orderNo : deal.id);
  document.getElementById('pdf-doc-type').textContent = won ? 'SALES ORDER' : 'QUOTATION';
  document.getElementById('pdf-lhdn-tag').textContent = tin ? `🟢 LHDN TIN ${tin}` : '⚪ No LHDN TIN yet';
  document.getElementById('pdf-party-name').textContent = deal.customer;
  document.getElementById('pdf-party-sub').textContent = deal.phone || '';
  document.getElementById('pdf-stock-status').textContent = 'Subject to stock availability · prices valid 7 days';
  document.getElementById('pdf-items-desc').textContent = (deal.items || [])
    .map(i => `${i.qty}x ${i.name} @ RM ${Number(i.unitPrice).toLocaleString()}`).join('\n')
    + (deal.discount ? `\nDiscount: -RM ${Number(deal.discount).toLocaleString()}` : '');
  document.getElementById('pdf-amount-cell').textContent = total;
  document.getElementById('pdf-total-big').textContent = total;
  document.getElementById('pdf-modal').classList.remove('hidden');
}

// Kept for older buttons that still call it by this name.
function openPdfForInvoice(dealId) {
  openPdfForDeal(dealId);
}

function openPdfFromChat() {
  const chat = getState().chats[currentChatIndex];
  if (!chat || !chat.dealId) {
    showToast('⚠️ No quote for this chat yet: send the quote first.');
    return;
  }
  openPdfForDeal(chat.dealId);
}

function closePdfModal() {
  document.getElementById('pdf-modal').classList.add('hidden');
}

function downloadInvoicePdf() {
  if (!currentPdfDocId) return;
  const fileName = `${currentPdfDocId}.pdf`;
  askUserConfirm(
    `Download ${fileName}`,
    `Download the PDF for #${currentPdfDocId}?`,
    async () => {
      const blob = await dealPdfBlob(currentPdfDocId);
      if (!blob) return;
      downloadBlob(blob, fileName);
      showToast(`📥 Downloaded ${fileName}`);
    },
    '📥 Download PDF (.pdf)'
  );
}

// Demo WhatsApp page: puts the real PDF into the chat; the bubble opens it.
function attachPdfToWhatsApp() {
  const chat = getState().chats[currentChatIndex];
  if (!chat || !currentPdfDocId) return;
  askUserConfirm(
    `Confirm Send PDF into WhatsApp`,
    `Attach and send ${currentPdfDocId}.pdf to ${chat.customer} on WhatsApp?`,
    async () => {
      const blob = await dealPdfBlob(currentPdfDocId);
      if (!blob) return;
      chat.messages.push({
        from: 'staff',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: chat.extDraft || `Hi ${chat.customer}! Attached is quotation #${currentPdfDocId}. Prices are valid for 7 days.`,
        attachment: {
          name: `${currentPdfDocId}.pdf`,
          size: `${Math.max(1, Math.round(blob.size / 1024))} KB`,
          type: 'pdf',
          url: URL.createObjectURL(blob)
        }
      });
      closePdfModal();
      switchPage('wa');
      if (typeof renderWhatsAppView === 'function') renderWhatsAppView();
      showToast(`Sent ${currentPdfDocId}.pdf into the WhatsApp chat!`);
    },
    '📎 Send PDF Now'
  );
}
