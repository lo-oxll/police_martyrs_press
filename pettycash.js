// ══════════════════════════════════════════════════════════════════
//  السلفة المستديمة (Petty Cash) — سند صرف واحد بعدة أصناف:
//  كل صنف إما "مادة مخزنية" (تُحدَّث أرصدتها فوراً بمخزنها المحدَّد
//  وتُحمَّل على حساب المخزون الموحّد) أو "مصروف مباشر" (يُحمَّل على
//  حساب المصروف المختار مباشرة بدون أثر مخزني). الدائن دائماً حساب
//  "السلفة المستديمة". القيود الناتجة تدخل تلقائياً بالتقارير المالية
//  وميزان المراجعة لأنها قيود محاسبية حقيقية بنفس آلية بقية النظام.
// ══════════════════════════════════════════════════════════════════

PAGE_RENDER.pettycash = async (root, mode = 'list', voucherId = null) => {
  if (!can('admin','manager','auditor','accountant')) { root.innerHTML = '<div class="card ec">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return; }
  if (mode === 'new') return renderPettyCashForm(root);
  if (mode === 'view') return renderPettyCashView(root, voucherId);

  const canWrite = canTreasury();
  const vouchers = await DB.listPettyCashVouchers();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🧾 السلفة المستديمة — سندات الصرف</div><div class="ph-sub">كل سند يُرحَّل فوراً بقيد محاسبي: مدين حساب المخزون (للمواد) و/أو حسابات المصروفات (للبنود غير المخزنية)، ودائن حساب السلفة المستديمة</div></div>
      ${canWrite ? `<div class="ph-actions"><button class="btn btn-o" onclick="go('pettycashfund')">📒 قائمة السلفة</button><button class="btn btn-p" onclick="PAGE_RENDER.pettycash(document.getElementById('page-root'),'new')">+ سند صرف جديد</button></div>` : ''}
    </div>
    <div class="card"><div class="itw"><table><thead><tr>
      <th>تسلسل</th><th>رقم المستند</th><th>التاريخ</th><th>اسم المحل</th><th>المبلغ الكلي</th><th>الحالة</th><th></th>
    </tr></thead><tbody>
      ${vouchers.map(v => `<tr>
        <td class="mono">${v.seq_no}</td><td class="doc-num">${v.doc_num}</td><td class="mono">${v.doc_date}</td><td>${v.shop_name || '—'}</td>
        <td class="gold-txt">${fmt(v.total_amount)}</td>
        <td>${v.is_cancelled ? '<span class="chip-danger chip">ملغى</span>' : '<span class="chip-ok chip">مُرحَّل</span>'}</td>
        <td>
          <button class="btn btn-o btn-sm" onclick="PAGE_RENDER.pettycash(document.getElementById('page-root'),'view','${v.id}')">عرض</button>
          ${can('admin') && !v.is_cancelled ? `<button class="btn btn-d btn-sm" onclick="cancelPettyCashConfirm('${v.id}','${(v.doc_num||'').replace(/'/g,"\\'")}')">إلغاء</button>` : ''}
          ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deletePettyCashConfirm('${v.id}','${(v.doc_num||'').replace(/'/g,"\\'")}','${v.journal_entry_id||''}')">🗑 حذف نهائي</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="ec">لا توجد سندات صرف مسجّلة بعد</td></tr>'}
    </tbody></table></div></div>
  `;
};

// ── صف صنف بسند الصرف ──────────────────────────────
function pcItemRowHTML() {
  return `<tr>
    <td style="width:34px" class="mono row-idx"></td>
    <td style="width:130px">
      <select class="pc-kind">
        <option value="inv">مادة مخزنية</option>
        <option value="exp">مصروف مباشر</option>
      </select>
    </td>
    <td style="min-width:220px">
      <div class="pc-inv-wrap ac-wrap">
        <input class="pc-mat-search" placeholder="ابحث بالرقم المخزني أو الاسم...">
        <div class="ac-portal"></div>
        <input type="hidden" class="pc-mat-id">
      </div>
      <input class="pc-exp-name hidden" placeholder="اسم/وصف البند">
    </td>
    <td style="min-width:170px">
      <select class="pc-wh hidden"><option value="">اختر المخزن...</option></select>
      <select class="pc-acc hidden"><option value="">اختر حساب المصروف...</option></select>
    </td>
    <td style="width:90px"><input type="number" step="0.001" min="0.001" class="pc-qty mono" value="1"></td>
    <td style="width:80px"><input class="pc-unit" placeholder="قطعة"></td>
    <td style="width:110px"><input type="number" class="pc-price mono" value="0"></td>
    <td style="width:120px" class="pc-total mono gold-txt">0</td>
    <td style="width:40px"><button class="btn btn-d btn-sm" onclick="this.closest('tr').remove(); recalcPettyCash();">✕</button></td>
  </tr>`;
}

async function addPettyCashRow() {
  const tbody = document.getElementById('pc-items');
  tbody.insertAdjacentHTML('beforeend', pcItemRowHTML());
  const row = tbody.lastElementChild;

  const whs = scopedWarehouses(await DB.listWarehouses());
  const accs = await DB.chartOfAccounts();
  const whSel = row.querySelector('.pc-wh');
  whSel.insertAdjacentHTML('beforeend', whs.map(w => `<option value="${w.id}">${w.code} — ${w.name}</option>`).join(''));
  const accSel = row.querySelector('.pc-acc');
  accSel.insertAdjacentHTML('beforeend', accs.filter(a=>a.type==='expense'||a.type==='asset').map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join(''));

  const kindSel = row.querySelector('.pc-kind');
  const invWrap = row.querySelector('.pc-inv-wrap'), expInput = row.querySelector('.pc-exp-name');
  kindSel.onchange = () => {
    const isInv = kindSel.value === 'inv';
    invWrap.classList.toggle('hidden', !isInv);
    expInput.classList.toggle('hidden', isInv);
    whSel.classList.toggle('hidden', !isInv);
    accSel.classList.toggle('hidden', isInv);
  };

  const searchInp = row.querySelector('.pc-mat-search');
  const portal = row.querySelector('.ac-portal');
  bindAutocomplete(searchInp, portal,
    async term => {
      if (!term) return [];
      const found = await DB.listMaterials(term);
      const exact = found.some(m => m.store_num.toLowerCase() === term.trim().toLowerCase());
      if (!exact && term.trim().length >= 2) found.push({ __new: true, store_num: term.trim() });
      return found;
    },
    async m => {
      if (m.__new) {
        const name = prompt(`تعريف مادة جديدة بالرقم المخزني "${m.store_num}"\nأدخل اسم المادة:`);
        if (!name || !name.trim()) return;
        const unit = prompt('وحدة القياس (اختياري):', 'قطعة') || 'قطعة';
        try {
          const created = await DB.upsertMaterial({ store_num: m.store_num, name: name.trim(), unit, category: '', min_qty: 0, notes: 'أُنشئت تلقائياً من سند صرف سلفة مستديمة' });
          await DB.log('auto_create_material', 'materials', created.id, { store_num: m.store_num, source: 'petty_cash' });
          toast('تم تعريف المادة الجديدة', 's');
          m = created;
        } catch (e) { toast('تعذر إنشاء المادة: ' + e.message, 'e'); return; }
      }
      searchInp.value = `${m.store_num} — ${m.name}`;
      row.querySelector('.pc-mat-id').value = m.id;
      if (!row.querySelector('.pc-unit').value) row.querySelector('.pc-unit').value = m.unit;
    },
    (m, first) => m.__new
      ? `<div class="ac-item ${first ? 'hi' : ''}" style="color:var(--ok);font-weight:700">+ تعريف مادة جديدة برقم "${m.store_num}"</div>`
      : `<div class="ac-item ${first ? 'hi' : ''}"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`
  );

  row.querySelectorAll('.pc-qty, .pc-price').forEach(inp => inp.addEventListener('input', recalcPettyCash));
  renumberPcRows();
}
window.addPettyCashRow = addPettyCashRow;

function renumberPcRows() {
  document.querySelectorAll('#pc-items tr').forEach((tr, i) => tr.querySelector('.row-idx').textContent = i + 1);
}
window.recalcPettyCash = () => {
  let total = 0;
  document.querySelectorAll('#pc-items tr').forEach(tr => {
    const qty = Number(tr.querySelector('.pc-qty').value) || 0;
    const price = Number(tr.querySelector('.pc-price').value) || 0;
    const t = qty * price;
    tr.querySelector('.pc-total').textContent = fmt(t);
    total += t;
  });
  renumberPcRows();
  const bar = document.getElementById('pc-grand');
  if (bar) bar.innerHTML = `<div class="grand-bar"><span class="grand-lbl">المبلغ الكلي للسند</span><span class="grand-val">${fmt(total)}</span></div>`;
};

function renderPettyCashForm(root) {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🧾 سند صرف جديد من السلفة المستديمة</div><div class="ph-sub">أدخل بيانات المحل والمستند، ثم أضف كل بند: مادة مخزنية (تُحدَّد بمخزنها) أو مصروف مباشر (يُحدَّد بحسابه)</div></div>
      <div class="ph-actions"><button class="btn btn-o" onclick="go('pettycash')">إلغاء</button><button class="btn btn-p" id="pc-save-btn">💾 حفظ وترحيل السند</button></div></div>
    <div class="card">
      <div class="fg" style="margin-bottom:14px">
        <div class="fgroup"><label>رقم المستند *</label><input id="pc-docnum"></div>
        <div class="fgroup"><label>تاريخ المستند *</label><input type="date" id="pc-docdate" value="${todayISO()}"></div>
        <div class="fgroup"><label>اسم المحل</label><input id="pc-shop"></div>
        <div class="fgroup"><label>تاريخ المحل</label><input type="date" id="pc-shopdate"></div>
      </div>
      <div class="fgroup" style="margin-bottom:14px"><label>ملاحظات</label><textarea id="pc-notes"></textarea></div>

      <div class="itw"><table><thead><tr>
        <th>#</th><th>نوع البند</th><th>التفاصيل (اسم المادة/البند)</th><th>التبويب المحاسبي (المخزن/الحساب)</th>
        <th>الكمية</th><th>نوع الكمية</th><th>السعر للمفرد</th><th>الإجمالي</th><th></th>
      </tr></thead><tbody id="pc-items"></tbody></table></div>
      <button class="btn btn-o btn-sm" style="margin-top:10px" onclick="addPettyCashRow()">+ إضافة بند</button>
      <div id="pc-grand" style="margin-top:12px"></div>
    </div>
  `;
  addPettyCashRow();
  document.getElementById('pc-save-btn').onclick = savePettyCashVoucher;
}

