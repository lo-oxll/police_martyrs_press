// ══════════════════════════════════════════════════════════════════
//  المرحلة ٥: طلبيات البيع والشراء + ايصالات الشحن + يومية مبيعات
//  ملاحظة: الطلبية "نية" تسبق الفاتورة — تنفيذها الفعلي يتم يدوياً من صفحتي
//  "ادخال فواتير"/"اخراج فواتير" الموجودتين، ثم تُوسَم الطلبية "مُنفَّذة" هنا
//  مع رقم الفاتورة الفعلية للتتبّع (بلا ربط تلقائي تجنّباً لكسر آلية الترحيل الحالية).
// ══════════════════════════════════════════════════════════════════

// ── طلبيات البيع والشراء ─────────────────────────────
PAGE_RENDER.salespurchaseorders = async (root) => {
  const [saleOrders, purchOrders] = await Promise.all([DB.listOrders('sale'), DB.listOrders('purchase')]);
  const renderTable = (list, type) => `<div class="itw"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>${type==='sale'?'الزبون':'الجهة'}</th><th>المخزن</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(o => `<tr><td class="doc-num">${o.doc_num}</td><td class="mono">${o.order_date}</td>
      <td>${o.customers?.name || o.party_name || '—'}</td><td>${o.warehouses?.name || '—'}</td>
      <td>${o.status==='pending'?'<span class="chip chip-gold">معلّقة</span>':o.status==='fulfilled'?'<span class="chip chip-ok">مُنفَّذة'+(o.fulfilled_doc_num?' — '+o.fulfilled_doc_num:'')+'</span>':'<span class="chip chip-danger">ملغاة</span>'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-o btn-sm" onclick="viewOrder('${o.id}')">عرض</button>
        ${o.status==='pending' && can('admin','accountant') ? `<button class="btn btn-s btn-sm" onclick="fulfillOrderPrompt('${o.id}')">تنفيذ</button>
        <button class="btn btn-d btn-sm" onclick="cancelOrderConfirm('${o.id}')">إلغاء</button>` : ''}
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteOrderConfirm('${o.id}','${o.doc_num}')">حذف</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد طلبيات بعد</td></tr>'}
    </tbody></table></div>`;
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🧾 طلبيات البيع والشراء</div><div class="ph-sub">نية شراء/بيع تسبق الفاتورة الفعلية — تُنفَّذ لاحقاً بربطها يدوياً برقم الفاتورة</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openOrderModal('purchase')">+ طلبية شراء</button><button class="btn btn-p btn-sm" onclick="openOrderModal('sale')">+ طلبية بيع</button>` : ''}</div></div>
    <div class="card"><div class="card-title">طلبيات الشراء</div>${renderTable(purchOrders, 'purchase')}</div>
    <div class="card"><div class="card-title">طلبيات البيع</div>${renderTable(saleOrders, 'sale')}</div>`;
};

window.openOrderModal = async (orderType) => {
  const [warehouses, customers] = await Promise.all([DB.listWarehouses(), orderType === 'sale' ? DB.listCustomers() : []]);
  let items = [];
  const renderItemsTable = () => items.map((it, i) => `<tr><td>${it.label}</td><td class="mono">${fmtQty(it.qty)}</td><td class="mono">${fmt(it.unit_price)}</td>
    <td><button class="btn btn-d btn-sm" onclick="removeOrderModalItem(${i})">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="ec">لم تُضَف مواد بعد</td></tr>';

  showModal(orderType === 'sale' ? 'طلبية بيع جديدة' : 'طلبية شراء جديدة', `
    <div class="fg2">
      <div class="fgroup"><label>رقم الطلبية</label><input id="m-ord-num" value="ORD-${Date.now().toString().slice(-8)}"></div>
      <div class="fgroup"><label>التاريخ</label><input id="m-ord-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="fg2">
      ${orderType === 'sale'
        ? `<div class="fgroup"><label>الزبون</label><select id="m-ord-customer">${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>`
        : `<div class="fgroup"><label>اسم المورد/الجهة</label><input id="m-ord-party"></div>`}
      <div class="fgroup"><label>المخزن</label><select id="m-ord-wh">${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
    </div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-ord-notes"></div>
    <div class="card-title" style="margin-top:14px">أصناف الطلبية</div>
    <div class="ac-wrap"><input id="m-ord-mat-search" placeholder="ابحث عن مادة لإضافتها..." autocomplete="off"><div class="ac-portal" id="m-ord-mat-portal"></div></div>
    <div class="fg" style="margin-top:8px">
      <div class="fgroup"><label>الكمية</label><input id="m-ord-qty" type="number" step="0.001"></div>
      <div class="fgroup"><label>سعر الوحدة</label><input id="m-ord-price" type="number" step="1"></div>
      <div class="fgroup" style="justify-content:flex-end;display:flex;align-items:flex-end"><button class="btn btn-o" id="m-ord-add-item" type="button">+ إضافة للطلبية</button></div>
    </div>
    <div class="itw" style="margin-top:10px"><table><thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th><th></th></tr></thead><tbody id="m-ord-items">${renderItemsTable()}</tbody></table></div>
  `, async () => {
    const doc_num = gv('m-ord-num'), order_date = gv('m-ord-date'), warehouse_id = gv('m-ord-wh'), notes = gv('m-ord-notes');
    if (!doc_num) { toast('رقم الطلبية مطلوب', 'e'); return false; }
    if (!items.length) { toast('أضف صنفاً واحداً على الأقل', 'e'); return false; }
    const header = { doc_num, order_type: orderType, order_date, warehouse_id: warehouse_id || null, notes: notes || null };
    if (orderType === 'sale') header.customer_id = gv('m-ord-customer') || null;
    else header.party_name = gv('m-ord-party') || null;
    try {
      await DB.createOrder(header, items.map(it => ({ material_id: it.material_id, qty: it.qty, unit_price: it.unit_price })));
      toast('تم حفظ الطلبية', 's'); go('salespurchaseorders');
    } catch (e) { toast('تعذر الحفظ: ' + (friendlyStockError ? friendlyStockError(e.message) : e.message), 'e'); return false; }
  });

  let pickedMaterial = null;
  bindAutocomplete(document.getElementById('m-ord-mat-search'), document.getElementById('m-ord-mat-portal'),
    async (term) => term ? DB.listMaterials(term, 8) : [],
    (m) => { pickedMaterial = m; sv('m-ord-mat-search', `${m.store_num} — ${m.name}`); },
    (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);
  document.getElementById('m-ord-add-item').addEventListener('click', () => {
    const qty = Number(gv('m-ord-qty')), price = Number(gv('m-ord-price')) || 0;
    if (!pickedMaterial) { toast('اختر مادة من قائمة الإكمال التلقائي', 'e'); return; }
    if (!qty || qty <= 0) { toast('أدخل كمية صحيحة', 'e'); return; }
    items.push({ material_id: pickedMaterial.id, label: `${pickedMaterial.store_num} — ${pickedMaterial.name}`, qty, unit_price: price });
    document.getElementById('m-ord-items').innerHTML = renderItemsTable();
    sv('m-ord-mat-search', ''); sv('m-ord-qty', ''); sv('m-ord-price', ''); pickedMaterial = null;
  });
  window.removeOrderModalItem = (i) => { items.splice(i, 1); document.getElementById('m-ord-items').innerHTML = renderItemsTable(); };
};

window.viewOrder = async (id) => {
  const items = await DB.orderItems(id);
  showModal('أصناف الطلبية', `<div class="itw"><table><thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.materials?.store_num} — ${it.materials?.name}</td><td class="mono">${fmtQty(it.qty)} ${it.materials?.unit||''}</td><td class="mono">${fmt(it.unit_price)}</td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد أصناف</td></tr>'}</tbody></table></div>`, async () => {});
};
window.fulfillOrderPrompt = (id) => {
  const docNum = prompt('أدخل رقم الفاتورة الفعلية (بعد إنشائها من صفحة ادخال/اخراج فواتير):');
  if (docNum === null) return;
  DB.updateOrderStatus(id, 'fulfilled', docNum.trim() || null)
    .then(() => { toast('تم وسم الطلبية كمُنفَّذة', 's'); go('salespurchaseorders'); })
    .catch(e => toast('تعذر: ' + e.message, 'e'));
};
window.cancelOrderConfirm = async (id) => {
  if (!confirm('إلغاء هذه الطلبية؟')) return;
  try { await DB.updateOrderStatus(id, 'cancelled'); toast('تم الإلغاء', 's'); go('salespurchaseorders'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
window.deleteOrderConfirm = async (id, docNum) => {
  if (!confirm(`حذف نهائي للطلبية "${docNum}"؟`)) return;
  try { await DB.deleteOrder(id, docNum); toast('تم الحذف', 's'); go('salespurchaseorders'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── ايصالات الشحن ─────────────────────────────
PAGE_RENDER.shippingreceipts = async (root) => {
  const list = await DB.listShippingReceipts();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🚚 ايصالات الشحن</div><div class="ph-sub">تتبّع شحنات الاستلام/الإصدار — الناقل والمركبة والسائق</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openShippingModal()">+ إيصال شحن جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>الاتجاه</th><th>مرتبط بفاتورة</th><th>الناقل</th><th>المركبة</th><th>السائق</th><th></th></tr></thead>
    <tbody>${list.map(r => `<tr><td class="doc-num">${r.doc_num}</td><td class="mono">${r.ship_date}</td>
      <td>${r.direction==='inbound' ? '<span class="chip chip-ok">وارد</span>' : '<span class="chip chip-danger">صادر</span>'}</td>
      <td class="mono">${r.related_doc_num||'—'}</td><td>${r.carrier_name||'—'}</td><td class="mono">${r.vehicle_no||'—'}</td><td>${r.driver_name||'—'}</td>
      <td>${can('admin','accountant') ? `<button class="btn btn-o btn-sm" onclick='openShippingModal(${JSON.stringify(r)})'>تعديل</button>` : ''}
      ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteShippingConfirm('${r.id}','${r.doc_num}')">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="ec">لا توجد ايصالات شحن بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openShippingModal = (r = null) => {
  showModal(r ? 'تعديل إيصال شحن' : 'إيصال شحن جديد', `
    <div class="fg2">
      <div class="fgroup"><label>رقم الإيصال</label><input id="m-sh-num" value="${r?.doc_num || 'SHP-' + Date.now().toString().slice(-8)}" ${r?'disabled':''}></div>
      <div class="fgroup"><label>التاريخ</label><input id="m-sh-date" type="date" value="${r?.ship_date || todayISO()}"></div>
    </div>
    <div class="fgroup"><label>الاتجاه</label><select id="m-sh-dir"><option value="inbound" ${r?.direction==='inbound'?'selected':''}>وارد (مع فاتورة استلام)</option><option value="outbound" ${r?.direction==='outbound'?'selected':''}>صادر (مع فاتورة إصدار)</option></select></div>
    <div class="fgroup"><label>رقم الفاتورة المرتبطة (اختياري)</label><input id="m-sh-doc" value="${r?.related_doc_num||''}"></div>
    <div class="fg2">
      <div class="fgroup"><label>اسم الناقل/الشركة</label><input id="m-sh-carrier" value="${r?.carrier_name||''}"></div>
      <div class="fgroup"><label>رقم المركبة</label><input id="m-sh-vehicle" value="${r?.vehicle_no||''}"></div>
    </div>
    <div class="fg2">
      <div class="fgroup"><label>اسم السائق</label><input id="m-sh-driver" value="${r?.driver_name||''}"></div>
      <div class="fgroup"><label>هاتف السائق</label><input id="m-sh-driverphone" value="${r?.driver_phone||''}"></div>
    </div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-sh-notes" value="${r?.notes||''}"></div>
  `, async () => {
    const patch = {
      ship_date: gv('m-sh-date'), direction: document.getElementById('m-sh-dir').value, related_doc_num: gv('m-sh-doc') || null,
      carrier_name: gv('m-sh-carrier') || null, vehicle_no: gv('m-sh-vehicle') || null,
      driver_name: gv('m-sh-driver') || null, driver_phone: gv('m-sh-driverphone') || null, notes: gv('m-sh-notes') || null,
    };
    try {
      if (r) await DB.updateShippingReceipt(r.id, patch);
      else await DB.createShippingReceipt({ doc_num: gv('m-sh-num'), ...patch });
      toast('تم الحفظ', 's'); go('shippingreceipts');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deleteShippingConfirm = async (id, docNum) => {
  if (!confirm(`حذف إيصال الشحن "${docNum}"؟`)) return;
  try { await DB.deleteShippingReceipt(id, docNum); toast('تم الحذف', 's'); go('shippingreceipts'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── يومية مبيعات ─────────────────────────────
PAGE_RENDER.salesjournal = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📗 يومية مبيعات</div><div class="ph-sub">كل فواتير الإصدار عبر جميع المخازن بفترة معيّنة، مع رصيد متراكم</div></div></div>
    <div class="card"><div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="sj-from" type="date" value="${todayISO().slice(0,8)}01"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="sj-to" type="date" value="${todayISO()}"></div>
    </div><div class="form-foot"><button class="btn btn-p" onclick="runSalesJournal()">عرض</button></div></div>
    <div id="sj-result"></div>`;
};
window.runSalesJournal = async () => {
  const from = gv('sj-from'), to = gv('sj-to');
  const box = document.getElementById('sj-result'); box.innerHTML = '<div class="ec">جارِ التحميل...</div>';
  try {
    const rows = await DB.salesJournal(from, to);
    const total = rows.reduce((s, r) => s + r.total, 0);
    box.innerHTML = `<div class="card"><div class="itw"><table><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المخزن</th><th>القيمة</th><th>الرصيد المتراكم</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="mono">${r.date}</td><td class="doc-num">${r.doc_num}</td><td>${r.warehouse}</td><td class="mono">${fmt(r.total)}</td><td class="mono gold-txt">${fmtIQD(r.running)}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد مبيعات بهذه الفترة</td></tr>'}
      </tbody></table></div><div class="grand-bar"><span class="grand-lbl">إجمالي المبيعات</span><span class="grand-val">${fmtIQD(total)}</span></div>
      <div class="form-foot"><button class="btn btn-o btn-sm" onclick='exportRowsToExcel(${JSON.stringify(rows.map(r=>({'التاريخ':r.date,'الفاتورة':r.doc_num,'المخزن':r.warehouse,'القيمة':r.total})))}, "يومية مبيعات", "يومية_مبيعات.xlsx")'>تصدير إكسل</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="card"><div class="ec">تعذر التحميل: ${e.message}</div></div>`; }
};
