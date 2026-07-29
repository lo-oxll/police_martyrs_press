// ══════════════════════════════════════════════════════════════════
//  المرحلة ٢: بطاقة المشروع + بطاقة الفرع
//  بطاقات مرجعية بسيطة بهذه المرحلة (بلا ربط تلقائي بالفواتير/القيود/فصل بيانات) —
//  الأساس جاهز لتوسيعها بمرحلة قادمة إن احتجت الربط الفعلي.
// ══════════════════════════════════════════════════════════════════

// ── بطاقة المشروع ─────────────────────────────
PAGE_RENDER.projects = async (root) => {
  const list = await DB.listProjects();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📁 بطاقة المشروع</div><div class="ph-sub">دليل المشاريع — بطاقة مرجعية (بلا ربط تلقائي بالفواتير بعد)</div></div>
      <div class="ph-actions">
        <button class="btn btn-o btn-sm" onclick="exportRowsToExcel(${'window.__projRows'}, 'المشاريع', 'المشاريع.xlsx')">تصدير إكسل</button>
        ${can('admin','accountant','manager') ? `<button class="btn btn-p btn-sm" onclick="openProjectModal()">+ مشروع جديد</button>` : ''}
      </div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>الوصف</th><th>من</th><th>إلى</th><th></th></tr></thead>
    <tbody>${list.map(p => `<tr>
      <td class="mono">${p.code}</td><td>${p.name}</td><td>${p.description||'—'}</td>
      <td class="mono">${p.start_date||'—'}</td><td class="mono">${p.end_date||'—'}</td>
      <td style="display:flex;gap:6px">
        ${can('admin','accountant','manager') ? `<button class="btn btn-o btn-sm" onclick='openProjectModal(${JSON.stringify(p)})'>تعديل</button>` : ''}
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deactivateProjectConfirm('${p.id}')">إلغاء تفعيل</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد مشاريع بعد</td></tr>'}
    </tbody></table></div></div>`;
  window.__projRows = list.map(p => ({ 'الرمز': p.code, 'الاسم': p.name, 'الوصف': p.description||'', 'من': p.start_date||'', 'إلى': p.end_date||'' }));
};
window.openProjectModal = (p = null) => {
  showModal(p ? 'تعديل بطاقة مشروع' : 'مشروع جديد', `
    <div class="fgroup"><label>الرمز</label><input id="m-pr-code" value="${p?.code||''}" ${p ? 'disabled' : ''}></div>
    <div class="fgroup"><label>الاسم</label><input id="m-pr-name" value="${p?.name||''}"></div>
    <div class="fgroup"><label>الوصف</label><input id="m-pr-desc" value="${p?.description||''}"></div>
    <div class="fg2">
      <div class="fgroup"><label>تاريخ البدء</label><input id="m-pr-start" type="date" value="${p?.start_date||''}"></div>
      <div class="fgroup"><label>تاريخ الانتهاء (اختياري)</label><input id="m-pr-end" type="date" value="${p?.end_date||''}"></div>
    </div>
  `, async () => {
    const code = gv('m-pr-code'), name = gv('m-pr-name'), description = gv('m-pr-desc');
    const start_date = gv('m-pr-start') || null, end_date = gv('m-pr-end') || null;
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    try {
      if (p) await DB.updateProject(p.id, { name, description, start_date, end_date });
      else await DB.createProject({ code, name, description, start_date, end_date });
      toast('تم الحفظ', 's'); go('projects');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deactivateProjectConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا المشروع؟')) return;
  try { await DB.deactivateProject(id); toast('تم', 's'); go('projects'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};

// ── بطاقة الفرع ─────────────────────────────
PAGE_RENDER.branches = async (root) => {
  const list = await DB.listBranches();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🏢 بطاقة الفرع</div><div class="ph-sub">دليل الفروع — بطاقة معلومات (بلا فصل فعلي للمخزون/المحاسبة بين الفروع بعد)</div></div>
      <div class="ph-actions">
        <button class="btn btn-o btn-sm" onclick="exportRowsToExcel(${'window.__brRows'}, 'الفروع', 'الفروع.xlsx')">تصدير إكسل</button>
        ${can('admin') ? `<button class="btn btn-p btn-sm" onclick="openBranchModal()">+ فرع جديد</button>` : ''}
      </div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>العنوان</th><th>الهاتف</th><th>المسؤول</th><th></th></tr></thead>
    <tbody>${list.map(b => `<tr>
      <td class="mono">${b.code}</td><td>${b.name}</td><td>${b.address||'—'}</td><td class="mono">${b.phone||'—'}</td><td>${b.manager_name||'—'}</td>
      <td style="display:flex;gap:6px">
        ${can('admin') ? `<button class="btn btn-o btn-sm" onclick='openBranchModal(${JSON.stringify(b)})'>تعديل</button>
        <button class="btn btn-d btn-sm" onclick="deactivateBranchConfirm('${b.id}')">إلغاء تفعيل</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد فروع بعد</td></tr>'}
    </tbody></table></div></div>`;
  window.__brRows = list.map(b => ({ 'الرمز': b.code, 'الاسم': b.name, 'العنوان': b.address||'', 'الهاتف': b.phone||'', 'المسؤول': b.manager_name||'' }));
};
window.openBranchModal = (b = null) => {
  showModal(b ? 'تعديل بطاقة فرع' : 'فرع جديد', `
    <div class="fgroup"><label>الرمز</label><input id="m-br-code" value="${b?.code||''}" ${b ? 'disabled' : ''}></div>
    <div class="fgroup"><label>الاسم</label><input id="m-br-name" value="${b?.name||''}"></div>
    <div class="fgroup"><label>العنوان</label><input id="m-br-addr" value="${b?.address||''}"></div>
    <div class="fg2">
      <div class="fgroup"><label>الهاتف</label><input id="m-br-phone" value="${b?.phone||''}"></div>
      <div class="fgroup"><label>اسم المسؤول</label><input id="m-br-mgr" value="${b?.manager_name||''}"></div>
    </div>
  `, async () => {
    const code = gv('m-br-code'), name = gv('m-br-name'), address = gv('m-br-addr'), phone = gv('m-br-phone'), manager_name = gv('m-br-mgr');
    if (!code || !name) { toast('الرمز والاسم مطلوبان', 'e'); return false; }
    try {
      if (b) await DB.updateBranch(b.id, { name, address, phone, manager_name });
      else await DB.createBranch({ code, name, address, phone, manager_name });
      toast('تم الحفظ', 's'); go('branches');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deactivateBranchConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا الفرع؟')) return;
  try { await DB.deactivateBranch(id); toast('تم', 's'); go('branches'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