async function savePettyCashVoucher() {
  const docNum = gv('pc-docnum'), docDate = gv('pc-docdate');
  if (!docNum || !docDate) { toast('أدخل رقم المستند وتاريخه', 'e'); return; }
  const rows = [...document.querySelectorAll('#pc-items tr')];
  if (!rows.length) { toast('أضف بنداً واحداً على الأقل', 'e'); return; }

  const items = [];
  for (const tr of rows) {
    const isInv = tr.querySelector('.pc-kind').value === 'inv';
    const qty = Number(tr.querySelector('.pc-qty').value) || 0;
    const price = Number(tr.querySelector('.pc-price').value) || 0;
    if (qty <= 0) { toast('تأكد أن الكمية أكبر من صفر بكل البنود', 'e'); return; }
    if (isInv) {
      const matId = tr.querySelector('.pc-mat-id').value;
      const whId = tr.querySelector('.pc-wh').value;
      if (!matId) { toast('اختر مادة من دليل المواد بكل بند مخزني', 'e'); return; }
      if (!whId) { toast('اختر المخزن (التبويب المحاسبي) بكل بند مخزني', 'e'); return; }
      items.push({
        item_name: tr.querySelector('.pc-mat-search').value.split('—').slice(1).join('—').trim() || tr.querySelector('.pc-mat-search').value,
        material_id: matId, warehouse_id: whId, account_id: null,
        qty, unit: tr.querySelector('.pc-unit').value || null, unit_price: price, line_total: qty * price,
      });
    } else {
      const name = tr.querySelector('.pc-exp-name').value.trim();
      const accId = tr.querySelector('.pc-acc').value;
      if (!name) { toast('أدخل اسم/وصف البند غير المخزني', 'e'); return; }
      if (!accId) { toast('اختر حساب المصروف بكل بند غير مخزني', 'e'); return; }
      items.push({
        item_name: name, material_id: null, warehouse_id: null, account_id: accId,
        qty, unit: tr.querySelector('.pc-unit').value || null, unit_price: price, line_total: qty * price,
      });
    }
  }

  const header = {
    doc_num: docNum, doc_date: docDate, shop_name: gv('pc-shop') || null, shop_date: gv('pc-shopdate') || null,
    notes: gv('pc-notes') || null, total_amount: items.reduce((s, i) => s + i.line_total, 0),
  };
  if (!confirm(`سيتم ترحيل السند فوراً: تحديث أرصدة المواد المخزنية المختارة وإنشاء قيد محاسبي بإجمالي ${fmtIQD(header.total_amount)}. متابعة؟`)) return;
  try {
    const v = await DB.createPettyCashVoucher(header, items);
    toast('✅ تم حفظ وترحيل سند الصرف', 's');
    PAGE_RENDER.pettycash(document.getElementById('page-root'), 'view', v.id);
  } catch (e) { toast('خطأ: ' + friendlyStockError(e.message), 'e'); }
}

