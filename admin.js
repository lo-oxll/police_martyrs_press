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

PAGE_RENDER.auditlog = async (root) => {
  if (!can('admin','manager')) { root.innerHTML = '<div class="card ec">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return; }
  const logs = await DB.auditLog(150);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🔐 سجل المراجعة</div><div class="ph-sub">سجل غير قابل للتعديل بكل العمليات الحساسة في النظام</div></div>
      <div class="ph-actions"><button class="btn btn-o btn-sm" onclick="exportAuditLogExcel()">⬇ تصدير إكسل</button></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>تفاصيل</th></tr></thead><tbody>
      ${logs.map(l => `<tr><td class="mono">${new Date(l.created_at).toLocaleString('ar-IQ')}</td><td>${l.profiles?.full_name || '—'}</td>
        <td><span class="chip">${l.action}</span></td><td>${l.entity}</td><td class="mono" style="font-size:11px">${JSON.stringify(l.details||{})}</td></tr>`).join('') || '<tr><td colspan="5" class="ec">لا توجد سجلات بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.exportAuditLogExcel = async () => {
  const logs = await DB.auditLog(2000);
  exportRowsToExcel(
    logs.map((l,i) => ({ 'م': i+1, 'الوقت': new Date(l.created_at).toLocaleString('ar-IQ'), 'المستخدم': l.profiles?.full_name || '—', 'العملية': l.action, 'الكيان': l.entity, 'تفاصيل': JSON.stringify(l.details||{}) })),
    'سجل المراجعة', `سجل_المراجعة_${todayISO()}.xlsx`
  );
};
