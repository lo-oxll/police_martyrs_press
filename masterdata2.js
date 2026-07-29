// ══════════════════════════════════════════════════════════════════
//  المرحلة ٣: تعريف المناطق والشوارع + بطاقة صنف رئيسي + بطاقة تشابه مواد
//             + توليد بطاقات مواد بشكل جماعي
// ══════════════════════════════════════════════════════════════════

// ── تعريف المناطق والشوارع ─────────────────────────────
PAGE_RENDER.regions = async (root) => {
  const list = await DB.listRegions();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🗺 تعريف المناطق والشوارع</div><div class="ph-sub">كل منطقة تحتوي شوارعها — تُستخدم لاحقاً كقائمة عناوين موحّدة (بطاقة الزبون وغيرها)</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openRegionModal()">+ منطقة جديدة</button>` : ''}</div></div>
    ${list.map(r => `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>📍 ${r.name}</span>
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteRegionConfirm('${r.id}','${r.name.replace(/'/g,"")}')">حذف المنطقة</button>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        ${(r.streets||[]).map(s => `<span class="chip">${s.name} ${can('admin') ? `<a href="javascript:deleteStreetConfirm('${s.id}','${s.name.replace(/'/g,"")}')" style="color:var(--danger);margin-right:4px">✕</a>` : ''}</span>`).join('') || '<span class="ph-sub">لا توجد شوارع بعد بهذه المنطقة</span>'}
      </div>
      ${can('admin','accountant') ? `<div style="display:flex;gap:8px"><input id="new-street-${r.id}" placeholder="اسم شارع جديد" style="max-width:260px"><button class="btn btn-o btn-sm" onclick="addStreetInline('${r.id}')">+ إضافة شارع</button></div>` : ''}
    </div>`).join('') || '<div class="card"><div class="ec">لا توجد مناطق بعد</div></div>'}`;
};
window.openRegionModal = () => {
  showModal('منطقة جديدة', `<div class="fgroup"><label>اسم المنطقة</label><input id="m-rg-name"></div>`, async () => {
    const name = gv('m-rg-name');
    if (!name) { toast('اسم المنطقة مطلوب', 'e'); return false; }
    try { await DB.createRegion(name); toast('تم الحفظ', 's'); go('regions'); }
    catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deleteRegionConfirm = async (id, name) => {
  if (!confirm(`حذف منطقة "${name}" وكل شوارعها؟`)) return;
  try { await DB.deleteRegion(id, name); toast('تم الحذف', 's'); go('regions'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};
window.addStreetInline = async (regionId) => {
  const input = document.getElementById('new-street-' + regionId);
  const name = (input.value || '').trim();
  if (!name) { toast('أدخل اسم الشارع', 'e'); return; }
  try { await DB.createStreet(regionId, name); toast('تمت الإضافة', 's'); go('regions'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
window.deleteStreetConfirm = async (id, name) => {
  if (!confirm(`حذف شارع "${name}"؟`)) return;
  try { await DB.deleteStreet(id, name); toast('تم الحذف', 's'); go('regions'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── بطاقة صنف رئيسي ─────────────────────────────
PAGE_RENDER.matcategory = async (root) => {
  const list = await DB.listMaterialCategories();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🏷 بطاقة صنف رئيسي</div><div class="ph-sub">قائمة مرجعية موحّدة لتصنيفات المواد (اختياري استخدامها عند تعبئة "التصنيف" بدليل المواد)</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openMatCategoryModal()">+ صنف رئيسي جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th></th></tr></thead>
    <tbody>${list.map(c => `<tr><td class="mono">${c.code}</td><td>${c.name}</td>
      <td>${can('admin','accountant') ? `<button class="btn btn-o btn-sm" onclick='openMatCategoryModal(${JSON.stringify(c)})'>تعديل</button>
      <button class="btn btn-d btn-sm" onclick="deactivateMatCategoryConfirm('${c.id}')">إلغاء تفعيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="ec">لا توجد أصناف رئيسية بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openMatCategoryModal = (c = null) => {
  showModal(c ? 'تعديل صنف رئيسي' : 'صنف رئيسي جديد', `
    <div class="fgroup"><label>الرمز</label><input id="m-mc-code" value="${c?.code||''}" ${c ? 'disabled' : ''}></div>
    <div class="fgroup"><label>الاسم</label><input id="m-mc-name" value="${c?.name||''}"></div>
  `, async () => {
    const code = gv('m-mc-code'), name = gv('m-mc-name');
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    try {
      if (c) await DB.updateMaterialCategory(c.id, { name });
      else await DB.createMaterialCategory({ code, name });
      toast('تم الحفظ', 's'); go('matcategory');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deactivateMatCategoryConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا الصنف الرئيسي؟')) return;
  try { await DB.deactivateMaterialCategory(id); toast('تم', 's'); go('matcategory'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── بطاقة تشابه مواد ─────────────────────────────
PAGE_RENDER.materialsimilar = async (root) => {
  const groups = await DB.listSimilarityGroups();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🔗 بطاقة تشابه مواد</div><div class="ph-sub">مجموعات مواد بديلة/متكافئة — تفيد بالاستعلام عن بدائل مادة نافدة الرصيد</div></div>
      <div class="ph-actions">${can('admin','accountant') ? `<button class="btn btn-p btn-sm" onclick="openSimGroupModal()">+ مجموعة جديدة</button>` : ''}</div></div>
    ${groups.map(g => `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${g.name}${g.notes ? ' — <span class="ph-sub" style="font-size:11px">'+g.notes+'</span>' : ''}</span>
        ${can('admin','accountant') ? `<button class="btn btn-d btn-sm" onclick="deleteSimGroupConfirm('${g.id}','${g.name.replace(/'/g,"")}')">حذف المجموعة</button>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        ${(g.material_similarity_items||[]).map(it => `<span class="chip chip-ok">${it.materials?.store_num} — ${it.materials?.name} ${can('admin','accountant') ? `<a href="javascript:removeSimItemConfirm('${it.id}','${g.id}')" style="color:var(--danger);margin-right:4px">✕</a>` : ''}</span>`).join('') || '<span class="ph-sub">لا توجد مواد بهذه المجموعة بعد</span>'}
      </div>
      ${can('admin','accountant') ? `<div class="ac-wrap" style="max-width:340px"><input id="sim-search-${g.id}" placeholder="ابحث عن مادة لإضافتها..." autocomplete="off"><div class="ac-portal" id="sim-portal-${g.id}"></div></div>` : ''}
    </div>`).join('') || '<div class="card"><div class="ec">لا توجد مجموعات تشابه بعد</div></div>'}`;

  groups.forEach(g => {
    if (!can('admin','accountant')) return;
    const input = document.getElementById(`sim-search-${g.id}`), portal = document.getElementById(`sim-portal-${g.id}`);
    if (!input) return;
    bindAutocomplete(input, portal, async (term) => term ? DB.listMaterials(term, 8) : [], async (m) => {
      try { await DB.addMaterialToGroup(g.id, m.id); toast('تمت الإضافة', 's'); go('materialsimilar'); }
      catch (e) { toast('تعذر: ' + e.message, 'e'); }
    }, (m) => `<div class="ac-item"><span class="ac-code">${m.store_num}</span><span>${m.name}</span></div>`);
  });
};
window.openSimGroupModal = () => {
  showModal('مجموعة تشابه جديدة', `
    <div class="fgroup"><label>اسم المجموعة</label><input id="m-sg-name" placeholder="مثال: بدائل زيت المحرك 20W50"></div>
    <div class="fgroup"><label>ملاحظات (اختياري)</label><input id="m-sg-notes"></div>
  `, async () => {
    const name = gv('m-sg-name');
    if (!name) { toast('اسم المجموعة مطلوب', 'e'); return false; }
    try { await DB.createSimilarityGroup(name, gv('m-sg-notes')); toast('تم الحفظ', 's'); go('materialsimilar'); }
    catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deleteSimGroupConfirm = async (id, name) => {
  if (!confirm(`حذف مجموعة "${name}"؟`)) return;
  try { await DB.deleteSimilarityGroup(id, name); toast('تم الحذف', 's'); go('materialsimilar'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};
window.removeSimItemConfirm = async (itemId) => {
  try { await DB.removeMaterialFromGroup(itemId); toast('تم الحذف', 's'); go('materialsimilar'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── توليد بطاقات مواد بشكل جماعي ─────────────────────────────
PAGE_RENDER.materialbulkgen = async (root) => {
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📦 توليد بطاقات مواد بشكل جماعي</div><div class="ph-sub">أدخل عدة مواد دفعة واحدة، سطر لكل مادة</div></div></div>
    <div class="card">
      <div class="ph-sub" style="margin-bottom:10px">
        صيغة كل سطر: <span class="mono">الرقم_المخزني , الاسم , الوحدة , التصنيف (اختياري) , الحد_الأدنى (اختياري)</span><br>
        مثال: <span class="mono">M-1001, مسمار 3 إنش, علبة, أدوات بناء, 20</span>
      </div>
      <textarea id="bulk-mat-input" rows="10" placeholder="M-1001, مسمار 3 إنش, علبة, أدوات بناء, 20
M-1002, مطرقة صغيرة, قطعة, أدوات يدوية, 5"></textarea>
      <div class="form-foot"><button class="btn btn-p" onclick="runBulkMaterialGen()">توليد البطاقات</button></div>
      <div id="bulk-mat-result"></div>
    </div>`;
};
window.runBulkMaterialGen = async () => {
  const raw = document.getElementById('bulk-mat-input').value.trim();
  if (!raw) { toast('أدخل سطراً واحداً على الأقل', 'e'); return; }
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const rows = lines.map(l => {
    const parts = l.split(',').map(p => p.trim());
    return { store_num: parts[0] || '', name: parts[1] || '', unit: parts[2] || 'قطعة', category: parts[3] || null, min_qty: parts[4] ? Number(parts[4]) : 0, is_active: true };
  }).filter(r => r.store_num && r.name);
  if (!rows.length) { toast('لم يتم التعرف على أي سطر صحيح — تحقق من الصيغة', 'e'); return; }
  const box = document.getElementById('bulk-mat-result');
  box.innerHTML = '<div class="ec">جارِ التوليد...</div>';
  try {
    const res = await DB.bulkCreateMaterials(rows);
    box.innerHTML = `<div class="card" style="margin-top:14px">
      <div class="stats"><div class="stat"><div class="stat-lbl">تم بنجاح</div><div class="stat-val" style="color:var(--ok)">${res.ok}</div></div>
      <div class="stat ${res.fail?'danger':''}"><div class="stat-lbl">فشل</div><div class="stat-val danger">${res.fail}</div></div></div>
      ${res.errors.length ? `<div class="ec" style="color:var(--danger);text-align:right;padding:10px">${res.errors.join('<br>')}</div>` : ''}
    </div>`;
    toast(`تم توليد ${res.ok} بطاقة مادة${res.fail ? '، وفشل ' + res.fail : ''}`, res.fail ? 'e' : 's');
  } catch (e) { box.innerHTML = `<div class="ec" style="color:var(--danger)">${e.message}</div>`; }
};
