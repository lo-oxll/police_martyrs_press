// ══════════════════════════════════════════════════════════════════
//  المرحلة ٧ (٢): التصنيع — نموذج تصنيع (BOM) + طلبية تصنيع
//  تنفيذ الطلبية يستهلك المكوّنات وينتج المادة الجاهزة عبر نفس آلية وثائق
//  الإصدار/الاستلام الآمنة الموجودة أصلاً (بلا لمس مباشر لجدول الأرصدة).
// ══════════════════════════════════════════════════════════════════

// ── نموذج تصنيع (BOM) ─────────────────────────────
PAGE_RENDER.mfgmodel = async (root) => {
  const list = await DB.listManufacturingModels();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🧬 نموذج تصنيع (BOM)</div><div class="ph-sub">وصفة تحويل مكوّنات خام إلى مادة جاهزة، لكل "دفعة" (batch)</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openMfgModelModal()">+ نموذج جديد</button>` : ''}</div></div>
    ${list.map(m => `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${m.code} — ${m.name} <span class="ph-sub">(ينتج ${fmtQty(m.output_qty_per_batch)} ${m.materials?.unit||''} من ${m.materials?.store_num} — ${m.materials?.name} لكل دفعة)</span></span>
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deactivateMfgModelConfirm('${m.id}')">إلغاء تفعيل</button>` : ''}
      </div>
      <div class="itw"><table><thead><tr><th>المكوّن</th><th>الكمية لكل دفعة</th></tr></thead>
      <tbody>${(m.manufacturing_model_components||[]).map(c => `<tr><td>${c.materials?.store_num} — ${c.materials?.name}</td><td class="mono">${fmtQty(c.qty_per_batch)} ${c.materials?.unit||''}</td></tr>`).join('') || '<tr><td colspan="2" class="ec">لا توجد مكوّنات</td></tr>'}</tbody></table></div>
    </div>`).join('') || '<div class="card"><div class="ec">لا توجد نماذج تصنيع بعد</div></div>'}`;
};
window.openMfgModelModal = async () => {
  let components = [];
  let outputMaterial = null;
  const renderCompTable = () => components.map((c, i) => `<tr><td>${c.label}</td><td class="mono">${fmtQty(c.qty_per_batch)}</td><td><button class="btn btn-d btn-sm" onclick="removeMfgComponent(${i})">✕</button></td></tr>`).join('') || '<tr><td colspan="3" class="ec">لم تُضَف مكوّنات بعد</td></tr>';

  showModal('نموذج تصنيع جديد', `
    <div class="fg2">
      <div class="fgroup"><label>الرمز</label><input id="m-mm-code" value="BOM-${Date.now().toString().slice(-6)}"></div>
      <div class="fgroup"><label>الاسم</label><input id="m-mm-name"></div>
    </div>
    <div class="fg2">
      <div class="fgroup"><label>المادة الجاهزة (الناتج)</label><div class="ac-wrap"><input id="m-mm-output-search" placeholder="ابحث عن المادة الناتجة..." autocomplete="off"><div class="ac-portal" id="m-mm-output-portal"></div></div></div>
      <div class="fgroup"><label>الكمية المنتَجة لكل دفعة</label><input id="m-mm-outqty" type="number" step="0.001" value="1"></div>
    </div>
    <div class="card-title" style="margin-top:14px">المكوّنات (لكل دفعة واحدة)</div>
    <div class="ac-wrap"><input id="m-mm-comp-search" placeholder="ابحث عن مكوّن لإضافته..." autocomplete="off"><div class="ac-portal" id="m-mm-comp-portal"></div></div>
    <div class="fg" style="margin-top:8px">
      <div class="fgroup"><label>الكمية</label><input id="m-mm-comp-qty" type="number" step="0.001"></div>
      <div class="fgroup" style="justify-content:flex-end;display:flex;align-items:flex-end"><button class="btn btn-o" id="m-mm-add-comp" type="button">+ إضافة مكوّن</button></div>
    </div>
    <div class="itw" style="margin-top:10px"><table><thead><tr><th>المكوّن</th><th>الكمية</th><th></th></tr></thead><tbody id="m-mm-comps">${renderCompTable()}</tbody></table></div>
  `, async () => {
    const code = gv('m-mm-code'), name = gv('m-mm-name'), outQty = Number(gv('m-mm-outqty'));
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    if (!outputMaterial) { toast('اختر المادة الجاهزة (الناتج)', 'e'); return false; }
    if (!components.length) { toast('أضف مكوّناً واحداً على الأقل', 'e'); return false; }
    try {
      await DB.createManufacturingModel(
        { code, name, output_material_id: outputMaterial.id, output_qty_per_batch: outQty || 1 },
        components.map(c => ({ material_id: c.material_id, qty_per_batch: c.qty_per_batch }))
      );
      toast('تم حفظ النموذج', 's'); go('mfgmodel');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });

  bindAutocomplete(document.getElementById('m-mm-output-search'), document.getElementById('m-mm-output-portal'),
    async (term) => term ? DB.listMaterials(term, 8) : [],
    (m) => { outputMaterial = m; sv('m-mm-output-search', `${m.store_num} — ${m.name}`); },
    (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);

  let pickedComponent = null;
  bindAutocomplete(document.getElementById('m-mm-comp-search'), document.getElementById('m-mm-comp-portal'),
    async (term) => term ? DB.listMaterials(term, 8) : [],
    (m) => { pickedComponent = m; sv('m-mm-comp-search', `${m.store_num} — ${m.name}`); },
    (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);
  document.getElementById('m-mm-add-comp').addEventListener('click', () => {
    const qty = Number(gv('m-mm-comp-qty'));
    if (!pickedComponent) { toast('اختر مكوّناً من قائمة الإكمال التلقائي', 'e'); return; }
    if (!qty || qty <= 0) { toast('أدخل كمية صحيحة', 'e'); return; }
    components.push({ material_id: pickedComponent.id, label: `${pickedComponent.store_num} — ${pickedComponent.name}`, qty_per_batch: qty });
    document.getElementById('m-mm-comps').innerHTML = renderCompTable();
    sv('m-mm-comp-search', ''); sv('m-mm-comp-qty', ''); pickedComponent = null;
  });
  window.removeMfgComponent = (i) => { components.splice(i, 1); document.getElementById('m-mm-comps').innerHTML = renderCompTable(); };
};
window.deactivateMfgModelConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا النموذج؟')) return;
  try { await DB.deactivateManufacturingModel(id); toast('تم', 's'); go('mfgmodel'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── طلبية تصنيع ─────────────────────────────
PAGE_RENDER.mfgorder = async (root) => {
  const list = await DB.listManufacturingOrders();
  const stChip = (s) => s === 'planned' ? '<span class="chip chip-gold">مخطَّطة</span>' : s === 'completed' ? '<span class="chip chip-ok">مكتملة</span>' : '<span class="chip chip-danger">ملغاة</span>';
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🏭 طلبية تصنيع</div><div class="ph-sub">تنفيذ الطلبية يستهلك المكوّنات وينتج المادة الجاهزة فوراً بترحيل محاسبي كامل</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openMfgOrderModal()">+ طلبية جديدة</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرقم</th><th>النموذج</th><th>المخزن</th><th>الدفعات</th><th>التاريخ</th><th>الحالة</th><th>الكلفة الفعلية</th><th></th></tr></thead>
    <tbody>${list.map(o => `<tr><td class="doc-num">${o.doc_num}</td><td>${o.manufacturing_models?.name||''}</td><td>${o.warehouses?.name||''}</td>
      <td class="mono">${fmtQty(o.batches)}</td><td class="mono">${o.order_date}</td><td>${stChip(o.status)}</td>
      <td class="mono gold-txt">${o.actual_cost?fmtIQD(o.actual_cost):'—'}</td>
      <td style="display:flex;gap:6px">
        ${o.status==='planned' && can('admin','accountant') ? `<button class="btn btn-s btn-sm" onclick="completeMfgOrderConfirm('${o.id}')">تنفيذ</button>
        <button class="btn btn-d btn-sm" onclick="cancelMfgOrderConfirm('${o.id}')">إلغاء</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="8" class="ec">لا توجد طلبيات تصنيع بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openMfgOrderModal = async () => {
  const [models, warehouses] = await Promise.all([DB.listManufacturingModels(), DB.listWarehouses().then(scopedWarehouses)]);
  if (!models.length) { toast('أنشئ نموذج تصنيع (BOM) أولاً قبل إصدار طلبية', 'e'); return; }
  showModal('طلبية تصنيع جديدة', `
    <div class="fg2">
      <div class="fgroup"><label>رقم الطلبية</label><input id="m-mo-num" value="MFG-${Date.now().toString().slice(-8)}"></div>
      <div class="fgroup"><label>التاريخ</label><input id="m-mo-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="fgroup"><label>نموذج التصنيع (BOM)</label><select id="m-mo-model">${models.map(m => `<option value="${m.id}">${m.code} — ${m.name}</option>`).join('')}</select></div>
    <div class="fg2">
      <div class="fgroup"><label>المخزن (استهلاك وإنتاج)</label><select id="m-mo-wh">${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>عدد الدفعات</label><input id="m-mo-batches" type="number" step="0.001" value="1"></div>
    </div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-mo-notes"></div>
  `, async () => {
    const doc_num = gv('m-mo-num'), batches = Number(gv('m-mo-batches'));
    if (!doc_num || !batches || batches <= 0) { toast('رقم الطلبية وعدد الدفعات مطلوبان', 'e'); return false; }
    try {
      await DB.createManufacturingOrder({ doc_num, model_id: gv('m-mo-model'), warehouse_id: gv('m-mo-wh'), batches, order_date: gv('m-mo-date'), notes: gv('m-mo-notes') });
      toast('تم إنشاء الطلبية (بحالة مخطَّطة)', 's'); go('mfgorder');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.completeMfgOrderConfirm = async (id) => {
  if (!confirm('تنفيذ هذه الطلبية سيستهلك المكوّنات من المخزن فوراً وينتج المادة الجاهزة، مع ترحيل القيود المحاسبية. متابعة؟')) return;
  try {
    const res = await DB.completeManufacturingOrder(id);
    toast(`تم التنفيذ — أُنتِج ${fmtQty(res.outputQty)} بكلفة إجمالية ${fmtIQD(res.totalCost)}`, 's');
    go('mfgorder');
  } catch (e) { toast('تعذر التنفيذ: ' + (friendlyStockError ? friendlyStockError(e.message) : e.message), 'e'); }
};
window.cancelMfgOrderConfirm = async (id) => {
  if (!confirm('إلغاء هذه الطلبية؟')) return;
  try { await DB.cancelManufacturingOrder(id); toast('تم الإلغاء', 's'); go('mfgorder'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
