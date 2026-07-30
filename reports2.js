// ══════════════════════════════════════════════════════════════════
//  المرحلة ٤: تقارير مستودعية ومحاسبية موسّعة — كلها تُبنى فوق البيانات
//  الموجودة أصلاً (وثائق الاستلام/الإصدار/التحويل، القيود، الأرصدة)
// ══════════════════════════════════════════════════════════════════

async function warehouseFilterOptions() {
  return scopedWarehouses(await DB.listWarehouses());
}
function monthStart() { return todayISO().slice(0, 8) + '01'; }

// ── كشف حركة مادة ─────────────────────────────
PAGE_RENDER.materialmovement = async (root) => {
  const whs = await warehouseFilterOptions();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🔄 كشف حركة مادة</div><div class="ph-sub">كل حركات مادة معيّنة بمخزن معيّن (استلام/إصدار/تحويل) برصيد متحرك</div></div></div>
    <div class="card">
      <div class="fg">
        <div class="fgroup"><label>المخزن</label><select id="mm-wh">${whs.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
        <div class="fgroup"><label>المادة</label><div class="ac-wrap"><input id="mm-mat-search" placeholder="ابحث برقم المادة أو الاسم..." autocomplete="off"><div class="ac-portal" id="mm-mat-portal"></div></div><input type="hidden" id="mm-mat-id"></div>
        <div class="fgroup"><label>&nbsp;</label><button class="btn btn-p" onclick="runMaterialMovement()">عرض</button></div>
      </div>
      <div class="fg2" style="margin-top:10px">
        <div class="fgroup"><label>من تاريخ</label><input id="mm-from" type="date" value="${monthStart()}"></div>
        <div class="fgroup"><label>إلى تاريخ</label><input id="mm-to" type="date" value="${todayISO()}"></div>
      </div>
    </div>
    <div id="mm-result"></div>`;
  bindAutocomplete(document.getElementById('mm-mat-search'), document.getElementById('mm-mat-portal'),
    async (term) => term ? DB.listMaterials(term, 8) : [],
    (m) => { sv('mm-mat-search', `${m.store_num} — ${m.name}`); sv('mm-mat-id', m.id); },
    (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);
};
window.runMaterialMovement = async () => {
  const wh = gv('mm-wh'), matId = gv('mm-mat-id'), from = gv('mm-from'), to = gv('mm-to');
  const box = document.getElementById('mm-result');
  if (!matId) { toast('اختر مادة من قائمة الإكمال التلقائي', 'e'); return; }
  box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.materialMovement(matId, wh, from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>التاريخ</th><th>رقم الوثيقة</th><th>النوع</th><th>وارد</th><th>صادر</th><th>الرصيد</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td class="doc-num">${r.doc_num}</td><td><span class="chip">${r.type}</span></td>
        <td class="mono" style="color:var(--ok)">${r.qtyIn ? fmtQty(r.qtyIn) : '—'}</td><td class="mono" style="color:var(--danger)">${r.qtyOut ? fmtQty(r.qtyOut) : '—'}</td>
        <td class="mono gold-txt">${fmtQty(r.balance)}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد حركات بهذه الفترة</td></tr>'}
      </tbody></table></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(rows.map(r=>({'التاريخ':r.date,'الوثيقة':r.doc_num,'النوع':r.type,'وارد':r.qtyIn,'صادر':r.qtyOut,'الرصيد':r.balance})))}, "كشف حركة مادة", "كشف_حركة_مادة.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

// ── ملخص الحركة المستودعية ─────────────────────────────
PAGE_RENDER.whmovementsummary = async (root) => {
  const whs = await warehouseFilterOptions();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📊 ملخص الحركة المستودعية</div><div class="ph-sub">إجمالي الوارد والصادر لكل مادة بمخزن خلال فترة، مع الرصيد الحالي</div></div></div>
    <div class="card"><div class="fg">
      <div class="fgroup"><label>المخزن</label><select id="wms-wh">${whs.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>من تاريخ</label><input id="wms-from" type="date" value="${monthStart()}"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="wms-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runWhMovementSummary()">عرض</button></div></div>
    <div id="wms-result"></div>`;
};
window.runWhMovementSummary = async () => {
  const wh = gv('wms-wh'), from = gv('wms-from'), to = gv('wms-to');
  const box = document.getElementById('wms-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.warehouseMovementSummary(wh, from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>الرقم المخزني</th><th>المادة</th><th>الوحدة</th><th>وارد</th><th>صادر</th><th>الرصيد الحالي</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.store_num}</td><td>${r.name}</td><td>${r.unit}</td>
        <td class="mono" style="color:var(--ok)">${r.in ? fmtQty(r.in) : '—'}</td><td class="mono" style="color:var(--danger)">${r.out ? fmtQty(r.out) : '—'}</td>
        <td class="mono gold-txt">${fmtQty(r.balance)}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد حركات بهذه الفترة</td></tr>'}
      </tbody></table></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(rows.map(r=>({'الرقم المخزني':r.store_num,'المادة':r.name,'الوحدة':r.unit,'وارد':r.in,'صادر':r.out,'الرصيد':r.balance})))}, "ملخص الحركة المستودعية", "ملخص_الحركة.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

// ── كشف يومية مستودع (عادي وموسّع بنفس الصفحة) ─────────────────────────────
async function renderWarehouseJournalPage(root, extended) {
  const whs = await warehouseFilterOptions();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">${extended ? '🗓 كشف يومية مستودع موسّع' : '🗓 كشف يومية مستودع'}</div>
      <div class="ph-sub">كل الوثائق المؤثرة بالمخزن خلال فترة، مرتّبة زمنياً</div></div></div>
    <div class="card"><div class="fg">
      <div class="fgroup"><label>المخزن</label><select id="wj-wh">${whs.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>من تاريخ</label><input id="wj-from" type="date" value="${todayISO()}"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="wj-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runWarehouseJournal(${extended})">عرض</button></div></div>
    <div id="wj-result"></div>`;
}
PAGE_RENDER.whdaily = async (root) => renderWarehouseJournalPage(root, false);
PAGE_RENDER.whdailyext = async (root) => renderWarehouseJournalPage(root, true);
window.runWarehouseJournal = async (extended) => {
  const wh = gv('wj-wh'), from = gv('wj-from'), to = gv('wj-to');
  const box = document.getElementById('wj-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.warehouseJournal(wh, from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>التاريخ</th><th>رقم الوثيقة</th><th>النوع</th>${extended ? '<th>التفاصيل</th>' : ''}<th>القيمة</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td class="doc-num">${r.doc_num}</td><td><span class="chip">${r.type}</span></td>${extended ? `<td>${r.detail}</td>` : ''}<td class="mono gold-txt">${r.amount ? fmtIQD(r.amount) : '—'}</td></tr>`).join('') || `<tr><td colspan="${extended?5:4}" class="ec">لا توجد وثائق بهذه الفترة</td></tr>`}
      </tbody></table></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(rows.map(r=>({'التاريخ':r.date,'الوثيقة':r.doc_num,'النوع':r.type,'التفاصيل':r.detail,'القيمة':r.amount})))}, "كشف يومية مستودع", "كشف_يومية_مستودع.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

// ── كشف اجمالي لمستودع ─────────────────────────────
PAGE_RENDER.warehousesummary = async (root) => {
  const whs = await warehouseFilterOptions();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📦 كشف اجمالى لمستودع</div><div class="ph-sub">مجاميع القيمة المالية خلال فترة + قيمة الرصيد الحالي</div></div></div>
    <div class="card"><div class="fg">
      <div class="fgroup"><label>المخزن</label><select id="wt-wh">${whs.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>من تاريخ</label><input id="wt-from" type="date" value="${monthStart()}"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="wt-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runWarehouseTotals()">عرض</button></div></div>
    <div id="wt-result"></div>`;
};
window.runWarehouseTotals = async () => {
  const wh = gv('wt-wh'), from = gv('wt-from'), to = gv('wt-to');
  const box = document.getElementById('wt-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const t = await DB.warehouseTotals(wh, from, to);
    box.innerHTML = `<div class="stats">
      <div class="stat"><div class="stat-lbl">إجمالي الاستلام</div><div class="stat-val" style="color:var(--ok)">${fmtIQD(t.totalReceipts)}</div></div>
      <div class="stat"><div class="stat-lbl">إجمالي الإصدار</div><div class="stat-val danger">${fmtIQD(t.totalIssues)}</div></div>
      <div class="stat"><div class="stat-lbl">الصافي</div><div class="stat-val gold">${fmtIQD(t.net)}</div></div>
      <div class="stat"><div class="stat-lbl">قيمة الرصيد الحالي</div><div class="stat-val">${fmtIQD(t.stockValue)}</div></div>
    </div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

// ── كشوفات المبيعات والمشتريات: تحليلي / تجميعي / احصائي ─────────────────────────────
async function renderSalesPurchasesPage(root, mode) {
  const titles = { analytical: ['📈 كشف تحليلي للمبيعات والمشتريات', 'تفصيل كل حركة بيع/شراء'], aggregate: ['📊 كشف تجميعي للمبيعات والمشتريات', 'مجاميع الكمية والقيمة حسب المادة'], stats: ['🏆 كشف احصائي للمبيعات والمشتريات', 'الأكثر مبيعاً وشراءً'] };
  const [title, subtitle] = titles[mode];
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">${title}</div><div class="ph-sub">${subtitle}</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="sp-from" type="date" value="${monthStart()}"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="sp-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runSalesPurchases('${mode}')">عرض</button></div></div>
    <div id="sp-result"></div>`;
}
PAGE_RENDER.salespurchaseanalytical = async (root) => renderSalesPurchasesPage(root, 'analytical');
PAGE_RENDER.salespurchaseaggregate = async (root) => renderSalesPurchasesPage(root, 'aggregate');
PAGE_RENDER.salespurchasestats = async (root) => renderSalesPurchasesPage(root, 'stats');
window.runSalesPurchases = async (mode) => {
  const from = gv('sp-from'), to = gv('sp-to');
  const box = document.getElementById('sp-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const { purchases, sales } = await DB.salesPurchasesData(from, to);
    if (mode === 'analytical') {
      const rowsHtml = (label, rows) => `<div class="card-title">${label}</div><div class="itw"><table><thead><tr><th>التاريخ</th><th>المخزن</th><th>المادة</th><th>الكمية</th><th>القيمة</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td>${r.warehouse}</td><td>${r.store_num} — ${r.name}</td><td class="mono">${fmtQty(r.qty)}</td><td class="mono gold-txt">${fmtIQD(r.value)}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد بيانات</td></tr>'}</tbody></table></div>`;
      box.innerHTML = `<div class="card">${rowsHtml('المشتريات (الاستلام)', purchases)}</div><div class="card">${rowsHtml('المبيعات (الإصدار)', sales)}</div>`;
    } else if (mode === 'aggregate') {
      const agg = (rows) => { const m = {}; rows.forEach(r => { m[r.store_num] = m[r.store_num] || { name: r.name, store_num: r.store_num, qty: 0, value: 0 }; m[r.store_num].qty += r.qty; m[r.store_num].value += r.value; }); return Object.values(m).sort((a,b)=>b.value-a.value); };
      const purchAgg = agg(purchases), salesAgg = agg(sales);
      const tbl = (rows) => `<div class="itw"><table><thead><tr><th>الرقم المخزني</th><th>المادة</th><th>إجمالي الكمية</th><th>إجمالي القيمة</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td class="mono">${r.store_num}</td><td>${r.name}</td><td class="mono">${fmtQty(r.qty)}</td><td class="mono gold-txt">${fmtIQD(r.value)}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد بيانات</td></tr>'}</tbody></table></div>`;
      box.innerHTML = `<div class="card"><div class="card-title">إجمالي المشتريات حسب المادة</div>${tbl(purchAgg)}</div><div class="card"><div class="card-title">إجمالي المبيعات حسب المادة</div>${tbl(salesAgg)}</div>`;
    } else {
      const agg = (rows) => { const m = {}; rows.forEach(r => { m[r.store_num] = m[r.store_num] || { name: r.name, store_num: r.store_num, qty: 0, value: 0 }; m[r.store_num].qty += r.qty; m[r.store_num].value += r.value; }); return Object.values(m).sort((a,b)=>b.value-a.value).slice(0, 10); };
      const topSales = agg(sales), topPurch = agg(purchases);
      const tbl = (rows) => `<div class="itw"><table><thead><tr><th>#</th><th>المادة</th><th>الكمية</th><th>القيمة</th></tr></thead>
        <tbody>${rows.map((r,i) => `<tr><td class="mono">${i+1}</td><td>${r.name}</td><td class="mono">${fmtQty(r.qty)}</td><td class="mono gold-txt">${fmtIQD(r.value)}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد بيانات</td></tr>'}</tbody></table></div>`;
      box.innerHTML = `<div class="card"><div class="card-title">🏆 الأكثر مبيعاً (أعلى 10 حسب القيمة)</div>${tbl(topSales)}</div><div class="card"><div class="card-title">🏆 الأكثر شراءً (أعلى 10 حسب القيمة)</div>${tbl(topPurch)}</div>`;
    }
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

// ── كشف الفواتير المستحقة ─────────────────────────────
PAGE_RENDER.duedocs = async (root) => {
  root.innerHTML = `<div class="ph"><div><div class="ph-title">⏰ كشف الفواتير المستحقة</div><div class="ph-sub">أرصدة الزبائن المدينة حتى تاريخ اليوم</div></div></div><div class="ec">جارِ التحميل...</div>`;
  try {
    const rows = await DB.dueCustomerBalances();
    const total = rows.reduce((s, r) => s + r.balance, 0);
    root.innerHTML = `<div class="ph"><div><div class="ph-title">⏰ كشف الفواتير المستحقة</div><div class="ph-sub">أرصدة الزبائن المدينة حتى تاريخ اليوم</div></div></div>
      <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الزبون</th><th>الرصيد المستحق</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.code}</td><td>${r.customer}</td><td class="mono gold-txt">${fmtIQD(r.balance)}</td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد أرصدة مستحقة 🎉</td></tr>'}
      </tbody></table></div><div class="grand-bar"><span class="grand-lbl">إجمالي المستحق</span><span class="grand-val">${fmtIQD(total)}</span></div></div>`;
  } catch (e) { root.innerHTML += `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

// ── كشوفات تفصيلية / اجمالية ─────────────────────────────
PAGE_RENDER.detailedstatements = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📑 كشوفات تفصيلية</div><div class="ph-sub">كل حركات القيود المحاسبية بفترة، سطراً سطراً</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="ds-from" type="date" value="${monthStart()}"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="ds-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runDetailedStatement()">عرض</button></div></div>
    <div id="ds-result"></div>`;
};
window.runDetailedStatement = async () => {
  const from = gv('ds-from'), to = gv('ds-to');
  const box = document.getElementById('ds-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.detailedLedgerAll(from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>التاريخ</th><th>رقم القيد</th><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td class="doc-num">${r.entry_no}</td><td>${r.code} — ${r.name}</td><td>${r.description||''}</td><td class="mono">${r.debit?fmt(r.debit):'—'}</td><td class="mono">${r.credit?fmt(r.credit):'—'}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد قيود بهذه الفترة</td></tr>'}
      </tbody></table></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(rows)}, "كشوفات تفصيلية", "كشوفات_تفصيلية.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

PAGE_RENDER.summarystatements = async (root) => {
  const labels = { asset: 'الأصول', liability: 'الالتزامات', equity: 'حقوق الملكية', revenue: 'الإيرادات', expense: 'المصروفات' };
  const rows = await DB.accountTypeSummary();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📚 كشوفات اجمالية</div><div class="ph-sub">مجاميع مصنّفة حسب نوع الحساب</div></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>نوع الحساب</th><th>مدين</th><th>دائن</th><th>الصافي</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${labels[r.type]||r.type}</td><td class="mono">${fmt(r.debit)}</td><td class="mono">${fmt(r.credit)}</td>
      <td class="mono gold-txt">${fmtIQD(Math.abs(r.debit-r.credit))}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد بيانات</td></tr>'}
    </tbody></table></div></div>`;
};

// ── كشوفات الأصول والموازنة ─────────────────────────────
PAGE_RENDER.assetsbudgetstatements = async (root) => {
  const st = await DB.assetsBudgetStatement();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🏢 كشوفات الأصول والموازنة</div><div class="ph-sub">${st.fy ? 'السنة المالية النشطة: ' + st.fy.year : 'لا توجد سنة مالية نشطة'}</div></div></div>
    <div class="stats">
      <div class="stat"><div class="stat-lbl">عدد الأصول الثابتة</div><div class="stat-val">${fmt(st.assets.length)}</div></div>
      <div class="stat"><div class="stat-lbl">إجمالي تكلفة الأصول</div><div class="stat-val gold">${fmtIQD(st.totalAssetsCost)}</div></div>
      <div class="stat"><div class="stat-lbl">إجمالي الموازنة المخصّصة</div><div class="stat-val">${fmtIQD(st.totalBudget)}</div></div>
    </div>
    <div class="card"><div class="card-title">الأصول الثابتة</div><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>التصنيف</th><th>تاريخ الشراء</th><th>التكلفة</th><th>الحالة</th></tr></thead>
    <tbody>${st.assets.map(a => `<tr><td class="mono">${a.asset_code||''}</td><td>${a.name}</td><td>${a.category||'—'}</td><td class="mono">${a.purchase_date||''}</td><td class="mono gold-txt">${fmtIQD(a.cost)}</td><td>${a.status==='disposed'?'مُستبعَد':'نشط'}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد أصول ثابتة مسجّلة</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="card-title">الموازنة التقديرية للحسابات</div><div class="itw"><table><thead><tr><th>الحساب</th><th>المبلغ المخصَّص</th></tr></thead>
    <tbody>${st.budget.map(b => `<tr><td>${b.chart_of_accounts?.code} — ${b.chart_of_accounts?.name}</td><td class="mono gold-txt">${fmtIQD(b.budgeted_amount)}</td></tr>`).join('') || '<tr><td colspan="2" class="ec">لا توجد موازنة مسجّلة لهذه السنة</td></tr>'}
    </tbody></table></div></div>`;
};

// ── دليل مراكز الكلفة ─────────────────────────────
PAGE_RENDER.costcenters = async (root) => {
  const list = await DB.listCostCenters();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🏷 دليل مراكز الكلفة</div><div class="ph-sub">قائمة مرجعية بمراكز الكلفة (بلا ربط تلقائي بالقيود بعد)</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openCostCenterModal()">+ مركز كلفة جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>ملاحظات</th><th></th></tr></thead>
    <tbody>${list.map(c => `<tr><td class="mono">${c.code}</td><td>${c.name}</td><td>${c.notes||'—'}</td>
      <td>${can('admin','accountant') ? `<button class="btn btn-o btn-sm" onclick='openCostCenterModal(${JSON.stringify(c)})'>تعديل</button>
      <button class="btn btn-d btn-sm" onclick="deactivateCostCenterConfirm('${c.id}')">إلغاء تفعيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد مراكز كلفة بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openCostCenterModal = (c = null) => {
  showModal(c ? 'تعديل مركز كلفة' : 'مركز كلفة جديد', `
    <div class="fgroup"><label>الرمز</label><input id="m-cc-code" value="${c?.code||''}" ${c ? 'disabled' : ''}></div>
    <div class="fgroup"><label>الاسم</label><input id="m-cc-name" value="${c?.name||''}"></div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-cc-notes" value="${c?.notes||''}"></div>
  `, async () => {
    const code = gv('m-cc-code'), name = gv('m-cc-name'), notes = gv('m-cc-notes');
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    try {
      if (c) await DB.updateCostCenter(c.id, { name, notes });
      else await DB.createCostCenter({ code, name, notes });
      toast('تم الحفظ', 's'); go('costcenters');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deactivateCostCenterConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل مركز الكلفة هذا؟')) return;
  try { await DB.deactivateCostCenter(id); toast('تم', 's'); go('costcenters'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
