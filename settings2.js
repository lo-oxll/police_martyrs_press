// ══════════════════════════════════════════════════════════════════
//  المرحلة ٨: البريد الداخلي + الباركود + صيانة الملفات + خدمات المزامنة + استيراد إكسل
// ══════════════════════════════════════════════════════════════════

// ── النسخ الاحتياطي والاستعادة ─────────────────────────────
PAGE_RENDER.backuprestore = async (root) => {
  if (!can('admin')) { root.innerHTML = '<div class="card"><div class="ec">هذه الصفحة لمدير النظام فقط</div></div>'; return; }
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">النسخ الاحتياطي والاستعادة</div><div class="ph-sub">نسخة كاملة للقراءة، واستعادة مقيَّدة بالبيانات المرجعية فقط لحماية سلامة السجلات المالية</div></div></div>

    <div class="card">
      <div class="card-title">تنزيل نسخة احتياطية كاملة</div>
      <div class="ph-sub" style="margin-bottom:12px">يقرأ كل جداول النظام (حسب صلاحياتك الحالية) ويحزمها بملف JSON واحد قابل للتنزيل. عملية قراءة فقط، آمنة دائماً.</div>
      <button class="btn btn-p" onclick="runFullBackup()">⬇ تنزيل نسخة احتياطية الآن</button>
      <div id="bk-progress" style="margin-top:10px;font-size:12px;color:var(--ink3)"></div>
    </div>

    <div class="card">
      <div class="card-title">استعادة بيانات مرجعية</div>
      <div class="ec" style="text-align:right;padding:12px;background:rgba(212,162,76,.08);border-radius:8px;margin-bottom:14px;color:var(--warn)">
        ⚠️ لأسباب أمان محاسبي، الاستعادة من الواجهة تقتصر عمداً على الجداول المرجعية (المواد، الزبائن، دليل الحسابات، المخازن، الموردين...) —
        <b>لا تشمل</b> الفواتير أو القيود أو الأرصدة أو أي بيانات مالية حركية. استعادة تلك البيانات (كارثة حقيقية/استرجاع كامل) تحتاج أداة قاعدة بيانات مباشرة
        (Point-in-time Recovery بلوحة Supabase أو pg_restore) بإشراف مدير قاعدة بيانات — التلقائية من الواجهة لهذه الجداول خطر حقيقي (ازدواج ترحيل، كسر تسلسلات، تعارض قيود).
      </div>
      <div class="fgroup" style="margin-bottom:12px"><label>ملف النسخة الاحتياطية (JSON)</label><input type="file" id="rs-file" accept=".json"></div>
      <div id="rs-tables"></div>
      <div class="form-foot"><button class="btn btn-d" id="rs-run-btn" style="display:none" onclick="runRestore()">استعادة الجداول المحدَّدة</button></div>
      <div id="rs-result" style="margin-top:12px;font-size:12.5px"></div>
    </div>`;
};
window.runFullBackup = async () => {
  const box = document.getElementById('bk-progress');
  try {
    const bundle = await DB.fullBackupExport((done, total, table) => { box.textContent = `جارِ التصدير... (${done}/${total}) ${table}`; });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `backup_${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
    box.textContent = '✅ تم تنزيل النسخة الاحتياطية الكاملة بنجاح';
    toast('تم تنزيل النسخة الاحتياطية', 's');
  } catch (e) { box.textContent = ''; toast('تعذر التصدير: ' + e.message, 'e'); }
};

