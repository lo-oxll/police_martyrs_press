// ══════════════════════════════════════════════════════════════════
//  المرحلة ٨: البريد الداخلي + الباركود + صيانة الملفات + خدمات المزامنة + استيراد إكسل
// ══════════════════════════════════════════════════════════════════

// ── البريد الداخلي ─────────────────────────────
PAGE_RENDER.internalmail = async (root) => {
  const [inbox, sent] = await Promise.all([DB.listInbox(), DB.listSentMail()]);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">البريد الداخلي</div><div class="ph-sub">رسائل بين مستخدمي النظام — اترك المستلم فارغاً لإرسال رسالة عامة للجميع</div></div>
      <div class="ph-actions"><button class="btn btn-p btn-sm" onclick="openComposeMailModal()">+ رسالة جديدة</button></div></div>
    <div class="card"><div class="card-title">الوارد</div><div class="itw"><table><thead><tr><th></th><th>من</th><th>الموضوع</th><th>التاريخ</th><th></th></tr></thead>
    <tbody>${inbox.map(m => `<tr><td>${m.is_read?'':'🔵'}</td><td>${m.sender?.full_name||''}</td>
      <td>${m.subject}${m.body?`<div class="ph-sub" style="margin-top:3px">${m.body}</div>`:''}</td><td class="mono">${new Date(m.created_at).toLocaleString('en-US')}</td>
      <td>${!m.is_read ? `<button class="btn btn-o btn-sm" onclick="markMailRead('${m.id}')">تحديد كمقروءة</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد رسائل واردة</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="card-title">الصادر</div><div class="itw"><table><thead><tr><th>إلى</th><th>الموضوع</th><th>التاريخ</th><th></th></tr></thead>
    <tbody>${sent.map(m => `<tr><td>${m.recipient?.full_name||'الجميع'}</td><td>${m.subject}</td><td class="mono">${new Date(m.created_at).toLocaleString('en-US')}</td>
      <td><button class="btn btn-d btn-sm" onclick="deleteMailConfirm('${m.id}')">حذف</button></td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد رسائل مُرسَلة</td></tr>'}
    </tbody></table></div></div>`;
};
window.openComposeMailModal = async () => {
  const users = await DB.listAllUsers();
  showModal('رسالة جديدة', `
    <div class="fgroup"><label>المستلم</label><select id="m-ml-to"><option value="">— الجميع (رسالة عامة) —</option>${users.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')}</select></div>
    <div class="fgroup"><label>الموضوع</label><input id="m-ml-subject"></div>
    <div class="fgroup"><label>نص الرسالة</label><textarea id="m-ml-body" rows="4"></textarea></div>
  `, async () => {
    const subject = gv('m-ml-subject');
    if (!subject) { toast('الموضوع مطلوب', 'e'); return false; }
    try { await DB.sendInternalMessage(gv('m-ml-to') || null, subject, gv('m-ml-body')); toast('تم الإرسال', 's'); go('internalmail'); }
    catch (e) { toast('تعذر الإرسال: ' + e.message, 'e'); return false; }
  });
};
window.markMailRead = async (id) => { try { await DB.markMessageRead(id); go('internalmail'); } catch (e) { toast('تعذر: ' + e.message, 'e'); } };
window.deleteMailConfirm = async (id) => {
  if (!confirm('حذف هذه الرسالة؟')) return;
  try { await DB.deleteInternalMessage(id); toast('تم الحذف', 's'); go('internalmail'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── أرشفة الوثائق: إعادة استخدام صفحة الأرشيف الموجودة (المرحلة ٧) ─────────────────────────────
PAGE_RENDER.docarchiving = async (root) => PAGE_RENDER.archive(root);

// ── تصميم وطباعة الباركود ─────────────────────────────
PAGE_RENDER.barcodedesign = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تصميم وطباعة الباركود</div><div class="ph-sub">اختر مادة، عيّن رمز باركود (أو استخدم الرقم المخزني)، واطبع الملصق</div></div></div>
    <div class="card">
      <div class="fgroup"><label>المادة</label><div class="ac-wrap"><input id="bc-mat-search" placeholder="ابحث عن مادة..." autocomplete="off"><div class="ac-portal" id="bc-mat-portal"></div></div></div>
      <div id="bc-detail"></div>
    </div>
    <div id="bc-print-area"></div>`;
  bindAutocomplete(document.getElementById('bc-mat-search'), document.getElementById('bc-mat-portal'),
    async (term) => term ? DB.listMaterials(term, 8) : [],
    (m) => { sv('bc-mat-search', `${m.store_num} — ${m.name}`); renderBarcodeDetail(m); },
    (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);
};
function renderBarcodeDetail(m) {
  const code = m.barcode || m.store_num;
  document.getElementById('bc-detail').innerHTML = `
    <div class="fg2" style="margin-top:14px">
      <div class="fgroup"><label>رمز الباركود (فارغ = يُستخدم الرقم المخزني)</label><input id="bc-code-input" value="${m.barcode||''}" placeholder="${m.store_num}"></div>
      <div class="fgroup" style="justify-content:flex-end;display:flex;align-items:flex-end;gap:8px">
        <button class="btn btn-o" onclick="saveBarcodeValue('${m.id}')">حفظ الرمز</button>
        <button class="btn btn-p" onclick="printBarcodeLabel('${m.id}','${(m.name||'').replace(/'/g,"")}')">طباعة الملصق</button>
      </div>
    </div>
    <div id="bc-preview" style="margin-top:14px;text-align:center;padding:20px;background:#fff;border-radius:10px">
      <svg id="bc-svg"></svg><div style="color:#111;font-size:12px;margin-top:4px">${(m.name||'').replace(/</g,'')}</div>
    </div>`;
  renderBarcodeSVG(code);
}
function renderBarcodeSVG(code) {
  if (window.JsBarcode) { try { JsBarcode('#bc-svg', code || '0', { format: 'CODE128', height: 60, displayValue: true, fontSize: 14 }); } catch (e) { /* رمز غير صالح */ } }
}
window.saveBarcodeValue = async (materialId) => {
  const val = gv('bc-code-input');
  try { await DB.setMaterialBarcode(materialId, val); toast('تم حفظ رمز الباركود', 's'); renderBarcodeSVG(val || materialId); }
  catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};
window.printBarcodeLabel = (materialId, name) => {
  const code = gv('bc-code-input') || materialId;
  const printArea = document.getElementById('bc-print-area');
  printArea.innerHTML = `<div id="print-area"><div style="text-align:center;padding:30px"><svg id="bc-print-svg"></svg><div style="font-size:13px;margin-top:6px">${name}</div></div></div>`;
  if (window.JsBarcode) JsBarcode('#bc-print-svg', code, { format: 'CODE128', height: 70, displayValue: true, fontSize: 16 });
  setTimeout(() => window.print(), 100);
};

// ── الاستعلام عن باركود ─────────────────────────────
PAGE_RENDER.barcodeinquiry = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">الاستعلام عن باركود</div><div class="ph-sub">أدخل أو امسح رمز الباركود لمعرفة المادة المرتبطة به</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>رمز الباركود</label><input id="bi-code" placeholder="امسح الباركود أو اكتب الرمز هنا" onkeydown="if(event.key==='Enter')runBarcodeInquiry()"></div>
      <div class="fgroup" style="justify-content:flex-end;display:flex;align-items:flex-end"><button class="btn btn-p" onclick="runBarcodeInquiry()">استعلام</button></div>
    </div></div>
    <div id="bi-result"></div>`;
  document.getElementById('bi-code').focus();
};
window.runBarcodeInquiry = async () => {
  const code = gv('bi-code');
  const box = document.getElementById('bi-result');
  if (!code) { toast('أدخل رمز الباركود', 'e'); return; }
  box.innerHTML = '<div class="ec">جارِ البحث...</div>';
  try {
    let m = await DB.findMaterialByBarcode(code);
    if (!m) { const results = await DB.listMaterials(code, 1); m = results[0]; }
    if (!m) { box.innerHTML = '<div class="card"><div class="ec">لا توجد مادة بهذا الباركود</div></div>'; return; }
    box.innerHTML = `<div class="card"><div class="stats">
      <div class="stat"><div class="stat-lbl">الرقم المخزني</div><div class="stat-val">${m.store_num}</div></div>
      <div class="stat"><div class="stat-lbl">الاسم</div><div class="stat-val" style="font-size:16px">${m.name}</div></div>
      <div class="stat"><div class="stat-lbl">الوحدة</div><div class="stat-val">${m.unit}</div></div>
    </div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر البحث: ${e.message}</div></div>`; }
};

// ── صيانة الملفات: لوحة فحص سريعة ─────────────────────────────
PAGE_RENDER.filemaintenance = async (root) => {
  root.innerHTML = `<div class="ph"><div><div class="ph-title">صيانة الملفات</div><div class="ph-sub">فحص سريع لحالة البيانات التشغيلية</div></div></div><div class="ec">جارِ الفحص...</div>`;
  try {
    const s = await DB.systemMaintenanceSummary();
    root.innerHTML = `<div class="ph"><div><div class="ph-title">صيانة الملفات</div><div class="ph-sub">فحص سريع لحالة البيانات التشغيلية</div></div></div>
    <div class="stats">
      <div class="stat ${s.lowStockCount?'warn':''}"><div class="stat-lbl">مواد بحاجة إعادة طلب</div><div class="stat-val">${s.lowStockCount}</div></div>
      <div class="stat ${s.pendingUsersCount?'warn':''}"><div class="stat-lbl">مستخدمون بانتظار الموافقة</div><div class="stat-val">${s.pendingUsersCount}</div></div>
      <div class="stat ${s.pendingEntriesCount?'warn':''}"><div class="stat-lbl">قيود بانتظار الموافقة</div><div class="stat-val">${s.pendingEntriesCount}</div></div>
      <div class="stat"><div class="stat-lbl">مواد بلا باركود</div><div class="stat-val">${s.materialsNoBarcodeCount}</div></div>
      <div class="stat"><div class="stat-lbl">بطاقات أرشيف بلا رابط ملف</div><div class="stat-val">${s.archiveNoUrlCount}</div></div>
    </div>
    <div class="card"><div class="ph-sub">لفحص تفصيلي لسلامة القيود المحاسبية، استخدم صفحة "فحص سلامة البيانات" بقائمة المحاسبة.</div></div>`;
  } catch (e) { root.innerHTML += `<div class="card"><div class="ec">تعذر الفحص: ${e.message}</div></div>`; }
};

// ── خدمات المزامنة: تصدير نسخة من الجداول المرجعية الأساسية ─────────────────────────────
PAGE_RENDER.syncservices = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">خدمات المزامنة</div><div class="ph-sub">تصدير نسخة كاملة من البيانات المرجعية (زبائن، مواد، حسابات، مخازن، مشاريع، فروع) لأي استخدام خارجي</div></div></div>
    <div class="card"><button class="btn btn-p" onclick="runExportSync()">تصدير نسخة JSON</button><div id="sync-status" style="margin-top:12px"></div></div>`;
};
window.runExportSync = async () => {
  const box = document.getElementById('sync-status');
  box.innerHTML = '<div class="ec">جارِ التجهيز...</div>';
  try {
    const bundle = await DB.exportSyncBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sync_export_' + todayISO() + '.json'; a.click();
    URL.revokeObjectURL(url);
    box.innerHTML = `<div class="ec" style="color:var(--ok)">تم تجهيز الملف وتنزيله (${bundle.customers.length} زبون، ${bundle.materials.length} مادة، ${bundle.chart_of_accounts.length} حساب)</div>`;
  } catch (e) { box.innerHTML = `<div class="ec">تعذر التصدير: ${e.message}</div>`; }
};

// ── الاستيراد من اكسل (دليل المواد) — يقبل أي تصميم ملف، ويحلل عناوين الأعمدة تلقائياً ─────────────────────────────
// كل حقل مطلوب له قائمة مرادفات عربية/إنجليزية شائعة؛ يُقارَن عنوان كل عمود بالملف
// معها (بعد تطبيع النص: إزالة المسافات/التشكيل وتوحيد الحالة) لاكتشاف أقرب تطابق.
const XLS_FIELD_ALIASES = {
  store_num: ['store_num','storenum','رقم مخزني','الرقم المخزني','رقم المادة','رقم الصنف','كود','كود المادة','code','sku','item code','رمز','رمز المادة'],
  name: ['name','الاسم','اسم المادة','اسم الصنف','المادة','item name','description','الوصف','التسمية'],
  unit: ['unit','الوحدة','وحدة','uom','وحدة القياس'],
  category: ['category','التصنيف','تصنيف','الصنف','type','فئة','المجموعة','group'],
  min_qty: ['min_qty','minqty','الحد الأدنى','حد ادنى','حد الطلب','نقطة اعادة الطلب','reorder','reorder point','minimum','الحد الادنى للطلب'],
  barcode: ['barcode','باركود','الباركود','رمز الباركود'],
};
const XLS_FIELD_LABELS = { store_num: 'الرقم المخزني', name: 'الاسم', unit: 'الوحدة', category: 'التصنيف', min_qty: 'الحد الأدنى', barcode: 'الباركود', __ignore: 'تجاهل هذا العمود' };
function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[\u064B-\u065F]/g, '').replace(/\s+/g, ' ');
}
function autoDetectXlsMapping(headers) {
  const mapping = {};
  headers.forEach(h => {
    const norm = normalizeHeader(h);
    let matched = null;
    for (const [field, aliases] of Object.entries(XLS_FIELD_ALIASES)) {
      if (aliases.some(a => normalizeHeader(a) === norm)) { matched = field; break; }
    }
    if (!matched) { // مطابقة جزئية احتياطية إن لم يوجد تطابق تام
      for (const [field, aliases] of Object.entries(XLS_FIELD_ALIASES)) {
        if (aliases.some(a => norm.includes(normalizeHeader(a)) || normalizeHeader(a).includes(norm))) { matched = field; break; }
      }
    }
    mapping[h] = matched || '__ignore';
  });
  return mapping;
}
let __xlsParsedRows = null, __xlsHeaders = null;

PAGE_RENDER.excelimport = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">الاستيراد من اكسل</div><div class="ph-sub">استيراد مواد دفعة واحدة — يقبل أي تصميم ملف، ويحلل عناوين الأعمدة تلقائياً</div></div></div>
    <div class="card">
      <div class="ph-sub" style="margin-bottom:10px">ارفع الملف بأي ترتيب/تسمية أعمدة تريدها — النظام يحلل عناوين الصف الأول ويقترح لكل عمود الحقل المناسب، وتقدر تعدّل أي اقتراح قبل الاستيراد.</div>
      <input type="file" id="xls-file" accept=".xlsx,.xls,.csv">
      <div class="form-foot"><button class="btn btn-p" onclick="analyzeExcelFile()">تحليل الملف</button></div>
      <div id="xls-mapping"></div>
      <div id="xls-result"></div>
    </div>`;
};

window.analyzeExcelFile = async () => {
  const fileInput = document.getElementById('xls-file');
  const box = document.getElementById('xls-mapping');
  if (!fileInput.files.length) { toast('اختر ملف إكسل أولاً', 'e'); return; }
  box.innerHTML = '<div class="ec">جارِ التحليل...</div>';
  try {
    const file = fileInput.files[0];
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    __xlsParsedRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!__xlsParsedRows.length) { box.innerHTML = '<div class="ec">الملف فارغ أو بلا بيانات قابلة للقراءة</div>'; return; }
    __xlsHeaders = Object.keys(__xlsParsedRows[0]);
    const mapping = autoDetectXlsMapping(__xlsHeaders);
    const requiredOk = Object.values(mapping).includes('store_num') && Object.values(mapping).includes('name');

    box.innerHTML = `
      <div class="card-title" style="margin-top:16px">مطابقة الأعمدة (${__xlsParsedRows.length} صف مكتشَف) — عدّل أي اقتراح غير صحيح</div>
      <div class="itw"><table><thead><tr><th>عمود الملف</th><th>عيّنة من القيم</th><th>يُستخدم كـ</th></tr></thead>
      <tbody>${__xlsHeaders.map(h => {
        const sample = __xlsParsedRows.slice(0, 3).map(r => r[h]).filter(v => v !== '').join('، ');
        return `<tr><td class="mono">${h}</td><td class="ph-sub">${sample || '—'}</td>
        <td><select id="xls-map-${cssSafeId(h)}" data-header="${h.replace(/"/g,'&quot;')}">
          ${Object.entries(XLS_FIELD_LABELS).map(([val, label]) => `<option value="${val}" ${mapping[h]===val?'selected':''}>${label}</option>`).join('')}
        </select></td></tr>`;
      }).join('')}</tbody></table></div>
      ${!requiredOk ? '<div class="ec" style="color:var(--warn)">تنبيه: لم يُكتشَف عمود "الرقم المخزني" و/أو "الاسم" تلقائياً — تأكد من تعيينهما يدوياً بالقائمة أعلاه، فهما إلزاميان.</div>' : ''}
      <div class="form-foot"><button class="btn btn-p" onclick="runExcelImport()">استيراد بهذه المطابقة</button></div>`;
  } catch (e) { box.innerHTML = `<div class="ec">تعذر تحليل الملف: ${e.message}</div>`; }
};
function cssSafeId(s) { return String(s).replace(/[^a-zA-Z0-9_\u0600-\u06FF]/g, '_'); }

window.runExcelImport = async () => {
  const box = document.getElementById('xls-result');
  if (!__xlsParsedRows) { toast('حلّل الملف أولاً', 'e'); return; }
  // اقرأ المطابقة النهائية التي اختارها/عدّلها المستخدم من القوائم المنسدلة
  const fieldByHeader = {};
  __xlsHeaders.forEach(h => {
    const sel = document.getElementById('xls-map-' + cssSafeId(h));
    if (sel && sel.value !== '__ignore') fieldByHeader[h] = sel.value;
  });
  const headerByField = {}; Object.entries(fieldByHeader).forEach(([h, f]) => { headerByField[f] = h; });
  if (!headerByField.store_num || !headerByField.name) { toast('يجب تعيين عمودي "الرقم المخزني" و"الاسم" على الأقل', 'e'); return; }

  box.innerHTML = '<div class="ec">جارِ الاستيراد...</div>';
  try {
    const rows = __xlsParsedRows.map(r => ({
      store_num: String(r[headerByField.store_num] || '').trim(),
      name: String(r[headerByField.name] || '').trim(),
      unit: headerByField.unit ? String(r[headerByField.unit] || 'قطعة').trim() || 'قطعة' : 'قطعة',
      category: headerByField.category && r[headerByField.category] ? String(r[headerByField.category]).trim() : null,
      min_qty: headerByField.min_qty && r[headerByField.min_qty] ? Number(r[headerByField.min_qty]) : 0,
      barcode: headerByField.barcode && r[headerByField.barcode] ? String(r[headerByField.barcode]).trim() : null,
      is_active: true,
    })).filter(r => r.store_num && r.name);
    if (!rows.length) { box.innerHTML = '<div class="ec">لا توجد صفوف صالحة بعد المطابقة — تحقق من القيم بعمودي الرقم المخزني والاسم</div>'; return; }
    const res = await DB.importMaterialsFromRows(rows);
    box.innerHTML = `<div class="stats" style="margin-top:14px">
      <div class="stat"><div class="stat-lbl">تم بنجاح</div><div class="stat-val" style="color:var(--ok)">${res.ok}</div></div>
      <div class="stat ${res.fail?'danger':''}"><div class="stat-lbl">فشل</div><div class="stat-val danger">${res.fail}</div></div></div>
      ${res.errors.length ? `<div class="ec" style="color:var(--danger);text-align:right;padding:10px">${res.errors.join('<br>')}</div>` : ''}`;
    toast(`تم استيراد ${res.ok} مادة${res.fail ? '، وفشل ' + res.fail : ''}`, res.fail ? 'e' : 's');
  } catch (e) { box.innerHTML = `<div class="ec">تعذر الاستيراد: ${e.message}</div>`; }
};

// ── تحديث الاتصال بالشبكة: تشخيص الاتصال بقاعدة البيانات ─────────────────────────────
PAGE_RENDER.networksettings = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تحديث الاتصال بالشبكة</div><div class="ph-sub">معلومات الاتصال الحالية بقاعدة البيانات وفحص جاهزيته</div></div></div>
    <div class="card">
      <div class="fgroup"><label>عنوان Supabase</label><input value="${window.APP_CONFIG?.SUPABASE_URL||''}" disabled></div>
      <div class="ph-sub" style="margin:8px 0">لتغيير عنوان الاتصال أو المفتاح، عدّل ملف config.js من الخادم مباشرة (لأسباب أمنية لا يمكن تعديله من داخل الواجهة).</div>
      <button class="btn btn-p" onclick="runConnectionTest()">فحص الاتصال الآن</button>
      <div id="net-status" style="margin-top:12px"></div>
    </div>`;
};
window.runConnectionTest = async () => {
  const box = document.getElementById('net-status');
  box.innerHTML = '<div class="ec">جارِ الفحص...</div>';
  const t0 = performance.now();
  try {
    await DB.listWarehouses();
    box.innerHTML = `<div class="ec" style="color:var(--ok)">الاتصال سليم — زمن الاستجابة ${Math.round(performance.now() - t0)} مللي ثانية</div>`;
  } catch (e) { box.innerHTML = `<div class="ec" style="color:var(--danger)">تعذر الاتصال: ${e.message}</div>`; }
};
