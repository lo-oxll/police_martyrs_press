// ══════════════════════════════════════════════════════════════════
//  عميل Supabase الموحّد + دوال الوصول للبيانات (Data Access Layer)
// ══════════════════════════════════════════════════════════════════
const { createClient } = supabase;
const sb = createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

// ── ترجمة أخطاء قاعدة البيانات الشائعة لرسائل عربية مفهومة ──────────────────────────────
function friendlyDbError(error) {
  if (!error) return error;
  const msg = error.message || '';
  const code = error.code || '';
  if (code === '23505' || msg.includes('duplicate key value violates unique constraint')) {
    if (msg.includes('warehouses_code_key') || msg.includes('warehouses_code_active_uk')) return new Error('رمز المخزن هذا مستخدم من مخزن آخر فعّال — اختر رمزاً مختلفاً');
    if (msg.includes('materials_store_num')) return new Error('الرقم المخزني هذا مستخدم من مادة أخرى بدليل المواد');
    if (msg.includes('seq_no')) return new Error('تعارض بالتسلسل الآلي للوثيقة — أعد المحاولة');
    return new Error('هذه القيمة (رمز/رقم) مستخدمة مسبقاً بسجل آخر — تحقق من البيانات وحاول مرة أخرى');
  }
  if (code === '23503') return new Error('لا يمكن إتمام العملية لوجود بيانات مرتبطة بهذا السجل بجداول أخرى بالنظام');
  if (code === '23514') return new Error('القيمة المدخلة لا تحقق أحد شروط قاعدة البيانات: ' + msg);
  if (code === '42P17') return new Error('خطأ إعداد صلاحيات بقاعدة البيانات (تكرار لا نهائي بسياسات RLS) — تواصل مع مدير النظام');
  return error;
}
window.friendlyDbError = friendlyDbError;