async function renderPettyCashView(root, id) {
  const v = await DB.getPettyCashVoucher(id);
  const items = await DB.pettyCashItems(id);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🧾 سند صرف رقم ${v.doc_num}</div><div class="ph-sub">تسلسل #${v.seq_no} — ${v.doc_date}${v.shop_name ? ' — ' + v.shop_name : ''} — ${v.is_cancelled ? '<b style="color:var(--danger)">ملغى</b>' : 'مُرحَّل'}</div></div>
      <div class="ph-actions">
        <button class="btn btn-o" onclick="go('pettycash')">◀ رجوع للقائمة</button>
        <button class="btn btn-o" onclick="exportPettyCashExcel('${v.id}')">⬇ تصدير إكسل</button>
        <button class="btn btn-o" onclick="printPettyCash('${v.id}')">🖨 طباعة</button>
        ${can('admin') && !v.is_cancelled ? `<button class="btn btn-d" onclick="cancelPettyCashConfirm('${v.id}','${(v.doc_num||'').replace(/'/g,"\\'")}')">إلغاء السند</button>` : ''}
        ${can('admin') ? `<button class="btn btn-d" onclick="deletePettyCashConfirm('${v.id}','${(v.doc_num||'').replace(/'/g,"\\'")}','${v.journal_entry_id||''}')">🗑 حذف نهائي</button>` : ''}
      </div>
    </div>
    <div class="card"><div class="itw"><table><thead><tr>
      <th>#</th><th>التفاصيل</th><th>التبويب المحاسبي</th><th>الكمية</th><th>نوع الكمية</th><th>السعر للمفرد</th><th>الإجمالي</th>
    </tr></thead><tbody>
      ${items.map((it,i) => `<tr><td class="mono">${i+1}</td><td>${it.item_name}</td>
        <td>${it.warehouses ? `مخزن: ${it.warehouses.code} — ${it.warehouses.name}` : (it.chart_of_accounts ? `${it.chart_of_accounts.code} — ${it.chart_of_accounts.name}` : '—')}</td>
        <td class="mono">${fmtQty(it.qty)}</td><td>${it.unit || '—'}</td><td class="mono">${fmt(it.unit_price)}</td><td class="gold-txt mono">${fmt(it.line_total)}</td></tr>`).join('') || '<tr><td colspan="7" class="ec">لا توجد بنود</td></tr>'}
    </tbody></table></div>
      <div class="grand-bar"><span class="grand-lbl">المبلغ الكلي</span><span class="grand-val">${fmt(v.total_amount)}</span></div>
      ${v.notes ? `<div style="margin-top:10px;font-size:12.5px;color:var(--ink2)">ملاحظات: ${v.notes}</div>` : ''}
    </div>
  `;
}

window.cancelPettyCashConfirm = async (id, docNum) => {
  if (!confirm(`⚠️ إلغاء سند الصرف رقم "${docNum}". سيُعكس أثره على أرصدة المواد المخزنية ويُحذف القيد المحاسبي المرتبط. سيُرفض تلقائياً لو صُرفت الكمية من مخزنها بعملية أخرى لاحقة. متابعة؟`)) return;
  try {
    await DB.cancelPettyCashVoucher(id, docNum);
    toast('تم إلغاء السند', 's');
    go('pettycash');
  } catch (e) { toast('تعذر الإلغاء: ' + friendlyStockError(e.message), 'e'); }
};
window.deletePettyCashConfirm = async (id, docNum, journalEntryId) => {
  if (!confirm(`⚠️ حذف نهائي لسند الصرف رقم "${docNum}" من السجل بالكامل (وليس مجرد إلغاء). هذا الإجراء لا يمكن التراجع عنه. متابعة؟`)) return;
  try {
    await DB.deletePettyCashVoucher(id, docNum, journalEntryId || null);
    toast('تم حذف السند نهائياً', 's');
    go('pettycash');
  } catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};
window.exportPettyCashExcel = async (id) => {
  const v = await DB.getPettyCashVoucher(id);
  const items = await DB.pettyCashItems(id);
  const rows = items.map((it,i) => ({
    'تسلسل': i+1, 'رقم المستند': v.doc_num, 'تاريخ المستند': v.doc_date, 'اسم المحل': v.shop_name || '', 'تاريخ المحل': v.shop_date || '',
    'التفاصيل (اسم المادة)': it.item_name,
    'التبويب المحاسبي': it.warehouses ? `مخزن: ${it.warehouses.code} — ${it.warehouses.name}` : (it.chart_of_accounts ? `${it.chart_of_accounts.code} — ${it.chart_of_accounts.name}` : ''),
    'الكمية': it.qty, 'نوع الكمية': it.unit || '', 'السعر للمفرد': it.unit_price, 'الإجمالي': it.line_total,
  }));
  exportRowsToExcel(rows, 'سند صرف', `سند_صرف_${v.doc_num}.xlsx`);
};
window.printPettyCash = async (id) => {
  const v = await DB.getPettyCashVoucher(id);
  const items = await DB.pettyCashItems(id);
  const rows = items.map((it,i) => `<tr><td>${i+1}</td><td>${it.item_name}</td>
    <td>${it.warehouses ? `مخزن: ${it.warehouses.code} — ${it.warehouses.name}` : (it.chart_of_accounts ? `${it.chart_of_accounts.code} — ${it.chart_of_accounts.name}` : '—')}</td>
    <td class="mono">${fmtQty(it.qty)}</td><td>${it.unit||''}</td><td class="mono">${fmt(it.unit_price)}</td><td class="mono">${fmt(it.line_total)}</td></tr>`).join('');
  const html = `
    <table style="width:100%;font-size:12px;margin-bottom:14px"><tr>
      <td>رقم المستند: <b class="mono">${v.doc_num}</b></td><td>التسلسل: <b class="mono">#${v.seq_no}</b></td><td>التاريخ: <b>${v.doc_date}</b></td><td>المحل: <b>${v.shop_name||'—'}</b></td>
    </tr></table>
    <table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="border-bottom:1px solid #999">
      <th>#</th><th>التفاصيل</th><th>التبويب المحاسبي</th><th>الكمية</th><th>النوع</th><th>سعر المفرد</th><th>الإجمالي</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div style="text-align:left;margin-top:10px;font-weight:800">المبلغ الكلي: ${fmtIQD(v.total_amount)}</div>
    ${v.notes ? `<div style="margin-top:10px;font-size:12px">ملاحظات: ${v.notes}</div>` : ''}
    <div style="display:flex;justify-content:space-between;margin-top:50px;font-size:12px">
      <div>محاسب المركز: ____________________</div><div>مصادقة مدير النظام: ____________________</div>
    </div>`;
  await renderPrintArea('سند صرف سلفة مستديمة', html);
  window.print();
};

// ════════════════════════════════════════════════════════════════
//  قائمة السلفة — سجل تغذية صندوق العهدة + الرصيد المتبقي
// ════════════════════════════════════════════════════════════════
PAGE_RENDER.pettycashfund = async (root) => {
  if (!can('admin','manager','auditor','accountant')) { root.innerHTML = '<div class="card ec">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return; }
  const [fund, advances, accs] = await Promise.all([DB.pettyCashFundBalance(), DB.listPettyCashAdvances(), DB.chartOfAccounts()]);
  const canWrite = canTreasury();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📒 قائمة السلفة المستديمة</div><div class="ph-sub">سجل تغذية صندوق العهدة (النقل إليه من الصندوق المركزي/البنك) مقابل إجمالي ما صُرف بسندات الصرف</div></div>
      <div class="ph-actions">
        <button class="btn btn-o" onclick="go('pettycash')">◀ سندات الصرف</button>
        ${canWrite ? `<button class="btn btn-p" onclick="openAdvanceModal()">+ تغذية جديدة للسلفة</button>` : ''}
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-lbl">إجمالي التغذيات</div><div class="stat-val" style="color:var(--ok)">${fmt(fund.totalAdv)}</div></div>
      <div class="stat"><div class="stat-lbl">إجمالي المصروف (سندات غير ملغاة)</div><div class="stat-val danger">${fmt(fund.totalSpent)}</div></div>
      <div class="stat"><div class="stat-lbl">الرصيد المتبقي بالسلفة</div><div class="stat-val gold">${fmt(fund.balance)}</div></div>
    </div>
    <div class="card"><div class="card-title">سجل التغذيات</div><div class="itw"><table><thead><tr>
      <th>التاريخ</th><th>المبلغ</th><th>مصدر التمويل</th><th>ملاحظات</th><th>بواسطة</th>${can('admin') ? '<th></th>' : ''}
    </tr></thead><tbody>
      ${advances.map(a => `<tr>
        <td class="mono">${a.advance_date}</td><td class="gold-txt mono">${fmt(a.amount)}</td>
        <td>${a.chart_of_accounts ? `${a.chart_of_accounts.code} — ${a.chart_of_accounts.name}` : '—'}</td>
        <td style="font-size:12px">${a.notes || '—'}</td><td>${a.profiles?.full_name || '—'}</td>
        ${can('admin') ? `<td><button class="btn btn-d btn-sm" onclick="deleteAdvanceConfirm('${a.id}','${a.journal_entry_id||''}',${a.amount})">🗑 حذف</button></td>` : ''}
      </tr>`).join('') || `<tr><td colspan="${can('admin')?6:5}" class="ec">لا توجد تغذيات مسجّلة بعد</td></tr>`}
    </tbody></table></div></div>
    <div id="pca-acc-cache" class="hidden">${JSON.stringify(accs)}</div>
  `;
};

