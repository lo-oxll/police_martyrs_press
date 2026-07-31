// ══════════════════════════════════════════════════════════════════
//  تعريف الألوان والقياسات + ماركات المواد + بطاقات الخصم
// ══════════════════════════════════════════════════════════════════

// ── الألوان والقياسات ─────────────────────────────
PAGE_RENDER.colorsizes = async (root) => {
  const [colors, sizes] = await Promise.all([DB.listColors(), DB.listSizes()]);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تعريف الألوان والقياسات</div><div class="ph-sub">قوائم مرجعية تُستخدم كخصائص اختيارية لبطاقات المواد مستقبلاً</div></div></div>
    <div class="card"><div class="card-title" style="display:flex;justify-content:space-between;align-items:center">الألوان <button class="btn btn-p btn-sm" onclick="openColorModal()">+ لون</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${colors.map(c => `<span class="chip" style="display:flex;align-items:center;gap:6px">${c.hex?`<span style="width:12px;height:12px;border-radius:50%;background:${c.hex};display:inline-block"></span>`:''}${c.name} <a href="javascript:deactivateColorConfirm('${c.id}')" style="color:var(--danger)">✕</a></span>`).join('') || '<span class="ph-sub">لا توجد ألوان بعد</span>'}</div></div>
    <div class="card"><div class="card-title" style="display:flex;justify-content:space-between;align-items:center">القياسات <button class="btn btn-p btn-sm" onclick="openSizeModal()">+ قياس</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${sizes.map(s => `<span class="chip">${s.name} <a href="javascript:deactivateSizeConfirm('${s.id}')" style="color:var(--danger)">✕</a></span>`).join('') || '<span class="ph-sub">لا توجد قياسات بعد</span>'}</div></div>`;
};
window.openColorModal = () => {
  showModal('لون جديد', `<div class="fgroup"><label>الاسم</label><input id="m-cl-name"></div><div class="fgroup"><label>كود اللون (اختياري)</label><input id="m-cl-hex" type="color" style="height:40px"></div>`, async () => {
    const name = gv('m-cl-name'); if (!name) { toast('الاسم مطلوب', 'e'); return false; }
    try { await DB.createColor({ name, hex: document.getElementById('m-cl-hex').value }); toast('تم', 's'); go('colorsizes'); }
    catch (e) { toast('تعذر: ' + e.message, 'e'); return false; }
  });
};
window.deactivateColorConfirm = async (id) => { try { await DB.deactivateColor(id); go('colorsizes'); } catch (e) { toast('تعذر: ' + e.message, 'e'); } };
window.openSizeModal = () => {
  showModal('قياس جديد', `<div class="fgroup"><label>الاسم</label><input id="m-sz-name" placeholder="مثال: S، M، L أو 40، 41..."></div><div class="fgroup"><label>ترتيب العرض</label><input id="m-sz-order" type="number" value="0"></div>`, async () => {
    const name = gv('m-sz-name'); if (!name) { toast('الاسم مطلوب', 'e'); return false; }
    try { await DB.createSize({ name, sort_order: Number(gv('m-sz-order'))||0 }); toast('تم', 's'); go('colorsizes'); }
    catch (e) { toast('تعذر: ' + e.message, 'e'); return false; }
  });
};
window.deactivateSizeConfirm = async (id) => { try { await DB.deactivateSize(id); go('colorsizes'); } catch (e) { toast('تعذر: ' + e.message, 'e'); } };

// ── ماركات المواد ─────────────────────────────
PAGE_RENDER.materialbrands = async (root) => {
  const list = await DB.listBrands();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تعريف ماركات المواد</div><div class="ph-sub">قائمة مرجعية للعلامات التجارية</div></div>
      <div class="ph-actions"><button class="btn btn-p btn-sm" onclick="openBrandModal()">+ ماركة جديدة</button></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الاسم</th><th>ملاحظات</th><th></th></tr></thead>
    <tbody>${list.map(b => `<tr><td>${b.name}</td><td>${b.notes||'—'}</td><td><button class="btn btn-d btn-sm" onclick="deactivateBrandConfirm('${b.id}')">إلغاء تفعيل</button></td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد ماركات بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openBrandModal = () => {
  showModal('ماركة جديدة', `<div class="fgroup"><label>الاسم</label><input id="m-bd-name"></div><div class="fgroup"><label>ملاحظات</label><input id="m-bd-notes"></div>`, async () => {
    const name = gv('m-bd-name'); if (!name) { toast('الاسم مطلوب', 'e'); return false; }
    try { await DB.createBrand({ name, notes: gv('m-bd-notes') }); toast('تم', 's'); go('materialbrands'); }
    catch (e) { toast('تعذر: ' + e.message, 'e'); return false; }
  });
};
window.deactivateBrandConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذه الماركة؟')) return;
  try { await DB.deactivateBrand(id); toast('تم', 's'); go('materialbrands'); } catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── تعريف بطاقات الخصم ─────────────────────────────
PAGE_RENDER.discountcards = async (root) => {
  const list = await DB.listDiscountCards();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تعريف بطاقات الخصم</div><div class="ph-sub">أكواد خصم بنسبة مئوية، بفترة صلاحية اختيارية</div></div>
      <div class="ph-actions">${can('admin','accountant','manager') ? `<button class="btn btn-p btn-sm" onclick="openDiscountModal()">+ بطاقة خصم</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الكود</th><th>الاسم</th><th>النسبة</th><th>من</th><th>إلى</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(d => `<tr><td class="doc-num">${d.code}</td><td>${d.name}</td><td class="mono gold-txt">${d.discount_percent}%</td>
      <td class="mono">${d.valid_from||'—'}</td><td class="mono">${d.valid_to||'—'}</td><td>${d.is_active?'<span class="chip chip-ok">فعّالة</span>':'<span class="chip chip-danger">معطّلة</span>'}</td>
      <td>${d.is_active && can('admin','accountant','manager') ? `<button class="btn btn-d btn-sm" onclick="deactivateDiscountConfirm('${d.id}')">تعطيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="ec">لا توجد بطاقات خصم بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openDiscountModal = () => {
  showModal('بطاقة خصم جديدة', `
    <div class="fg2"><div class="fgroup"><label>الكود</label><input id="m-dc-code" value="DISC-${Date.now().toString().slice(-6)}"></div>
    <div class="fgroup"><label>النسبة %</label><input id="m-dc-pct" type="number" step="0.01" max="100"></div></div>
    <div class="fgroup"><label>الاسم</label><input id="m-dc-name"></div>
    <div class="fg2"><div class="fgroup"><label>صالحة من</label><input id="m-dc-from" type="date"></div><div class="fgroup"><label>إلى</label><input id="m-dc-to" type="date"></div></div>
  `, async () => {
    const code = gv('m-dc-code'), name = gv('m-dc-name'), pct = Number(gv('m-dc-pct'));
    if (!code || !name || !pct) { toast('الكود والاسم والنسبة مطلوبة', 'e'); return false; }
    try { await DB.createDiscountCard({ code, name, discount_percent: pct, valid_from: gv('m-dc-from')||null, valid_to: gv('m-dc-to')||null }); toast('تم', 's'); go('discountcards'); }
    catch (e) { toast('تعذر: ' + e.message, 'e'); return false; }
  });
};
window.deactivateDiscountConfirm = async (id) => {
  if (!confirm('تعطيل بطاقة الخصم هذه؟')) return;
  try { await DB.deactivateDiscountCard(id); toast('تم', 's'); go('discountcards'); } catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
