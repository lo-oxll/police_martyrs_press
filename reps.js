// ══════════════════════════════════════════════════════════════════
//  اعدادات نسبة المندوب: بطاقة مندوب المبيعات + تقرير العمولات
// ══════════════════════════════════════════════════════════════════

PAGE_RENDER.repcommissionsettings = async (root) => {
  const list = await DB.listSalesReps();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">مندوبو المبيعات واعدادات نسبة العمولة</div><div class="ph-sub">كل فاتورة إصدار تقدر تُربط بمندوب مبيعات (من شاشة "اخراج فواتير") لاحتساب عمولته تلقائياً</div></div>
      <div class="ph-actions">${can('admin','accountant','manager') ? `<button class="btn btn-p btn-sm" onclick="openRepModal()">+ مندوب جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>الهاتف</th><th>نسبة العمولة</th><th></th></tr></thead>
    <tbody>${list.map(r => `<tr><td class="mono">${r.code}</td><td>${r.name}</td><td class="mono">${r.phone||'—'}</td><td class="mono gold-txt">${r.commission_percent}%</td>
      <td>${can('admin','accountant','manager') ? `<button class="btn btn-o btn-sm" onclick='openRepModal(${JSON.stringify(r)})'>تعديل</button>
      <button class="btn btn-d btn-sm" onclick="deactivateRepConfirm('${r.id}')">إلغاء تفعيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا يوجد مندوبون بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openRepModal = (r = null) => {
  showModal(r ? 'تعديل مندوب' : 'مندوب جديد', `
    <div class="fg2">
      <div class="fgroup"><label>الرمز</label><input id="m-rp-code" value="${r?.code||'REP-'+Date.now().toString().slice(-6)}" ${r?'disabled':''}></div>
      <div class="fgroup"><label>نسبة العمولة %</label><input id="m-rp-pct" type="number" step="0.01" value="${r?.commission_percent||0}"></div>
    </div>
    <div class="fgroup"><label>الاسم</label><input id="m-rp-name" value="${r?.name||''}"></div>
    <div class="fgroup"><label>الهاتف</label><input id="m-rp-phone" value="${r?.phone||''}"></div>
  `, async () => {
    const code = gv('m-rp-code'), name = gv('m-rp-name'), commission_percent = Number(gv('m-rp-pct'))||0;
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    try {
      if (r) await DB.updateSalesRep(r.id, { name, phone: gv('m-rp-phone'), commission_percent });
      else await DB.createSalesRep({ code, name, phone: gv('m-rp-phone'), commission_percent });
      toast('تم الحفظ', 's'); go('repcommissionsettings');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deactivateRepConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا المندوب؟')) return;
  try { await DB.deactivateSalesRep(id); toast('تم', 's'); go('repcommissionsettings'); } catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── تقرير عمولات المندوبين (استضفته بصفحة "ملخص يومية المندوبين") ─────────────────────────────
PAGE_RENDER.repsdailysummary = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تقرير عمولات المندوبين</div><div class="ph-sub">إجمالي مبيعات كل مندوب وعمولته المحتسَبة بفترة معيّنة</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="rc-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="rc-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runRepCommissionReport()">عرض</button></div></div>
    <div id="rc-result"></div>`;
};
window.runRepCommissionReport = async () => {
  const from = gv('rc-from'), to = gv('rc-to');
  const box = document.getElementById('rc-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.repCommissionReport(from, to);
    const totalCommission = rows.reduce((s,r)=>s+r.commissionAmount,0);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>المندوب</th><th>إجمالي المبيعات</th><th>نسبة العمولة</th><th>مبلغ العمولة</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.name}</td><td class="mono">${fmtIQD(r.totalSales)}</td><td class="mono">${r.commission_percent}%</td><td class="mono gold-txt">${fmtIQD(r.commissionAmount)}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد مبيعات مرتبطة بمندوبين بهذه الفترة</td></tr>'}
      </tbody></table></div><div class="grand-bar"><span class="grand-lbl">إجمالي العمولات</span><span class="grand-val">${fmtIQD(totalCommission)}</span></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};