const DB = {
  // ── جلسة وملف المستخدم ─────────────────────────────
  async currentSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  async currentProfile() {
    const session = await this.currentSession();
    if (!session) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error) { console.error(error); return null; }
    return data;
  },
  async listPendingUsers() {
    const { data, error } = await sb.from('profiles').select('*').eq('is_active', false).order('created_at');
    if (error) throw error; return data;
  },
  // الموافقة على حساب جديد: تفعيله + تحديد دوره (لمدير النظام فقط عبر RLS)
  async approveUser(id, role) {
    const { error } = await sb.from('profiles').update({ is_active: true, role }).eq('id', id);
    if (error) throw error;
    await this.log('approve_user', 'profiles', id, { role });
  },
  // رفض حساب قيد الموافقة: يحذف صف الملف الشخصي فقط (حساب الدخول بحد ذاته يبقى بجدول auth.users
  // ولا يمكن حذفه من واجهة العميل لأسباب أمنية — لو تحتاج حذفه نهائياً استخدم لوحة Supabase)
  async rejectUser(id) {
    const { error } = await sb.from('profiles').delete().eq('id', id);
    if (error) throw error;
    await this.log('reject_user', 'profiles', id, {});
  },
  // حذف نهائي لملف مستخدم فعّال (مدير النظام فقط عبر RLS) — حساب الدخول
  // نفسه بخدمة المصادقة يبقى ويحتاج حذفاً يدوياً من لوحة Supabase
  async hardDeleteUser(id, name) {
    const { error } = await sb.from('profiles').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('hard_delete_user', 'profiles', id, { name });
  },
  // تحديد نطاق مخازن محاسب معيّن + صلاحية الخزينة والرواتب — مدير النظام فقط (عبر RLS)
  async updateProfileScope(id, { warehouse_ids, can_treasury }) {
    const { error } = await sb.from('profiles').update({ warehouse_ids, can_treasury }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_profile_scope', 'profiles', id, { warehouse_ids, can_treasury });
  },

  // ── مخازن ─────────────────────────────
  async listWarehouses() {
    const { data, error } = await sb.from('warehouses').select('*').eq('is_active', true).order('code');
    if (error) throw error; return data;
  },
  async createWarehouse(w) {
    const { data, error } = await sb.from('warehouses').insert(w).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_warehouse', 'warehouses', data.id, { code: w.code, name: w.name });
    return data;
  },
  async updateWarehouse(id, w) {
    const { data: before } = await sb.from('warehouses').select('*').eq('id', id).maybeSingle();
    const { data, error } = await sb.from('warehouses').update(w).eq('id', id).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('update_warehouse', 'warehouses', id, { old: before ? { code: before.code, name: before.name, location: before.location } : null, new: w });
    return data;
  },
  // حذف ناعم (soft delete): يمنع ظهور المخزن بالقوائم دون فقدان تاريخه بالوثائق والأرصدة
  async deleteWarehouse(id) {
    const { data, error: e0 } = await sb.from('material_stock').select('material_id').eq('warehouse_id', id).gt('qty_on_hand', 0).limit(1);
    if (e0) throw e0;
    if (data && data.length > 0) throw new Error('لا يمكن حذف مخزن يحتوي رصيد مواد أكبر من صفر — صفّر الرصيد أو رحّله لمخزن آخر أولاً');
    const { error } = await sb.from('warehouses').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    await this.log('delete_warehouse', 'warehouses', id, {});
  },
  // حذف نهائي (Hard Delete) — مدير النظام فقط. يحذف صفوف الرصيد الخاصة بهذا
  // المخزن أولاً؛ إن كان له وثائق استلام/إصدار تاريخية سيُرفض الحذف تلقائياً
  // من قيد FID بقاعدة البيانات لحماية السجل التاريخي (هذا سلوك مقصود وآمن)
  async hardDeleteWarehouse(id, name) {
    const { error: e1 } = await sb.from('material_stock').delete().eq('warehouse_id', id);
    if (e1) throw friendlyDbError(e1);
    const { error } = await sb.from('warehouses').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('hard_delete_warehouse', 'warehouses', id, { name });
  },

  // ── دليل المواد ─────────────────────────────
  // offset/limit تدعم "تحميل المزيد" (pagination) بدل جلب كل السجلات دفعة واحدة
  async listMaterials(term = '', limit = null, offset = 0) {
    let q = sb.from('materials').select('*').eq('is_active', true).order('store_num');
    if (term) q = q.or(`name.ilike.%${term}%,store_num.ilike.%${term}%`);
    if (limit != null) q = q.range(offset, offset + limit - 1);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async upsertMaterial(m) {
    const { data: before } = await sb.from('materials').select('*').eq('store_num', m.store_num).maybeSingle();
    const { data, error } = await sb.from('materials').upsert(m, { onConflict: 'store_num' }).select().single();
    if (error) throw error;
    await this.log(before ? 'update_material' : 'create_material', 'materials', data.id,
      before ? { old: { name: before.name, unit: before.unit, category: before.category, min_qty: before.min_qty }, new: m } : { new: m });
    return data;
  },
  // حذف نهائي لمادة — مدير النظام فقط. يُرفض تلقائياً لو للمادة رصيد أو
  // استخدام سابق بوثائق استلام/إصدار أو أرصدة افتتاحية (حماية من قاعدة البيانات)
  async deleteMaterial(id, storeNum) {
    const { error } = await sb.from('materials').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_material', 'materials', id, { store_num: storeNum });
  },

  // ── الأرصدة والسعر الوسطي ─────────────────────────────
  async stockOf(materialId, warehouseId) {
    const { data, error } = await sb.from('material_stock').select('*')
      .eq('material_id', materialId).eq('warehouse_id', warehouseId).maybeSingle();
    if (error) throw error; return data || { qty_on_hand: 0, avg_price: 0 };
  },
  async lowStock() {
    const { data, error } = await sb.from('v_low_stock').select('*').order('store_num');
    if (error) throw error; return data;
  },
  async fullBalance(warehouseId = null) {
    let q = sb.from('material_stock').select('*, materials(store_num,name,unit,min_qty), warehouses(code,name)');
    if (warehouseId) q = q.eq('warehouse_id', warehouseId);
    const { data, error } = await q; if (error) throw error; return data;
  },
  // حذف رصيد مادة بمخزن معيّن نهائياً — مدير النظام فقط (لا يعدّل تاريخ الوثائق، فقط يمحو سطر الرصيد الحالي)
  async deleteMaterialStock(materialId, warehouseId) {
    const { error } = await sb.from('material_stock').delete().eq('material_id', materialId).eq('warehouse_id', warehouseId);
    if (error) throw friendlyDbError(error);
    await this.log('delete_material_stock', 'material_stock', materialId, { warehouse_id: warehouseId });
  },

  // ── استيراد أرصدة التدوير (الافتتاحية) حسب المخزن ─────────────────────────────
  // rows: [{ store_num, qty, unit_price }] — يُحدَّث رصيد material_stock فوراً + يُسجَّل بجدول opening_balances لهذه السنة
  async importOpeningBalancesForWarehouse(fiscalYearId, warehouseId, rows) {
    const session = await this.currentSession();
    let ok = 0, fail = 0; const errors = [];
    let seq = 1;
    for (const r of rows) {
      try {
        const { data: mat, error: e1 } = await sb.from('materials').select('id').eq('store_num', r.store_num).maybeSingle();
        if (e1) throw e1;
        if (!mat) { throw new Error('الرقم المخزني غير موجود بدليل المواد'); }

        const { error: e2 } = await sb.from('material_stock')
          .upsert({ material_id: mat.id, warehouse_id: warehouseId, qty_on_hand: r.qty, avg_price: r.unit_price }, { onConflict: 'material_id,warehouse_id' });
        if (e2) throw e2;

        const { error: e3 } = await sb.from('opening_balances').insert({
          fiscal_year_id: fiscalYearId, seq: seq++, material_id: mat.id, warehouse_id: warehouseId,
          qty: r.qty, unit_price: r.unit_price, balance_date: todayISO(), created_by: session?.user?.id,
        });
        if (e3) throw e3;
        ok++;
      } catch (e) { fail++; errors.push(`${r.store_num}: ${e.message}`); }
    }
    await this.log('import_opening_balances', 'opening_balances', null, { warehouse_id: warehouseId, fiscal_year_id: fiscalYearId, ok, fail });
    return { ok, fail, errors };
  },

  // ── وثائق الاستلام ─────────────────────────────
  async createReceipt(doc, items) {
    const { data: rdoc, error: e1 } = await sb.from('receipt_docs').insert(doc).select().single();
    if (e1) throw e1;
    const rows = items.map(it => ({ ...it, receipt_doc_id: rdoc.id }));
    const { error: e2 } = await sb.from('receipt_items').insert(rows);
    if (e2) throw e2;
    const { error: e3 } = await sb.rpc('fn_post_receipt_journal', { p_receipt_id: rdoc.id });
    if (e3) throw e3;
    await this.log('create_receipt', 'receipt_docs', rdoc.id, { doc_num: doc.doc_num, items: items.length });
    return rdoc;
  },
  async listReceipts(limit = 50, fiscalYearId = null, offset = 0, includeCancelled = false) {
    let q = sb.from('receipt_docs').select('*, warehouses(code,name)').order('seq_no', { ascending: false }).range(offset, offset + limit - 1);
    if (fiscalYearId) q = q.eq('fiscal_year_id', fiscalYearId);
    if (!includeCancelled) q = q.eq('is_cancelled', false);
    const { data, error } = await q;
    if (error) throw error; return data;
  },
  async getReceiptById(id) {
    const { data, error } = await sb.from('receipt_docs').select('*, warehouses(code,name)').eq('id', id).single();
    if (error) throw error; return data;
  },
  async cancelReceipt(id, reason) {
    const { error } = await sb.rpc('fn_cancel_receipt', { p_receipt_id: id, p_reason: reason || null });
    if (error) throw error;
    await this.log('cancel_receipt', 'receipt_docs', id, { reason });
  },
  async receiptItems(receiptId) {
    const { data, error } = await sb.from('receipt_items').select('*, materials(store_num,name,unit)')
      .eq('receipt_doc_id', receiptId);
    if (error) throw error; return data;
  },

  // ── مرفقات وثائق الاستلام (Supabase Storage) ─────────────────────────────
  async uploadReceiptAttachment(receiptId, file) {
    const path = `receipts/${receiptId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error: e1 } = await sb.storage.from(window.APP_CONFIG.ATTACHMENTS_BUCKET).upload(path, file, { upsert: false });
    if (e1) throw e1;
    // .select().single() إجباري هنا: بدونها، لو منعت صلاحيات RLS التحديث (لعدم وجود سياسة UPDATE
    // على receipt_docs) فإن Supabase يرجّع "نجاح" بصمت مع صفر صفوف محدَّثة، والمرفق يختفي بدون أي
    // رسالة خطأ. بإضافة select().single() نجبر الاستعلام على إرجاع خطأ صريح إن لم يتحدّث أي صف فعلاً.
    const { data, error: e2 } = await sb.from('receipt_docs')
      .update({ attachment_path: path, attachment_name: file.name })
      .eq('id', receiptId)
      .select()
      .single();
    if (e2 || !data) {
      throw new Error('تعذّر ربط المرفق بالوثيقة (صلاحيات الوصول). تأكد من تنفيذ migration_v4.sql، أو تواصل مع مدير النظام. تفاصيل: ' + (e2?.message || 'لم يتحدّث أي صف'));
    }
    await this.log('upload_attachment', 'receipt_docs', receiptId, { file: file.name });
    return path;
  },
  async getAttachmentUrl(path) {
    // رابط موقّع صالح لمدة ساعة (البكت خاص)
    const { data, error } = await sb.storage.from(window.APP_CONFIG.ATTACHMENTS_BUCKET).createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  },

  // ── وثائق الإصدار ─────────────────────────────
  async createIssue(doc, items) {
    const { data: idoc, error: e1 } = await sb.from('issue_docs').insert(doc).select().single();
    if (e1) throw e1;
    const rows = items.map(it => ({ ...it, issue_doc_id: idoc.id, unit_price: 0 })); // يُملأ تلقائياً بالتريغر
    const { error: e2 } = await sb.from('issue_items').insert(rows);
    if (e2) {
      // تنظيف الوثيقة اليتيمة إذا فشل إدخال الأصناف (مثلاً بسبب قيد الرصيد غير السالب material_stock_qty_nonneg)
      await sb.from('issue_docs').delete().eq('id', idoc.id);
      throw e2;
    }
    const { error: e3 } = await sb.rpc('fn_post_issue_journal', { p_issue_id: idoc.id });
    if (e3) { await sb.from('issue_docs').delete().eq('id', idoc.id); throw e3; }
    await this.log('create_issue', 'issue_docs', idoc.id, { doc_num: doc.doc_num, items: items.length });
    return idoc;
  },
  async listIssues(limit = 50, fiscalYearId = null, offset = 0, includeCancelled = false) {
    let q = sb.from('issue_docs').select('*, warehouses(code,name)').order('seq_no', { ascending: false }).range(offset, offset + limit - 1);
    if (fiscalYearId) q = q.eq('fiscal_year_id', fiscalYearId);
    if (!includeCancelled) q = q.eq('is_cancelled', false);
    const { data, error } = await q;
    if (error) throw error; return data;
  },
  async getIssueById(id) {
    const { data, error } = await sb.from('issue_docs').select('*, warehouses(code,name)').eq('id', id).single();
    if (error) throw error; return data;
  },
  async cancelIssue(id, reason) {
    const { error } = await sb.rpc('fn_cancel_issue', { p_issue_id: id, p_reason: reason || null });
    if (error) throw error;
    await this.log('cancel_issue', 'issue_docs', id, { reason });
  },
  async issueItems(issueId) {
    const { data, error } = await sb.from('issue_items').select('*, materials(store_num,name,unit)')
      .eq('issue_doc_id', issueId);
    if (error) throw error; return data;
  },
  // قائمة مرتّبة بالتسلسل الآلي الثابت (seq_no) — تُستخدم للتنقل التالي/السابق
  async docIdsOrdered(tab, fiscalYearId = null) {
    let q = sb.from(tab === 'receipts' ? 'receipt_docs' : 'issue_docs').select('id, doc_num, seq_no')
      .eq('is_cancelled', false).order('seq_no', { ascending: true });
    if (fiscalYearId) q = q.eq('fiscal_year_id', fiscalYearId);
    const { data, error } = await q;
    if (error) throw error; return data;
  },

  // ── المحاسبة: دليل الحسابات + القيود ─────────────────────────────
  async chartOfAccounts() {
    const { data, error } = await sb.from('chart_of_accounts').select('*').order('code');
    if (error) throw error; return data;
  },
  // استيراد جماعي من إكسل — يحدّث الحساب لو الرمز موجود، أو يضيفه جديداً
  async bulkUpsertAccounts(rows) {
    let ok = 0, fail = 0; const errors = [];
    for (const r of rows) {
      try {
        const { error } = await sb.from('chart_of_accounts')
          .upsert({ code: r.code, name: r.name, type: r.type, is_cogs: r.type === 'expense' ? (r.is_cogs || false) : false }, { onConflict: 'code' });
        if (error) throw friendlyDbError(error);
        ok++;
      } catch (e) { fail++; errors.push(`${r.code}: ${e.message}`); }
    }
    await this.log('import_chart_of_accounts', 'chart_of_accounts', null, { ok, fail, total: rows.length });
    if (errors.length) console.warn('أخطاء استيراد دليل الحسابات:', errors);
    return { ok, fail, errors };
  },
  // حذف حساب: يُمنع لو له قيود محاسبية أو أرصدة افتتاحية مرتبطة (يحمي التاريخ المحاسبي)
  async deleteAccount(id) {
    const [{ data: d1, error: e1 }, { data: d2, error: e2 }] = await Promise.all([
      sb.from('journal_lines').select('id').eq('account_id', id).limit(1),
      sb.from('opening_balances').select('id').eq('account_id', id).limit(1),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    if ((d1 && d1.length) || (d2 && d2.length)) {
      throw new Error('لا يمكن حذف هذا الحساب — له قيود محاسبية أو أرصدة افتتاحية مسجّلة بالفعل. يمكنك تعديل اسمه بدلاً من حذفه.');
    }
    const { error } = await sb.from('chart_of_accounts').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_account', 'chart_of_accounts', id, {});
  },
  // حذف نهائي/إجباري لحساب حتى لو له قيود سابقة — مدير النظام فقط.
  // ⚠️ يحذف كل سطور القيود الخاصة بهذا الحساب، ما قد يكسر توازن قيود
  // مرتبطة. استخدمه بحذر شديد (راجع تنبيه الواجهة قبل الاستدعاء).
  async forceDeleteAccount(id, code) {
    const { error } = await sb.rpc('fn_admin_force_delete_account', { p_account_id: id });
    if (error) throw friendlyDbError(error);
    await this.log('force_delete_account', 'chart_of_accounts', id, { code });
  },
  async trialBalance() {
    const { data, error } = await sb.from('v_trial_balance').select('*');
    if (error) throw error; return data;
  },
  async journalEntries(limit = 50, offset = 0) {
    const { data, error } = await sb.from('journal_entries').select('*, journal_lines(*, chart_of_accounts(code,name))')
      .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error; return data;
  },
  async postManualEntry(entry, lines) {
    const totalD = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalC = lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalD - totalC) > 0.001) throw new Error('القيد غير متوازن: المدين لا يساوي الدائن');
    const { data: je, error: e1 } = await sb.from('journal_entries').insert(entry).select().single();
    if (e1) throw e1;
    const rows = lines.map(l => ({ ...l, entry_id: je.id }));
    const { error: e2 } = await sb.from('journal_lines').insert(rows);
    if (e2) throw e2;
    await this.log('post_journal', 'journal_entries', je.id, { entry_no: entry.entry_no });
    return je;
  },
  // حذف قيد محاسبي كامل (رأس + سطور) — مدير النظام فقط.
  // ⚠️ لو القيد ناتج تلقائياً عن وثيقة استلام/إصدار أو تسوية جرد أو راتب،
  // حذفه هنا لا يعكس أثره على المخزون/الصندوق — استخدم "حذف الوثيقة" أو
  // إلغاء العملية الأصلية لو أردت عكساً كاملاً وآمناً للأثر.
  async deleteJournalEntry(id, entryNo) {
    const { error } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: id });
    if (error) throw friendlyDbError(error);
    await this.log('delete_journal_entry', 'journal_entries', id, { entry_no: entryNo });
  },

  // ── السنوات المالية ─────────────────────────────
  async listFiscalYears() {
    const { data, error } = await sb.from('fiscal_years').select('*').order('year', { ascending: false });
    if (error) throw error; return data;
  },
  async activeFiscalYear() {
    const { data, error } = await sb.from('fiscal_years').select('*').eq('is_active', true).maybeSingle();
    if (error) throw error; return data;
  },
  async closeFiscalYear(newYear) {
    const { data, error } = await sb.rpc('fn_close_fiscal_year', { p_new_year: newYear });
    if (error) throw error;
    await this.log('close_fiscal_year', 'fiscal_years', null, { new_year: newYear });
    return data;
  },
  async openingBalances(fiscalYearId) {
    const { data, error } = await sb.from('v_opening_balances').select('*').eq('fiscal_year_id', fiscalYearId).order('seq');
    if (error) throw error; return data;
  },
  // حذف سنة مالية مؤرشفة (غير نشطة) — مدير النظام فقط. يُرفض تلقائياً
  // لو للسنة وثائق استلام/إصدار أو أرصدة افتتاحية مسجّلة (حماية FK)
  async deleteFiscalYear(id, year, isActive) {
    if (isActive) throw new Error('لا يمكن حذف السنة المالية النشطة حالياً');
    const { error: e1 } = await sb.from('opening_balances').delete().eq('fiscal_year_id', id);
    if (e1) throw friendlyDbError(e1);
    const { error } = await sb.from('fiscal_years').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_fiscal_year', 'fiscal_years', id, { year });
  },

  // ── الجرد الدوري (Physical Count) ─────────────────────────────
  async listPhysicalCounts() {
    const { data, error } = await sb.from('physical_counts').select('*, warehouses(code,name)').order('created_at', { ascending: false });
    if (error) throw error; return data;
  },
  async createPhysicalCount(count, items) {
    const { data: pc, error: e1 } = await sb.from('physical_counts').insert(count).select().single();
    if (e1) throw e1;
    const rows = items.map(it => ({ ...it, count_id: pc.id }));
    const { error: e2 } = await sb.from('count_items').insert(rows);
    if (e2) throw e2;
    await this.log('create_physical_count', 'physical_counts', pc.id, { count_no: count.count_no, items: items.length });
    return pc;
  },
  async countItems(countId) {
    const { data, error } = await sb.from('count_items').select('*, materials(store_num,name,unit)').eq('count_id', countId).order('id');
    if (error) throw error; return data;
  },
  async postPhysicalCount(countId) {
    const { error } = await sb.rpc('fn_post_physical_count_journal', { p_count_id: countId });
    if (error) throw error;
    await this.log('post_physical_count', 'physical_counts', countId, {});
  },
  // حذف عملية جرد كاملة — مدير النظام فقط. لو كانت "مُرحَّلة" فإن قيد
  // التسوية المحاسبي الناتج عنها لا يُحذف تلقائياً (احذفه يدوياً من صفحة
  // القيود المحاسبية إن أردت عكس أثره بالكامل)
  async deletePhysicalCount(id, countNo) {
    const { error: e1 } = await sb.from('count_items').delete().eq('count_id', id);
    if (e1) throw friendlyDbError(e1);
    const { error } = await sb.from('physical_counts').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_physical_count', 'physical_counts', id, { count_no: countNo });
  },

  // ── إعدادات النظام (مفتاح/قيمة) — تُستخدم لضبط حسابات فروقات الجرد ─────────────────────────────
  async getSetting(key) {
    const { data, error } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
    if (error) throw error; return data?.value || null;
  },
  async setSetting(key, value) {
    const { error } = await sb.from('app_settings').upsert({ key, value });
    if (error) throw error;
  },

  // ── بيانات اللوحة البيانية (Dashboard Charts) ─────────────────────────────
  async monthlyMovementChart(months = 6) {
    const since = new Date(); since.setMonth(since.getMonth() - (months - 1)); since.setDate(1);
    const sinceISO = since.toISOString().split('T')[0];
    const [{ data: r, error: e1 }, { data: i, error: e2 }] = await Promise.all([
      sb.from('receipt_docs').select('doc_date,total').gte('doc_date', sinceISO),
      sb.from('issue_docs').select('doc_date,total').gte('doc_date', sinceISO),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const buckets = {};
    for (let k = 0; k < months; k++) {
      const d = new Date(since); d.setMonth(d.getMonth() + k);
      buckets[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`] = { receipts: 0, issues: 0 };
    }
    (r||[]).forEach(x => { const k = x.doc_date.slice(0,7); if (buckets[k]) buckets[k].receipts += Number(x.total)||0; });
    (i||[]).forEach(x => { const k = x.doc_date.slice(0,7); if (buckets[k]) buckets[k].issues += Number(x.total)||0; });
    return Object.entries(buckets).map(([month, v]) => ({ month, ...v }));
  },
  async topConsumedMaterials(limit = 8, months = 6) {
    const since = new Date(); since.setMonth(since.getMonth() - (months - 1)); since.setDate(1);
    const sinceISO = since.toISOString().split('T')[0];
    const { data, error } = await sb.from('issue_items')
      .select('qty, materials(name), issue_docs!inner(doc_date)')
      .gte('issue_docs.doc_date', sinceISO)
      .limit(5000);
    if (error) throw error;
    const agg = {};
    (data||[]).forEach(it => {
      const key = it.materials?.name || '—';
      agg[key] = (agg[key] || 0) + (Number(it.qty)||0);
    });
    return Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0, limit).map(([name, qty]) => ({ name, qty }));
  },
  async inventoryValueTrend() {
    const stock = await this.fullBalance();
    const total = stock.reduce((s,x)=>s+ (Number(x.qty_on_hand)||0) * (Number(x.avg_price)||0), 0);
    return total;
  },
  // اتجاه المصروفات الشهرية (من القيود المحاسبية الفعلية — حسابات المصروفات فقط)
  async monthlyExpenseTrend(months = 6) {
    const since = new Date(); since.setMonth(since.getMonth() - (months - 1)); since.setDate(1);
    const sinceISO = since.toISOString().split('T')[0];
    const { data, error } = await sb.from('journal_lines')
      .select('debit, credit, journal_entries!inner(entry_date), chart_of_accounts!inner(type)')
      .eq('chart_of_accounts.type', 'expense')
      .gte('journal_entries.entry_date', sinceISO);
    if (error) throw error;
    const buckets = {};
    for (let k = 0; k < months; k++) {
      const d = new Date(since); d.setMonth(d.getMonth() + k);
      buckets[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`] = 0;
    }
    (data||[]).forEach(l => {
      const k = l.journal_entries?.entry_date?.slice(0,7);
      if (k in buckets) buckets[k] += (Number(l.debit)||0) - (Number(l.credit)||0);
    });
    return Object.entries(buckets).map(([month, total]) => ({ month, total }));
  },
  // مقارنة سنوية: إيرادات/مصروفات/صافي لكل سنة مالية مسجَّلة (آخر N سنة)
  async yearlyComparison(yearsCount = 4) {
    const years = await this.listFiscalYears();
    const sorted = [...years].map(y => y.year).sort((a,b) => b-a).slice(0, yearsCount).sort((a,b) => a-b);
    const results = [];
    for (const year of sorted) {
      const start = `${year}-01-01`, end = `${year}-12-31`;
      const { data, error } = await sb.from('journal_lines')
        .select('debit, credit, chart_of_accounts!inner(type), journal_entries!inner(entry_date)')
        .gte('journal_entries.entry_date', start).lte('journal_entries.entry_date', end)
        .in('chart_of_accounts.type', ['revenue','expense']);
      if (error) throw error;
      let revenue = 0, expense = 0;
      (data||[]).forEach(l => {
        if (l.chart_of_accounts.type === 'revenue') revenue += (Number(l.credit)||0) - (Number(l.debit)||0);
        else expense += (Number(l.debit)||0) - (Number(l.credit)||0);
      });
      results.push({ year, revenue, expense, net: revenue - expense });
    }
    return results;
  },

  // ── صندوق المركز (Cash Box) ─────────────────────────────
  async listCashTransactions(limit = 200) {
    const { data, error } = await sb.from('cash_transactions').select('*, chart_of_accounts(code,name)').order('trans_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async cashBalance() {
    const { data, error } = await sb.from('cash_transactions').select('type, amount');
    if (error) throw error;
    return (data || []).reduce((s, t) => s + (t.type === 'in' ? Number(t.amount) : -Number(t.amount)), 0);
  },
  // ينشئ حركة صندوق + قيد يدوي مرتبط بها (الطرف الآخر = counterparty_account_id)
  // doc_kind: 'voucher' (سند فعلي، الافتراضي) أو 'order' (أمر قبض/صرف)
  async createCashTransaction(t) {
    const cashAccId = await this.getSetting('cashbox_account_id');
    if (!cashAccId) throw new Error('يجب ضبط "حساب الصندوق/النقدية" أولاً من صفحة المستخدمون والصلاحيات');
    const session = await this.currentSession();
    const lines = t.type === 'in'
      ? [{ account_id: cashAccId, debit: t.amount, credit: 0 }, { account_id: t.counterparty_account_id, debit: 0, credit: t.amount }]
      : [{ account_id: t.counterparty_account_id, debit: t.amount, credit: 0 }, { account_id: cashAccId, debit: 0, credit: t.amount }];
    const je = await this.postManualEntry({
      entry_no: 'JE-CASH-' + Date.now().toString().slice(-8), entry_date: t.trans_date, ref_type: 'cash',
      description: t.description || (t.type === 'in' ? 'قبض نقدي' : 'صرف نقدي'), created_by: session?.user?.id,
    }, lines);
    const { data, error } = await sb.from('cash_transactions').insert({
      trans_date: t.trans_date, type: t.type, amount: t.amount, description: t.description,
      counterparty_account_id: t.counterparty_account_id, journal_entry_id: je.id, created_by: session?.user?.id,
      doc_kind: t.doc_kind || 'voucher',
    }).select().single();
    if (error) throw error;
    await this.log(t.type === 'in' ? 'create_receipt' : 'create_payment', 'cash_transactions', data.id, { amount: t.amount, doc_kind: t.doc_kind || 'voucher' });
    return data;
  },
  async listCashReconciliations(limit = 50) {
    const { data, error } = await sb.from('cash_reconciliations').select('*, profiles(full_name)').order('recon_date', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async createCashReconciliation(r) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('cash_reconciliations').insert({ ...r, created_by: session?.user?.id }).select().single();
    if (error) throw error;
    await this.log('cash_reconciliation', 'cash_reconciliations', data.id, { diff: r.counted_amount - r.system_balance });
    return data;
  },
  // حذف حركة صندوق — مدير النظام فقط. يحذف القيد اليدوي المرتبط بها أيضاً
  async deleteCashTransaction(id, journalEntryId, desc) {
    if (journalEntryId) {
      const { error: eJ } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: journalEntryId });
      if (eJ) throw friendlyDbError(eJ);
    }
    const { error } = await sb.from('cash_transactions').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_cash_transaction', 'cash_transactions', id, { desc });
  },
  // حذف عملية مطابقة جرد صندوق — مدير النظام فقط (سجل توثيقي، بلا قيد محاسبي مرتبط)
  async deleteCashReconciliation(id) {
    const { error } = await sb.from('cash_reconciliations').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_cash_reconciliation', 'cash_reconciliations', id, {});
  },

  // ── تغذية السلفة المستديمة (Petty Cash Advances) ─────────────────────────────
  async listPettyCashAdvances(limit = 200) {
    const { data, error } = await sb.from('petty_cash_advances').select('*, chart_of_accounts(code,name), profiles(full_name)').order('advance_date', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  // رصيد صندوق السلفة المستديمة الحالي = مجموع التغذيات - مجموع سندات الصرف غير الملغاة
  async pettyCashFundBalance() {
    const [{ data: adv, error: e1 }, { data: vch, error: e2 }] = await Promise.all([
      sb.from('petty_cash_advances').select('amount'),
      sb.from('petty_cash_vouchers').select('total_amount').eq('is_cancelled', false),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    const totalAdv = adv.reduce((s, r) => s + Number(r.amount), 0);
    const totalSpent = vch.reduce((s, r) => s + Number(r.total_amount), 0);
    return { totalAdv, totalSpent, balance: totalAdv - totalSpent };
  },
  // تسجيل تغذية جديدة للسلفة المستديمة (مدين حساب السلفة، دائن حساب المصدر) — تنشئ قيداً محاسبياً فوراً
  async createPettyCashAdvance(a) {
    const pettyCashAcc = await this.getSetting('petty_cash_account_id');
    if (!pettyCashAcc) throw new Error('يجب ضبط "حساب السلفة المستديمة" أولاً من صفحة المستخدمون والصلاحيات');
    const je = await this.postManualEntry({
      entry_no: 'JE-PCADV-' + Date.now(), entry_date: a.advance_date, ref_type: 'petty_cash_advance',
      description: 'تغذية السلفة المستديمة' + (a.notes ? ' - ' + a.notes : ''),
    }, [
      { account_id: pettyCashAcc, debit: a.amount, credit: 0 },
      { account_id: a.source_account_id, debit: 0, credit: a.amount },
    ]);
    const session = await this.currentSession();
    const { data, error } = await sb.from('petty_cash_advances').insert({
      advance_date: a.advance_date, amount: a.amount, source_account_id: a.source_account_id,
      notes: a.notes || null, journal_entry_id: je.id, created_by: session?.user?.id,
    }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_petty_cash_advance', 'petty_cash_advances', data.id, { amount: a.amount });
    return data;
  },
  // حذف تغذية سلفة — مدير النظام فقط. يحذف القيد المرتبط أيضاً
  async deletePettyCashAdvance(id, journalEntryId, amount) {
    if (journalEntryId) {
      const { error: eJ } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: journalEntryId });
      if (eJ) throw friendlyDbError(eJ);
    }
    const { error } = await sb.from('petty_cash_advances').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_petty_cash_advance', 'petty_cash_advances', id, { amount });
  },

  // ── الرواتب (Payroll) ─────────────────────────────
  async listEmployees(activeOnly = true) {
    let q = sb.from('employees').select('*').order('full_name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async upsertEmployee(e) {
    const { data, error } = await sb.from('employees').upsert(e).select().single();
    if (error) throw error; return data;
  },
  // إنشاء موظف جديد — مدير النظام ومحاسب المركز
  async createEmployee(e) {
    const { data, error } = await sb.from('employees').insert(e).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_employee', 'employees', data.id, { name: e.full_name });
    return data;
  },
  // تعديل جزئي لموظف (لا يمسح بقية الأعمدة كما قد يفعل upsert الكامل)
  async updateEmployee(id, patch) {
    const { data, error } = await sb.from('employees').update(patch).eq('id', id).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('update_employee', 'employees', id, patch);
    return data;
  },
  async toggleEmployeeActive(id, val) {
    const { error } = await sb.from('employees').update({ is_active: val }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log(val ? 'activate_employee' : 'deactivate_employee', 'employees', id, {});
  },
  // حذف نهائي لموظف — يُرفض تلقائياً لو له سطور بكشوفات رواتب سابقة (حماية FK)
  async deleteEmployee(id, name) {
    const { error } = await sb.from('employees').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_employee', 'employees', id, { name });
  },
  async listPayrollRuns() {
    const { data, error } = await sb.from('payroll_runs').select('*').order('period', { ascending: false });
    if (error) throw error; return data;
  },
  async getPayrollRun(id) {
    const { data, error } = await sb.from('payroll_runs').select('*').eq('id', id).single();
    if (error) throw error; return data;
  },
  async createPayrollRun(run, items) {
    const { data: pr, error: e1 } = await sb.from('payroll_runs').insert(run).select().single();
    if (e1) throw friendlyDbError(e1);
    if (items.length) {
      const rows = items.map(it => ({ ...it, run_id: pr.id }));
      const { error: e2 } = await sb.from('payroll_items').insert(rows);
      if (e2) throw friendlyDbError(e2);
    }
    await this.log('create_payroll_run', 'payroll_runs', pr.id, { period: run.period, items: items.length });
    return pr;
  },
  // تعديل رأس الكشف (الفترة/العنوان) — مسودة فقط عملياً بحكم RLS
  async updatePayrollRun(id, patch) {
    const { error } = await sb.from('payroll_runs').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
  },
  // استبدال كامل لأصناف كشف الراتب (يُستخدم عند حفظ تعديلات على مسودة)
  async replacePayrollItems(runId, items) {
    const { error: e1 } = await sb.from('payroll_items').delete().eq('run_id', runId);
    if (e1) throw friendlyDbError(e1);
    if (items.length) {
      const rows = items.map(it => ({ ...it, run_id: runId }));
      const { error: e2 } = await sb.from('payroll_items').insert(rows);
      if (e2) throw friendlyDbError(e2);
    }
  },
  async payrollItems(runId) {
    const { data, error } = await sb.from('payroll_items').select('*, employees(full_name,job_title)').eq('run_id', runId);
    if (error) throw error; return data;
  },
  async postPayrollRun(runId) {
    const { error } = await sb.rpc('fn_post_payroll_journal', { p_run_id: runId });
    if (error) throw friendlyDbError(error);
    await this.log('post_payroll_run', 'payroll_runs', runId, {});
  },
  // حذف كشف راتب كامل — محاسب المركز: مسودات فقط. مدير النظام: أي كشف
  // (ويحذف معه القيد المحاسبي المرتبط لو كان مُرحَّلاً)
  async deletePayrollRun(id, period, journalEntryId) {
    if (journalEntryId) {
      const { error: eJ } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: journalEntryId });
      if (eJ) throw friendlyDbError(eJ);
    }
    const { error: e1 } = await sb.from('payroll_items').delete().eq('run_id', id);
    if (e1) throw friendlyDbError(e1);
    const { error } = await sb.from('payroll_runs').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_payroll_run', 'payroll_runs', id, { period });
  },

  // ── السلفة المستديمة (Petty Cash) ─────────────────────────────
  async listPettyCashVouchers(limit = 200) {
    const { data, error } = await sb.from('petty_cash_vouchers').select('*').order('seq_no', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async getPettyCashVoucher(id) {
    const { data, error } = await sb.from('petty_cash_vouchers').select('*').eq('id', id).single();
    if (error) throw error; return data;
  },
  async pettyCashItems(voucherId) {
    const { data, error } = await sb.from('petty_cash_items')
      .select('*, materials(store_num,name), warehouses(code,name), chart_of_accounts(code,name)')
      .eq('voucher_id', voucherId).order('line_no');
    if (error) throw error; return data;
  },
  // إنشاء سند صرف من السلفة المستديمة وترحيله فوراً (رأس + أصناف + قيد محاسبي)
  async createPettyCashVoucher(header, items) {
    const session = await this.currentSession();
    const { data: v, error: e1 } = await sb.from('petty_cash_vouchers').insert({ ...header, created_by: session?.user?.id }).select().single();
    if (e1) throw friendlyDbError(e1);
    const rows = items.map((it, i) => ({ ...it, voucher_id: v.id, line_no: i + 1 }));
    const { error: e2 } = await sb.from('petty_cash_items').insert(rows);
    if (e2) throw friendlyDbError(e2);
    const { error: e3 } = await sb.rpc('fn_post_petty_cash_voucher', { p_voucher_id: v.id });
    if (e3) throw friendlyDbError(e3);
    await this.log('create_petty_cash_voucher', 'petty_cash_vouchers', v.id, { doc_num: header.doc_num, items: items.length });
    return v;
  },
  // إلغاء سند (مدير النظام فقط) — يعكس أثر المخزون ويحذف القيد المرتبط
  async cancelPettyCashVoucher(id, docNum) {
    const { error } = await sb.rpc('fn_cancel_petty_cash_voucher', { p_voucher_id: id });
    if (error) throw friendlyDbError(error);
    await this.log('cancel_petty_cash_voucher', 'petty_cash_vouchers', id, { doc_num: docNum });
  },
  // حذف نهائي لسند (مدير النظام فقط) — استخدم "إلغاء" عادةً؛ هذا يمحو السند نهائياً من السجل
  async deletePettyCashVoucher(id, docNum, journalEntryId) {
    if (journalEntryId) {
      const { error: eJ } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: journalEntryId });
      if (eJ) throw friendlyDbError(eJ);
    }
    const { error: e1 } = await sb.from('petty_cash_items').delete().eq('voucher_id', id);
    if (e1) throw friendlyDbError(e1);
    const { error } = await sb.from('petty_cash_vouchers').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_petty_cash_voucher', 'petty_cash_vouchers', id, { doc_num: docNum });
  },

  // ── التحويل المخزني بين المخازن ─────────────────────────────
  async listStockTransfers(limit = 200) {
    const { data, error } = await sb.from('stock_transfers').select('*, from:from_warehouse_id(code,name), to:to_warehouse_id(code,name)').order('seq_no', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async getStockTransfer(id) {
    const { data, error } = await sb.from('stock_transfers').select('*, from:from_warehouse_id(code,name), to:to_warehouse_id(code,name)').eq('id', id).single();
    if (error) throw error; return data;
  },
  async stockTransferItems(id) {
    const { data, error } = await sb.from('stock_transfer_items').select('*, materials(store_num,name,unit)').eq('transfer_id', id);
    if (error) throw error; return data;
  },
  async createStockTransfer(header, items) {
    const session = await this.currentSession();
    const { data: t, error: e1 } = await sb.from('stock_transfers').insert({ ...header, created_by: session?.user?.id }).select().single();
    if (e1) throw friendlyDbError(e1);
    const { error: e2 } = await sb.from('stock_transfer_items').insert(items.map(it => ({ ...it, transfer_id: t.id })));
    if (e2) throw friendlyDbError(e2);
    const { error: e3 } = await sb.rpc('fn_post_stock_transfer', { p_transfer_id: t.id });
    if (e3) throw friendlyDbError(e3);
    await this.log('create_stock_transfer', 'stock_transfers', t.id, { doc_num: header.doc_num, items: items.length });
    return t;
  },
  async cancelStockTransfer(id, docNum) {
    const { error } = await sb.rpc('fn_cancel_stock_transfer', { p_transfer_id: id });
    if (error) throw friendlyDbError(error);
    await this.log('cancel_stock_transfer', 'stock_transfers', id, { doc_num: docNum });
  },
  async deleteStockTransfer(id, docNum) {
    const { error: e1 } = await sb.from('stock_transfer_items').delete().eq('transfer_id', id);
    if (e1) throw friendlyDbError(e1);
    const { error } = await sb.from('stock_transfers').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_stock_transfer', 'stock_transfers', id, { doc_num: docNum });
  },

  // ── سلف الموظفين ─────────────────────────────
  async listEmployeeLoans(activeOnly = false) {
    let q = sb.from('employee_loans').select('*, employees(full_name)').order('created_at', { ascending: false });
    if (activeOnly) q = q.eq('status', 'active');
    const { data, error } = await q; if (error) throw error; return data;
  },
  async activeLoanForEmployee(employeeId) {
    const { data, error } = await sb.from('employee_loans').select('*').eq('employee_id', employeeId).eq('status', 'active').maybeSingle();
    if (error) throw error; return data;
  },
  async createEmployeeLoan(l) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('employee_loans').insert({ ...l, remaining_balance: l.principal_amount, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_employee_loan', 'employee_loans', data.id, { amount: l.principal_amount });
    return data;
  },
  async closeEmployeeLoan(id) {
    const { error } = await sb.from('employee_loans').update({ status: 'closed' }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('close_employee_loan', 'employee_loans', id, {});
  },
  async deleteEmployeeLoan(id) {
    const { error } = await sb.from('employee_loans').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_employee_loan', 'employee_loans', id, {});
  },

  // ── دليل الموردين ─────────────────────────────
  async listSuppliers(activeOnly = true) {
    let q = sb.from('suppliers').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createSupplier(s) {
    const { data, error } = await sb.from('suppliers').insert(s).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_supplier', 'suppliers', data.id, { name: s.name });
    return data;
  },
  async updateSupplier(id, patch) {
    const { error } = await sb.from('suppliers').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_supplier', 'suppliers', id, patch);
  },
  async deleteSupplier(id, name) {
    const { error } = await sb.from('suppliers').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_supplier', 'suppliers', id, { name });
  },

  // ── الأصول الثابتة ─────────────────────────────
  async listFixedAssets(activeOnly = false) {
    let q = sb.from('fixed_assets').select('*, asset_account:asset_account_id(code,name), dep_account:depreciation_account_id(code,name)').order('created_at', { ascending: false });
    if (activeOnly) q = q.eq('status', 'active');
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createFixedAsset(a) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('fixed_assets').insert({ ...a, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_fixed_asset', 'fixed_assets', data.id, { name: a.name, cost: a.cost });
    return data;
  },
  async disposeFixedAsset(id) {
    const { error } = await sb.from('fixed_assets').update({ status: 'disposed' }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('dispose_fixed_asset', 'fixed_assets', id, {});
  },
  async deleteFixedAsset(id, name) {
    const { error } = await sb.from('fixed_assets').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_fixed_asset', 'fixed_assets', id, { name });
  },
  async listDepreciationRuns() {
    const { data, error } = await sb.from('depreciation_runs').select('*').order('run_date', { ascending: false });
    if (error) throw error; return data;
  },
  async postDepreciation(periodLabel) {
    const { data, error } = await sb.rpc('fn_post_depreciation', { p_period_label: periodLabel });
    if (error) throw friendlyDbError(error);
    await this.log('post_depreciation', 'depreciation_runs', data, { period: periodLabel });
    return data;
  },
  async deleteDepreciationRun(id, journalEntryId) {
    if (journalEntryId) {
      const { error: eJ } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: journalEntryId });
      if (eJ) throw friendlyDbError(eJ);
    }
    const { error } = await sb.from('depreciation_runs').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_depreciation_run', 'depreciation_runs', id, {});
  },

  // ── الموازنة التقديرية ─────────────────────────────
  async listBudgets(fiscalYearId) {
    const { data, error } = await sb.from('budgets').select('*, chart_of_accounts(code,name,type)').eq('fiscal_year_id', fiscalYearId);
    if (error) throw error; return data;
  },
  async upsertBudget(b) {
    const { error } = await sb.from('budgets').upsert(b, { onConflict: 'fiscal_year_id,account_id' });
    if (error) throw friendlyDbError(error);
  },
  async deleteBudget(id) {
    const { error } = await sb.from('budgets').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
  },
  // الفعلي المتحقق لكل حساب ضمن فترة سنة مالية معيّنة (صافي مدين-دائن)
  async actualByAccount(fiscalYearId) {
    const { data: fy, error: e0 } = await sb.from('fiscal_years').select('*').eq('id', fiscalYearId).single();
    if (e0) throw e0;
    const start = `${fy.year}-01-01`, end = `${fy.year}-12-31`;
    const { data, error } = await sb.from('journal_lines').select('account_id, debit, credit, journal_entries!inner(entry_date)')
      .gte('journal_entries.entry_date', start).lte('journal_entries.entry_date', end);
    if (error) throw error;
    const map = {};
    data.forEach(l => { map[l.account_id] = (map[l.account_id] || 0) + Number(l.debit || 0) - Number(l.credit || 0); });
    return map;
  },

  // ── موافقة القيود اليدوية الكبيرة (Maker-Checker) ─────────────────────────────
  async listPendingEntries(status = 'pending') {
    const { data, error } = await sb.from('pending_journal_entries').select('*, requester:requested_by(full_name)').eq('status', status).order('created_at', { ascending: false });
    if (error) throw error; return data;
  },
  async createPendingEntry(entry, lines) {
    const session = await this.currentSession();
    const total = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const { data, error } = await sb.from('pending_journal_entries').insert({
      entry_date: entry.entry_date, description: entry.description, lines, total_amount: total, requested_by: session?.user?.id,
    }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('request_journal_approval', 'pending_journal_entries', data.id, { total });
    return data;
  },
  async approvePendingEntry(id, note) {
    const { data, error } = await sb.rpc('fn_approve_pending_entry', { p_id: id, p_note: note || null });
    if (error) throw friendlyDbError(error);
    await this.log('approve_journal_entry', 'pending_journal_entries', id, {});
    return data;
  },
  async rejectPendingEntry(id, note) {
    const { error } = await sb.rpc('fn_reject_pending_entry', { p_id: id, p_note: note || null });
    if (error) throw friendlyDbError(error);
    await this.log('reject_journal_entry', 'pending_journal_entries', id, {});
  },

  // ── فحص سلامة البيانات ─────────────────────────────
  async integrityCheck() {
    const { data, error } = await sb.rpc('fn_integrity_check');
    if (error) throw friendlyDbError(error);
    return data;
  },

  // ── سجل المراجعة ─────────────────────────────
  async log(action, entity, entity_id, details = {}) {
    const session = await this.currentSession();
    await sb.from('audit_log').insert({ user_id: session?.user?.id, action, entity, entity_id, details });
  },
  async auditLog(limit = 100) {
    const { data, error } = await sb.from('audit_log').select('*, profiles(full_name,role)')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },

  // ══════════════════════════════════════════════════════════════════
  //  بطاقة الزبون + إيصالات/أوامر القبض والدفع + كشف الحساب — المرحلة ١
  // ══════════════════════════════════════════════════════════════════
  // ── بطاقة الزبون ─────────────────────────────
  async listCustomers(term = '', activeOnly = true) {
    let q = sb.from('customers').select('*, chart_of_accounts(code,name)').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    if (term) q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async getCustomer(id) {
    const { data, error } = await sb.from('customers').select('*, chart_of_accounts(code,name)').eq('id', id).single();
    if (error) throw error; return data;
  },
  // ينشئ الزبون + حسابه بدليل الحسابات بعملية واحدة ذرّية (راجع fn_create_customer بملف SQL)
  async createCustomer(c) {
    const { data, error } = await sb.rpc('fn_create_customer', { p_code: c.code, p_name: c.name, p_phone: c.phone || null, p_address: c.address || null });
    if (error) throw friendlyDbError(error);
    await this.log('create_customer', 'customers', data.id, { code: c.code, name: c.name });
    return data;
  },
  // تحديث بيانات الزبون؛ يُحدَّث اسم حسابه بدليل الحسابات أيضاً ليبقى متطابقاً معه بكل التقارير
  async updateCustomer(id, patch, accountId) {
    const { error: e1 } = await sb.from('customers').update(patch).eq('id', id);
    if (e1) throw friendlyDbError(e1);
    if (patch.name && accountId) {
      const { error: e2 } = await sb.from('chart_of_accounts').update({ name: patch.name }).eq('id', accountId);
      if (e2) throw friendlyDbError(e2);
    }
    await this.log('update_customer', 'customers', id, patch);
  },
  // حذف ناعم: يمنع ظهور الزبون بالقوائم دون فقدان تاريخه بالفواتير والإيصالات
  async deactivateCustomer(id) {
    const { error } = await sb.from('customers').update({ is_active: false }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('deactivate_customer', 'customers', id, {});
  },
  // حذف نهائي — مدير النظام فقط. يُرفض تلقائياً لو للزبون قيود محاسبية مسجّلة (حماية FK بحساب دليل الحسابات المرتبط)
  async hardDeleteCustomer(id, accountId, name) {
    const { error: e1 } = await sb.from('customers').delete().eq('id', id);
    if (e1) throw friendlyDbError(e1);
    const { error: e2 } = await sb.from('chart_of_accounts').delete().eq('id', accountId);
    if (e2) throw friendlyDbError(e2); // لو فيه قيود سابقة سيُرفض هنا تلقائياً ويبقى سطر الزبون محذوفاً بينما الحساب يبقى — نادر الحدوث، يُعالَج يدوياً
    await this.log('hard_delete_customer', 'customers', id, { name });
  },

  // ── إيصالات/أوامر القبض والدفع (تُبنى فوق صندوق المركز الموجود أصلاً) ─────────────────────────────
  // type: 'in' (قبض) | 'out' (صرف) — docKind: 'voucher' (إيصال/سند فعلي) | 'order' (أمر)
  async listCashDocs(type, docKind, limit = 100) {
    let q = sb.from('cash_transactions').select('*, chart_of_accounts(code,name)')
      .eq('type', type).eq('doc_kind', docKind)
      .order('trans_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
    const { data, error } = await q; if (error) throw error; return data;
  },

  // ── كشف الحساب (دفتر أستاذ حساب معيّن بفترة معيّنة، مع رصيد افتتاحي ومتحرك) ─────────────────────────────
  async accountStatement(accountId, dateFrom, dateTo) {
    const { data: allLines, error } = await sb.from('journal_lines')
      .select('debit, credit, journal_entries!inner(entry_date, entry_no, description)')
      .eq('account_id', accountId)
      .lte('journal_entries.entry_date', dateTo)
      .order('journal_entries(entry_date)', { ascending: true });
    if (error) throw error;
    let opening = 0;
    const rows = [];
    (allLines || []).forEach(l => {
      const d = l.journal_entries.entry_date;
      const net = Number(l.debit || 0) - Number(l.credit || 0);
      if (d < dateFrom) { opening += net; return; }
      rows.push({ date: d, entry_no: l.journal_entries.entry_no, description: l.journal_entries.description, debit: Number(l.debit || 0), credit: Number(l.credit || 0) });
    });
    let running = opening;
    const withBalance = rows.map(r => { running += (r.debit - r.credit); return { ...r, balance: running }; });
    return { opening, closing: running, rows: withBalance };
  },
  async customerStatement(customerId, dateFrom, dateTo) {
    const cust = await this.getCustomer(customerId);
    const st = await this.accountStatement(cust.account_id, dateFrom, dateTo);
    return { customer: cust, ...st };
  },

  // ══════════════════════════════════════════════════════════════════
  //  بطاقة المشروع + بطاقة الفرع — المرحلة ٢
  // ══════════════════════════════════════════════════════════════════
  // ── بطاقة المشروع ─────────────────────────────
  async listProjects(activeOnly = true) {
    let q = sb.from('projects').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createProject(p) {
    const { data, error } = await sb.from('projects').insert(p).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_project', 'projects', data.id, { code: p.code, name: p.name });
    return data;
  },
  async updateProject(id, patch) {
    const { error } = await sb.from('projects').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_project', 'projects', id, patch);
  },
  async deactivateProject(id) {
    const { error } = await sb.from('projects').update({ is_active: false }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('deactivate_project', 'projects', id, {});
  },
  async hardDeleteProject(id, name) {
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('hard_delete_project', 'projects', id, { name });
  },

  // ── بطاقة الفرع ─────────────────────────────
  async listBranches(activeOnly = true) {
    let q = sb.from('branches').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createBranch(b) {
    const { data, error } = await sb.from('branches').insert(b).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_branch', 'branches', data.id, { code: b.code, name: b.name });
    return data;
  },
  async updateBranch(id, patch) {
    const { error } = await sb.from('branches').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_branch', 'branches', id, patch);
  },
  async deactivateBranch(id) {
    const { error } = await sb.from('branches').update({ is_active: false }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('deactivate_branch', 'branches', id, {});
  },
  async hardDeleteBranch(id, name) {
    const { error } = await sb.from('branches').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('hard_delete_branch', 'branches', id, { name });
  },
};

window.DB = DB;
window.sb = sb;
