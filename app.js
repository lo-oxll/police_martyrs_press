// ══════════════════════════════════════════════════════════════════
//  التطبيق الرئيسي: أدوات مشتركة + التوجيه بين الصفحات + الإقلاع
// ══════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
//  أداة استيراد إكسل ذكية عامة — تُستخدم من أي صفحة (دليل المواد، أرصدة
//  التدوير، اعدادات البرنامج...) لقبول أي تصميم ملف وتحليل عناوين أعمدته
//  تلقائياً بدل اشتراط ترتيب/تسمية أعمدة ثابتة.
// ══════════════════════════════════════════════════════════════════
const XLS_COMMON_ALIASES = {
  store_num: ['store_num','storenum','رقم مخزني','الرقم المخزني','رقم المادة','رقم الصنف','كود','كود المادة','code','sku','item code','رمز','رمز المادة'],
  name: ['name','الاسم','اسم المادة','اسم الصنف','المادة','item name','description','الوصف','التسمية'],
  unit: ['unit','الوحدة','وحدة','uom','وحدة القياس'],
  category: ['category','التصنيف','تصنيف','الصنف','type','فئة','المجموعة','group'],
  min_qty: ['min_qty','minqty','الحد الأدنى','حد ادنى','حد الطلب','نقطة اعادة الطلب','reorder','reorder point','minimum','الحد الادنى للطلب'],
  barcode: ['barcode','باركود','الباركود','رمز الباركود'],
  qty: ['qty','quantity','الكمية','كمية','الكميه','الكمية الافتتاحية','العدد','عدد'],
  unit_price: ['unit_price','price','cost','السعر','سعر الوحدة','سعر','التكلفة','سعر الشراء','سعر الكلفة'],
  value: ['value','القيمة','قيمة','total','amount','المبلغ','الاجمالي','الإجمالي'],
  balance_date: ['date','التاريخ','تاريخ','balance_date','تاريخ الرصيد'],
  notes: ['notes','note','ملاحظات','ملاحظة','الملاحظات','remarks'],
};
const XLS_FIELD_LABELS_ALL = {
  store_num: 'الرقم المخزني', name: 'الاسم', unit: 'الوحدة', category: 'التصنيف', min_qty: 'الحد الأدنى',
  barcode: 'الباركود', qty: 'الكمية', unit_price: 'السعر/التكلفة', value: 'القيمة', balance_date: 'التاريخ',
  notes: 'ملاحظات', __ignore: 'تجاهل هذا العمود',
};
function xlsNormalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\u064B-\u065F]/g, '').replace(/\s+/g, ' ');
}
// fields: مصفوفة أسماء الحقول المطلوبة بهذا الاستيراد تحديداً (مثال: ['store_num','name','unit'])
function xlsAutoDetectMapping(headers, fields) {
  const mapping = {};
  headers.forEach(h => {
    const norm = xlsNormalizeHeader(h);
    let matched = null;
    for (const field of fields) {
      const aliases = XLS_COMMON_ALIASES[field] || [];
      if (aliases.some(a => xlsNormalizeHeader(a) === norm)) { matched = field; break; }
    }
    if (!matched) {
      for (const field of fields) {
        const aliases = XLS_COMMON_ALIASES[field] || [];
        if (aliases.some(a => norm.includes(xlsNormalizeHeader(a)) || xlsNormalizeHeader(a).includes(norm))) { matched = field; break; }
      }
    }
    mapping[h] = matched || '__ignore';
  });
  return mapping;
}
function xlsCssSafeId(s) { return String(s).replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_'); }
// يقرأ أي ملف إكسل/CSV بأي تصميم أعمدة ويرجّع {headers, rows} — لا يرفض أي ملف طالما فيه صف عناوين وصف بيانات واحد على الأقل
async function xlsReadFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) throw new Error('الملف فارغ أو بلا بيانات قابلة للقراءة');
  return { headers: Object.keys(rows[0]), rows };
}
// يبني جدول HTML لمطابقة الأعمدة (عمود الملف + عيّنة قيم + قائمة اختيار الحقل)، معرَّف بـ idPrefix فريد لكل استخدام بنفس الصفحة
function xlsRenderMappingTable(headers, rows, fields, mapping, idPrefix) {
  return `<div class="itw"><table><thead><tr><th>عمود الملف</th><th>عيّنة من القيم</th><th>يُستخدم كـ</th></tr></thead>
    <tbody>${headers.map(h => {
      const sample = rows.slice(0, 3).map(r => r[h]).filter(v => v !== '').join('، ');
      const options = [...fields, '__ignore'];
      return `<tr><td class="mono">${h}</td><td class="ph-sub">${sample || '—'}</td>
      <td><select id="${idPrefix}-${xlsCssSafeId(h)}" data-header="${h.replace(/"/g,'&quot;')}">
        ${options.map(val => `<option value="${val}" ${mapping[h]===val?'selected':''}>${XLS_FIELD_LABELS_ALL[val]||val}</option>`).join('')}
      </select></td></tr>`;
    }).join('')}</tbody></table></div>`;
}
// يقرأ المطابقة النهائية التي اختارها/عدّلها المستخدم من القوائم المنسدلة، يرجّع { field: headerName }
function xlsReadMapping(headers, idPrefix) {
  const headerByField = {};
  headers.forEach(h => {
    const sel = document.getElementById(idPrefix + '-' + xlsCssSafeId(h));
    if (sel && sel.value !== '__ignore') headerByField[sel.value] = h;
  });
  return headerByField;
}
window.xlsReadFile = xlsReadFile;
window.xlsAutoDetectMapping = xlsAutoDetectMapping;
window.xlsRenderMappingTable = xlsRenderMappingTable;
window.xlsReadMapping = xlsReadMapping;
window.xlsCssSafeId = xlsCssSafeId;

