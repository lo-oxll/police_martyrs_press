// ══════════════════════════════════════════════════════════════════
//  اعدادات البرنامج الأساسية: بيانات الشركة + الثوابت العامة + الصلاحيات الأمنية
// ══════════════════════════════════════════════════════════════════

// ── ادخال وتعديل اسم الشركة ─────────────────────────────
PAGE_RENDER.companyname = async (root) => {
  const s = await DB.getAppSettingsBatch(['company_name', 'company_phone', 'company_address', 'company_tax_no']);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">بيانات الشركة</div><div class="ph-sub">تظهر هذه البيانات بصفحة "حول البرنامج" والتقارير المطبوعة مستقبلاً</div></div></div>
    <div class="card" style="max-width:520px">
      <div class="fgroup" style="margin-bottom:12px"><label>اسم الشركة</label><input id="cs-name" value="${s.company_name || ''}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>الهاتف</label><input id="cs-phone" value="${s.company_phone || ''}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>العنوان</label><input id="cs-address" value="${s.company_address || ''}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>الرقم الضريبي (اختياري)</label><input id="cs-tax" value="${s.company_tax_no || ''}"></div>
      <div class="form-foot"><button class="btn btn-p" onclick="saveCompanySettings()">حفظ</button></div>
    </div>`;
};
window.saveCompanySettings = async () => {
  try {
    await DB.setAppSettingsBatch({
      company_name: gv('cs-name'), company_phone: gv('cs-phone'), company_address: gv('cs-address'), company_tax_no: gv('cs-tax'),
    });
    if (gv('cs-name')) window.APP_CONFIG.APP_NAME = gv('cs-name');
    toast('تم حفظ بيانات الشركة', 's');
  } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};

// ── تصميم ثوابت عامة ─────────────────────────────
PAGE_RENDER.designconstants = async (root) => {
  const s = await DB.getAppSettingsBatch(['currency_label', 'default_tax_rate', 'qty_decimals', 'invoice_footer_note']);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تصميم ثوابت عامة</div><div class="ph-sub">قيم افتراضية تُستخدم عبر النظام (تُطبَّق فوراً بدون إعادة نشر)</div></div></div>
    <div class="card" style="max-width:520px">
      <div class="fgroup" style="margin-bottom:12px"><label>رمز العملة المعروض</label><input id="gc-currency" value="${s.currency_label || 'د.ع'}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>نسبة الضريبة الافتراضية (%)</label><input id="gc-tax" type="number" step="0.01" value="${s.default_tax_rate || '0'}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>عدد المنازل العشرية للكميات</label><input id="gc-decimals" type="number" min="0" max="4" value="${s.qty_decimals || '3'}"></div>
      <div class="fgroup" style="margin-bottom:12px"><label>ملاحظة تذييل الفواتير (اختياري)</label><input id="gc-footer" value="${s.invoice_footer_note || ''}"></div>
      <div class="form-foot"><button class="btn btn-p" onclick="saveGeneralConstants()">حفظ</button></div>
    </div>`;
};
window.saveGeneralConstants = async () => {
  try {
    await DB.setAppSettingsBatch({
      currency_label: gv('gc-currency') || 'د.ع', default_tax_rate: gv('gc-tax') || '0',
      qty_decimals: gv('gc-decimals') || '3', invoice_footer_note: gv('gc-footer'),
    });
    window.__currencyLabel = gv('gc-currency') || 'د.ع';
    toast('تم الحفظ — رمز العملة تحدَّث فوراً بكل الشاشات', 's');
  } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};

// ── تصميم الصلاحيات الأمنية ─────────────────────────────
const SECURITY_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
const SECURITY_ROLE_LABELS = { admin: 'مدير النظام', accountant: 'محاسب', manager: 'مدير', auditor: 'مدقق' };

PAGE_RENDER.designsecurityroles = async (root) => {
  if (!can('admin')) { root.innerHTML = '<div class="card"><div class="ec">هذه الصفحة لمدير النظام فقط</div></div>'; return; }
  const overrides = await DB.listPagePermissions();
  const overrideMap = {}; overrides.forEach(o => { overrideMap[o.page_id + '|' + o.role] = o.allowed; });
  const allPages = [];
  PAGES.forEach(sec => sec.items.forEach(it => allPages.push({ id: it.id, label: it.label, defaultRoles: it.roles || null })));

  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تصميم الصلاحيات الأمنية</div><div class="ph-sub">تجاوز اختياري فوق الأدوار الافتراضية لكل صفحة — التغيير يطبَّق فوراً لكل مستخدمي ذلك الدور</div></div></div>
    <div class="card"><div class="ph-sub" style="margin-bottom:12px">✅ = مسموح، فارغ = ممنوع. الخانة الباهتة تعني القيمة الحالية هي الافتراضية المبرمجة (بدون تجاوز مخصَّص).</div>
    <div class="itw"><table><thead><tr><th>الصفحة</th>${SECURITY_ROLES.map(r => `<th>${SECURITY_ROLE_LABELS[r]}</th>`).join('')}</tr></thead>
    <tbody>${allPages.map(p => `<tr><td>${p.label}</td>${SECURITY_ROLES.map(r => {
      const key = p.id + '|' + r;
      const hasOverride = Object.prototype.hasOwnProperty.call(overrideMap, key);
      const effective = hasOverride ? overrideMap[key] : (!p.defaultRoles || p.defaultRoles.includes(r));
      return `<td style="text-align:center;${hasOverride?'':'opacity:.55'}"><input type="checkbox" style="width:auto" ${effective?'checked':''} onchange="togglePagePermission('${p.id}','${r}',this.checked)"></td>`;
    }).join('')}</tr>`).join('')}
    </tbody></table></div></div>`;
};
window.togglePagePermission = async (pageId, role, checked) => {
  try { await DB.setPagePermission(pageId, role, checked); toast('تم الحفظ — يسري فوراً', 's'); }
  catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); }
};
