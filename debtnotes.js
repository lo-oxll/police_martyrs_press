// ══════════════════════════════════════════════════════════════════
//  المرحلة ٦: سندات الديون + تقاريرها
//  سند الدين اعتراف محاسبي بدين "لنا" (receivable) أو "علينا" (payable)، يُرحَّل
//  قيده فوراً عند الإصدار، ويُقفل بقيد تسوية عند التحصيل/السداد الفعلي.
// ══════════════════════════════════════════════════════════════════

PAGE_RENDER.debtnotes = async (root) => {
  const [receivable, payable] = await Promise.all([DB.listDebtNotes('receivable'), DB.listDebtNotes('payable')]);
  const statusChip = (s) => s === 'open' ? '<span class="chip chip-gold">مفتوح</span>' : s === 'settled' ? '<span class="chip chip-ok">مُسوًّى</span>' : '<span class="chip chip-danger">ملغى</span>';
  const renderTable = (list) => `<div class="itw"><table><thead><tr><th>الرقم</th><th>الإصدار</th><th>الاستحقاق</th><th>الطرف</th><th>المبلغ</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(n => `<tr><td class="doc-num">${n.doc_num}</td><td class="mono">${n.issue_date}</td><td class="mono">${n.due_date||'—'}</td>
      <td>${n.customers?.name || n.counterparty_name || '—'}</td><td class="mono gold-txt">${fmtIQD(n.amount)}</td><td>${statusChip(n.status)}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-o btn-sm" onclick='printDebtNote(${JSON.stringify(n).replace(/'/g,"&#39;")})'>🖨 طباعة</button>
        <button class="btn btn-o btn-sm" onclick='exportDebtNotePDF(${JSON.stringify(n).replace(/'/g,"&#39;")})'>⬇ PDF</button>
        ${n.status==='open' && can('admin','accountant') ? `<button class="btn btn-s btn-sm" onclick="settleDebtNotePrompt('${n.id}','${n.note_type}')">تسوية</button>
        <button class="btn btn-d btn-sm" onclick="cancelDebtNoteConfirm('${n.id}')">إلغاء</button>` : ''}
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="hardDeleteDebtNoteConfirm('${n.id}','${n.doc_num}','${n.journal_entry_id||''}','${n.settlement_journal_entry_id||''}')">🗑 حذف نهائي</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="7" class="ec">لا توجد سندات بعد</td></tr>'}
    </tbody></table></div>`;
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📜 سندات الديون</div><div class="ph-sub">ديون مستحقة لنا أو علينا — كل سند يُرحَّل قيداً محاسبياً فور إصداره</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openDebtNoteModal('receivable')">+ سند دين لنا</button><button class="btn btn-p btn-sm" onclick="openDebtNoteModal('payable')">+ سند دين علينا</button>` : ''}</div></div>
    <div class="card"><div class="card-title">ديون لنا (Receivable)</div>${renderTable(receivable)}</div>
    <div class="card"><div class="card-title">ديون علينا (Payable)</div>${renderTable(payable)}</div>
    <div id="debtnote-print-area"></div>`;
};
async function buildDebtNotePrintArea(n) {
  const html = `<div style="padding:20px 4px;font-size:13px;line-height:2">
      <div>تاريخ الإصدار: <b>${n.issue_date}</b></div>
      <div>تاريخ الاستحقاق: <b>${n.due_date||'—'}</b></div>
      <div>الطرف: <b>${n.customers?.name || n.counterparty_name || '—'}</b></div>
      <div>المبلغ: <b>${fmtIQD(n.amount)}</b></div>
      <div>الحالة: ${n.status==='open'?'مفتوح':n.status==='settled'?'مُسوًّى':'ملغى'}</div>
      ${n.notes ? `<div>ملاحظات: ${n.notes}</div>` : ''}
      <div style="margin-top:40px;display:flex;justify-content:space-between"><span>توقيع الطرف: ____________</span><span>توقيع المُعتمِد: ____________</span></div>
    </div>`;
  await renderPrintArea(`سند دين ${n.note_type==='receivable'?'لنا':'علينا'} — ${n.doc_num}`, html);
}
window.printDebtNote = async (n) => { await buildDebtNotePrintArea(n); window.print(); };
window.exportDebtNotePDF = async (n) => { await buildDebtNotePrintArea(n); exportPrintAreaToPDF(`سند_دين_${n.doc_num}`); };

window.openDebtNoteModal = async (noteType) => {
  const [customers, accounts] = await Promise.all([DB.listCustomers(), DB.chartOfAccounts()]);
  showModal(noteType === 'receivable' ? 'سند دين لنا جديد' : 'سند دين علينا جديد', `
    <div class="fg2">
      <div class="fgroup"><label>رقم السند</label><input id="m-dn-num" value="DN-${Date.now().toString().slice(-8)}"></div>
      <div class="fgroup"><label>المبلغ (د.ع)</label><input id="m-dn-amount" type="number" step="1"></div>
    </div>
    <div class="fg2">
      <div class="fgroup"><label>تاريخ الإصدار</label><input id="m-dn-issue" type="date" value="${todayISO()}"></div>
      <div class="fgroup"><label>تاريخ الاستحقاق</label><input id="m-dn-due" type="date"></div>
    </div>
    <div class="fgroup"><label>الزبون (اختياري)</label><select id="m-dn-customer"><option value="">— بدون —</option>${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
    <div class="fgroup"><label>أو اسم طرف آخر (مورد/جهة) — إن لم يُختر زبون</label><input id="m-dn-party"></div>
    <div class="fg2">
      <div class="fgroup"><label>الحساب المدين</label><select id="m-dn-debit">${accounts.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>الحساب الدائن</label><select id="m-dn-credit">${accounts.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')}</select></div>
    </div>
    <div class="ph-sub" style="margin:-4px 0 8px">${noteType === 'receivable' ? 'مثال: مدين "سندات قبض" (أصل)، دائن حساب الزبون (لتحويل رصيده الجاري إلى سند رسمي)' : 'مثال: مدين حساب المورد (لتخفيض التزامه الجاري)، دائن "سندات دفع" (التزام)'}</div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-dn-notes"></div>
  `, async () => {
    const doc_num = gv('m-dn-num'), amount = Number(gv('m-dn-amount'));
    if (!doc_num || !amount || amount <= 0) { toast('رقم السند والمبلغ مطلوبان', 'e'); return false; }
    const debit_account_id = gv('m-dn-debit'), credit_account_id = gv('m-dn-credit');
    if (debit_account_id === credit_account_id) { toast('الحساب المدين والدائن يجب أن يختلفا', 'e'); return false; }
    try {
      await DB.createDebtNote({
        doc_num, note_type: noteType, issue_date: gv('m-dn-issue'), due_date: gv('m-dn-due') || null, amount,
        customer_id: gv('m-dn-customer') || null, counterparty_name: gv('m-dn-party') || null,
        debit_account_id, credit_account_id, notes: gv('m-dn-notes'),
      });
      toast('تم إصدار السند وترحيل قيده', 's'); go('debtnotes');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};

window.settleDebtNotePrompt = async (id, noteType) => {
  const accounts = await DB.chartOfAccounts();
  showModal(noteType === 'receivable' ? 'تحصيل سند الدين' : 'سداد سند الدين', `
    <div class="fgroup"><label>${noteType === 'receivable' ? 'حساب التحصيل (نقدية/بنك)' : 'حساب السداد (نقدية/بنك)'}</label>
      <select id="m-dns-acc">${accounts.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')}</select></div>
    <div class="fgroup"><label>تاريخ التسوية</label><input id="m-dns-date" type="date" value="${todayISO()}"></div>
  `, async () => {
    try {
      await DB.settleDebtNote(id, gv('m-dns-acc'), gv('m-dns-date'));
      toast('تمت التسوية وترحيل قيدها', 's'); go('debtnotes');
    } catch (e) { toast('تعذر: ' + e.message, 'e'); return false; }
  });
};
window.cancelDebtNoteConfirm = async (id) => {
  if (!confirm('إلغاء هذا السند؟ سيُرحَّل قيد عكسي لإصداره الأصلي.')) return;
  try { await DB.cancelDebtNote(id); toast('تم الإلغاء', 's'); go('debtnotes'); }
  catch (e) { toast('تعذر الإلغاء: ' + e.message, 'e'); }
};
window.hardDeleteDebtNoteConfirm = async (id, docNum, journalEntryId, settlementJournalEntryId) => {
  if (!confirm(`حذف نهائي لسند "${docNum}" وكل قيوده المحاسبية المرتبطة (إصدار وتسوية إن وُجدت). هذا إجراء لا يمكن التراجع عنه. متابعة؟`)) return;
  try {
    await DB.hardDeleteDebtNote(id, docNum, journalEntryId || null, settlementJournalEntryId || null);
    toast('تم الحذف النهائي', 's'); go('debtnotes');
  } catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── تقارير سندات الديون ─────────────────────────────
PAGE_RENDER.debtnotereports = async (root) => {
  const { notes, totalReceivable, totalPayable } = await DB.debtNoteReport();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📊 تقارير سندات الديون</div><div class="ph-sub">السندات المفتوحة حالياً، مع أيام التأخر عن الاستحقاق</div></div></div>
    <div class="stats">
      <div class="stat"><div class="stat-lbl">إجمالي الديون لنا</div><div class="stat-val" style="color:var(--ok)">${fmtIQD(totalReceivable)}</div></div>
      <div class="stat"><div class="stat-lbl">إجمالي الديون علينا</div><div class="stat-val danger">${fmtIQD(totalPayable)}</div></div>
    </div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرقم</th><th>النوع</th><th>الطرف</th><th>الاستحقاق</th><th>المبلغ</th><th>التأخر</th></tr></thead>
    <tbody>${notes.map(n => `<tr><td class="doc-num">${n.doc_num}</td><td>${n.note_type==='receivable'?'لنا':'علينا'}</td>
      <td>${n.customers?.name || n.counterparty_name || '—'}</td><td class="mono">${n.due_date||'—'}</td><td class="mono gold-txt">${fmtIQD(n.amount)}</td>
      <td>${n.overdueDays > 0 ? `<span class="chip chip-danger">متأخر ${n.overdueDays} يوم</span>` : '<span class="chip chip-ok">ضمن الأجل</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد سندات مفتوحة</td></tr>'}
    </tbody></table></div>
    <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(notes.map(n=>({'الرقم':n.doc_num,'النوع':n.note_type==='receivable'?'لنا':'علينا','الطرف':n.customers?.name||n.counterparty_name||'','الاستحقاق':n.due_date||'','المبلغ':n.amount,'التأخر':n.overdueDays})))}, "تقارير سندات الديون", "سندات_الديون.xlsx")'>تصدير إكسل</button></div></div>`;
};