const gv = id => (document.getElementById(id)?.value ?? '').trim();
const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
// المبالغ بالدينار العراقي — بدون فاصلة عشرية (لا يوجد تعامل عملي بكسور الدينار)
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const fmtIQD = n => fmt(n) + ' ' + (window.__currencyLabel || 'د.ع');
const fmtQty = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const todayISO = () => new Date().toISOString().split('T')[0];

let ME = null; // ملف تعريف المستخدم الحالي (profiles row)

function toast(msg, kind = 'i') {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast t' + kind;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
window.toast = toast;

// ── تصدير إكسل عام (تُستخدم بكل صفحات التقارير وسجل الوثائق) ──────────────────────────────
function exportRowsToExcel(rows, sheetName, filename) {
  if (!rows || !rows.length) { toast('لا توجد بيانات لتصديرها', 'e'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const colWidths = Object.keys(rows[0]).map(k => ({ wch: Math.max(10, Math.min(34, k.length + 4)) }));
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}
window.exportRowsToExcel = exportRowsToExcel;

// ── ترجمة أخطاء قيود قاعدة البيانات الشائعة لرسائل عربية مفهومة ──────────────────────────────
function friendlyStockError(msg) {
  if (!msg) return 'حدث خطأ غير متوقع';
  if (msg.includes('material_stock_qty_nonneg') || msg.toLowerCase().includes('check constraint') && msg.includes('qty_on_hand')) {
    return 'تعذّر تنفيذ العملية: الكمية المطلوبة تتجاوز الرصيد الفعلي المتاح بهذا المخزن (رُفضت من قاعدة البيانات لمنع رصيد سالب — قد تكون هذه المادة صُرفت للتو بعملية أخرى متزامنة، حدّث الصفحة وحاول مجدداً)';
  }
  return msg;
}
window.friendlyStockError = friendlyStockError;

// ── صلاحيات حسب الدور ──────────────────────────────
const ROLE_LABEL = { admin: 'مدير النظام', accountant: 'محاسب', manager: 'مدير', auditor: 'مدقق' };
function can(...roles) { return ME && roles.includes(ME.role); }
window.can = can;
// ── صلاحيات مفصّلة لكل مستخدم (تجاوز فوق الدور) ──────────────────────────────
let USER_PERM_OVERRIDES = {}; // { permKey: true/false } — لهذا المستخدم فقط، مُحمَّلة عند boot()
// أدق من can(): يفحص تخصيص المستخدم الصريح أولاً، وإلا يرجع لدوره — ومستخدم بلا دور يُمنع من كل شيء
function canDo(permKey, ...fallbackRoles) {
  if (!ME) return false;
  if (Object.prototype.hasOwnProperty.call(USER_PERM_OVERRIDES, permKey)) return USER_PERM_OVERRIDES[permKey];
  if (!ME.role) return false;
  return fallbackRoles.length ? fallbackRoles.includes(ME.role) : false;
}
window.canDo = canDo;
// يبني مفاتيح الصلاحيات القياسية الأربعة لأي صفحة
function pagePermKeys(pageId) {
  return { view: `page:${pageId}`, create: `${pageId}:create`, edit: `${pageId}:edit`, delete: `${pageId}:delete` };
}
window.pagePermKeys = pagePermKeys;
// صلاحية الخزينة والرواتب والسلفة المستديمة: مدير النظام دائماً، أو محاسب مُفعَّل له can_treasury تحديداً
function canTreasury() { return ME && (ME.role === 'admin' || (ME.role === 'accountant' && ME.can_treasury)); }
window.canTreasury = canTreasury;
// تقييد قائمة المخازن حسب نطاق المحاسب (warehouse_ids) ونطاق الفرع (branch_ids) — أي منهما NULL/فارغ = بدون تقييد بذلك البعد
function scopedWarehouses(all) {
  let list = all;
  if (ME && ME.role === 'accountant' && ME.warehouse_ids && ME.warehouse_ids.length) {
    list = list.filter(w => ME.warehouse_ids.includes(w.id));
  }
  if (ME && ME.branch_ids && ME.branch_ids.length) {
    list = list.filter(w => !w.branch_id || ME.branch_ids.includes(w.branch_id));
  }
  return list;
}
window.scopedWarehouses = scopedWarehouses;
// تقييد قائمة الفروع الظاهرة للمستخدم حسب branch_ids (بدون تحديد = كل الفروع)
function scopedBranches(all) {
  if (!ME || !ME.branch_ids || !ME.branch_ids.length) return all;
  return all.filter(b => ME.branch_ids.includes(b.id));
}
window.scopedBranches = scopedBranches;

// ══════════════════════════════════════════════════════════════════
//  القائمة العلوية (Mega Menu) — المرحلة ١: هيكل تنقّل كامل
//  كل عنصر: { id, label, page? , action? }. page = معرّف صفحة مسجّلة أو
//  ستُنشأ تلقائياً كصفحة "قيد الإنشاء" إن لم توجد. action = دالة تُنفَّذ مباشرة (بدون تنقّل).
// ══════════════════════════════════════════════════════════════════
const TOPMENU = [
  { id: 'cards', label: 'فتح بطاقات', icon: '🗂', items: [
    { label: 'فتح وتعديل بطاقة حساب', page: 'coa' },
    { label: 'فتح وتعديل بطاقة صنف رئيسي', page: 'matcategory' },
    { label: 'فتح وتعديل بطاقة زبون', page: 'customers' },
    { label: 'فتح وتعديل بطاقة مادة', page: 'materials' },
    { label: 'فتح وتعديل بطاقة مستودع', page: 'warehouses' },
    { label: 'توليد بطاقات مواد بشكل جماعي', page: 'materialbulkgen' },
    { label: 'فتح وتعديل بطاقة تشابه مواد', page: 'materialsimilar' },
    { label: 'فتح وتعديل بطاقة عملة', page: 'currencies' },
    { label: 'فتح وتعديل بطاقة مشروع', page: 'projects' },
    { label: 'تعريف المناطق والشوارع', page: 'regions' },
    { label: 'ادخال وتعديل بطاقة فرع', page: 'branches' },
  ]},
  { id: 'acctmove', label: 'ادخال الحركات المحاسبية', icon: '🧾', items: [
    { label: 'القيود المحاسبية', page: 'journal' },
    { label: 'إيصالات القبض', page: 'receiptsvouchers' },
    { label: 'أمر قبض', page: 'receiptorders' },
    { label: 'أمر صرف', page: 'paymentreceiptorders' },
    { label: 'سندات الديون', page: 'debtnotes' },
    { label: 'الموازنة التقديرية', page: 'budget' },
  ]},
  { id: 'acctreports', label: 'تقارير محاسبة', icon: '📈', items: [
    { label: 'كشف الحساب', page: 'accountstatement' },
    { label: 'كشوفات تفصيلية', page: 'detailedstatements' },
    { label: 'كشوفات اجمالية', page: 'summarystatements' },
    { label: 'تقارير سندات الديون', page: 'debtnotereports' },
    { label: 'دليل الحسابات', page: 'coa' },
    { label: 'دليل مراكز الكلفة', page: 'costcenters' },
    { label: 'كشوفات الأصول والموازنة', page: 'assetsbudgetstatements' },
    { label: 'كشوفات ختامية', page: 'reports' },
  ]},
  { id: 'matmove', label: 'ادخال حركة المواد', icon: '📦', items: [
    { label: 'ادخال فواتير', page: 'receive' },
    { label: 'طلبيات البيع والشراء', page: 'salespurchaseorders' },
    { label: 'المناقلات بين المستودعات', page: 'transfer' },
    { label: 'فواتير الجرد', page: 'physcount' },
    { label: 'اخراج فواتير', page: 'issue' },
    { label: 'يومية مبيعات', page: 'salesjournal' },
    { label: 'ادخال وتعديل ايصالات الشحن', page: 'shippingreceipts' },
  ]},
  { id: 'whreports', label: 'تقارير مستودعية', icon: '📊', items: [
    { label: 'كشف الفواتير', page: 'docs' },
    { label: 'كشف حركة مادة', page: 'materialmovement' },
    { label: 'جرد مستودع', page: 'balance' },
    { label: 'كشف اجمالى لمستودع', page: 'warehousesummary' },
    { label: 'جرد مستودع بالأرقام التسلسلية', page: 'serialcount' },
    { label: 'كشف يومية مستودع', page: 'whdaily' },
    { label: 'ملخص الحركة المستودعية', page: 'whmovementsummary' },
    { label: 'كشف يومية مستودع موسع', page: 'whdailyext' },
    { label: 'كشف تحليلي للمبيعات والمشتريات', page: 'salespurchaseanalytical' },
    { label: 'كشف تجميعي للمبيعات والمشتريات', page: 'salespurchaseaggregate' },
    { label: 'كشف احصائي للمبيعات والمشتريات', page: 'salespurchasestats' },
    { label: 'كشف تفصيلي للمستودعات', page: 'whdetailed' },
    { label: 'كشف ايصالات الشحن', page: 'shippingreceiptsreport' },
    { label: 'دليل المواد', page: 'materials' },
    { label: 'الاستعلام عن مادة', page: 'materialinquiry' },
    { label: 'الاستعلام عن باركود', page: 'barcodeinquiry' },
    { label: 'كشف الفواتير المستحقة', page: 'duedocs' },
    { label: 'متابعة المشتريات', page: 'purchasetracking' },
    { label: 'ملخص يومية المندوبين', page: 'repsdailysummary' },
    { label: 'متابعة المبيعات اليومية', page: 'salesdailytracking' },
    { label: 'كشف توفر المواد حسب الصلاحية', page: 'expiryavailability' },
    { label: 'كشف تدفقات المخزون', page: 'stockflow' },
    { label: 'كشف المتجر', page: 'storestatement' },
    { label: 'كشف يومية المطعم', page: 'restaurantdaily' },
  ]},
  { id: 'attachments', label: 'الملحقات', icon: '📎', items: [
    { label: 'العقود', page: 'contracts' },
    { label: 'الأرشيف', page: 'archive' },
    { label: 'الأعمال والمهام', page: 'tasks' },
    { label: 'التأجير', page: 'rental' },
  ]},
  { id: 'manufacturing', label: 'التصنيع', icon: '🏭', items: [
    { label: 'ادخال وتعديل نموذج تصنيع', page: 'mfgmodel' },
    { label: 'ادخال وتعديل طلبية تصنيع', page: 'mfgorder' },
    { label: 'ادخال وتعديل عملية تصنيع', page: 'mfgprocess' },
    { label: 'توزيع نفقات غير مباشرة', page: 'indirectexpenses' },
    { label: 'كشف التصنيع واحتياجاته', page: 'mfgreport' },
    { label: 'كشف انحراف التصنيع', page: 'mfgdeviation' },
    { label: 'جرد المواد والمكونات', page: 'mfgcomponentscount' },
  ]},
  { id: 'services', label: 'خدمات', icon: '🛎', items: [
    { label: 'آلة حاسبة', action: 'openCalculator' },
    { label: 'الرقابة', page: 'auditlog' },
    { label: 'البريد الداخلي', page: 'internalmail' },
    { label: 'أرشفة الوثائق', page: 'docarchiving' },
    { label: 'صيانة الملفات', page: 'filemaintenance' },
    { label: 'تصميم وطباعة الباركود', page: 'barcodedesign' },
    { label: 'نسخ بيانات من والى فرع شركة آخر', page: 'branchsync' },
    { label: 'خدمات متفرقة', page: 'miscservices' },
    { label: 'خدمات المزامنة', page: 'syncservices' },
    { label: 'تنفيذ أوامر SQL Server', page: 'sqlserverexec' },
    { label: 'الاستيراد من اكسل', page: 'excelimport' },
    { label: 'English', action: 'toggleLanguage' },
    { label: 'حول البرنامج', page: 'about' },
    { label: 'تحديث الاتصال بالشبكة', page: 'networksettings' },
  ]},
  { id: 'settings', label: 'اعدادات البرنامج', icon: '⚙️', items: [
    { label: 'تصميم ثوابت عامة', page: 'designconstants' },
    { label: 'تصميم اعدادات الفواتير', page: 'designinvoicesettings' },
    { label: 'تصميم كشوفات الفواتير', page: 'designinvoicestatements' },
    { label: 'تصميم مصطلحات البرنامج', page: 'designterminology' },
    { label: 'تصميم طباعة إيصالات القبض والدفع', page: 'designreceiptprint' },
    { label: 'تصميم طباعة سندات الديون', page: 'designdebtnoteprint' },
    { label: 'تصميم طباعة بطاقات الأرشيف', page: 'designarchivecardprint' },
    { label: 'تعريف الألوان والقياسات', page: 'colorsizes' },
    { label: 'تعريف ماركات المواد', page: 'materialbrands' },
    { label: 'تصميم ملاحظات بنود الفواتير', page: 'designinvoiceitemnotes' },
    { label: 'ادخال وتعديل اسم الشركة', page: 'companyname' },
    { label: 'تصميم الصلاحيات الأمنية', page: 'designsecurityroles' },
    { label: 'تصميم سطح المكتب', page: 'designdesktop' },
    { label: 'توزيع الأرباح', page: 'profitdistribution' },
    { label: 'تدوير الميزانية', page: 'budgetrollover' },
    { label: 'تصميم القوائم المالية', page: 'designfinancialstatements' },
    { label: 'بطاقة قالب افتراضي', page: 'defaulttemplatecard' },
    { label: 'مولد التقارير والخدمات', page: 'reportgenerator' },
    { label: 'اعدادات نسبة المندوب', page: 'repcommissionsettings' },
    { label: 'تصميم العروض', page: 'designoffers' },
    { label: 'خطة مسار المندوب', page: 'reprouteplan' },
    { label: 'اعدادات المتجر', page: 'storesettings' },
    { label: 'اعدادات مستخدمي الجوال', page: 'mobileusersettings' },
    { label: 'تعريف بطاقات الخصم', page: 'discountcards' },
    { label: 'تطبيق المدير', page: 'managerapp' },
    { label: 'أوقات عمل المواعيد', page: 'appointmenthours' },
  ]},
  { id: 'exit', label: 'خروج', icon: '🚪', action: 'doLogout' },
];
window.TOPMENU = TOPMENU;

// ── تعريف الصفحات والقائمة الجانبية ──────────────────────────────
const PAGES = [
  { section: 'عام', items: [
    { id: 'dashboard', label: 'لوحة التحكم', icon: '📊' },
  ]},
  { section: 'الحركة اليومية', items: [
    { id: 'receive', label: 'ادخال فواتير', icon: '📥', roles: ['admin','accountant'] },
    { id: 'issue', label: 'اخراج فواتير', icon: '📤', roles: ['admin','accountant'] },
    { id: 'whdaily', label: 'كشف يومية مستودع', icon: '🗓' },
    { id: 'balance', label: 'جرد مستودع', icon: '⚖️' },
    { id: 'materials', label: 'دليل المواد', icon: '📚', roles: ['admin','accountant'] },
    { id: 'docs', label: 'كشف الحركة اليومية', icon: '📑' },
    { id: 'warehouses', label: 'المخازن', icon: '🏬', roles: ['admin'] },
    { id: 'suppliers', label: 'دليل الموردين', icon: '🏪', roles: ['admin','accountant'] },
    { id: 'lowstock', label: 'تنبيهات إعادة الطلب', icon: '🔔' },
    { id: 'physcount', label: 'الجرد الدوري', icon: '🧮', roles: ['admin','accountant','manager'] },
    { id: 'cashbox', label: 'ادخال وتعديل يومية صندوق', icon: '💰', roles: ['admin','accountant'], check: canTreasury },
    { id: 'receiptsvouchers', label: 'ادخال وتعديل إيصال قبض', icon: '🧾', roles: ['admin','accountant'] },
    { id: 'accountstatement', label: 'كشف الحساب', icon: '📄' },
    { id: 'journal', label: 'ادخال وتعديل سند قيد مركب', icon: '🧮' },
    { id: 'coabalances', label: 'كشف أرصدة حسابات', icon: '📋' },
    { id: 'paymentreceiptorders', label: 'ادخال وتعديل أمر صرف', icon: '📤', roles: ['admin','accountant'] },
    { id: 'receiptorders', label: 'ادخال وتعديل أمر قبض', icon: '📥', roles: ['admin','accountant'] },
    { id: 'materialinquiry', label: 'الاستعلام عن مادة', icon: '🔎' },
    { id: 'fixedassets', label: 'الأصول الثابتة', icon: '🏢', roles: ['admin','accountant','manager','auditor'] },
    { id: 'employees', label: 'الموظفون', icon: '🪪', roles: ['admin','accountant'], check: canTreasury },
    { id: 'loans', label: 'سلف الموظفين', icon: '💳', roles: ['admin','accountant'], check: canTreasury },
    { id: 'payroll', label: 'الرواتب', icon: '🧑‍💼', roles: ['admin','accountant'], check: canTreasury },
    { id: 'pettycash', label: 'سندات الصرف (السلفة المستديمة)', icon: '🧾', roles: ['admin','manager','auditor','accountant'] },
    { id: 'pettycashfund', label: 'قائمة السلفة المستديمة', icon: '📒', roles: ['admin','manager','auditor','accountant'] },
    { id: 'fiscal', label: 'السنوات المالية', icon: '📅', roles: ['admin','manager'] },
    { id: 'users', label: 'المستخدمون والصلاحيات', icon: '👤', roles: ['admin','manager'] },
    { id: 'auditlog', label: 'سجل المراجعة', icon: '🔐', roles: ['admin','manager'] },
    { id: 'loginsessions', label: 'سجل جلسات الدخول', icon: '🔑', roles: ['admin','manager'] },
    { id: 'backuprestore', label: 'النسخ الاحتياطي والاستعادة', icon: '💾', roles: ['admin'] },
  ]},
];

// ── الصلاحيات الأمنية: تجاوز اختياري فوق الأدوار الافتراضية المبرمجة بكل صفحة ──────────────────────────────
let PAGE_PERM_OVERRIDES = {}; // { 'pageId|role': true/false }
function pageAllowedForRole(pageId, defaultRoles) {
  if (!ME) return false;
  const userKey = `page:${pageId}`;
  if (Object.prototype.hasOwnProperty.call(USER_PERM_OVERRIDES, userKey)) return USER_PERM_OVERRIDES[userKey];
  const key = pageId + '|' + ME.role;
  if (Object.prototype.hasOwnProperty.call(PAGE_PERM_OVERRIDES, key)) return PAGE_PERM_OVERRIDES[key];
  if (!ME.role) return false;
  return !defaultRoles || can(...defaultRoles);
}
window.pageAllowedForRole = pageAllowedForRole;

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = PAGES.map(sec => {
    const items = sec.items.filter(it => pageAllowedForRole(it.id, it.roles) && (!it.check || it.check()));
    if (!items.length) return '';
    return `<div class="nav-section">${sec.section}</div>` + items.map(it =>
      `<div class="nav-item" data-page="${it.id}" onclick="go('${it.id}')">
         <span class="nav-icon">${it.icon}</span><span>${it.label}</span>
         <span class="badge hidden" id="badge-${it.id}"></span>
       </div>`).join('');
  }).join('');

  document.getElementById('user-name').textContent = ME.full_name;
  document.getElementById('user-role').textContent = ROLE_LABEL[ME.role] || ME.role;
  document.getElementById('user-avatar').textContent = (ME.full_name || '?').trim()[0]?.toUpperCase() || '?';
}

// ── القائمة العلوية: رسم + تفاعل ──────────────────────────────
// كل قسم بالقائمة العلوية (غير الأقسام ذات "action" المباشر) لا يفتح قائمة منسدلة منفصلة؛
// بل ينتقل لصفحة رئيسية خاصة بالقسم تُعرض ضمن نفس مساحة المحتوى (page-root)، فتبقى متصلة
// بالقائمة الرئيسية وليست منفصلة عنها كنافذة عائمة.
function renderTopMenu() {
  const bar = document.getElementById('topmenu-bar');
  if (!bar) return;
  bar.innerHTML = TOPMENU.map(cat => {
    if (cat.action) {
      return `<div class="tm-cat tm-leaf" onclick="runTopAction('${cat.action}')"><span class="tm-icon">${cat.icon || ''}</span>${cat.label}</div>`;
    }
    return `<div class="tm-cat" data-cat="${cat.id}" onclick="go('${cat.id}')">
      <span class="tm-icon">${cat.icon || ''}</span>${cat.label}
    </div>`;
  }).join('');
}

// تحديث تمييز القسم النشط بالشريط العلوي كلما انتقلنا لصفحة (صفحة القسم نفسها، أو أي صفحة فرعية تابعة له)
function highlightTopMenu(pageId) {
  const bar = document.getElementById('topmenu-bar');
  if (!bar) return;
  const owner = TOPMENU.find(c => c.id === pageId) || TOPMENU.find(c => (c.items || []).some(it => it.page === pageId));
  bar.querySelectorAll('.tm-cat').forEach(el => el.classList.toggle('active', !!owner && el.dataset.cat === owner.id));
}

// صفحة رئيسية لكل قسم من أقسام القائمة العلوية — تعرض عناصره كبطاقات ضمن نفس الصفحة
function registerTopMenuHomePages() {
  TOPMENU.forEach(cat => {
    if (cat.action || PAGE_RENDER[cat.id]) return; // الأقسام ذات إجراء مباشر، أو معرّف مستخدم مسبقاً، تُستثنى
    PAGE_RENDER[cat.id] = async (root) => {
      root.innerHTML = `<div class="ph"><div><div class="ph-title">${cat.icon || ''} ${cat.label}</div>
        <div class="ph-sub">اختر أحد العناصر التالية</div></div></div>
        <div class="tile-grid">
          ${cat.items.map(it => it.action
            ? `<div class="tile" onclick="runTopAction('${it.action}')"><div class="tile-lbl">${it.label}</div></div>`
            : `<div class="tile" onclick="go('${it.page}')"><div class="tile-lbl">${it.label}</div></div>`
          ).join('')}
        </div>`;
    };
  });
}

window.runTopAction = function runTopAction(action) {
  document.querySelectorAll('.tm-cat').forEach(c => c.classList.remove('open'));
  if (typeof window[action] === 'function') window[action]();
  else toast('هذا الإجراء غير متاح بعد', 'e');
};

window.openCalculator = function openCalculator() {
  if (document.getElementById('calc-modal')) return;
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'calc-modal';
  bg.innerHTML = `<div class="modal" style="width:290px">
    <div class="card-title">آلة حاسبة</div>
    <input id="calc-screen" readonly style="text-align:left;font-family:var(--font-mono);font-size:20px;margin-bottom:10px" value="0">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
      ${['7','8','9','÷','4','5','6','×','1','2','3','-','0','.','=','+'].map(k =>
        `<button class="btn btn-o" onclick="calcPress('${k}')" style="padding:12px 0">${k}</button>`).join('')}
      <button class="btn btn-d" style="grid-column:span 4" onclick="calcPress('C')">مسح</button>
    </div>
    <div class="form-foot"><button class="btn btn-o" onclick="document.getElementById('calc-modal').remove()">إغلاق</button></div>
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.remove(); });
};
let calcBuf = '';
window.calcPress = function calcPress(k) {
  const scr = document.getElementById('calc-screen');
  if (k === 'C') { calcBuf = ''; scr.value = '0'; return; }
  if (k === '=') {
    try {
      const expr = calcBuf.replace(/×/g, '*').replace(/÷/g, '/');
      // eslint-disable-next-line no-new-func
      const r = Function('"use strict";return (' + expr + ')')();
      scr.value = String(r); calcBuf = String(r);
    } catch { scr.value = 'خطأ'; calcBuf = ''; }
    return;
  }
  calcBuf += k; scr.value = calcBuf;
};

window.toggleLanguage = function toggleLanguage() {
  toast('دعم تعدد اللغات (English) ضمن مرحلة قادمة — الواجهة حالياً عربية بالكامل', 'i');
};

const PAGE_RENDER = {}; // كل وحدة (inventory.js, accounting.js ...) تسجّل رواسم صفحاتها هنا
window.PAGE_RENDER = PAGE_RENDER;

// صفحة "حول البرنامج" — حقيقية وثابتة (وليست قيد إنشاء)
PAGE_RENDER.about = async (root) => {
  root.innerHTML = `<div class="ph"><div class="ph-title">حول البرنامج</div></div>
    <div class="card" style="text-align:center;padding:40px">
      <div class="seal" style="margin:0 auto 14px">🏛</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:6px">${window.APP_CONFIG?.APP_NAME || 'نظام السيطرة المخزنية والمحاسبية'}</div>
      <div style="color:var(--ink3);font-size:12.5px">نظام ويب لإدارة المخزون والمحاسبة والخزينة والسلفة المستديمة، مبني على Supabase.</div>
    </div>`;
};

// "تنفيذ أوامر SQL Server" غير قابلة للتطبيق على هذا النظام (Supabase/Postgres وليس SQL Server)،
// ولن تُبنى كأداة تنفيذ SQL حر من المتصفح لأسباب أمنية — يُشرح هذا صراحةً بدل ترك زر وهمي أو "قيد الإنشاء" مضلِّل.
PAGE_RENDER.sqlserverexec = async (root) => {
  root.innerHTML = `<div class="ph"><div class="ph-title">تنفيذ أوامر SQL Server</div></div>
    <div class="card"><div class="ec">⛔ هذه الميزة غير متاحة على هذا النظام لسببين:<br><br>
      <span style="font-size:12.5px">١) قاعدة بيانات هذا النظام Supabase/PostgreSQL وليست SQL Server.<br>
      ٢) السماح بتنفيذ أوامر SQL حرة من المتصفح ثغرة أمنية خطيرة (حتى لو كانت محدودة لمدير النظام) — لن تُبنى بهذا الشكل.</span><br><br>
      <span style="font-size:12.5px">لو احتجت تنفيذ استعلام أو تعديل بقاعدة البيانات، استخدم SQL Editor مباشرة من لوحة Supabase.</span>
    </div></div>`;
};

// ── مولّد صفحات "قيد الإنشاء" آلياً لأي معرّف صفحة مذكور بالقوائم وليس له راسم مسجَّل بعد ──
// أسباب محدَّدة لكل صفحة ما زالت غير مبنية — بدل رسالة عامة واحدة لكل شي، كل صفحة تشرح
// وضعها الفعلي بالضبط (مؤجَّلة بقرار صريح، تحتاج مفهوماً غير موجود بعد، أو تتداخل مع ميزة قائمة).
const STUB_REASONS = {
  currencies: 'مؤجَّلة بقرارك — النظام حالياً دينار عراقي واحد بدون تعدد عملات.',
  serialcount: 'يحتاج جدول تتبّع أرقام تسلسلية جديد + تعديل شاشتي الاستلام والإصدار لتسجيل كل رقم تسلسلي — لم يُبنَ بعد.',
  expiryavailability: 'يحتاج حقل تاريخ انتهاء صلاحية على دفعات المخزون (المخزون حالياً بلا تتبّع دفعات/تواريخ) — لم يُبنَ بعد.',
  storestatement: 'يحتاج نظام نقطة بيع (POS) كامل — لم يُبنَ بعد.',
  restaurantdaily: 'يحتاج نظام نقطة بيع (POS) مخصَّص للمطاعم — لم يُبنَ بعد.',
  branchsync: 'يحتاج فصل بيانات فعلي وصارم بين الفروع أولاً (النسخ الحالي للفروع تطبيقي لا صارم) — لم يُبنَ بعد.',
  miscservices: 'نطاق غير محدَّد — أخبرني شنو تقصد بالضبط لأبنيها.',
  reprouteplan: 'يحتاج بيانات مواقع/مسارات ميدانية فعلية للمندوبين غير موجودة بالنظام حالياً — لم يُبنَ بعد.',
  designinvoicestatements: 'مُغطاة أصلاً — طباعة فواتير الاستلام/الإصدار الفعلية شغّالة من صفحتي "ادخال/اخراج فواتير" مباشرة.',
  designfinancialstatements: 'مُغطاة أصلاً — القوائم المالية (ميزانية عمومية، أرباح وخسائر، ميزان مراجعة) شغّالة من "التقارير المالية" بقائمة المحاسبة.',
  designoffers: 'يتداخل مع "تعريف بطاقات الخصم" الموجودة أصلاً (خصم % بفترة صلاحية) — إذا تحتاج شي إضافي (عروض تجميعية "اشترِ واحصل"، مثلاً)، وضّح لي بالضبط لأبنيه.',
};
function registerStubPages() {
  const allPageIds = new Set();
  PAGES.forEach(sec => sec.items.forEach(it => allPageIds.add(it.id)));
  TOPMENU.forEach(cat => (cat.items || []).forEach(it => { if (it.page) allPageIds.add(it.page); }));
  allPageIds.forEach(id => {
    if (PAGE_RENDER[id]) return;
    PAGE_RENDER[id] = async (root) => {
      const label = findLabel(id);
      const reason = STUB_REASONS[id] || 'لم تُبنَ بعد ضمن مراحل التطوير الحالية.';
      root.innerHTML = `<div class="ph"><div class="ph-title">${label}</div></div>
        <div class="card"><div class="ec">${reason}</div></div>`;
    };
  });
}
function findLabel(id) {
  for (const sec of PAGES) { const it = sec.items.find(x => x.id === id); if (it) return it.label; }
  for (const cat of TOPMENU) { const it = (cat.items || []).find(x => x.page === id); if (it) return it.label; }
  return id;
}

async function go(pageId) {
  if (!PAGE_RENDER[pageId]) return;
  window.__currentPageId = pageId;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === pageId));
  highlightTopMenu(pageId);
  const main = document.getElementById('page-root');
  main.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    await PAGE_RENDER[pageId](main);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card"><div class="ec">⚠️ حدث خطأ أثناء تحميل الصفحة<br><span class="mono" style="color:var(--danger)">${err.message || err}</span></div></div>`;
  }
  document.getElementById('sidebar')?.classList.remove('open');
  await refreshBadges();
}
window.go = go;