let __restoreBundle = null;
document.addEventListener('change', (e) => {
  if (e.target?.id !== 'rs-file') return;
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      __restoreBundle = JSON.parse(reader.result);
      const restorable = Object.keys(DB.RESTORABLE_REFERENCE_TABLES).filter(t => __restoreBundle.tables?.[t]?.length);
      const box = document.getElementById('rs-tables');
      if (!restorable.length) { box.innerHTML = '<div class="ec">لا توجد جداول مرجعية قابلة للاستعادة بهذا الملف</div>'; document.getElementById('rs-run-btn').style.display = 'none'; return; }
      box.innerHTML = `<label style="font-size:11px;color:var(--ink2);font-weight:600;display:block;margin:10px 0 6px">اختر الجداول المرجعية المطلوب استعادتها</label>
        ${restorable.map(t => `<label style="display:flex;align-items:center;gap:6px;padding:5px 0"><input type="checkbox" class="rs-tbl" value="${t}" style="width:auto"> ${t} (${__restoreBundle.tables[t].length} سجل)</label>`).join('')}`;
      document.getElementById('rs-run-btn').style.display = 'inline-block';
    } catch (err) { toast('ملف JSON غير صالح: ' + err.message, 'e'); }
  };
  reader.readAsText(file);
});
window.runRestore = async () => {
  const tables = [...document.querySelectorAll('.rs-tbl:checked')].map(el => el.value);
  if (!tables.length) { toast('اختر جدولاً واحداً على الأقل', 'e'); return; }
  if (!confirm(`سيتم دمج (Upsert) بيانات ${tables.length} جدول من الملف مع البيانات الحالية — السجلات المطابقة بالمفتاح الفريد ستُحدَّث، والجديدة تُضاف. هذا لا يحذف أي بيانات حالية. متابعة؟`)) return;
  const box = document.getElementById('rs-result');
  box.innerHTML = 'جارِ الاستعادة...';
  let log = [];
  for (const t of tables) {
    try { const res = await DB.restoreReferenceTable(t, __restoreBundle.tables[t]); log.push(`✅ ${t}: ${res.ok} سجل`); }
    catch (e) { log.push(`⛔ ${t}: ${e.message}`); }
  }
  box.innerHTML = log.join('<br>');
  toast('اكتملت عملية الاستعادة', 's');
};

