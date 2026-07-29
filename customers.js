// ══════════════════════════════════════════════════════════════════
//  المرحلة ١: بطاقة الزبون + إيصالات/أوامر القبض والدفع + كشف الحساب
//  تُبنى فوق آلية "صندوق المركز" (cash_transactions) وقيود القاعدة الحسابية
//  المزدوجة الموجودة أصلاً بالنظام — بلا تكرار للمنطق المحاسبي.
// ══════════════════════════════════════════════════════════════════

// ── بطاقة الزبون ─────────────────────────────
PAGE_RENDER.customers = async (root) => {
  const list = await DB.listCustomers();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📇 بطاقة الزبون</div><div class="ph-sub">دليل الزبائن — كل زبون مرتبط تلقائياً بحساب خاص به بدليل الحسابات</div></div>
      <div class="ph-actions">
        <button class="btn btn-o btn-sm" onclick="exportRowsToExcel(${JSON.stringify(list.map(c => ({ 'الرمز': c.code, 'الاسم': c.name, 'الهاتف': c.phone||'', 'العنوان': c.address||'', 'رمز الحساب': c.chart_of_accounts?.code||'' })))}, 'الزبائن', 'الزبائن.xlsx')">تصدير إكسل</button>
        ${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openCustomerModal()">+ زبون جديد</button>` : ''}
      </div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th>حساب الأستاذ</th><th></th></tr></thead>
    <tbody>${list.map(c => `<tr>
      <td class="mono">${c.code}</td><td>${c.name}</td><td class="mono">${c.phone||'—'}</td><td>${c.address||'—'}</td>
      <td><span class="doc-num">${c.chart_of_accounts?.code||''}</span></td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-o btn-sm" onclick="go('accountstatement');setTimeout(()=>prefillStatementCustomer('${c.id}'),50)">كشف الحساب</button>
        ${can('admin','accountant') ? `<button class="btn btn-o btn-sm" onclick='openCustomerModal(${JSON.stringify(c)})'>تعديل</button>` : ''}
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deactivateCustomerConfirm('${c.id}')">إلغاء تفعيل</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا يوجد زبائن بعد</td></tr>'}
    </tbody></table></div></div>`;
};

window.openCustomerModal = (c = null) => {
  showModal(c ? 'تعديل بطاقة زبون' : 'زبون جديد', `
    <div class="fgroup"><label>الرمز</label><input id="m-cu-code" value="${c?.code||''}" ${c ? 'disabled' : ''}></div>
    <div class="fgroup"><label>الاسم</label><input id="m-cu-name" value="${c?.name||''}"></div>
    <div class="fgroup"><label>الهاتف</label><input id="m-cu-phone" value="${c?.phone||''}"></div>
    <div class="fgroup"><label>العنوان</label><input id="m-cu-addr" value="${c?.address||''}"></div>
  `, async () => {
    const code = gv('m-cu-code'), name = gv('m-cu-name'), phone = gv('m-cu-phone'), addr = gv('m-cu-addr');
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    try {
      if (c) await DB.updateCustomer(c.id, { name, phone, address: addr }, c.account_id);
      else await DB.createCustomer({ code, name, phone, address: addr });
      toast('تم الحفظ', 's');
      go('customers');
    } catch (e) { toast('تعذر الحفظ: ' + (friendlyDbError ? (friendlyDbError(e).message||e.message) : e.message), 'e'); return false; }
  });
};
window.deactivateCustomerConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا الزبون؟ يبقى تاريخه بالفواتير والإيصالات محفوظاً، فقط لن يظهر بالقوائم الجديدة.')) return;
  try { await DB.deactivateCustomer(id); toast('تم', 's'); go('customers'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── قالب مشترك لصفحات القبض/الصرف (إيصال قبض / أمر قبض / أمر صرف) ─────────────────────────────
async function renderCashDocPage(root, { pageTitle, subtitle, type, docKind, partyLabel, allowAccount }) {
  const [docs, customers] = await Promise.all([DB.listCashDocs(type, docKind, 100), DB.listCustomers()]);
  const custMap = {}; customers.forEach(c => { custMap[c.account_id] = c; });
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">${pageTitle}</div><div class="ph-sub">${subtitle}</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" id="btn-new-cashdoc">+ جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>التاريخ</th><th>${partyLabel}</th><th>المبلغ</th><th>البيان</th><th></th></tr></thead>
    <tbody>${docs.map(d => `<tr>
      <td class="mono">${d.trans_date}</td>
      <td>${custMap[d.counterparty_account_id] ? custMap[d.counterparty_account_id].name : (d.chart_of_accounts ? d.chart_of_accounts.code+' — '+d.chart_of_accounts.name : '—')}</td>
      <td class="mono gold-txt">${fmtIQD(d.amount)}</td><td>${d.description||'—'}</td>
      <td>${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteCashDocConfirm('${d.id}','${d.journal_entry_id||''}','${(d.description||'').replace(/'/g,"")}')">حذف</button>` : ''}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="ec">لا توجد سجلات بعد</td></tr>`}
    </tbody></table></div></div>`;

  document.getElementById('btn-new-cashdoc')?.addEventListener('click', () => openCashDocModal({ type, docKind, partyLabel, allowAccount, customers, onSaved: () => go(window.__currentPageId) }));
}

window.openCashDocModal = async ({ type, docKind, partyLabel, allowAccount, customers, onSaved }) => {
  const accounts = allowAccount ? await DB.chartOfAccounts() : [];
  showModal(`${partyLabel} جديد`, `
    <div class="fgroup"><label>التاريخ</label><input id="m-cd-date" type="date" value="${todayISO()}"></div>
    ${allowAccount ? `
    <div class="fgroup"><label>نوع الطرف الآخر</label>
      <select id="m-cd-partytype" onchange="document.querySelectorAll('.m-cd-party').forEach(x=>x.classList.add('hidden'));document.getElementById('m-cd-party-'+this.value).classList.remove('hidden')">
        <option value="customer">زبون</option><option value="account">حساب مباشر (مورد/مصروف/آخر)</option>
      </select></div>
    <div class="fgroup m-cd-party" id="m-cd-party-customer"><label>الزبون</label>
      <select id="m-cd-customer">${customers.map(c => `<option value="${c.account_id}">${c.name}</option>`).join('')}</select></div>
    <div class="fgroup m-cd-party hidden" id="m-cd-party-account"><label>الحساب</label>
      <select id="m-cd-account">${accounts.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')}</select></div>
    <div class="ph-sub" style="margin:-6px 0 8px">ملاحظة: الموردون ليسوا مرتبطين بدليل الحسابات بعد بهذه المرحلة — لصرف مبلغ لمورد اختر "حساب مباشر" وحدد حسابه من دليل الحسابات إن وُجد.</div>
    ` : `
    <div class="fgroup"><label>الزبون</label>
      <select id="m-cd-customer">${customers.map(c => `<option value="${c.account_id}">${c.name}</option>`).join('')}</select></div>
    `}
    <div class="fgroup"><label>المبلغ (د.ع)</label><input id="m-cd-amount" type="number" step="1"></div>
    <div class="fgroup"><label>البيان</label><input id="m-cd-desc"></div>
  `, async () => {
    const date = gv('m-cd-date'), amount = Number(gv('m-cd-amount')), desc = gv('m-cd-desc');
    if (!amount || amount <= 0) { toast('أدخل مبلغاً صحيحاً', 'e'); return false; }
    let counterparty_account_id;
    if (allowAccount) {
      const pt = document.getElementById('m-cd-partytype').value;
      counterparty_account_id = pt === 'customer' ? gv('m-cd-customer') : gv('m-cd-account');
      if (!counterparty_account_id) { toast('اختر الطرف الآخر', 'e'); return false; }
    } else {
      counterparty_account_id = gv('m-cd-customer');
      if (!counterparty_account_id) { toast('لا يوجد زبائن بعد — أضف زبوناً أولاً من "فتح بطاقات ← بطاقة زبون"', 'e'); return false; }
    }
    try {
      await DB.createCashTransaction({ trans_date: date, type, amount, description: desc, counterparty_account_id, doc_kind: docKind });
      toast('تم الحفظ وترحيل القيد المحاسبي تلقائياً', 's');
      onSaved && onSaved();
    } catch (e) { toast('تعذر الحفظ: ' + (friendlyStockError ? friendlyStockError(e.message) : e.message), 'e'); return false; }
  });
};
window.deleteCashDocConfirm = async (id, journalEntryId, desc) => {
  if (!confirm(`حذف نهائي لهذا المستند "${desc}" مع قيده المحاسبي المرتبط. متابعة؟`)) return;
  try { await DB.deleteCashTransaction(id, journalEntryId || null, desc); toast('تم الحذف', 's'); go(window.__currentPageId); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

PAGE_RENDER.receiptsvouchers = async (root) => {
  window.__currentPageId = 'receiptsvouchers';
  await renderCashDocPage(root, { pageTitle: '🧾 إيصالات القبض', subtitle: 'مبالغ مُستلَمة فعلياً من الزبائن — تُرحَّل قيداً محاسبياً فوراً', type: 'in', docKind: 'voucher', partyLabel: 'الزبون', allowAccount: false });
};
PAGE_RENDER.receiptorders = async (root) => {
  window.__currentPageId = 'receiptorders';
  await renderCashDocPage(root, { pageTitle: '📥 أوامر القبض', subtitle: 'تعليمة/توثيق لقبض مبلغ من زبون — تُرحَّل قيداً محاسبياً فوراً بهذه المرحلة', type: 'in', docKind: 'order', partyLabel: 'الزبون', allowAccount: false });
};
PAGE_RENDER.paymentreceiptorders = async (root) => {
  window.__currentPageId = 'paymentreceiptorders';
  await renderCashDocPage(root, { pageTitle: '📤 أوامر الصرف', subtitle: 'صرف مبلغ لزبون أو أي حساب آخر — تُرحَّل قيداً محاسبياً فوراً', type: 'out', docKind: 'order', partyLabel: 'الجهة', allowAccount: true });
};

// ── كشف الحساب ─────────────────────────────
PAGE_RENDER.accountstatement = async (root) => {
  const [customers, accounts] = await Promise.all([DB.listCustomers(), DB.chartOfAccounts()]);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📄 كشف الحساب</div><div class="ph-sub">دفتر أستاذ لأي حساب أو زبون بفترة محدّدة، مع رصيد افتتاحي ومتحرك</div></div></div>
    <div class="card">
      <div class="fg">
        <div class="fgroup"><label>نوع الحساب</label>
          <select id="st-type" onchange="document.getElementById('st-cust-wrap').classList.toggle('hidden',this.value!=='customer');document.getElementById('st-acc-wrap').classList.toggle('hidden',this.value!=='account')">
            <option value="customer">زبون</option><option value="account">حساب من دليل الحسابات</option>
          </select></div>
        <div class="fgroup" id="st-cust-wrap"><label>الزبون</label>
          <select id="st-customer">${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
        <div class="fgroup hidden" id="st-acc-wrap"><label>الحساب</label>
          <select id="st-account">${accounts.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('')}</select></div>
      </div>
      <div class="fg" style="margin-top:12px">
        <div class="fgroup"><label>من تاريخ</label><input id="st-from" type="date" value="${todayISO().slice(0,8)}01"></div>
        <div class="fgroup"><label>إلى تاريخ</label><input id="st-to" type="date" value="${todayISO()}"></div>
        <div class="fgroup" style="justify-content:flex-end;display:flex;align-items:flex-end"><button class="btn btn-p" onclick="runAccountStatement()">عرض الكشف</button></div>
      </div>
    </div>
    <div id="st-result"></div>`;
};
window.prefillStatementCustomer = (customerId) => {
  const sel = document.getElementById('st-customer');
  if (sel) { sel.value = customerId; runAccountStatement(); }
};
window.runAccountStatement = async () => {
  const type = document.getElementById('st-type').value;
  const from = gv('st-from'), to = gv('st-to');
  const box = document.getElementById('st-result');
  box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    let st, title;
    if (type === 'customer') {
      const custId = gv('st-customer');
      if (!custId) { box.innerHTML = '<div class="card"><div class="ec">لا يوجد زبائن بعد</div></div>'; return; }
      st = await DB.customerStatement(custId, from, to);
      title = st.customer.name;
    } else {
      const accId = gv('st-account');
      st = await DB.accountStatement(accId, from, to);
      const acc = (await DB.chartOfAccounts()).find(a => a.id === accId);
      title = acc ? `${acc.code} — ${acc.name}` : '';
    }
    box.innerHTML = `<div class="card">
      <div class="card-title">${title} — من ${from} إلى ${to}</div>
      <div class="grand-bar" style="margin-bottom:10px"><span class="grand-lbl">الرصيد الافتتاحي</span><span class="grand-val" style="color:var(--ink)">${fmtIQD(st.opening)}</span></div>
      <div class="itw"><table><thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
      <tbody>${st.rows.map(r => `<tr><td class="mono">${r.date}</td><td class="doc-num">${r.entry_no||''}</td><td>${r.description||''}</td>
        <td class="mono">${r.debit ? fmt(r.debit) : '—'}</td><td class="mono">${r.credit ? fmt(r.credit) : '—'}</td>
        <td class="mono gold-txt">${fmtIQD(r.balance)}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد حركات بهذه الفترة</td></tr>'}
      </tbody></table></div>
      <div class="grand-bar"><span class="grand-lbl">الرصيد الختامي</span><span class="grand-val">${fmtIQD(st.closing)}</span></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick="exportRowsToExcel(${'window.__lastStatementRows'}, 'كشف الحساب', 'كشف_الحساب.xlsx')">تصدير إكسل</button></div>
    </div>`;
    window.__lastStatementRows = st.rows.map(r => ({ 'التاريخ': r.date, 'رقم القيد': r.entry_no||'', 'البيان': r.description||'', 'مدين': r.debit, 'دائن': r.credit, 'الرصيد': r.balance }));
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر عرض الكشف: ${e.message}</div></div>`; }
};

// ── كشف أرصدة حسابات (ميزان المراجعة الموجود أصلاً، بواجهة مخصّصة لهذا العنصر) ─────────────────────────────
PAGE_RENDER.coabalances = async (root) => {
  const tb = await DB.trialBalance();
  const totalD = tb.reduce((s, r) => s + Number(r.total_debit || 0), 0);
  const totalC = tb.reduce((s, r) => s + Number(r.total_credit || 0), 0);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📋 كشف أرصدة حسابات</div><div class="ph-sub">ميزان المراجعة — أرصدة جميع الحسابات حتى الآن</div></div>
      <div class="ph-actions"><button class="btn btn-o btn-sm" onclick="exportRowsToExcel(${'window.__tbRows'}, 'أرصدة الحسابات', 'أرصدة_الحسابات.xlsx')">تصدير إكسل</button></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
    <tbody>${tb.map(r => `<tr><td class="mono">${r.code}</td><td>${r.name}</td>
      <td class="mono">${Number(r.total_debit) ? fmt(r.total_debit) : '—'}</td><td class="mono">${Number(r.total_credit) ? fmt(r.total_credit) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد بيانات</td></tr>'}
    </tbody></table></div>
    <div class="grand-bar"><span class="grand-lbl">الإجمالي</span><span class="grand-val">${fmtIQD(totalD)} / ${fmtIQD(totalC)}</span></div></div>`;
  window.__tbRows = tb.map(r => ({ 'الرمز': r.code, 'الحساب': r.name, 'مدين': Number(r.total_debit)||0, 'دائن': Number(r.total_credit)||0 }));
};