window.openAdvanceModal = () => {
  const accs = JSON.parse(document.getElementById('pca-acc-cache').textContent);
  const opts = accs.map(a => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join('');
  showModal('+ تغذية جديدة للسلفة المستديمة', `
    <div class="fg2" style="margin-bottom:10px">
      <div class="fgroup"><label>التاريخ *</label><input type="date" id="m-adv-date" value="${todayISO()}"></div>
      <div class="fgroup"><label>المبلغ (د.ع) *</label><input type="number" id="m-adv-amount"></div>
      <div class="fgroup s2"><label>مصدر التمويل (الحساب المقابل) *</label><select id="m-adv-acc"><option value="">— اختر حساب —</option>${opts}</select></div>
      <div class="fgroup s2"><label>ملاحظات</label><input id="m-adv-notes"></div>
    </div>
  `, async () => {
    const amount = Number(gv('m-adv-amount')), acc = gv('m-adv-acc'), date = gv('m-adv-date');
    if (!amount || amount <= 0) { toast('أدخل مبلغاً صحيحاً', 'e'); return false; }
    if (!acc) { toast('اختر مصدر التمويل', 'e'); return false; }
    try {
      await DB.createPettyCashAdvance({ advance_date: date, amount, source_account_id: acc, notes: gv('m-adv-notes') });
      toast('تم تسجيل التغذية', 's');
      go('pettycashfund'); return true;
    } catch (e) { toast('خطأ: ' + e.message, 'e'); return false; }
  });
};
window.deleteAdvanceConfirm = async (id, journalEntryId, amount) => {
  if (!confirm(`⚠️ حذف نهائي لتغذية بمبلغ ${fmtIQD(amount)} وقيدها المحاسبي المرتبط. متابعة؟`)) return;
  try {
    await DB.deletePettyCashAdvance(id, journalEntryId || null, amount);
    toast('تم الحذف', 's');
    go('pettycashfund');
  } catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};
