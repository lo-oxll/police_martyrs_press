// ══════════════════════════════════════════════════════════════════
//  تقارير مستودعية إضافية: كشف تفصيلي للمستودعات، متابعة المشتريات،
//  متابعة المبيعات اليومية، كشف تدفقات المخزون، كشف ايصالات الشحن
// ══════════════════════════════════════════════════════════════════

PAGE_RENDER.whdetailed = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">كشف تفصيلي للمستودعات</div><div class="ph-sub">كل المخازن جنباً لجنب: حركة الفترة وقيمة الرصيد الحالي</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="wd-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="wd-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runWhDetailed()">عرض</button></div></div>
    <div id="wd-result"></div>`;
};
window.runWhDetailed = async () => {
  const from = gv('wd-from'), to = gv('wd-to');
  const box = document.getElementById('wd-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.allWarehousesDetailed(from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>المخزن</th><th>استلام الفترة</th><th>إصدار الفترة</th><th>الصافي</th><th>قيمة الرصيد الحالي</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.code}</td><td>${r.warehouse}</td><td class="mono" style="color:var(--ok)">${fmt(r.totalReceipts)}</td><td class="mono" style="color:var(--danger)">${fmt(r.totalIssues)}</td><td class="mono">${fmt(r.net)}</td><td class="mono gold-txt">${fmtIQD(r.stockValue)}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد مخازن</td></tr>'}
      </tbody></table></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

PAGE_RENDER.purchasetracking = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">متابعة المشتريات</div><div class="ph-sub">فواتير الاستلام مجمّعة حسب المورّد بفترة معيّنة</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="pt-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="pt-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runPurchaseTracking()">عرض</button></div></div>
    <div id="pt-result"></div>`;
};
window.runPurchaseTracking = async () => {
  const from = gv('pt-from'), to = gv('pt-to');
  const box = document.getElementById('pt-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const { rows, bySupplier } = await DB.purchaseTracking(from, to);
    box.innerHTML = `<div class="card"><div class="card-title">إجمالي حسب المورّد</div><div class="itw"><table><thead><tr><th>المورّد</th><th>عدد الفواتير</th><th>الإجمالي</th></tr></thead>
      <tbody>${bySupplier.map(s => `<tr><td>${s.supplier}</td><td class="mono">${s.count}</td><td class="mono gold-txt">${fmtIQD(s.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد مشتريات بهذه الفترة</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-title">كل الفواتير</div><div class="itw"><table><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المخزن</th><th>المورّد</th><th>القيمة</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.doc_date}</td><td class="doc-num">${r.doc_num}</td><td>${r.warehouses?.name||''}</td><td>${r.supplier||'غير محدَّد'}</td><td class="mono">${fmt(r.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد فواتير</td></tr>'}</tbody></table></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(rows.map(r=>({"التاريخ":r.doc_date,"الفاتورة":r.doc_num,"المورد":r.supplier||"","القيمة":r.total})))}, "متابعة المشتريات", "متابعة_المشتريات.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

PAGE_RENDER.salesdailytracking = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">متابعة المبيعات اليومية</div><div class="ph-sub">إجمالي مبيعات كل يوم بفترة معيّنة</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="dst-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="dst-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runDailySales()">عرض</button></div></div>
    <div id="dst-result"></div>`;
};
window.runDailySales = async () => {
  const from = gv('dst-from'), to = gv('dst-to');
  const box = document.getElementById('dst-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.dailySalesTracking(from, to);
    const total = rows.reduce((s,r)=>s+r.total,0);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>اليوم</th><th>عدد الفواتير</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td class="mono">${r.count}</td><td class="mono gold-txt">${fmtIQD(r.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد مبيعات بهذه الفترة</td></tr>'}</tbody></table></div>
      <div class="grand-bar"><span class="grand-lbl">إجمالي الفترة</span><span class="grand-val">${fmtIQD(total)}</span></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

PAGE_RENDER.stockflow = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">كشف تدفقات المخزون</div><div class="ph-sub">إجمالي وارد/صادر يومي عبر كل المخازن مجتمعة، برصيد صافٍ متحرك</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="sf-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="sf-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runStockFlow()">عرض</button></div></div>
    <div id="sf-result"></div>`;
};
window.runStockFlow = async () => {
  const from = gv('sf-from'), to = gv('sf-to');
  const box = document.getElementById('sf-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.stockFlowReport(from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>اليوم</th><th>وارد</th><th>صادر</th><th>الصافي</th><th>الرصيد المتراكم</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td class="mono" style="color:var(--ok)">${fmt(r.in)}</td><td class="mono" style="color:var(--danger)">${fmt(r.out)}</td><td class="mono">${fmt(r.net)}</td><td class="mono gold-txt">${fmtIQD(r.running)}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد حركات بهذه الفترة</td></tr>'}</tbody></table></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};

PAGE_RENDER.shippingreceiptsreport = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">كشف ايصالات الشحن</div><div class="ph-sub">كل عمليات الشحن الواردة/الصادرة المسجَّلة بفترة معيّنة</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="sr-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="sr-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runShippingReport()">عرض</button></div></div>
    <div id="sr-result"></div>`;
};
window.runShippingReport = async () => {
  const from = gv('sr-from'), to = gv('sr-to');
  const box = document.getElementById('sr-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.shippingReceiptsReport(from, to);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الاتجاه</th><th>الناقل</th><th>المركبة</th><th>مرتبط بفاتورة</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="doc-num">${r.doc_num}</td><td class="mono">${r.ship_date}</td><td>${r.direction==='inbound'?'وارد':'صادر'}</td><td>${r.carrier_name||'—'}</td><td class="mono">${r.vehicle_no||'—'}</td><td class="mono">${r.related_doc_num||'—'}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد شحنات بهذه الفترة</td></tr>'}</tbody></table></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};
