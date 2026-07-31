// ══════════════════════════════════════════════════════════════════
//  تصميم اعدادات الفواتير + مصطلحات البرنامج
// ══════════════════════════════════════════════════════════════════

// ── تصميم اعدادات الفواتير ─────────────────────────────
PAGE_RENDER.designinvoicesettings = async (root) => {
  const [s, whs] = await Promise.all([
    DB.getAppSettingsBatch(['default_receive_warehouse_id', 'default_issue_warehouse_id', 'invoice_num_prefix_receive', 'invoice_num_prefix_issue']),
    DB.listWarehouses(),
  ]);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تصميم اعدادات الفواتير</div><div class="ph-sub">قيم افتراضية تُستخدم عند فتح شاشات ادخال/اخراج فواتير جديدة</div></div></div>
    <div class="card" style="max-width:560px">
      <div class="fg2">
        <div class="fgroup"><label>المخزن الافتراضي لفواتير الاستلام</label><select id="is-recv-wh"><option value="">— بدون —</option>${whs.map(w => `<option value="${w.id}" ${s.default_receive_warehouse_id===w.id?'selected':''}>${w.name}</option>`).join('')}</select></div>
        <div class="fgroup"><label>المخزن الافتراضي لفواتير الإصدار</label><select id="is-issue-wh"><option value="">— بدون —</option>${whs.map(w => `<option value="${w.id}" ${s.default_issue_warehouse_id===w.id?'selected':''}>${w.name}</option>`).join('')}</select></div>
      </div>
      <div class="fg2" style="margin-top:12px">
        <div class="fgroup"><label>بادئة ترقيم فواتير الاستلام (تذكيرية)</label><input id="is-recv-prefix" value="${s.invoice_num_prefix_receive||''}" placeholder="مثال: REC-"></div>
        <div class="fgroup"><label>بادئة ترقيم فواتير الإصدار (تذكيرية)</label><input id="is-issue-prefix" value="${s.invoice_num_prefix_issue||''}" placeholder="مثال: ISS-"></div>
      </div>
      <div class="form-foot"><button class="btn btn-p" onclick="saveInvoiceSettings()">حفظ</button></div>
    </div>
    <div class="card"><div class="ph-sub">ملاحظة: البادئة هنا تذكيرية فقط لموظف الإدخال — والمخزن الافتراضي يحتاج ربطاً بشاشتي "ادخال/اخراج فواتير" ليصير فعلياً تلقائي التعبئة، أقدر أفعّله بمرحلة قادمة صغيرة لو احتجته.</div></div>`;
};
window.saveInvoiceSettings = async () => {
  try {
    await DB.setAppSettingsBatch({
      default_receive_warehouse_id: gv('is-recv-wh'), default_issue_warehouse_id: gv('is-issue-wh'),
      invoice_num_prefix_receive: gv('is-recv-prefix'), invoice_num_prefix_issue: gv('is-issue-prefix'),
    });
    toast('تم الحفظ', 's');
  } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};

// ── مصطلحات البرنامج: تخصيص تسميات عناصر القائمة الجانبية ─────────────────────────────
PAGE_RENDER.designterminology = async (root) => {
  const s = await DB.getAppSettingsBatch(['nav_label_overrides']);
  let overrides = {}; try { overrides = s.nav_label_overrides ? JSON.parse(s.nav_label_overrides) : {}; } catch (e) { overrides = {}; }
  const allPages = [];
  PAGES.forEach(sec => sec.items.forEach(it => allPages.push(it)));
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تصميم مصطلحات البرنامج</div><div class="ph-sub">غيّر تسمية أي عنصر بالقائمة الجانبية لتناسب مصطلحاتك (مثال: "زبون" ← "عميل")</div></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>التسمية الأصلية</th><th>التسمية المخصَّصة</th></tr></thead>
    <tbody>${allPages.map(p => `<tr><td>${p.label}</td><td><input id="term-${p.id}" value="${overrides[p.id]||''}" placeholder="${p.label}" style="max-width:260px"></td></tr>`).join('')}</tbody></table></div>
    <div class="form-foot"><button class="btn btn-p" onclick="saveTerminology()">حفظ وتطبيق</button></div></div>`;
};
window.saveTerminology = async () => {
  const overrides = {};
  PAGES.forEach(sec => sec.items.forEach(it => {
    const val = gv('term-' + it.id);
    if (val) overrides[it.id] = val;
  }));
  try {
    await DB.setAppSettingsBatch({ nav_label_overrides: JSON.stringify(overrides) });
    applyNavLabelOverrides(overrides);
    renderSidebar();
    toast('تم الحفظ وتطبيق التسميات الجديدة على القائمة الجانبية', 's');
  } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};
function applyNavLabelOverrides(overrides) {
  PAGES.forEach(sec => sec.items.forEach(it => { if (overrides[it.id]) it.label = overrides[it.id]; }));
}
window.applyNavLabelOverrides = applyNavLabelOverrides;