async function refreshBadges() {
  refreshNotifPanel();
  try {
    const low = await DB.lowStock();
    const b = document.getElementById('badge-lowstock');
    if (b) { b.textContent = low.length; b.classList.toggle('hidden', low.length === 0); }
  } catch (e) { /* صامت */ }
  if (can('admin','manager')) {
    try {
      const pending = await DB.listPendingUsers();
      const bu = document.getElementById('badge-users');
      if (bu) { bu.textContent = pending.length; bu.classList.toggle('hidden', pending.length === 0); }
    } catch (e) { /* صامت */ }
  }
  if (can('admin')) {
    try {
      const pendingEntries = await DB.listPendingEntries('pending');
      const ba = document.getElementById('badge-approvals');
      if (ba) { ba.textContent = pendingEntries.length; ba.classList.toggle('hidden', pendingEntries.length === 0); }
    } catch (e) { /* صامت */ }
  }
}

// ── مربعات بحث ذاتية الإكمال عامة (تُستخدم لاختيار المواد) ──────────────────────
function bindAutocomplete(inputEl, portalEl, getItems, onPick, renderItem) {
  let items = [], hi = 0;
  const run = async () => {
    items = await getItems(inputEl.value.trim());
    if (!items.length) { portalEl.style.display = 'none'; return; }
    hi = 0;
    portalEl.innerHTML = items.map((it, i) => renderItem(it, i === 0)).join('');
    portalEl.style.display = 'block';
    portalEl.querySelectorAll('.ac-item').forEach((el, i) => el.addEventListener('mousedown', () => { onPick(items[i]); portalEl.style.display = 'none'; }));
  };
  inputEl.addEventListener('input', run);
  inputEl.addEventListener('focus', run);
  inputEl.addEventListener('keydown', e => {
    if (!items.length || portalEl.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hi + 1, items.length - 1); highlight(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(hi - 1, 0); highlight(); }
    if (e.key === 'Enter') { e.preventDefault(); onPick(items[hi]); portalEl.style.display = 'none'; }
    if (e.key === 'Escape') portalEl.style.display = 'none';
  });
  document.addEventListener('mousedown', e => { if (!portalEl.contains(e.target) && e.target !== inputEl) portalEl.style.display = 'none'; });
  function highlight() { portalEl.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('hi', i === hi)); }
}
window.bindAutocomplete = bindAutocomplete;

