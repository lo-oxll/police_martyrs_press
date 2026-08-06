// ══════════════════════════════════════════════════════════════════
//  الإدارة: المستخدمون والصلاحيات + سجل المراجعة + إعدادات النظام
// ══════════════════════════════════════════════════════════════════
PAGE_RENDER.users = async (root) => {
  if (!can('admin','manager')) { root.innerHTML = '<div class="card ec">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return; }
  const [{ data: users, error }, pending] = await Promise.all([
    sb.from('profiles').select('*').eq('is_active', true).order('created_at'),
    DB.listPendingUsers(),
  ]);
  if (error) { root.innerHTML = `<div class="card ec">تعذر جلب المستخدمين: ${error.message}</div>`; return; }
  const isAdmin = can('admin');
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">المستخدمون والصلاحيات</div><div class="ph-sub">${isAdmin ? 'إدارة أدوار المستخدمين، والموافقة على الحسابات الجديدة' : 'عرض للاطّلاع فقط — الموافقة وتغيير الأدوار بيد مدير النظام'}</div></div></div>

    ${pending.length ? `<div class="card" style="border:1px solid var(--gold)">
      <div class="card-title">🕐 حسابات بانتظار الموافقة (${pending.length})</div>
      <div class="itw"><table><thead><tr><th>الاسم</th><th>تاريخ التسجيل</th>${isAdmin ? '<th>الدور المقترَح</th><th></th>' : ''}</tr></thead><tbody>
        ${pending.map(u => `<tr><td>${u.full_name}</td><td class="mono">${new Date(u.created_at).toLocaleDateString('ar-IQ')}</td>
          ${isAdmin ? `
          <td><select id="pend-role-${u.id}">
            ${['accountant','manager','auditor'].map(r => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}
          </select></td>
          <td>
            <button class="btn btn-s btn-sm" onclick="approvePendingUser('${u.id}')">✅ الموافقة</button>
            <button class="btn btn-d btn-sm" onclick="rejectPendingUser('${u.id}','${(u.full_name||'').replace(/'/g,"\\'")}')">❌ رفض</button>
          </td>` : ''}
        </tr>`).join('')}
      </tbody></table></div>
      ${isAdmin ? `<div style="font-size:11px;color:var(--ink3);margin-top:10px">"رفض" يحذف ملف المستخدم من النظام فقط — حساب الدخول نفسه (البريد/كلمة المرور) يبقى موجوداً بخدمة المصادقة ولازم يُحذف نهائياً من لوحة Supabase لو تحتاج ذلك.</div>` : ''}
    </div>` : ''}

    <div class="card"><div class="itw"><table><thead><tr><th>الاسم</th><th>الدور</th><th>الصلاحيات الإضافية</th><th>الحالة</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>
      ${users.map(u => `<tr><td>${u.full_name}</td>
        <td>${isAdmin ? `<select onchange="changeRole('${u.id}', this.value, '${u.role}')">
          ${['admin','accountant','manager','auditor'].map(r => `<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
        </select>` : `<span class="chip">${ROLE_LABEL[u.role] || u.role}</span>`}</td>
        <td>${u.role === 'accountant' ? `
          <span class="chip ${u.can_treasury ? 'chip-ok' : ''}">${u.can_treasury ? '💰 الخزينة والرواتب' : 'مخزني فقط'}</span>
          <span class="chip">${u.warehouse_ids && u.warehouse_ids.length ? `🏬 ${u.warehouse_ids.length} مخزن محدَّد` : 'كل المخازن'}</span>
          ${isAdmin ? `<button class="btn btn-o btn-sm" onclick='openScopeModal(${JSON.stringify(u).replace(/'/g,"&#39;")})'>تعديل الصلاحيات</button>` : ''}
        ` : '<span style="color:var(--ink3);font-size:11px">—</span>'}</td>
        <td>${u.is_active ? '<span class="chip-ok chip">فعّال</span>' : '<span class="chip-danger chip">موقوف</span>'}</td>
        ${isAdmin ? `<td>
          <button class="btn btn-o btn-sm" onclick="toggleActive('${u.id}', ${!u.is_active})">${u.is_active?'إيقاف':'تفعيل'}</button>
          ${u.id !== ME.id ? `<button class="btn btn-d btn-sm" onclick="hardDeleteUserConfirm('${u.id}','${(u.full_name||'').replace(/'/g,"\\'")}')">🗑 حذف نهائي</button>` : ''}
        </td>` : ''}
      </tr>`).join('')}
    </tbody></table></div></div>

    ${isAdmin ? await renderCountSettingsCard() : ''}
  `;
  if (isAdmin) bindCountSettingsHandlers();
};
window.approvePendingUser = async (id) => {
  const role = document.getElementById('pend-role-' + id)?.value || 'accountant';
  try {
    await DB.approveUser(id, role);
    toast('✅ تمت الموافقة على الحساب', 's');
    go('users');
  } catch (e) { toast('خطأ: ' + e.message, 'e'); }
};
window.rejectPendingUser = async (id, name) => {
  if (!confirm(`متأكد تريد رفض حساب "${name}"؟ سيُحذف ملفه من النظام.`)) return;
  try {
    await DB.rejectUser(id);
    toast('تم رفض الحساب', 's');
    go('users');
  } catch (e) { toast('خطأ: ' + e.message, 'e'); }
};
// تحديد صلاحيات محاسب محدَّد: أي مخازن يشتغل عليها، وهل له صلاحية الخزينة والرواتب
window.openScopeModal = async (u) => {
  const [whs, branches] = await Promise.all([DB.listWarehouses(), DB.listBranches()]);
  const current = new Set(u.warehouse_ids || []);
  const currentBranches = new Set(u.branch_ids || []);
  showModal(`صلاحيات: ${u.full_name}`, `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:12px">اترك كل المخازن بدون تحديد ليشتغل عليها كلها بدون قيد.</div>
    <div class="fgroup" style="margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="m-scope-treasury" style="width:auto" ${u.can_treasury?'checked':''}> صلاحية الخزينة والرواتب والسلفة المستديمة (صندوق المركز، الرواتب، الموظفين، سلف الموظفين)</label>
    </div>
    <label style="font-size:11px;color:var(--ink2);font-weight:600;display:block;margin-bottom:6px">المخازن المسموح بها (بدون تحديد = الكل)</label>
    <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:14px">
      ${whs.map(w => `<label style="display:flex;align-items:center;gap:6px;padding:5px 0"><input type="checkbox" class="m-scope-wh" value="${w.id}" style="width:auto" ${current.has(w.id)?'checked':''}> ${w.code} — ${w.name}</label>`).join('') || '<div class="ec">لا توجد مخازن</div>'}
    </div>
    <label style="font-size:11px;color:var(--ink2);font-weight:600;display:block;margin-bottom:6px">الفروع المسموح بها (بدون تحديد = الكل) — تُستخدم لتصفية شاشات اختيار الفرع تطبيقياً</label>
    <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
      ${branches.map(b => `<label style="display:flex;align-items:center;gap:6px;padding:5px 0"><input type="checkbox" class="m-scope-branch" value="${b.id}" style="width:auto" ${currentBranches.has(b.id)?'checked':''}> ${b.code} — ${b.name}</label>`).join('') || '<div class="ec">لا توجد فروع مسجّلة بعد</div>'}
    </div>
  `, async () => {
    const selected = [...document.querySelectorAll('.m-scope-wh:checked')].map(el => el.value);
    const selectedBranches = [...document.querySelectorAll('.m-scope-branch:checked')].map(el => el.value);
    try {
      await DB.updateProfileScope(u.id, { warehouse_ids: selected.length ? selected : null, can_treasury: document.getElementById('m-scope-treasury').checked, branch_ids: selectedBranches.length ? selectedBranches : null });
      toast('تم حفظ الصلاحيات', 's'); go('users'); return true;
    } catch (e) { toast('خطأ: ' + e.message, 'e'); return false; }
  });
};
window.changeRole = async (id, role, oldRole) => {
  const { error } = await sb.from('profiles').update({ role }).eq('id', id);
  if (error) { toast('خطأ: ' + error.message, 'e'); return; }
  await DB.log('change_role', 'profiles', id, { old: { role: oldRole }, new: { role } });
  toast('تم تحديث الدور', 's');
};
window.toggleActive = async (id, val) => {
  const { error } = await sb.from('profiles').update({ is_active: val }).eq('id', id);
  if (error) { toast('خطأ: ' + error.message, 'e'); return; }
  await DB.log(val ? 'activate_user' : 'deactivate_user', 'profiles', id, { old: { is_active: !val }, new: { is_active: val } });
  go('users');
};
// حذف نهائي لملف مستخدم فعّال — مدير النظام فقط. لا يمكن حذف حسابك الخاص.
window.hardDeleteUserConfirm = async (id, name) => {
  if (!confirm(`⚠️ حذف نهائي لملف المستخدم "${name}" من النظام. هذا الإجراء لا يمكن التراجع عنه (حساب الدخول نفسه يبقى بخدمة المصادقة ويحتاج حذفاً يدوياً من لوحة Supabase لو أردت). متابعة؟`)) return;
  try {
    await DB.hardDeleteUser(id, name);
    toast('تم حذف المستخدم نهائياً', 's');
    go('users');
  } catch (e) { toast('تعذّر الحذف: ' + e.message, 'e'); }
};

// ── إعدادات حسابات فروقات الجرد الدوري (تُستخدم عند ترحيل قيد الجرد) ──────────────────────────────
async function renderCountSettingsCard() {
  const accs = await DB.chartOfAccounts();
  const opts = (selected) => `<option value="">— اختر حساب —</option>` + accs.map(a => `<option value="${a.id}" ${a.id===selected?'selected':''}>${a.code} — ${a.name}</option>`).join('');
  const [inv, short, surplus, cashbox, salExp, salPay, logoUrl, footerTxt, pettyCash, threshold] = await Promise.all([
    DB.getSetting('inventory_account_id'), DB.getSetting('inventory_shortage_account_id'), DB.getSetting('inventory_surplus_account_id'),
    DB.getSetting('cashbox_account_id'), DB.getSetting('salary_expense_account_id'), DB.getSetting('salary_payment_account_id'),
    DB.getSetting('print_logo_url'), DB.getSetting('print_footer_text'), DB.getSetting('petty_cash_account_id'), DB.getSetting('approval_threshold_amount'),
  ]);
  return `
    <div class="card" style="border:1px dashed var(--border)">
      <div class="card-title">🖨️ إعدادات قوالب الطباعة</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:14px">تُستخدم بكل التقارير والوثائق المطبوعة (رأس الصفحة بالشعار، وتذييل اختياري بأسفل كل طباعة).</div>
      <div class="fg2" style="margin-bottom:10px">
        <div class="fgroup"><label>رابط شعار المؤسسة (URL لصورة)</label><input id="cs-logo" value="${logoUrl || ''}" placeholder="https://.../logo.png"></div>
        <div class="fgroup"><label>نص التذييل (يظهر أسفل كل طباعة)</label><input id="cs-footer" value="${footerTxt || ''}" placeholder="مثال: هذه وثيقة رسمية صادرة عن..."></div>
      </div>
      <button class="btn btn-p btn-sm" id="cs-save3">💾 حفظ إعدادات الطباعة</button>
      <div id="cs-msg3" style="margin-top:8px;font-size:12px"></div>
    </div>

    <div class="card" style="border:1px dashed var(--border)">
      <div class="card-title">📨 حد موافقة القيود اليدوية الكبيرة (Maker-Checker)</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:14px">أي قيد يدوي ينشئه محاسب المركز بمبلغ يساوي أو يتجاوز هذا الحد يُحفظ "معلَّقاً" وينتظر موافقة مدير النظام بدل الترحيل المباشر. اتركه صفراً لتعطيل هذا الشرط (كل القيود تُرحَّل مباشرة كالسابق).</div>
      <div class="fg2" style="margin-bottom:10px"><div class="fgroup s2"><label>الحد الأدنى (د.ع)</label><input type="number" id="cs-threshold" value="${threshold || 0}"></div></div>
      <button class="btn btn-p btn-sm" id="cs-save5">💾 حفظ الحد</button>
      <div id="cs-msg5" style="margin-top:8px;font-size:12px"></div>
    </div>

    <div class="card" style="border:1px dashed var(--border)">
      <div class="card-title">💵 إعدادات السلفة المستديمة (Petty Cash)</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:14px">يُستخدم هذا الحساب كطرف دائن تلقائياً بكل سند صرف من السلفة المستديمة يُنشئه محاسب المركز.</div>
      <div class="fg2" style="margin-bottom:10px">
        <div class="fgroup s2"><label>حساب السلفة المستديمة</label><select id="cs-pettycash">${opts(pettyCash)}</select></div>
      </div>
      <button class="btn btn-p btn-sm" id="cs-save4">💾 حفظ إعداد السلفة المستديمة</button>
      <div id="cs-msg4" style="margin-top:8px;font-size:12px"></div>
    </div>

    <div class="card" style="border:1px dashed var(--border)">
      <div class="card-title">⚙️ إعدادات الجرد الدوري — حسابات فروقات الجرد</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:14px">تُستخدم هذه الحسابات تلقائياً عند ترحيل قيد تسوية أي جرد فعلي (عجز/زيادة). يجب ضبطها مرة واحدة قبل أول عملية ترحيل جرد.</div>
      <div class="fg" style="margin-bottom:10px">
        <div class="fgroup"><label>حساب المخزون (أصل)</label><select id="cs-inv">${opts(inv)}</select></div>
        <div class="fgroup"><label>حساب عجز الجرد (مصروف)</label><select id="cs-short">${opts(short)}</select></div>
        <div class="fgroup"><label>حساب زيادة الجرد (إيراد)</label><select id="cs-surplus">${opts(surplus)}</select></div>
      </div>
      <button class="btn btn-p btn-sm" id="cs-save">💾 حفظ إعدادات الجرد</button>
      <div id="cs-msg" style="margin-top:8px;font-size:12px"></div>
    </div>

    <div class="card" style="border:1px dashed var(--border)">
      <div class="card-title">⚙️ إعدادات صندوق المركز والرواتب</div>
      <div style="font-size:12px;color:var(--ink3);margin-bottom:14px">تُستخدم عند تسجيل حركات الصندوق وترحيل قيود الرواتب. اضبطها مرة واحدة قبل استخدام صفحتي "صندوق المركز" و"الرواتب".</div>
      <div class="fg" style="margin-bottom:10px">
        <div class="fgroup"><label>حساب الصندوق/النقدية</label><select id="cs-cashbox">${opts(cashbox)}</select></div>
        <div class="fgroup"><label>حساب مصروف الرواتب</label><select id="cs-salexp">${opts(salExp)}</select></div>
        <div class="fgroup"><label>حساب دفع الرواتب (نقدية/بنك)</label><select id="cs-salpay">${opts(salPay)}</select></div>
      </div>
      <button class="btn btn-p btn-sm" id="cs-save2">💾 حفظ إعدادات الخزينة والرواتب</button>
      <div id="cs-msg2" style="margin-top:8px;font-size:12px"></div>
    </div>`;
}
function bindCountSettingsHandlers() {
  const btn3 = document.getElementById('cs-save3');
  if (btn3) btn3.onclick = async () => {
    try {
      await Promise.all([
        DB.setSetting('print_logo_url', gv('cs-logo')),
        DB.setSetting('print_footer_text', gv('cs-footer')),
      ]);
      document.getElementById('cs-msg3').innerHTML = '<span style="color:var(--ok)">✓ تم حفظ إعدادات الطباعة</span>';
      toast('تم حفظ إعدادات الطباعة', 's');
    } catch (e) { toast('خطأ: ' + e.message, 'e'); }
  };
  const btn4 = document.getElementById('cs-save4');
  if (btn4) btn4.onclick = async () => {
    const pc = gv('cs-pettycash');
    if (!pc) { toast('اختر حساب السلفة المستديمة قبل الحفظ', 'e'); return; }
    try {
      await DB.setSetting('petty_cash_account_id', pc);
      document.getElementById('cs-msg4').innerHTML = '<span style="color:var(--ok)">✓ تم حفظ إعداد السلفة المستديمة</span>';
      toast('تم حفظ إعداد السلفة المستديمة', 's');
    } catch (e) { toast('خطأ: ' + e.message, 'e'); }
  };
  const btn5 = document.getElementById('cs-save5');
  if (btn5) btn5.onclick = async () => {
    try {
      await DB.setSetting('approval_threshold_amount', gv('cs-threshold') || '0');
      document.getElementById('cs-msg5').innerHTML = '<span style="color:var(--ok)">✓ تم حفظ الحد</span>';
      toast('تم حفظ حد الموافقة', 's');
    } catch (e) { toast('خطأ: ' + e.message, 'e'); }
  };
  const btn = document.getElementById('cs-save');
  if (btn) btn.onclick = async () => {
    const inv = gv('cs-inv'), short = gv('cs-short'), surplus = gv('cs-surplus');
    if (!inv || !short || !surplus) { toast('اختر الحسابات الثلاثة قبل الحفظ', 'e'); return; }
    try {
      await Promise.all([
        DB.setSetting('inventory_account_id', inv),
        DB.setSetting('inventory_shortage_account_id', short),
        DB.setSetting('inventory_surplus_account_id', surplus),
      ]);
      document.getElementById('cs-msg').innerHTML = '<span style="color:var(--ok)">✓ تم حفظ إعدادات الجرد</span>';
      toast('تم حفظ إعدادات الجرد', 's');
    } catch (e) { toast('خطأ: ' + e.message, 'e'); }
  };
  const btn2 = document.getElementById('cs-save2');
  if (btn2) btn2.onclick = async () => {
    const cashbox = gv('cs-cashbox'), salExp = gv('cs-salexp'), salPay = gv('cs-salpay');
    if (!cashbox || !salExp || !salPay) { toast('اختر الحسابات الثلاثة قبل الحفظ', 'e'); return; }
    try {
      await Promise.all([
        DB.setSetting('cashbox_account_id', cashbox),
        DB.setSetting('salary_expense_account_id', salExp),
        DB.setSetting('salary_payment_account_id', salPay),
      ]);
      document.getElementById('cs-msg2').innerHTML = '<span style="color:var(--ok)">✓ تم حفظ إعدادات الخزينة والرواتب</span>';
      toast('تم حفظ إعدادات الخزينة والرواتب', 's');
    } catch (e) { toast('خطأ: ' + e.message, 'e'); }
  };
}

// ── قاموس ترجمة سجل المراجعة للعربية ─────────────────────────────
const AUDIT_ACTION_LABELS = {
  login: 'تسجيل دخول', logout: 'تسجيل خروج',
  create_receipt: 'إنشاء وثيقة استلام', cancel_receipt: 'إلغاء وثيقة استلام', hard_delete_receipt: 'حذف نهائي لوثيقة استلام', upload_attachment: 'رفع مرفق',
  create_issue: 'إنشاء وثيقة إصدار', cancel_issue: 'إلغاء وثيقة إصدار', hard_delete_issue: 'حذف نهائي لوثيقة إصدار',
  create_stock_transfer: 'إنشاء تحويل مخزني', cancel_stock_transfer: 'إلغاء تحويل مخزني', delete_stock_transfer: 'حذف تحويل مخزني',
  create_petty_cash_voucher: 'إنشاء سند سلفة مستديمة', cancel_petty_cash_voucher: 'إلغاء سند سلفة مستديمة', delete_petty_cash_voucher: 'حذف سند سلفة مستديمة', create_petty_cash_advance: 'إنشاء دفعة سلفة مستديمة', delete_petty_cash_advance: 'حذف دفعة سلفة مستديمة',
  create_payment: 'إنشاء سند صرف', create_receipt_voucher: 'إنشاء سند قبض', delete_cash_transaction: 'حذف حركة صندوق',
  cash_reconciliation: 'تسوية/مطابقة صندوق', delete_cash_reconciliation: 'حذف تسوية صندوق',
  post_journal: 'ترحيل قيد محاسبي', delete_journal_entry: 'حذف قيد محاسبي', request_journal_approval: 'طلب موافقة على قيد', approve_journal_entry: 'الموافقة على قيد', reject_journal_entry: 'رفض قيد',
  create_debt_note: 'إصدار سند دين', settle_debt_note: 'تسوية سند دين', cancel_debt_note: 'إلغاء سند دين', hard_delete_debt_note: 'حذف نهائي لسند دين',
  create_order: 'إنشاء طلبية', delete_order: 'حذف طلبية', update_order_status: 'تحديث حالة طلبية',
  create_shipping_receipt: 'إنشاء إيصال شحن', delete_shipping_receipt: 'حذف إيصال شحن', update_shipping_receipt: 'تحديث إيصال شحن',
  create_manufacturing_order: 'إنشاء طلبية تصنيع', cancel_manufacturing_order: 'إلغاء طلبية تصنيع', complete_manufacturing_order: 'إتمام طلبية تصنيع', create_manufacturing_model: 'إنشاء موديل تصنيع', deactivate_manufacturing_model: 'إلغاء تفعيل موديل تصنيع',
  create_physical_count: 'إنشاء جرد دوري', post_physical_count: 'ترحيل قيد الجرد', delete_physical_count: 'حذف جرد دوري',
  bulk_create_materials: 'توليد بطاقات مواد جماعياً', delete_material: 'حذف مادة', delete_material_stock: 'حذف رصيد مادة', set_material_barcode: 'تعيين باركود مادة',
  create_material_category: 'إنشاء صنف رئيسي', update_material_category: 'تعديل صنف رئيسي', deactivate_material_category: 'إلغاء تفعيل صنف رئيسي',
  create_similarity_group: 'إنشاء مجموعة تشابه مواد', delete_similarity_group: 'حذف مجموعة تشابه مواد',
  create_region: 'إنشاء منطقة', delete_region: 'حذف منطقة', create_street: 'إضافة شارع', delete_street: 'حذف شارع',
  create_supplier: 'إضافة مورّد', update_supplier: 'تعديل مورّد', delete_supplier: 'حذف مورّد',
  create_customer: 'إضافة زبون', update_customer: 'تعديل زبون', deactivate_customer: 'إلغاء تفعيل زبون', hard_delete_customer: 'حذف نهائي لزبون',
  create_warehouse: 'إضافة مخزن', update_warehouse: 'تعديل مخزن', delete_warehouse: 'حذف مخزن', hard_delete_warehouse: 'حذف نهائي لمخزن',
  create_branch: 'إضافة فرع', update_branch: 'تعديل فرع', deactivate_branch: 'إلغاء تفعيل فرع', hard_delete_branch: 'حذف نهائي لفرع',
  create_project: 'إضافة مشروع', update_project: 'تعديل مشروع', deactivate_project: 'إلغاء تفعيل مشروع', hard_delete_project: 'حذف نهائي لمشروع',
  create_cost_center: 'إضافة مركز كلفة', deactivate_cost_center: 'إلغاء تفعيل مركز كلفة',
  create_employee: 'إضافة موظف', update_employee: 'تعديل موظف', delete_employee: 'حذف موظف',
  create_employee_loan: 'إنشاء سلفة موظف', close_employee_loan: 'إغلاق سلفة موظف', delete_employee_loan: 'حذف سلفة موظف',
  create_payroll_run: 'إنشاء دورة رواتب', post_payroll_run: 'ترحيل دورة رواتب', delete_payroll_run: 'حذف دورة رواتب',
  create_fixed_asset: 'إضافة أصل ثابت', delete_fixed_asset: 'حذف أصل ثابت', dispose_fixed_asset: 'استبعاد أصل ثابت', post_depreciation: 'ترحيل قيد إهلاك', delete_depreciation_run: 'حذف دورة إهلاك',
  create_contract: 'إنشاء عقد', update_contract: 'تعديل عقد', delete_contract: 'حذف عقد',
  create_archive_card: 'إنشاء بطاقة أرشيف', delete_archive_card: 'حذف بطاقة أرشيف',
  create_rental_item: 'إضافة عنصر تأجير', delete_rental_item: 'حذف عنصر تأجير', update_rental_status: 'تحديث حالة تأجير',
  create_task: 'إنشاء مهمة', delete_task: 'حذف مهمة', update_task_status: 'تحديث حالة مهمة',
  send_internal_message: 'إرسال رسالة داخلية',
  create_invoice_template: 'إنشاء قالب فاتورة', delete_invoice_template: 'حذف قالب فاتورة',
  import_chart_of_accounts: 'استيراد دليل الحسابات', delete_account: 'حذف حساب', force_delete_account: 'حذف إجباري لحساب',
  import_opening_balances: 'استيراد أرصدة افتتاحية', close_fiscal_year: 'إغلاق سنة مالية', delete_fiscal_year: 'حذف سنة مالية', rollover_budget: 'ترحيل موازنة لسنة جديدة',
  allocate_indirect_expense: 'توزيع مصروف غير مباشر', restore_reference_table: 'استعادة جدول من نسخة احتياطية',
  update_app_settings: 'تحديث إعدادات النظام', set_page_permission: 'تعيين صلاحية صفحة', reset_page_permission: 'إعادة صلاحية صفحة للافتراضي',
  set_user_permission: 'تعيين صلاحية مفصّلة لمستخدم', clear_user_permission: 'إزالة صلاحية مفصّلة لمستخدم',
  approve_user: 'الموافقة على حساب مستخدم', reject_user: 'رفض حساب مستخدم', activate_user: 'تفعيل مستخدم', deactivate_user: 'إيقاف مستخدم', change_role: 'تغيير دور مستخدم', hard_delete_user: 'حذف نهائي لمستخدم', update_profile_scope: 'تعديل نطاق صلاحيات محاسب',
  auto_create_material: 'تعريف مادة تلقائياً أثناء الإدخال',
};
const AUDIT_ENTITY_LABELS = {
  auth: 'الدخول والخروج', receipt_docs: 'وثائق الاستلام', issue_docs: 'وثائق الإصدار', stock_transfers: 'التحويلات المخزنية',
  petty_cash_vouchers: 'سندات السلفة المستديمة', petty_cash_advances: 'دفعات السلفة المستديمة', cash_transactions: 'حركات الصندوق', cash_reconciliations: 'تسويات الصندوق',
  journal_entries: 'القيود المحاسبية', pending_journal_entries: 'القيود بانتظار الموافقة', chart_of_accounts: 'دليل الحسابات', opening_balances: 'الأرصدة الافتتاحية',
  debt_notes: 'سندات الديون', sales_purchase_orders: 'الطلبيات', shipping_receipts: 'إيصالات الشحن',
  manufacturing_orders: 'طلبيات التصنيع', manufacturing_models: 'موديلات التصنيع', physical_counts: 'الجرد الدوري',
  materials: 'المواد', material_stock: 'أرصدة المواد', material_categories: 'الأصناف الرئيسية', material_similarity_groups: 'مجموعات تشابه المواد',
  regions: 'المناطق', streets: 'الشوارع', suppliers: 'الموردون', customers: 'الزبائن',
  warehouses: 'المخازن', branches: 'الفروع', projects: 'المشاريع', cost_centers: 'مراكز الكلفة',
  employees: 'الموظفون', employee_loans: 'سلف الموظفين', payroll_runs: 'دورات الرواتب',
  fixed_assets: 'الأصول الثابتة', depreciation_runs: 'دورات الإهلاك',
  contracts: 'العقود', archive_cards: 'بطاقات الأرشيف', rental_items: 'عناصر التأجير', tasks: 'المهام', internal_messages: 'الرسائل الداخلية',
  invoice_templates: 'قوالب الفواتير', fiscal_years: 'السنوات المالية', budgets: 'الموازنات', indirect_expense_allocations: 'توزيع المصاريف غير المباشرة',
  app_settings: 'إعدادات النظام', page_permissions: 'صلاحيات الصفحات', user_permissions: 'الصلاحيات المفصّلة للمستخدمين', profiles: 'المستخدمون',
};
function auditActionLabel(a) { return AUDIT_ACTION_LABELS[a] || a; }
function auditEntityLabel(e) { return AUDIT_ENTITY_LABELS[e] || e; }
// يحوّل تفاصيل السجل (details JSON) لجملة عربية مقروءة بدل عرض JSON خام
function auditDetailsText(action, details) {
  const d = details || {};
  const parts = [];
  if (d.doc_num) parts.push(`رقم المستند: ${d.doc_num}`);
  if (d.entry_no) parts.push(`رقم القيد: ${d.entry_no}`);
  if (d.email) parts.push(`البريد: ${d.email}`);
  if (d.amount !== undefined) parts.push(`المبلغ: ${fmtIQD(d.amount)}`);
  if (d.diff !== undefined) parts.push(`الفرق: ${fmtIQD(d.diff)}`);
  if (d.doc_kind) parts.push(`النوع: ${d.doc_kind === 'voucher' ? 'سند' : d.doc_kind}`);
  if (d.reason) parts.push(`السبب: ${d.reason}`);
  else if ('reason' in d) parts.push('السبب: (بدون سبب مكتوب)');
  if (d.items !== undefined) parts.push(`عدد الأصناف: ${d.items}`);
  if (d.ok !== undefined || d.fail !== undefined) parts.push(`نجح: ${d.ok||0} / فشل: ${d.fail||0}`);
  if (d.old && d.new) parts.push(`من "${JSON.stringify(d.old)}" إلى "${JSON.stringify(d.new)}"`);
  if (d.perm_key) parts.push(`المفتاح: ${d.perm_key}${d.allowed!==undefined ? ' — ' + (d.allowed?'مسموح':'ممنوع') : ''}`);
  if (parts.length) return parts.join(' | ');
  return Object.keys(d).length ? JSON.stringify(d) : '—';
}

PAGE_RENDER.auditlog = async (root) => {
  if (!can('admin','manager')) { root.innerHTML = '<div class="card ec">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return; }
  const logs = await DB.auditLog(150);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🔐 سجل المراجعة</div><div class="ph-sub">سجل غير قابل للتعديل بكل العمليات الحساسة في النظام</div></div>
      <div class="ph-actions"><button class="btn btn-o btn-sm" onclick="exportAuditLogExcel()">⬇ تصدير إكسل</button></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>تفاصيل</th></tr></thead><tbody>
      ${logs.map(l => `<tr><td class="mono">${new Date(l.created_at).toLocaleString('ar-IQ')}</td><td>${l.profiles?.full_name || '—'}</td>
        <td><span class="chip">${auditActionLabel(l.action)}</span></td><td>${auditEntityLabel(l.entity)}</td><td style="font-size:12px">${auditDetailsText(l.action, l.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد سجلات بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.exportAuditLogExcel = async () => {
  const logs = await DB.auditLog(2000);
  exportRowsToExcel(
    logs.map((l,i) => ({ 'م': i+1, 'الوقت': new Date(l.created_at).toLocaleString('ar-IQ'), 'المستخدم': l.profiles?.full_name || '—', 'العملية': auditActionLabel(l.action), 'الكيان': auditEntityLabel(l.entity), 'تفاصيل': auditDetailsText(l.action, l.details) })),
    'سجل المراجعة', `سجل_المراجعة_${todayISO()}.xlsx`
  );
};
