// ══════════════════════════════════════════════════════════════════
//  السنوات المالية: عرض الأرشيف + إقفال السنة الحالية وبدء سنة جديدة
//  + تصدير/استيراد الأرصدة الافتتاحية (إكسل)
// ══════════════════════════════════════════════════════════════════

PAGE_RENDER.fiscal = async (root) => {
  if (!can('admin','manager')) { root.innerHTML = '<div class="card ec">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return; }
  const years = await DB.listFiscalYears();
  const active = years.find(y => y.is_active);
  const whs = await DB.listWarehouses();

  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📅 السنوات المالية</div><div class="ph-sub">السنة النشطة الحالية: <b style="color:var(--gold)">${active ? active.year : '—'}</b></div></div>
      ${can('admin') ? `<div class="ph-actions"><button class="btn btn-p" onclick="openCloseYearModal(${active ? active.year : 'null'})">🔒 إقفال السنة الحالية وبدء سنة جديدة</button></div>` : ''}
    </div>

    <div class="card"><div class="card-title">جميع السنوات</div>
      <div class="itw"><table><thead><tr><th>السنة</th><th>الحالة</th><th>تاريخ الفتح</th><th>تاريخ الإقفال</th><th></th></tr></thead><tbody>
        ${years.map(y => `<tr>
          <td class="mono" style="font-weight:800">${y.year}</td>
          <td>${y.is_active ? '<span class="chip-ok chip">نشطة</span>' : '<span class="chip chip-gold">مؤرشفة</span>'}</td>
          <td class="mono">${new Date(y.opened_at).toLocaleDateString('ar-IQ')}</td>
          <td class="mono">${y.closed_at ? new Date(y.closed_at).toLocaleDateString('ar-IQ') : '—'}</td>
          <td>
            <button class="btn btn-o btn-sm" onclick="viewOpeningBalances('${y.id}', ${y.year})">عرض الأرصدة الافتتاحية</button>
            <button class="btn btn-o btn-sm" onclick="exportOpeningBalancesExcel('${y.id}', ${y.year})">⬇ تصدير إكسل</button>
            ${can('admin') && !y.is_active ? `<button class="btn btn-d btn-sm" onclick="deleteFiscalYearConfirm('${y.id}', ${y.year})">🗑 حذف نهائي</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد سنوات مسجّلة</td></tr>'}
      </tbody></table></div>
    </div>

    ${can('admin') ? `
    <div class="card">
      <div class="ph" style="margin-bottom:14px">
        <div><div class="card-title" style="margin:0;padding:0;border:none">📥 استيراد أرصدة التدوير (الأرصدة الافتتاحية) حسب المخزن</div>
        <div class="ph-sub" style="margin-top:4px">استورد ملف إكسل منفصل لكل مخزن يحتوي أرصدة مواده آخر السنة — سيتم اعتمادها كرصيد افتتاحي وتحديث رصيد المخزن الحالي دفعة واحدة</div></div>
      </div>
      <div class="fg" style="margin-bottom:14px">
        <div class="fgroup"><label>السنة المالية *</label><select id="ob-year">
          ${years.map(y => `<option value="${y.id}" ${y.is_active ? 'selected' : ''}>${y.year}${y.is_active ? ' (نشطة)' : ''}</option>`).join('') || '<option value="">لا توجد سنوات</option>'}
        </select></div>
        <div class="fgroup"><label>المخزن *</label><select id="ob-wh">
          <option value="">اختر المخزن...</option>
          ${whs.map(w => `<option value="${w.id}">${w.code} — ${w.name}</option>`).join('')}
        </select></div>
        <div class="fgroup"><label>ملف الإكسل *</label><input type="file" id="ob-file" accept=".xlsx,.xls"></div>
      </div>
      <div style="font-size:11.5px;color:var(--ink3);margin-bottom:12px">
        يقبل أي تصميم ملف — حلّل الملف أولاً وستظهر لك مطابقة أعمدته تلقائياً (الرقم المخزني، الكمية، السعر) وتقدر تعدّلها قبل الاستيراد.
      </div>
      <div class="ph-actions">
        <button class="btn btn-o btn-sm" onclick="downloadOpeningBalanceTemplate()">⬇ تحميل قالب فارغ</button>
        <button class="btn btn-p btn-sm" onclick="analyzeOpeningBalancesExcel()">🔍 تحليل الملف</button>
      </div>
      <div id="ob-mapping"></div>
      <div id="ob-import-result" style="margin-top:12px;font-size:12.5px"></div>
    </div>` : ''}

    <div id="ob-view"></div>

    <div class="card" style="border:1px dashed var(--border)">
      <div class="card-title">ℹ️ كيف يعمل الإقفال السنوي</div>
      <div style="font-size:12.5px;color:var(--ink2);line-height:2">
        1) عند الإقفال، يُلتقط رصيد كل مادة (الكمية + السعر الوسطي) بكل مخزن كما هو لحظة الإقفال ويُسجَّل كـ"رصيد افتتاحي" للسنة الجديدة.<br>
        2) صافي أرصدة حسابات الأصول والخصوم وحقوق الملكية يُرحَّل كرصيد افتتاحي؛ حسابات الإيرادات والمصروفات تبدأ من صفر بالسنة الجديدة (كما بالأصول المحاسبية).<br>
        3) دليل المواد والمخازن ودليل الحسابات <b>لا تتكرر</b> — تبقى مشتركة بين كل السنوات.<br>
        4) وثائق الاستلام/الإصدار والقيود المحاسبية للسنوات المُقفلة تبقى محفوظة بالكامل ويمكن الرجوع لها من صفحة "سجل الوثائق" باختيار السنة (للأدمن فقط).<br>
        5) الإقفال إجراء ${can('admin') ? '<b style="color:var(--danger)">لا يمكن التراجع عنه</b>' : 'يقوم به مدير النظام فقط'} — تأكد من ترحيل كل وثائق السنة الحالية قبل الإقفال.<br>
        6) استيراد أرصدة التدوير يدوياً (أعلاه) مخصص لبدء تشغيل النظام لأول مرة بمخزون موجود فعلاً، أو لتصحيح أرصدة سنة مفتوحة — وهو إجراء يقوم به الأدمن فقط ويُسجَّل بسجل المراجعة.<br>
        7) "حذف نهائي" لسنة مؤرشفة (مدير النظام فقط) يُرفض تلقائياً لو توجد لها وثائق استلام/إصدار مسجّلة — لحماية السجل التاريخي من الحذف بالخطأ.
      </div>
    </div>
  `;
};

// ── عرض الأرصدة الافتتاحية لسنة معينة ──────────────────────────────
window.viewOpeningBalances = async (fyId, year) => {
  const rows = await DB.openingBalances(fyId);
  const el = document.getElementById('ob-view');
  const matRows = rows.filter(r => r.store_num);
  const accRows = rows.filter(r => r.account_code);
  el.innerHTML = `
    <div class="card">
      <div class="card-title">الأرصدة الافتتاحية — سنة ${year} (${rows.length} صف)</div>
      ${matRows.length ? `<h3 style="font-size:12.5px;margin:10px 0">أرصدة المواد</h3>
      <div class="itw"><table><thead><tr><th>م</th><th>الرقم المخزني</th><th>المادة</th><th>المخزن</th><th>الكمية</th><th>السعر (د.ع)</th><th>القيمة (د.ع)</th></tr></thead><tbody>
        ${matRows.map(r => `<tr><td class="mono">${r.seq}</td><td class="mono">${r.store_num}</td><td>${r.material_name}</td><td>${r.warehouse_name}</td>
          <td class="mono">${fmtQty(r.qty)}</td><td class="mono">${fmt(r.unit_price)}</td><td class="gold-txt">${fmt(r.total)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${accRows.length ? `<h3 style="font-size:12.5px;margin:16px 0 10px">أرصدة الحسابات</h3>
      <div class="itw"><table><thead><tr><th>م</th><th>الرمز</th><th>الحساب</th><th>الرصيد (د.ع)</th></tr></thead><tbody>
        ${accRows.map(r => `<tr><td class="mono">${r.seq}</td><td class="mono">${r.account_code}</td><td>${r.account_name}</td><td class="mono">${fmt(r.qty * r.unit_price)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${!rows.length ? '<div class="ec">لا توجد أرصدة مسجّلة لهذه السنة</div>' : ''}
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
};

// ── تصدير الأرصدة الافتتاحية إلى إكسل (بالأعمدة المطلوبة: م/الوثيقة/الحساب/المادة/الكمية/السعر/القيمة/التاريخ) ──────────────────────────────
window.exportOpeningBalancesExcel = async (fyId, year) => {
  const rows = await DB.openingBalances(fyId);
  if (!rows.length) { toast('لا توجد أرصدة افتتاحية لهذه السنة', 'e'); return; }
  const excelRows = rows.map(r => ({
    'م': r.seq,
    'الوثيقة': r.doc_ref || '',
    'الحساب': r.account_code ? `${r.account_code} — ${r.account_name}` : '',
    'المادة': r.store_num ? `${r.store_num} — ${r.material_name}` : '',
    'المخزن': r.warehouse_name || '',
    'الكمية': r.store_num ? r.qty : '',
    'السعر': r.unit_price,
    'القيمة': r.total,
    'التاريخ': r.balance_date,
  }));
  const ws = XLSX.utils.json_to_sheet(excelRows);
  ws['!cols'] = [{wch:5},{wch:14},{wch:26},{wch:26},{wch:14},{wch:12},{wch:12},{wch:14},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `أرصدة ${year}`);
  XLSX.writeFile(wb, `الأرصدة_الافتتاحية_${year}.xlsx`);
};

// ── قالب فارغ لاستيراد أرصدة التدوير حسب المخزن ──────────────────────────────
window.downloadOpeningBalanceTemplate = () => {
  const ws = XLSX.utils.json_to_sheet([{ 'الرقم المخزني': '', 'الكمية': '', 'السعر': '' }]);
  ws['!cols'] = [{wch:18},{wch:12},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'قالب أرصدة التدوير');
  XLSX.writeFile(wb, 'قالب_أرصدة_التدوير.xlsx');
};

// ── استيراد أرصدة التدوير (الافتتاحية) لمخزن واحد من ملف إكسل — يقبل أي تصميم ملف ──────────────────────────────
// المطابقة تتم باسم المادة (وليس الرقم المخزني). أي مادة غير موجودة بدليل المواد تُضاف تلقائياً
// ببطاقة جديدة، لكن رصيدها الافتتاحي يبقى صفراً عمداً — راجعها يدوياً بعد الاستيراد.
const OB_XLS_FIELDS = ['name', 'unit', 'qty', 'unit_price', 'value', 'balance_date'];
window.__obXlsState = null;

window.analyzeOpeningBalancesExcel = async () => {
  const fyId = gv('ob-year'), whId = gv('ob-wh');
  const fileInput = document.getElementById('ob-file');
  const box = document.getElementById('ob-mapping');
  if (!fyId || !whId) { toast('اختر السنة المالية والمخزن أولاً', 'e'); return; }
  if (!fileInput?.files?.length) { toast('اختر ملف الإكسل أولاً', 'e'); return; }
  box.innerHTML = '<div class="ec">جارِ التحليل...</div>';
  try {
    const { headers, rows } = await xlsReadFile(fileInput.files[0]);
    window.__obXlsState = { headers, rows };
    const mapping = xlsAutoDetectMapping(headers, OB_XLS_FIELDS);
    const requiredOk = Object.values(mapping).includes('name');
    box.innerHTML = `
      <div class="card-title" style="margin-top:14px">مطابقة الأعمدة (${rows.length} صف مكتشَف) — عدّل أي اقتراح غير صحيح</div>
      ${xlsRenderMappingTable(headers, rows, OB_XLS_FIELDS, mapping, 'ob-map')}
      ${!requiredOk ? '<div class="ec" style="color:var(--warn)">تنبيه: لم يُكتشَف عمود "المادة" (اسم المادة) تلقائياً — تأكد من تعيينه يدوياً، فهو إلزامي.</div>' : ''}
      <div class="ec" style="color:var(--ink3);font-size:11.5px">ملاحظة: أي مادة باسم غير موجود بدليل المواد ستُضاف تلقائياً ببطاقة جديدة، برصيد افتتاحي صفر (بلا كمية أو سعر) — راجعها يدوياً بعد الاستيراد وأكمل رصيدها إذا لزم.</div>
      <div class="form-foot"><button class="btn btn-p btn-sm" onclick="runOpeningBalancesImport()">⬆ استيراد الأرصدة بهذه المطابقة</button></div>`;
  } catch (e) { box.innerHTML = `<div class="ec">تعذر تحليل الملف: ${e.message}</div>`; }
};

window.runOpeningBalancesImport = async () => {
  const fyId = gv('ob-year'), whId = gv('ob-wh');
  const resEl = document.getElementById('ob-import-result');
  if (!window.__obXlsState) { toast('حلّل الملف أولاً', 'e'); return; }
  const headerByField = xlsReadMapping(window.__obXlsState.headers, 'ob-map');
  if (!headerByField.name) { toast('يجب تعيين عمود "المادة" (اسم المادة) على الأقل', 'e'); return; }

  const parsed = window.__obXlsState.rows.map(r => ({
    name: String(r[headerByField.name] || '').trim(),
    unit: headerByField.unit ? String(r[headerByField.unit] || '').trim() : '',
    qty: headerByField.qty ? (Number(r[headerByField.qty]) || 0) : 0,
    unit_price: headerByField.unit_price ? (Number(r[headerByField.unit_price]) || 0) : 0,
    value: headerByField.value ? (Number(r[headerByField.value]) || 0) : 0,
    balance_date: headerByField.balance_date ? String(r[headerByField.balance_date] || '').trim() : '',
  })).filter(r => r.name);

  if (!parsed.length) { toast('لم يتم العثور على صفوف صالحة (تحقق من عمود المادة)', 'e'); return; }
  if (!confirm(`سيتم استيراد ${parsed.length} صف كأرصدة افتتاحية لهذا المخزن. المواد غير الموجودة بدليل المواد ستُضاف تلقائياً برصيد صفر. متابعة؟`)) return;

  resEl.innerHTML = 'جارِ الاستيراد...';
  try {
    const result = await DB.importOpeningBalancesForWarehouse(fyId, whId, parsed);
    resEl.innerHTML = `✅ تم استيراد <b style="color:var(--ok)">${result.ok}</b> صف بنجاح${result.fail ? `، وفشل <b style="color:var(--danger)">${result.fail}</b> صف` : ''}${result.autoCreated ? `، وأُضيفت <b style="color:var(--warn)">${result.autoCreated}</b> مادة جديدة برصيد صفر (راجعها يدوياً)` : ''}.`;
    if (result.errors.length) {
      resEl.innerHTML += `<div style="margin-top:8px;color:var(--danger);font-size:11.5px">${result.errors.slice(0,10).map(e=>`• ${e}`).join('<br>')}${result.errors.length>10 ? '<br>...' : ''}</div>`;
    }
    document.getElementById('ob-file').value = '';
    document.getElementById('ob-mapping').innerHTML = '';
    window.__obXlsState = null;
    toast('تم استيراد أرصدة التدوير للمخزن', 's');
  } catch (e) {
    resEl.innerHTML = '';
    toast('تعذر الاستيراد: ' + e.message, 'e');
  }
};

// ── حذف نهائي لسنة مالية مؤرشفة (مدير النظام فقط) ──────────────────────────────
window.deleteFiscalYearConfirm = async (id, year) => {
  if (!confirm(`⚠️ حذف نهائي للسنة المالية ${year} وكل أرصدتها الافتتاحية. سيُرفض الحذف تلقائياً لو توجد لهذه السنة وثائق استلام/إصدار مسجّلة. هذا الإجراء لا يمكن التراجع عنه. متابعة؟`)) return;
  try {
    await DB.deleteFiscalYear(id, year, false);
    toast('تم حذف السنة المالية نهائياً', 's');
    go('fiscal');
  } catch (e) { toast('تعذّر الحذف: ' + e.message, 'e'); }
};

// ── إقفال السنة الحالية وبدء سنة جديدة ──────────────────────────────
window.openCloseYearModal = (currentYear) => {
  const suggested = (currentYear || new Date().getFullYear()) + 1;
  showModal('🔒 إقفال السنة الحالية وبدء سنة جديدة', `
    <div style="background:rgba(209,85,74,.1);border:1px solid var(--danger);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12.5px;color:var(--danger)">
      ⚠️ هذا الإجراء نهائي ولا يمكن التراجع عنه. تأكد من ترحيل كل وثائق ${currentYear || 'السنة الحالية'} قبل المتابعة.
    </div>
    <div class="fgroup"><label>سنة البدء الجديدة *</label><input type="number" id="m-new-year" value="${suggested}"></div>
  `, async () => {
    const newYear = Number(gv('m-new-year'));
    if (!newYear || newYear <= (currentYear || 0)) { toast('أدخل سنة صحيحة أكبر من السنة الحالية', 'e'); return false; }
    if (!confirm(`متأكد تريد إقفال سنة ${currentYear} وبدء سنة ${newYear}؟ هذا الإجراء نهائي.`)) return false;
    try {
      await DB.closeFiscalYear(newYear);
      toast(`✅ تم إقفال السنة وبدء سنة ${newYear}`, 's');
      go('fiscal');
      return true;
    } catch (e) { toast('خطأ: ' + e.message, 'e'); return false; }
  });
};