// ── الثيم (فاتح/داكن) ──────────────────────────────
window.toggleTheme = () => {
  document.documentElement.classList.toggle('light');
  localStorage.setItem('wh-theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
};

// ── مركز التنبيهات الموحَّد ──────────────────────────────
async function refreshNotifPanel() {
  try {
    const items = await DB.unifiedNotifications();
    const countEl = document.getElementById('notif-count');
    if (countEl) { countEl.textContent = items.length; countEl.classList.toggle('hidden', items.length === 0); }
    const panel = document.getElementById('notif-panel');
    if (panel) {
      panel.innerHTML = items.length
        ? items.map(it => `<div class="notif-item" onclick="go('${it.page}');document.getElementById('notif-panel').classList.add('hidden')">${it.type==='danger'?'🔴':it.type==='warning'?'🟡':'🔵'} ${it.label}</div>`).join('')
        : '<div class="notif-empty">لا توجد تنبيهات حالياً 🎉</div>';
    }
  } catch (e) { /* صامت */ }
}
window.toggleNotifPanel = () => {
  const panel = document.getElementById('notif-panel');
  panel.classList.toggle('hidden');
  document.getElementById('gsearch-results')?.classList.add('hidden');
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.notif-wrap')) document.getElementById('notif-panel')?.classList.add('hidden');
  if (!e.target.closest('.gsearch-wrap')) document.getElementById('gsearch-results')?.classList.add('hidden');
});

