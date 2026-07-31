// ══════════════════════════════════════════════════════════════════
//  بطاقة قالب افتراضي + مولد التقارير والخدمات + اعدادات عامة (متجر/مستخدمو الجوال/أوقات المواعيد)
// ══════════════════════════════════════════════════════════════════

// ── بطاقة قالب افتراضي ─────────────────────────────
PAGE_RENDER.defaulttemplatecard = async (root) => {
  const list = await DB.listInvoiceTemplates();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">بطاقة قالب افتراضي</div><div class="ph-sub">قوالب فواتير جاهزة (أصناف وكميات متكرّرة) — استخدمها من شاشتي ادخال/اخراج فواتير بزر "تحميل من قالب"</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openTemplateModal('receive')">+ قالب استلام</button><button class="btn btn-p btn-sm" onclick="openTemplateModal('issue')">+ قالب إصدار</button>` : ''}</div></div>
    ${list.map(t => `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${t.name} <span class="chip ${t.doc_type==='receive'?'chip-ok':'chip-gold'}">${t.doc_type==='receive'?'استلام':'إصدار'}</span> ${t.warehouses ? `<span class="ph-sub">— ${t.warehouses.name}</span>` : ''}</span>
        ${can('admin','accountant') ? `<button class="btn btn-d btn-sm" onclick="deleteTemplateConfirm('${t.id}','${t.name.replace(/'/g,"")}')">حذف القالب</button>` : ''}
      </div>
      <div class="itw"><table><thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th></tr></thead>
      <tbody>${(t.invoice_template_items||[]).map(it => `<tr><td>${it.materials?.store_num} — ${it.materials?.name}</td><td class="mono">${fmtQty(it.qty)} ${it.materials?.unit||''}</td><td class="mono">${fmt(it.unit_price)}</td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد أصناف</td></tr>'}</tbody></table></div>
    </div>`).join('') || '<div class="card"><div class="ec">لا توجد قوالب بعد</div></div>'}`;
};
window.openTemplateModal = async (docType) => {
  const whs = await DB.listWarehouses();
  let items = [], picked = null;
  const renderItems = () => items.map((it, i) => `<tr><td>${it.label}</td><td class="mono">${fmtQty(it.qty)}</td><td class="mono">${fmt(it.unit_price)}</td><td><button class="btn btn-d btn-sm" onclick="removeTplItem(${i})">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا توجد أصناف بعد</td></tr>';
  showModal(docType === 'receive' ? 'قالب استلام جديد' : 'قالب إصدار جديد', `
    <div class="fgroup"><label>اسم القالب</label><input id="m-tpl-name" placeholder="مثال: طلبية شهرية اعتيادية"></div>
    <div class="fgroup"><label>المخزن (اختياري)</label><select id="m-tpl-wh"><option value="">— بدون —</option>${whs.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
    <div class="card-title" style="margin-top:14px">أصناف القالب</div>
    <div class="ac-wrap"><input id="m-tpl-mat-search" placeholder="ابحث عن مادة لإضافتها..." autocomplete="off"><div class="ac-portal" id="m-tpl-mat-portal"></div></div>
    <div class="fg" style="margin-top:8px">
      <div class="fgroup"><label>الكمية</label><input id="m-tpl-qty" type="number" step="0.001"></div>
      <div class="fgroup"><label>السعر (اختياري)</label><input id="m-tpl-price" type="number" step="1"></div>
      <div class="fgroup" style="justify-content:flex-end;display:flex;align-items:flex-end"><button class="btn btn-o" id="m-tpl-add" type="button">+ إضافة</button></div>
    </div>
    <div class="itw" style="margin-top:10px"><table><thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th><th></th></tr></thead><tbody id="m-tpl-items">${renderItems()}</tbody></table></div>
  `, async () => {
    const name = gv('m-tpl-name');
    if (!name) { toast('اسم القالب مطلوب', 'e'); return false; }
    if (!items.length) { toast('أضف صنفاً واحداً على الأقل', 'e'); return false; }
    try {
      await DB.createInvoiceTemplate({ name, doc_type: docType, warehouse_id: gv('m-tpl-wh') || null }, items.map(it => ({ material_id: it.material_id, qty: it.qty, unit_price: it.unit_price })));
      toast('تم حفظ القالب', 's'); go('defaulttemplatecard');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
  bindAutocomplete(document.getElementById('m-tpl-mat-search'), document.getElementById('m-tpl-mat-portal'),
    async (term) => term ? DB.listMaterials(term, 8) : [],
    (m) => { picked = m; sv('m-tpl-mat-search', `${m.store_num} — ${m.name}`); },
    (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);
  document.getElementById('m-tpl-add').addEventListener('click', () => {
    const qty = Number(gv('m-tpl-qty')) || 1, price = Number(gv('m-tpl-price')) || 0;
    if (!picked) { toast('اختر مادة من قائمة الإكمال التلقائي', 'e'); return; }
    items.push({ material_id: picked.id, label: `${picked.store_num} — ${picked.name}`, qty, unit_price: price });
    document.getElementById('m-tpl-items').innerHTML = renderItems();
    sv('m-tpl-mat-search', ''); sv('m-tpl-qty', ''); sv('m-tpl-price', ''); picked = null;
  });
  window.removeTplItem = (i) => { items.splice(i, 1); document.getElementById('m-tpl-items').innerHTML = renderItems(); };
};
window.deleteTemplateConfirm = async (id, name) => {
  if (!confirm(`حذف قالب "${name}"؟`)) return;
  try { await DB.deleteInvoiceTemplate(id, name); toast('تم الحذف', 's'); go('defaulttemplatecard'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};
// يُستدعى من شاشتي ادخال/اخراج فواتير لتعبئة الأصناف من قالب محفوظ (زر "تحميل من قالب")
window.applyTemplateToForm = async (docType, prefix) => {
  const templates = await DB.listInvoiceTemplates(docType);
  if (!templates.length) { toast('لا توجد قوالب محفوظة لهذا النوع بعد — أنشئ واحداً من "بطاقة قالب افتراضي"', 'e'); return; }
  showModal('اختر قالباً', `<div class="fgroup"><label>القالب</label><select id="m-apply-tpl">${templates.map(t => `<option value="${t.id}">${t.name} (${(t.invoice_template_items||[]).length} صنف)</option>`).join('')}</select></div>`, async () => {
    const tpl = templates.find(t => t.id === gv('m-apply-tpl'));
    if (!tpl) return false;
    const tbody = document.getElementById(prefix + '-items');
    (tpl.invoice_template_items || []).forEach(it => {
      addItemRow(prefix, docType === 'receive');
      const tr = tbody.lastElementChild;
      tr.querySelector('.mat-search').value = `${it.materials.store_num} — ${it.materials.name}`;
      tr.querySelector('.mat-id').value = it.materials.id;
      tr.querySelector('.mat-unit').textContent = it.materials.unit;
      tr.querySelector('.qty-in').value = it.qty;
      const priceEl = tr.querySelector('.price-in'); if (priceEl) priceEl.value = it.unit_price;
    });
    recalcItems(prefix);
    toast('تم تحميل أصناف القالب', 's');
  });
};

// ── مولد التقارير والخدمات ─────────────────────────────
const REPORT_GEN_SOURCES = {
  materials: { label: 'دليل المواد', cols: ['store_num','name','unit','category','min_qty'], labels: { store_num:'الرقم المخزني', name:'الاسم', unit:'الوحدة', category:'التصنيف', min_qty:'الحد الأدنى' } },
  customers: { label: 'الزبائن', cols: ['code','name','phone','address'], labels: { code:'الرمز', name:'الاسم', phone:'الهاتف', address:'العنوان' } },
  coa: { label: 'دليل الحسابات', cols: ['code','name','type'], labels: { code:'الرمز', name:'الاسم', type:'النوع' } },
  warehouses: { label: 'المخازن', cols: ['code','name','location'], labels: { code:'الرمز', name:'الاسم', location:'الموقع' } },
};
PAGE_RENDER.reportgenerator = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">مولد التقارير والخدمات</div><div class="ph-sub">اختر مصدر بيانات والأعمدة المطلوبة وولّد تقريراً مخصَّصاً قابلاً للتصدير</div></div></div>
    <div class="card">
      <div class="fgroup"><label>مصدر البيانات</label><select id="rg-source" onchange="renderReportGenColumns()">${Object.entries(REPORT_GEN_SOURCES).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
      <div id="rg-columns" style="margin:12px 0"></div>
      <div class="form-foot"><button class="btn btn-p" onclick="runReportGenerator()">توليد التقرير</button></div>
    </div>
    <div id="rg-result"></div>`;
  renderReportGenColumns();
};
window.renderReportGenColumns = () => {
  const src = REPORT_GEN_SOURCES[gv('rg-source')];
  document.getElementById('rg-columns').innerHTML = `<label style="font-size:11px;color:var(--ink2);font-weight:600;display:block;margin-bottom:6px">الأعمدة</label>
    <div style="display:flex;flex-wrap:wrap;gap:10px">${src.cols.map(c => `<label style="display:flex;align-items:center;gap:5px"><input type="checkbox" class="rg-col" value="${c}" checked style="width:auto">${src.labels[c]}</label>`).join('')}</div>`;
};
window.runReportGenerator = async () => {
  const key = gv('rg-source');
  const src = REPORT_GEN_SOURCES[key];
  const cols = [...document.querySelectorAll('.rg-col:checked')].map(el => el.value);
  const box = document.getElementById('rg-result');
  if (!cols.length) { toast('اختر عموداً واحداً على الأقل', 'e'); return; }
  box.innerHTML = '<div class="ec">جارِ التوليد...</div>';
  try {
    let rows;
    if (key === 'materials') rows = await DB.listMaterials('', null);
    else if (key === 'customers') rows = await DB.listCustomers('', false);
    else if (key === 'coa') rows = await DB.chartOfAccounts();
    else if (key === 'warehouses') rows = await DB.listWarehouses();
    const outRows = rows.map(r => { const o = {}; cols.forEach(c => { o[src.labels[c]] = r[c] ?? ''; }); return o; });
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr>${cols.map(c => `<th>${src.labels[c]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${r[c] ?? '—'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="ec">لا توجد بيانات</td></tr>`}</tbody></table></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(outRows)}, "${src.label}", "${src.label}.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التوليد: ${e.message}</div></div>`; }
};

// ── اعدادات عامة: المتجر / مستخدمو الجوال / أوقات عمل المواعيد ─────────────────────────────
// إعدادات تخزين فقط (key-value) — بلا محرّك نقطة بيع (POS) أو نظام حجز مواعيد فعلي خلفهما
PAGE_RENDER.storesettings = async (root) => {
  const s = await DB.getAppSettingsBatch(['store_name', 'store_receipt_width', 'store_default_warehouse_id']);
  const whs = await DB.listWarehouses();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">اعدادات المتجر</div><div class="ph-sub">إعدادات عامة تُستخدم مستقبلاً إذا فُعِّلت واجهة نقطة بيع (POS) — تخزين فقط بهذه المرحلة</div></div></div>
    <div class="card" style="max-width:480px">
      <div class="fgroup" style="margin-bottom:12px"><label>اسم المتجر المعروض بالإيصال</label><input id="ss-name" value="${s.store_name||''}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>عرض ورق الطابعة الحرارية</label><select id="ss-width"><option value="58mm" ${s.store_receipt_width==='58mm'?'selected':''}>58mm</option><option value="80mm" ${s.store_receipt_width==='80mm'?'selected':''}>80mm</option></select></div>
      <div class="fgroup" style="margin-bottom:12px"><label>المخزن الافتراضي للمتجر</label><select id="ss-wh"><option value="">— بدون —</option>${whs.map(w => `<option value="${w.id}" ${s.store_default_warehouse_id===w.id?'selected':''}>${w.name}</option>`).join('')}</select></div>
      <div class="form-foot"><button class="btn btn-p" onclick="saveStoreSettings()">حفظ</button></div>
    </div>`;
};
window.saveStoreSettings = async () => {
  try { await DB.setAppSettingsBatch({ store_name: gv('ss-name'), store_receipt_width: document.getElementById('ss-width').value, store_default_warehouse_id: gv('ss-wh') }); toast('تم الحفظ', 's'); }
  catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};

PAGE_RENDER.mobileusersettings = async (root) => {
  const s = await DB.getAppSettingsBatch(['mobile_login_enabled', 'mobile_session_timeout_min']);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">اعدادات مستخدمي الجوال</div><div class="ph-sub">إعدادات عامة لتصفّح النظام من متصفح الجوال — لا يوجد تطبيق جوال مستقل (native app)</div></div></div>
    <div class="card" style="max-width:480px">
      <div class="fgroup" style="margin-bottom:12px"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="ms-enabled" style="width:auto" ${s.mobile_login_enabled!=='false'?'checked':''}> السماح بتسجيل الدخول من متصفح الجوال</label></div>
      <div class="fgroup" style="margin-bottom:12px"><label>مهلة انتهاء الجلسة (دقيقة)</label><input id="ms-timeout" type="number" value="${s.mobile_session_timeout_min||'60'}"></div>
      <div class="form-foot"><button class="btn btn-p" onclick="saveMobileSettings()">حفظ</button></div>
    </div>`;
};
window.saveMobileSettings = async () => {
  try { await DB.setAppSettingsBatch({ mobile_login_enabled: document.getElementById('ms-enabled').checked, mobile_session_timeout_min: gv('ms-timeout') }); toast('تم الحفظ', 's'); }
  catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};

PAGE_RENDER.appointmenthours = async (root) => {
  const s = await DB.getAppSettingsBatch(['appointment_hours']);
  let hours = {}; try { hours = s.appointment_hours ? JSON.parse(s.appointment_hours) : {}; } catch (e) { hours = {}; }
  const days = [['sun','الأحد'],['mon','الاثنين'],['tue','الثلاثاء'],['wed','الأربعاء'],['thu','الخميس'],['fri','الجمعة'],['sat','السبت']];
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">أوقات عمل المواعيد</div><div class="ph-sub">إعدادات عامة لأوقات الدوام — تخزين فقط بهذه المرحلة (بلا نظام حجز مواعيد فعلي خلفها)</div></div></div>
    <div class="card" style="max-width:560px"><div class="itw"><table><thead><tr><th>اليوم</th><th>يوم عمل؟</th><th>من</th><th>إلى</th></tr></thead>
    <tbody>${days.map(([k,l]) => { const d = hours[k] || {}; return `<tr><td>${l}</td>
      <td><input type="checkbox" id="ah-on-${k}" style="width:auto" ${d.open?'checked':''}></td>
      <td><input type="time" id="ah-from-${k}" value="${d.from||'09:00'}"></td>
      <td><input type="time" id="ah-to-${k}" value="${d.to||'17:00'}"></td></tr>`; }).join('')}</tbody></table></div>
    <div class="form-foot"><button class="btn btn-p" onclick="saveAppointmentHours()">حفظ</button></div></div>`;
};
window.saveAppointmentHours = async () => {
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const hours = {};
  days.forEach(k => { hours[k] = { open: document.getElementById('ah-on-'+k).checked, from: gv('ah-from-'+k), to: gv('ah-to-'+k) }; });
  try { await DB.setAppSettingsBatch({ appointment_hours: JSON.stringify(hours) }); toast('تم الحفظ', 's'); }
  catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};
