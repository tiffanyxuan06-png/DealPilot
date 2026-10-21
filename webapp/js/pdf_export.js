async function triggerRealXlsxOrCsvDownload(targetFileName = 'CashChase_Bookkeeper_Ledger.xlsx') {
      try {
        const res = await fetch(`${BACKEND_API_BASE}/api/export/xlsx?role=${encodeURIComponent(currentRole)}`);
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          showToast(`🔒 ${data.detail || 'Staff are not allowed to export Excel.'}`);
          return;
        }
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = targetFileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast(`📥 Downloaded real 4-sheet Excel workbook: ${targetFileName}!`);
          return;
        }
      } catch (err) {
        // Fallback to client-side Excel-compatible UTF-8 BOM CSV if backend is offline
      }

      const st = getState();
      const stockVal = st.stock.reduce((sum, s) => sum + (s.onHand * s.unitCost), 0);
      const rows = [
        ['CASHCHASE BY ORBYTE — BOOKKEEPER & LHDN MASTER EXPORT', '', '', '', '', '', ''],
        ['Company Name', st.name, 'Verified Cash on Hand (RM)', st.cashOnHand, 'Physical Stock Value (RM)', stockVal, 'Core Net Worth (RM): ' + (st.cashOnHand + stockVal)],
        [],
        ['SECTION 1: INVOICES, 48H QUOTE HOLDS & SUPPLIER BILLS'],
        ['Doc ID', 'Record Type', 'Customer / Supplier', 'Phone', 'Scope & Items', 'Amount (RM)', 'Status', 'LHDN e-Invoice Status'],
        ...st.invoices.map(i => [i.id, i.type, i.party, i.phone || '-', i.itemsText, i.amount, i.status, i.lhdn]),
        [],
        ['SECTION 2: PHYSICAL WAREHOUSE STOCK & 48H HOLDS'],
        ['SKU', 'Product Name', 'Physical On Hand', 'Locked on 48h Hold', 'Available to Sell', 'Unit Cost (RM)', 'Selling Price (RM)', 'Total Stock Cost (RM)'],
        ...st.stock.map(s => [s.sku, s.name, s.onHand, s.onHold, Math.max(0, s.onHand - s.onHold), s.unitCost, s.sellPrice, s.onHand * s.unitCost]),
        [],
        ['SECTION 3: AUDIT TRAIL LOGS'],
        ['Timestamp & Action Details'],
        ...st.logs.map(l => [l])
      ];
      const csvContent = '\uFEFF' + rows.map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const csvName = targetFileName.replace(/\.xlsx$/i, '.csv');
      const a = document.createElement('a');
      a.href = url;
      a.download = csvName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`📥 Downloaded ${csvName} (Start backend for multi-sheet .xlsx)!`);
    }

    function exportExcelDemo() {
      askUserConfirm(
        `Export Bookkeeper Ledger (.xlsx)`,
        `Download full Cash, Stock, Quote Holds, Client Memory & LHDN e-Invoice ledger as CashChase_Bookkeeper_Ledger.xlsx?`,
        () => {
          triggerRealXlsxOrCsvDownload('CashChase_Bookkeeper_Ledger.xlsx');
        },
        '📥 Download Excel (.xlsx)'
      );
    }

    // =========================================================================
    // PDF MODAL & REAL %PDF-1.4 BINARY GENERATOR + DOWNLOAD
    // =========================================================================
    let currentPdfDocId = '#QT-104';

    function buildClientSidePdfBlob(lines) {
      const esc = (s) => String(s || '')
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
      let y = 790;
      const ops = ['BT', '/F1 11 Tf'];
      lines.forEach((rawLine, idx) => {
        const fontSize = idx === 0 ? 15 : idx === 1 ? 12 : 10;
        ops.push(`/F1 ${fontSize} Tf`);
        ops.push(`1 0 0 1 45 ${y} Tm (${esc(rawLine)}) Tj`);
        y -= (idx <= 1 ? 22 : 15);
      });
      ops.push('ET');
      const streamData = ops.join('\n');

      const objs = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
        '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
        `5 0 obj\n<< /Length ${streamData.length} >>\nstream\n${streamData}\nendstream\nendobj\n`
      ];

      let pdf = '%PDF-1.4\n';
      const offsets = [0];
      objs.forEach(o => {
        offsets.push(pdf.length);
        pdf += o;
      });
      const xrefStart = pdf.length;
      pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i < offsets.length; i++) {
        pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      }
      pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
      return new Blob([pdf], { type: 'application/pdf' });
    }

    function downloadInvoicePdf() {
      const cleanId = String(currentPdfDocId || 'QT-104').replace(/^#/, '');
      const partyName = document.getElementById('pdf-party-name')?.textContent || 'Customer';
      const totalStr = document.getElementById('pdf-total-big')?.textContent || 'RM 6,650';
      const docType = document.getElementById('pdf-doc-type')?.textContent || 'OFFICIAL DOCUMENT';
      const itemsDesc = document.getElementById('pdf-items-desc')?.textContent || '';
      const lhdnTag = document.getElementById('pdf-lhdn-tag')?.textContent || 'LHDN Ready';
      const stockStatus = document.getElementById('pdf-stock-status')?.textContent || '';
      const companyName = document.getElementById('pdf-company-name')?.textContent || getState().name;

      askUserConfirm(
        `Download Official PDF (${cleanId}.pdf)`,
        `Generate and download real PDF document "${cleanId}_Official_Document.pdf" for ${partyName} (${totalStr})?`,
        async () => {
          const pdfFileName = `${cleanId}_Official_Document.pdf`;
          try {
            const res = await fetch(`${BACKEND_API_BASE}/api/invoices/${encodeURIComponent(cleanId)}/pdf`);
            if (res.ok) {
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = pdfFileName;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              showToast(`📥 Downloaded official searchable PDF: ${pdfFileName}!`);
              return;
            }
          } catch (err) {
            // Fallback to client-side %PDF-1.4 generator if backend is offline
          }

          const lines = [
            companyName,
            `${docType} — #${cleanId}`,
            '--------------------------------------------------------------------------',
            `Document ID      : ${cleanId}`,
            `Counterparty     : ${partyName}`,
            `Stock Status     : ${stockStatus}`,
            `LHDN MyInvois    : ${lhdnTag}`,
            '--------------------------------------------------------------------------',
            'ITEMS & LABOR BREAKDOWN:',
            ...itemsDesc.split('\n').map(l => '  ' + l),
            '--------------------------------------------------------------------------',
            `TOTAL AMOUNT     : ${totalStr}`,
            '--------------------------------------------------------------------------',
            'Generated by CashChase Smart SME Copilot (Searchable PDF-1.4 Text Stream)'
          ];
          const blob = buildClientSidePdfBlob(lines);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = pdfFileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast(`📥 Downloaded ${pdfFileName}!`);
        },
        '📥 Download PDF (.pdf)'
      );
    }

    function openPdfForInvoice(id) {
      const st = getState();
      const inv = st.invoices.find(i => i.id === id) || st.invoices[0];
      if (!inv) return;
      currentPdfDocId = inv.id;
      document.getElementById('pdf-company-name').textContent = st.name;
      document.getElementById('pdf-doc-id').textContent = '#' + inv.id;
      document.getElementById('pdf-doc-type').textContent = inv.type === 'QUOTE_HOLD'
        ? 'OFFICIAL QUOTATION (48H STOCK HOLD)'
        : 'OFFICIAL TAX INVOICE';
      document.getElementById('pdf-lhdn-tag').textContent = inv.lhdn;
      document.getElementById('pdf-party-name').textContent = inv.party;
      document.getElementById('pdf-party-sub').textContent = 'Status: ' + inv.status;
      document.getElementById('pdf-stock-status').textContent = inv.type === 'QUOTE_HOLD'
        ? '⏳ Stock Held for 48 Hours'
        : '✅ Confirmed Record';
      document.getElementById('pdf-items-desc').textContent = inv.itemsText;
      document.getElementById('pdf-amount-cell').textContent = 'RM ' + inv.amount.toLocaleString();
      document.getElementById('pdf-total-big').textContent = 'RM ' + inv.amount.toLocaleString();
      document.getElementById('pdf-modal').classList.remove('hidden');
    }

    function openPdfFromChat() {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      currentPdfDocId = chat.extActionType === 'CREATE_QUOTE_HOLD' ? 'QT-104' : 'INV-204';
      document.getElementById('pdf-company-name').textContent = st.name;
      document.getElementById('pdf-doc-id').textContent = '#' + currentPdfDocId;
      document.getElementById('pdf-doc-type').textContent = chat.extActionType === 'CREATE_QUOTE_HOLD'
        ? 'OFFICIAL QUOTATION (48H STOCK HOLD)'
        : 'OFFICIAL TAX INVOICE';
      document.getElementById('pdf-lhdn-tag').textContent = '🟢 LHDN e-Invoice Ready';
      document.getElementById('pdf-party-name').textContent = chat.customer;
      document.getElementById('pdf-party-sub').textContent = chat.phone;
      document.getElementById('pdf-stock-status').textContent = chat.extActionType === 'CREATE_QUOTE_HOLD'
        ? '⏳ Stock Placed ON HOLD for 48 Hours'
        : '✅ Physical Stock Deducted';
      document.getElementById('pdf-items-desc').textContent = chat.extCheck;
      document.getElementById('pdf-amount-cell').textContent = chat.extActionType === 'CREATE_QUOTE_HOLD' ? 'RM 6,650' : 'RM 4,650';
      document.getElementById('pdf-total-big').textContent = chat.extActionType === 'CREATE_QUOTE_HOLD' ? 'RM 6,650' : 'RM 4,650';
      document.getElementById('pdf-modal').classList.remove('hidden');
    }

    function closePdfModal() {
      document.getElementById('pdf-modal').classList.add('hidden');
    }

    function attachPdfToWhatsApp() {
      const st = getState();
      const chat = st.chats[currentChatIndex];
      askUserConfirm(
        `Confirm Send PDF into WhatsApp`,
        `Attach and send ${currentPdfDocId}.pdf to ${chat.customer} on WhatsApp?`,
        () => {
          chat.messages.push({
            from: 'staff',
            time: '10:55 AM',
            text: `📎 [Attached PDF: ${currentPdfDocId}.pdf] — ${chat.extDraft}`
          });
          closePdfModal();
          switchPage('wa');
          showToast(`Sent ${currentPdfDocId}.pdf directly into the WhatsApp chat!`);
        },
        '📎 Send PDF Now'
      );
    }

    // =========================================================================
    // SAMPLE PDF RECEIPT TEMPLATES DOWNLOADER & CUSTOMER ACTION SIMULATOR
    // =========================================================================
    function downloadSamplePdfTemplate(type) {
      let fileName = 'Sample_DuitNow_Receipt_DN99102.pdf';
      let lines = [];

      if (type === 'DUITNOW') {
        fileName = 'Sample_DuitNow_Receipt_DN99102.pdf';
        lines = [
          'DUITNOW INSTANT TRANSFER RECEIPT (PAYNET MALAYSIA)',
          'STATUS: SUCCESSFUL TRANSACTION (COMPLETED)',
          '--------------------------------------------------------------------------',
          'Reference ID     : DN-20261117-99102',
          'Payment Date     : 17 Nov 2026, 10:42 AM',
          'Recipient Name   : Sejuk Jaya Aircond Sdn Bhd',
          'Recipient TIN    : C2088391020',
          'Recipient Bank   : Maybank Berhad (5140-1234-9988)',
          'Sender / Buyer   : Tan Bros Trading (Klang)',
          'Transfer Type    : DuitNow 2.0 Real-Time Instant Bank Transfer',
          '--------------------------------------------------------------------------',
          'PAYMENT BREAKDOWN:',
          '  40% Confirmation Deposit for Quote #QT-104',
          '  Scope: 5x Daikin 1.5HP Inverter + 5x R32 Refrigerant Gas',
          '--------------------------------------------------------------------------',
          'AMOUNT TRANSFERRED: RM 2,000.00',
          '--------------------------------------------------------------------------',
          'Direct PDF Text Searchable Stream (Decodable via pypdf / Zero Vision OCR)'
        ];
      } else if (type === 'SUPPLIER') {
        fileName = 'Sample_Supplier_Bill_SUP902.pdf';
        lines = [
          'PENGHAWA DINGIN SUPPLIES (M) SDN BHD',
          'OFFICIAL SUPPLIER TAX INVOICE & DELIVERY ORDER',
          '--------------------------------------------------------------------------',
          'Invoice / Bill # : SUP-902',
          'Delivery Date    : 17 Nov 2026, 09:15 AM',
          'Supplier TIN     : C1102938810',
          'Billed To        : Sejuk Jaya Aircond Sdn Bhd',
          'Delivery Lorry   : WTR 8812 (Driver: Muthu)',
          '--------------------------------------------------------------------------',
          'ITEMS DELIVERED:',
          '  Item 1: 20x GAS-R32 Refrigerant Gas (3kg cylinder)',
          '          Unit Cost: RM 130.00 | Total: RM 2,600.00',
          '--------------------------------------------------------------------------',
          'TOTAL BILL AMOUNT: RM 2,600.00',
          '--------------------------------------------------------------------------',
          'LHDN MyInvois e-Invoice UUID: 39a4891b-8012-4211-9f90-88bca902881a'
        ];
      } else {
        fileName = 'Sample_Official_Quotation_QT104.pdf';
        lines = [
          'SEJUK JAYA AIRCOND SDN BHD',
          'OFFICIAL QUOTATION & 48-HOUR STOCK HOLD NOTICE',
          '--------------------------------------------------------------------------',
          'Quotation No     : QT-104',
          'Date Issued      : 17 Nov 2026, 10:38 AM',
          'Customer         : Tan Bros Trading (+60 12-345 6789)',
          'Stock Hold Status: 5x Daikin 1.5HP + 5x R32 Gas HELD for 48 Hours',
          'LHDN Buyer TIN   : C2088391020',
          '--------------------------------------------------------------------------',
          'SCOPE & ITEMS BREAKDOWN:',
          '  5x Daikin 1.5HP Inverter Unit  : RM 5,750.00 (RM 1,150/unit)',
          '  5x R32 Refrigerant Gas (3kg)   : RM 900.00   (RM 180/bottle)',
          '  Standard Installation Labor    : RM 1,250.00 (RM 250/unit)',
          '--------------------------------------------------------------------------',
          'QUOTE TOTAL      : RM 7,900.00',
          'REQUIRED DEPOSIT : RM 3,160.00 (40% to confirm dispatch)',
          '--------------------------------------------------------------------------',
          'Valid for 48 Hours. Stock released if deposit is not received.'
        ];
      }

      askUserConfirm(
        `Download Sample PDF Template`,
        `Download "${fileName}" to test PDF receipt OCR and text decoding?`,
        () => {
          const blob = buildClientSidePdfBlob(lines);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast(`📥 Downloaded ${fileName}! You can open it or upload to test Stage 1 PDF OCR.`);
        },
        '📥 Download PDF'
      );
    }