// ── البحث الشامل ──────────────────────────────
function initGlobalSearch() {
  const input = document.getElementById('gsearch-input');
  const box = document.getElementById('gsearch-results');
  if (!input) return;
  input.addEventListener('input', debounce(async () => {
    const term = input.value.trim();
    if (term.length < 2) { box.classList.add('hidden'); return; }
    const res = await DB.globalSearch(term);
    const groups = [
      { key: 'materials', label: 'المواد', render: m => `<div class="gsearch-item" onclick="go('materials');document.getElementById('gsearch-results').classList.add('hidden')">${m.store_num} — ${m.name}</div>` },
      { key: 'customers', label: 'الزبائن', render: c => `<div class="gsearch-item" onclick="go('customers');document.getElementById('gsearch-results').classList.add('hidden')">${c.code} — ${c.name}</div>` },
      { key: 'receipts', label: 'فواتير الاستلام', render: r => `<div class="gsearch-item" onclick="go('docs');document.getElementById('gsearch-results').classList.add('hidden')"><b>${r.doc_num}</b><small>${r.doc_date} — ${fmtIQD(r.total)}</small></div>` },
      { key: 'issues', label: 'فواتير الإصدار', render: r => `<div class="gsearch-item" onclick="go('docs');document.getElementById('gsearch-results').classList.add('hidden')"><b>${r.doc_num}</b><small>${r.doc_date} — ${fmtIQD(r.total)}</small></div>` },
    ];
    const html = groups.map(g => (res[g.key] || []).length ? `<div class="gsearch-group-lbl">${g.label}</div>${res[g.key].map(g.render).join('')}` : '').join('');
    box.innerHTML = html || '<div class="notif-empty">لا نتائج</div>';
    box.classList.remove('hidden');
  }, 300));
}
// (debounce مُعرَّفة أصلاً بملف inventory.js، تُستخدم هنا كما هي)