// ── سجل جلسات الدخول (يُستنتَج من سجل المراجعة الموجود أصلاً) ─────────────────────────────
PAGE_RENDER.loginsessions = async (root) => {
  const rows = await DB.loginSessionsLog();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">سجل جلسات الدخول</div><div class="ph-sub">آخر عمليات تسجيل الدخول والخروج بالنظام</div></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الإجراء</th><th>التاريخ والوقت</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.profiles?.full_name||'—'}</td><td>${ROLE_LABEL[r.profiles?.role]||r.profiles?.role||''}</td>
      <td>${r.action==='login' ? '<span class="chip chip-ok">دخول</span>' : '<span class="chip">خروج</span>'}</td>
      <td class="mono">${new Date(r.created_at).toLocaleString('en-US')}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا يوجد سجل بعد</td></tr>'}
    </tbody></table></div></div>`;
};

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
// عناصر الاستيراد الخاصة بدليل المواد (تُستخدم من هذه الصفحة، ومن "دليل المواد" مباشرة عبر renderMaterialsExcelImportCard)
const MATERIALS_XLS_FIELDS = ['store_num', 'name', 'unit', 'category', 'min_qty', 'barcode', 'notes'];

// يبني بطاقة استيراد إكسل كاملة (رفع + تحليل + مطابقة + استيراد) داخل أي حاوية DOM بمعرّف idPrefix فريد —
// يُستخدم بصفحة "الاستيراد من اكسل" وبصفحة "دليل المواد" مباشرة بنفس المنطق دون تكرار الكود.
function renderMaterialsExcelImportCard(idPrefix) {
  return `<div class="card">
    <div class="ph-sub" style="margin-bottom:10px">ارفع أي ملف إكسل بأي ترتيب/تسمية أعمدة — النظام يحلل عناوين الصف الأول ويقترح لكل عمود الحقل المناسب، وتقدر تعدّل أي اقتراح قبل الاستيراد.</div>
    <input type="file" id="${idPrefix}-file" accept=".xlsx,.xls,.csv">
    <div class="form-foot"><button class="btn btn-p" onclick="analyzeMaterialsExcel('${idPrefix}')">تحليل الملف</button></div>
    <div id="${idPrefix}-mapping"></div>
    <div id="${idPrefix}-result"></div>
  </div>`;
}
window.__xlsState = {}; // { [idPrefix]: { headers, rows } } — يدعم أكثر من بطاقة استيراد بنفس الصفحة إن لزم

window.analyzeMaterialsExcel = async (idPrefix) => {
  const fileInput = document.getElementById(idPrefix + '-file');
  const box = document.getElementById(idPrefix + '-mapping');
  if (!fileInput.files.length) { toast('اختر ملف إكسل أولاً', 'e'); return; }
  box.innerHTML = '<div class="ec">جارِ التحليل...</div>';
  try {
    const { headers, rows } = await xlsReadFile(fileInput.files[0]);
    window.__xlsState[idPrefix] = { headers, rows };
    const mapping = xlsAutoDetectMapping(headers, MATERIALS_XLS_FIELDS);
    const requiredOk = Object.values(mapping).includes('store_num') && Object.values(mapping).includes('name');
    box.innerHTML = `
      <div class="card-title" style="margin-top:16px">مطابقة الأعمدة (${rows.length} صف مكتشَف) — عدّل أي اقتراح غير صحيح</div>
      ${xlsRenderMappingTable(headers, rows, MATERIALS_XLS_FIELDS, mapping, idPrefix + '-map')}
      ${!requiredOk ? '<div class="ec" style="color:var(--warn)">تنبيه: لم يُكتشَف عمود "الرقم المخزني" و/أو "الاسم" تلقائياً — تأكد من تعيينهما يدوياً بالقائمة أعلاه، فهما إلزاميان.</div>' : ''}
      <div class="form-foot"><button class="btn btn-p" onclick="runMaterialsExcelImport('${idPrefix}')">استيراد بهذه المطابقة</button></div>`;
  } catch (e) { box.innerHTML = `<div class="ec">تعذر تحليل الملف: ${e.message}</div>`; }
};

window.runMaterialsExcelImport = async (idPrefix) => {
  const box = document.getElementById(idPrefix + '-result');
  const state = window.__xlsState[idPrefix];
  if (!state) { toast('حلّل الملف أولاً', 'e'); return; }
  const headerByField = xlsReadMapping(state.headers, idPrefix + '-map');
  if (!headerByField.store_num || !headerByField.name) { toast('يجب تعيين عمودي "الرقم المخزني" و"الاسم" على الأقل', 'e'); return; }

  box.innerHTML = '<div class="ec">جارِ الاستيراد...</div>';
  try {
    const rows = state.rows.map(r => ({
      store_num: String(r[headerByField.store_num] || '').trim(),
      name: String(r[headerByField.name] || '').trim(),
      unit: headerByField.unit ? (String(r[headerByField.unit] || 'قطعة').trim() || 'قطعة') : 'قطعة',
      category: headerByField.category && r[headerByField.category] ? String(r[headerByField.category]).trim() : null,
      min_qty: headerByField.min_qty && r[headerByField.min_qty] ? Number(r[headerByField.min_qty]) : 0,
      barcode: headerByField.barcode && r[headerByField.barcode] ? String(r[headerByField.barcode]).trim() : null,
      notes: headerByField.notes && r[headerByField.notes] ? String(r[headerByField.notes]).trim() : null,
      is_active: true,
    })).filter(r => r.store_num && r.name);
    if (!rows.length) { box.innerHTML = '<div class="ec">لا توجد صفوف صالحة بعد المطابقة — تحقق من القيم بعمودي الرقم المخزني والاسم</div>'; return; }
    const res = await DB.importMaterialsFromRows(rows);
    box.innerHTML = `<div class="stats" style="margin-top:14px">
      <div class="stat"><div class="stat-lbl">تم بنجاح</div><div class="stat-val" style="color:var(--ok)">${res.ok}</div></div>
      <div class="stat ${res.fail?'danger':''}"><div class="stat-lbl">فشل</div><div class="stat-val danger">${res.fail}</div></div></div>
      ${res.errors.length ? `<div class="ec" style="color:var(--danger);text-align:right;padding:10px">${res.errors.join('<br>')}</div>` : ''}`;
    toast(`تم استيراد ${res.ok} مادة${res.fail ? '، وفشل ' + res.fail : ''}`, res.fail ? 'e' : 's');
    if (window.__afterMaterialsImport) window.__afterMaterialsImport();
  } catch (e) { box.innerHTML = `<div class="ec">تعذر الاستيراد: ${e.message}</div>`; }
};

PAGE_RENDER.excelimport = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">الاستيراد من اكسل</div><div class="ph-sub">استيراد مواد دفعة واحدة — يقبل أي تصميم ملف، ويحلل عناوين الأعمدة تلقائياً</div></div></div>
    ${renderMaterialsExcelImportCard('xls-main')}`;
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
