// ══════════════════════════════════════════════════════════════════
//  التطبيق الرئيسي: أدوات مشتركة + التوجيه بين الصفحات + الإقلاع
// ══════════════════════════════════════════════════════════════════
const gv = id => (document.getElementById(id)?.value ?? '').trim();
const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
// المبالغ بالدينار العراقي — بدون فاصلة عشرية (لا يوجد تعامل عملي بكسور الدينار)
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const fmtIQD = n => fmt(n) + ' د.ع';
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
// صلاحية الخزينة والرواتب والسلفة المستديمة: مدير النظام دائماً، أو محاسب مُفعَّل له can_treasury تحديداً
function canTreasury() { return ME && (ME.role === 'admin' || (ME.role === 'accountant' && ME.can_treasury)); }
window.canTreasury = canTreasury;
// تقييد قائمة المخازن حسب نطاق المحاسب (NULL/غير محاسب = بدون تقييد)
function scopedWarehouses(all) {
  if (!ME || ME.role !== 'accountant' || !ME.warehouse_ids || !ME.warehouse_ids.length) return all;
  return all.filter(w => ME.warehouse_ids.includes(w.id));
}
window.scopedWarehouses = scopedWarehouses;

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
    { label: 'إيصالات القبض والدفع', page: 'receiptsvouchers' },
    { label: 'أوامر القبض والدفع', page: 'paymentreceiptorders' },
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
    { label: 'ادخال وتعديل نموذج تصنيع', page: 'mfgmodel' },
    { label: 'ادخال وتعديل طلبية تصنيع', page: 'mfgorder' },
    { label: 'ادخال وتعديل عملية تصنيع', page: 'mfgprocess' },
    { label: 'توزيع نفقات غير مباشرة', page: 'indirectexpenses' },
    { label: 'كشف التصنيع واحتياجاته', page: 'mfgreport' },
    { label: 'كشف انحراف التصنيع', page: 'mfgdeviation' },
    { label: 'جرد المواد والمكونات', page: 'mfgcomponentscount' },
  ]},
  { id: 'settings', label: 'اعدادات البرنامج', icon: '⚙️', items: [
    { label: 'آلة حاسبة', action: 'openCalculator' },
    { label: 'الرقابة', page: 'auditlog' },
    { label: 'البريد الداخلي', page: 'internalmail' },
    { label: 'أرشفة الوثائق', page: 'docarchiving' },
    { label: 'صيانة الملفات', page: 'filemaintenance' },
    { label: 'تصميم وطباعة الباركود', page: 'barcodedesign' },
    { label: 'نسخ بيانات من والى فرع شركة آخر', page: 'branchsync' },
    { label: 'خدمات متفرقة', page: 'miscservices' },
    { label: 'خدمات المزامنة', page: 'syncservices' },
    { label: 'الاستيراد من اكسل', page: 'excelimport' },
    { label: 'English', action: 'toggleLanguage' },
    { label: 'حول البرنامج', page: 'about' },
    { label: 'تحديث الاتصال بالشبكة', page: 'networksettings' },
  ]},
  { id: 'exit', label: 'خروج', icon: '🚪', action: 'doLogout' },
];
window.TOPMENU = TOPMENU;

// ── تعريف الصفحات والقائمة الجانبية ──────────────────────────────
// القائمة الجانبية اليمنى تقتصر حصراً على العناصر المطلوبة، بلا تكرار: كل ميزة تظهر
// مرة واحدة فقط بأحدث تسمية لها (مثال: "سند قيد مركب" و"يومية مركبة" هما نفس ميزة
// القيد المحاسبي المركب — أُبقي على تسمية واحدة فقط وحُذفت الأخرى المكررة).
const PAGES = [
  { section: 'الحركة اليومية', items: [
    { id: 'receive', label: 'ادخال فواتير', icon: '📥', roles: ['admin','accountant'] },
    { id: 'issue', label: 'اخراج فواتير', icon: '📤', roles: ['admin','accountant'] },
    { id: 'whdaily', label: 'كشف يومية مستودع', icon: '🗓' },
    { id: 'balance', label: 'جرد مستودع', icon: '⚖️' },
    { id: 'materials', label: 'دليل المواد', icon: '📚', roles: ['admin','accountant'] },
    { id: 'docs', label: 'كشف الحركة اليومية', icon: '📑' },
    { id: 'cashbox', label: 'ادخال وتعديل يومية صندوق', icon: '💰', roles: ['admin','accountant'], check: canTreasury },
    { id: 'receiptsvouchers', label: 'ادخال وتعديل إيصال قبض', icon: '🧾', roles: ['admin','accountant'] },
    { id: 'accountstatement', label: 'كشف الحساب', icon: '📄' },
    { id: 'journal', label: 'ادخال وتعديل سند قيد مركب', icon: '🧮' },
    { id: 'coabalances', label: 'كشف أرصدة حسابات', icon: '📋' },
    { id: 'paymentreceiptorders', label: 'ادخال وتعديل أمر صرف', icon: '📤', roles: ['admin','accountant'] },
    { id: 'receiptorders', label: 'ادخال وتعديل أمر قبض', icon: '📥', roles: ['admin','accountant'] },
    { id: 'materialinquiry', label: 'الاستعلام عن مادة', icon: '🔎' },
  ]},
];

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = PAGES.map(sec => {
    const items = sec.items.filter(it => (!it.roles || can(...it.roles)) && (!it.check || it.check()));
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

// ── مولّد صفحات "قيد الإنشاء" آلياً لأي معرّف صفحة مذكور بالقوائم وليس له راسم مسجَّل بعد ──
function registerStubPages() {
  const allPageIds = new Set();
  PAGES.forEach(sec => sec.items.forEach(it => allPageIds.add(it.id)));
  TOPMENU.forEach(cat => (cat.items || []).forEach(it => { if (it.page) allPageIds.add(it.page); }));
  allPageIds.forEach(id => {
    if (PAGE_RENDER[id]) return;
    PAGE_RENDER[id] = async (root) => {
      const label = findLabel(id);
      root.innerHTML = `<div class="ph"><div class="ph-title">${label}</div></div>
        <div class="card"><div class="ec">🚧 هذه الميزة ضمن مراحل التطوير القادمة وليست جاهزة بعد.<br>
        <span style="font-size:11.5px">سيتم بناؤها كوحدة كاملة (قاعدة بيانات + شاشة إدخال + تقارير) في مرحلة لاحقة حسب أولوية العمل.</span></div></div>`;
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
  registerTopMenuHomePages();
  registerStubPages();
  renderSidebar();
  renderTopMenu();
  go('dashboard');
}
window.showPending = function showPending() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('pending-screen')?.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', boot);