// ── تصدير PDF حقيقي: يلتقط نفس محتوى #print-area (بعد تعبئته عبر renderPrintArea) كصورة عالية الدقة
// ويُدرجها بملف PDF متعدد الصفحات — هذا الأسلوب يتفادى مشكلة عدم دعم jsPDF للعربية بخطوطه الافتراضية،
// لأن المتصفح نفسه يرسم النص العربي بصورة صحيحة والمكتبة تلتقطها كصورة بدل التعامل مع الحروف مباشرة.
async function exportPrintAreaToPDF(filename) {
  const area = document.getElementById('print-area');
  if (!area || !area.innerHTML.trim()) { toast('لا يوجد محتوى معدّ للطباعة بعد', 'e'); return; }
  if (!window.html2canvas || !window.jspdf) { toast('مكتبة تصدير PDF لم تُحمَّل بعد — تحقق من الاتصال بالإنترنت وأعد المحاولة', 'e'); return; }
  const prevCss = area.style.cssText;
  area.style.cssText = 'display:block;position:fixed;top:0;left:-9999px;width:750px;background:#fff;padding:20px;color:#111;direction:rtl;z-index:-1';
  await new Promise(r => setTimeout(r, 60));
  try {
    const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 40;
    const imgHeight = canvas.height * (imgWidth / canvas.width);
    let heightLeft = imgHeight, position = 20;
    pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - 40);
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 20;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 40);
    }
    pdf.save(filename.endsWith('.pdf') ? filename : filename + '.pdf');
  } catch (e) {
    toast('تعذر توليد PDF: ' + e.message, 'e');
  } finally {
    area.style.cssText = prevCss;
  }
}
window.exportPrintAreaToPDF = exportPrintAreaToPDF;

// ── الإقلاع ──────────────────────────────
async function boot() {
  if (localStorage.getItem('wh-theme') === 'light') document.documentElement.classList.add('light');

  const session = await DB.currentSession();
  if (!session) { showLogin(); return; }

  ME = await DB.currentProfile();
  if (!ME) { showLogin(); return; }

  if (!ME.is_active) { showPending(); return; }

  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('pending-screen')?.classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  // تحميل تجاوزات الصلاحيات الأمنية + الثوابت العامة/بيانات الشركة (لا توقف الإقلاع لو فشلت — صامتة)
  try {
    const perms = await DB.listPagePermissions();
    PAGE_PERM_OVERRIDES = {}; perms.forEach(p => { PAGE_PERM_OVERRIDES[p.page_id + '|' + p.role] = p.allowed; });
  } catch (e) { /* صامت */ }
  try {
    const uperms = await DB.listUserPermissions(ME.id);
    USER_PERM_OVERRIDES = {}; uperms.forEach(p => { USER_PERM_OVERRIDES[p.perm_key] = p.allowed; });
  } catch (e) { /* صامت */ }
  try {
    const s = await DB.getAppSettingsBatch(['company_name', 'currency_label', 'nav_label_overrides']);
    if (s.company_name) { window.APP_CONFIG.APP_NAME = s.company_name; document.querySelector('.brand-name') && (document.querySelector('.brand-name').textContent = s.company_name); }
    if (s.currency_label) window.__currencyLabel = s.currency_label;
    if (s.nav_label_overrides && window.applyNavLabelOverrides) {
      try { window.applyNavLabelOverrides(JSON.parse(s.nav_label_overrides)); } catch (e) { /* صامت */ }
    }
  } catch (e) { /* صامت */ }

  registerTopMenuHomePages();
  registerStubPages();
  renderSidebar();
  renderTopMenu();
  initGlobalSearch();
  refreshNotifPanel();
  go('dashboard');
}
window.showPending = function showPending() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('pending-screen')?.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', boot);
