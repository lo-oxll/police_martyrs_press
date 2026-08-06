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
  async updateProfileScope(id, { warehouse_ids, can_treasury, branch_ids }) {
    const patch = { warehouse_ids, can_treasury };
    if (branch_ids !== undefined) patch.branch_ids = branch_ids;
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_profile_scope', 'profiles', id, patch);
  },

  // ── مخازن ─────────────────────────────
  async listWarehouses() {
    const { data, error } = await sb.from('warehouses').select('*, branches(name)').eq('is_active', true).order('code');
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
  // يستورد أرصدة افتتاحية بمطابقة اسم المادة (وليس الرقم المخزني). المادة غير الموجودة بدليل المواد
  // تُضاف تلقائياً ببطاقة جديدة (رقم مخزني مولَّد + الوحدة من الملف)، لكن رصيدها الافتتاحي يبقى صفراً
  // عمداً (تحتاج مراجعة يدوية) — لا يُستورَد لها أي كمية/سعر من الملف تجنّباً لتحميل بيانات غير موثوقة.
  async importOpeningBalancesForWarehouse(fiscalYearId, warehouseId, rows) {
    const session = await this.currentSession();
    let ok = 0, fail = 0, autoCreated = 0; const errors = [];
    let seq = 1;
    for (const r of rows) {
      try {
        const name = (r.name || '').trim();
        if (!name) throw new Error('اسم المادة فارغ');
        let { data: mat, error: e1 } = await sb.from('materials').select('id').ilike('name', name).maybeSingle();
        if (e1) throw e1;

        let qty = Number(r.qty) || 0;
        let unitPrice = Number(r.unit_price) || (r.value && qty ? Number(r.value) / qty : 0);
        const balanceDate = r.balance_date || todayISO();

        if (!mat) {
          // مادة غير موجودة: أضفها ببطاقة جديدة، وصفّر رصيدها الافتتاحي عمداً بدل استيراد أرقام غير موثوقة
          const storeNum = 'AUTO-' + Date.now().toString().slice(-6) + '-' + seq;
          const { data: newMat, error: e0 } = await sb.from('materials').insert({ store_num: storeNum, name, unit: r.unit || 'قطعة', category: null, min_qty: 0, is_active: true }).select('id').single();
          if (e0) throw e0;
          mat = newMat;
          qty = 0; unitPrice = 0; autoCreated++;
        }

        const { error: e2 } = await sb.from('material_stock')
          .upsert({ material_id: mat.id, warehouse_id: warehouseId, qty_on_hand: qty, avg_price: unitPrice }, { onConflict: 'material_id,warehouse_id' });
        if (e2) throw e2;

        const { error: e3 } = await sb.from('opening_balances').insert({
          fiscal_year_id: fiscalYearId, seq: seq++, material_id: mat.id, warehouse_id: warehouseId,
          qty, unit_price: unitPrice, balance_date: balanceDate, created_by: session?.user?.id,
        });
        if (e3) throw e3;
        ok++;
      } catch (e) { fail++; errors.push(`${r.name || '؟'}: ${e.message}`); }
    }
    await this.log('import_opening_balances', 'opening_balances', null, { warehouse_id: warehouseId, fiscal_year_id: fiscalYearId, ok, fail, autoCreated });
    return { ok, fail, errors, autoCreated };
  },

  // ── وثائق الاستلام ─────────────────────────────
  async createReceipt(doc, items) {
    const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
    const { data: rdoc, error: e1 } = await sb.from('receipt_docs').insert({ ...doc, total }).select().single();
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
    if (e3) { await sb.from('issue_items').delete().eq('issue_doc_id', idoc.id); await sb.from('issue_docs').delete().eq('id', idoc.id); throw e3; }
    // سعر الإصدار (متوسط مرجّح) يُملأ بالتريغر أثناء الترحيل أعلاه — نجلبه الآن ونحسب الإجمالي الفعلي ونخزّنه
    const { data: savedItems, error: e4 } = await sb.from('issue_items').select('qty, unit_price').eq('issue_doc_id', idoc.id);
    if (!e4 && savedItems) {
      const total = savedItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);
      await sb.from('issue_docs').update({ total }).eq('id', idoc.id);
      idoc.total = total;
    }
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

  // ══════════════════════════════════════════════════════════════════
  //  تعريف المناطق والشوارع + بطاقة صنف رئيسي + بطاقة تشابه مواد — المرحلة ٣
  // ══════════════════════════════════════════════════════════════════
  // ── المناطق والشوارع ─────────────────────────────
  async listRegions() {
    const { data, error } = await sb.from('regions').select('*, streets(*)').eq('is_active', true).order('name');
    if (error) throw error; return data;
  },
  async createRegion(name) {
    const { data, error } = await sb.from('regions').insert({ name }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_region', 'regions', data.id, { name });
    return data;
  },
  async deleteRegion(id, name) {
    const { error } = await sb.from('regions').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_region', 'regions', id, { name });
  },
  async createStreet(regionId, name) {
    const { data, error } = await sb.from('streets').insert({ region_id: regionId, name }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_street', 'streets', data.id, { name });
    return data;
  },
  async deleteStreet(id, name) {
    const { error } = await sb.from('streets').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_street', 'streets', id, { name });
  },

  // ── بطاقة صنف رئيسي (تصنيف المواد) ─────────────────────────────
  async listMaterialCategories(activeOnly = true) {
    let q = sb.from('material_categories').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createMaterialCategory(c) {
    const { data, error } = await sb.from('material_categories').insert(c).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_material_category', 'material_categories', data.id, c);
    return data;
  },
  async updateMaterialCategory(id, patch) {
    const { error } = await sb.from('material_categories').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_material_category', 'material_categories', id, patch);
  },
  async deactivateMaterialCategory(id) {
    const { error } = await sb.from('material_categories').update({ is_active: false }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('deactivate_material_category', 'material_categories', id, {});
  },

  // ── بطاقة تشابه المواد (مجموعات بدائل/متكافئة) ─────────────────────────────
  async listSimilarityGroups() {
    const { data, error } = await sb.from('material_similarity_groups')
      .select('*, material_similarity_items(id, materials(id,store_num,name,unit))').order('created_at', { ascending: false });
    if (error) throw error; return data;
  },
  async createSimilarityGroup(name, notes) {
    const { data, error } = await sb.from('material_similarity_groups').insert({ name, notes }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_similarity_group', 'material_similarity_groups', data.id, { name });
    return data;
  },
  async deleteSimilarityGroup(id, name) {
    const { error } = await sb.from('material_similarity_groups').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_similarity_group', 'material_similarity_groups', id, { name });
  },
  async addMaterialToGroup(groupId, materialId) {
    const { error } = await sb.from('material_similarity_items').insert({ group_id: groupId, material_id: materialId });
    if (error) throw friendlyDbError(error);
  },
  async removeMaterialFromGroup(itemId) {
    const { error } = await sb.from('material_similarity_items').delete().eq('id', itemId);
    if (error) throw friendlyDbError(error);
  },

  // ── توليد بطاقات مواد بشكل جماعي (يُبنى فوق دليل المواد الموجود؛ بلا جدول جديد) ─────────────────────────────
  // rows: [{ store_num, name, unit, category, min_qty }] — يستخدم نفس upsertMaterial لكل سطر
  async bulkCreateMaterials(rows) {
    let ok = 0, fail = 0; const errors = [];
    for (const r of rows) {
      try { await this.upsertMaterial(r); ok++; }
      catch (e) { fail++; errors.push(`${r.store_num || r.name}: ${e.message}`); }
    }
    await this.log('bulk_create_materials', 'materials', null, { ok, fail, total: rows.length });
    return { ok, fail, errors };
  },

  // ══════════════════════════════════════════════════════════════════
  //  المرحلة ٤: تقارير مستودعية ومحاسبية موسّعة — تُبنى فوق البيانات الموجودة
  // ══════════════════════════════════════════════════════════════════

  // ── كشف حركة مادة: كل حركات مادة معيّنة بمخزن معيّن (استلام/إصدار/تحويل) مرتّبة زمنياً برصيد متحرك ─────────────────────────────
  async materialMovement(materialId, warehouseId, dateFrom, dateTo) {
    const [rec, iss, trfOut, trfIn] = await Promise.all([
      sb.from('receipt_items').select('qty, unit_price, receipt_docs!inner(doc_num, doc_date, warehouse_id)')
        .eq('material_id', materialId).eq('receipt_docs.warehouse_id', warehouseId).eq('receipt_docs.is_cancelled', false)
        .gte('receipt_docs.doc_date', dateFrom).lte('receipt_docs.doc_date', dateTo),
      sb.from('issue_items').select('qty, unit_price, issue_docs!inner(doc_num, doc_date, warehouse_id)')
        .eq('material_id', materialId).eq('issue_docs.warehouse_id', warehouseId).eq('issue_docs.is_cancelled', false)
        .gte('issue_docs.doc_date', dateFrom).lte('issue_docs.doc_date', dateTo),
      sb.from('stock_transfer_items').select('qty, stock_transfers!inner(doc_num, doc_date, from_warehouse_id, is_cancelled)')
        .eq('material_id', materialId).eq('stock_transfers.from_warehouse_id', warehouseId).eq('stock_transfers.is_cancelled', false)
        .gte('stock_transfers.doc_date', dateFrom).lte('stock_transfers.doc_date', dateTo),
      sb.from('stock_transfer_items').select('qty, stock_transfers!inner(doc_num, doc_date, to_warehouse_id, is_cancelled)')
        .eq('material_id', materialId).eq('stock_transfers.to_warehouse_id', warehouseId).eq('stock_transfers.is_cancelled', false)
        .gte('stock_transfers.doc_date', dateFrom).lte('stock_transfers.doc_date', dateTo),
    ]);
    if (rec.error) throw rec.error; if (iss.error) throw iss.error; if (trfOut.error) throw trfOut.error; if (trfIn.error) throw trfIn.error;
    const rows = [
      ...(rec.data || []).map(r => ({ date: r.receipt_docs.doc_date, doc_num: r.receipt_docs.doc_num, type: 'استلام', qtyIn: Number(r.qty), qtyOut: 0, unit_price: Number(r.unit_price || 0) })),
      ...(iss.data || []).map(r => ({ date: r.issue_docs.doc_date, doc_num: r.issue_docs.doc_num, type: 'إصدار', qtyIn: 0, qtyOut: Number(r.qty), unit_price: Number(r.unit_price || 0) })),
      ...(trfIn.data || []).map(r => ({ date: r.stock_transfers.doc_date, doc_num: r.stock_transfers.doc_num, type: 'تحويل وارد', qtyIn: Number(r.qty), qtyOut: 0, unit_price: 0 })),
      ...(trfOut.data || []).map(r => ({ date: r.stock_transfers.doc_date, doc_num: r.stock_transfers.doc_num, type: 'تحويل صادر', qtyIn: 0, qtyOut: Number(r.qty), unit_price: 0 })),
    ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let bal = 0;
    return rows.map(r => { bal += r.qtyIn - r.qtyOut; return { ...r, balance: bal }; });
  },

  // ── ملخص الحركة المستودعية: إجمالي وارد/صادر لكل مادة بمخزن بفترة، مع الرصيد الحالي ─────────────────────────────
  async warehouseMovementSummary(warehouseId, dateFrom, dateTo) {
    const [rec, iss, stock] = await Promise.all([
      sb.from('receipt_items').select('qty, materials(id,store_num,name,unit), receipt_docs!inner(doc_date, warehouse_id, is_cancelled)')
        .eq('receipt_docs.warehouse_id', warehouseId).eq('receipt_docs.is_cancelled', false)
        .gte('receipt_docs.doc_date', dateFrom).lte('receipt_docs.doc_date', dateTo),
      sb.from('issue_items').select('qty, materials(id,store_num,name,unit), issue_docs!inner(doc_date, warehouse_id, is_cancelled)')
        .eq('issue_docs.warehouse_id', warehouseId).eq('issue_docs.is_cancelled', false)
        .gte('issue_docs.doc_date', dateFrom).lte('issue_docs.doc_date', dateTo),
      sb.from('material_stock').select('material_id, qty_on_hand').eq('warehouse_id', warehouseId),
    ]);
    if (rec.error) throw rec.error; if (iss.error) throw iss.error; if (stock.error) throw stock.error;
    const map = {};
    const bump = (m, field, qty) => {
      if (!m) return;
      map[m.id] = map[m.id] || { store_num: m.store_num, name: m.name, unit: m.unit, in: 0, out: 0, balance: 0 };
      map[m.id][field] += Number(qty);
    };
    (rec.data || []).forEach(r => bump(r.materials, 'in', r.qty));
    (iss.data || []).forEach(r => bump(r.materials, 'out', r.qty));
    (stock.data || []).forEach(s => { if (map[s.material_id]) map[s.material_id].balance = Number(s.qty_on_hand); });
    return Object.values(map).sort((a, b) => a.store_num.localeCompare(b.store_num));
  },

  // ── كشف يومية مستودع (عادي/موسّع): كل الوثائق المؤثرة بمخزن بفترة، مرتّبة زمنياً ─────────────────────────────
  async warehouseJournal(warehouseId, dateFrom, dateTo) {
    const [rec, iss, trfOut, trfIn] = await Promise.all([
      sb.from('receipt_docs').select('doc_num, doc_date, total, is_cancelled').eq('warehouse_id', warehouseId).eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
      sb.from('issue_docs').select('doc_num, doc_date, total, is_cancelled').eq('warehouse_id', warehouseId).eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
      sb.from('stock_transfers').select('doc_num, doc_date, is_cancelled, to:to_warehouse_id(name)').eq('from_warehouse_id', warehouseId).eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
      sb.from('stock_transfers').select('doc_num, doc_date, is_cancelled, from:from_warehouse_id(name)').eq('to_warehouse_id', warehouseId).eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
    ]);
    if (rec.error) throw rec.error; if (iss.error) throw iss.error; if (trfOut.error) throw trfOut.error; if (trfIn.error) throw trfIn.error;
    const rows = [
      ...(rec.data || []).map(d => ({ date: d.doc_date, doc_num: d.doc_num, type: 'استلام', detail: '—', amount: Number(d.total || 0) })),
      ...(iss.data || []).map(d => ({ date: d.doc_date, doc_num: d.doc_num, type: 'إصدار', detail: '—', amount: Number(d.total || 0) })),
      ...(trfOut.data || []).map(d => ({ date: d.doc_date, doc_num: d.doc_num, type: 'تحويل صادر', detail: 'إلى: ' + (d.to?.name || ''), amount: 0 })),
      ...(trfIn.data || []).map(d => ({ date: d.doc_date, doc_num: d.doc_num, type: 'تحويل وارد', detail: 'من: ' + (d.from?.name || ''), amount: 0 })),
    ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    return rows;
  },

  // ── كشف اجمالي لمستودع: مجاميع القيمة المالية بفترة + قيمة الرصيد الحالي ─────────────────────────────
  async warehouseTotals(warehouseId, dateFrom, dateTo) {
    const [rec, iss, stock] = await Promise.all([
      sb.from('receipt_docs').select('total').eq('warehouse_id', warehouseId).eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
      sb.from('issue_docs').select('total').eq('warehouse_id', warehouseId).eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
      sb.from('material_stock').select('qty_on_hand, avg_price').eq('warehouse_id', warehouseId),
    ]);
    if (rec.error) throw rec.error; if (iss.error) throw iss.error; if (stock.error) throw stock.error;
    const totalReceipts = (rec.data || []).reduce((s, r) => s + Number(r.total || 0), 0);
    const totalIssues = (iss.data || []).reduce((s, r) => s + Number(r.total || 0), 0);
    const stockValue = (stock.data || []).reduce((s, r) => s + Number(r.qty_on_hand || 0) * Number(r.avg_price || 0), 0);
    return { totalReceipts, totalIssues, net: totalReceipts - totalIssues, stockValue };
  },

  // ── تقارير المبيعات والمشتريات (تحليلي/تجميعي/احصائي) — استعلام واحد، عرض مختلف بالواجهة ─────────────────────────────
  async salesPurchasesData(dateFrom, dateTo) {
    const [purch, sales] = await Promise.all([
      sb.from('receipt_items').select('qty, unit_price, materials(store_num,name,unit), receipt_docs!inner(doc_date, is_cancelled, warehouses(name))')
        .eq('receipt_docs.is_cancelled', false).gte('receipt_docs.doc_date', dateFrom).lte('receipt_docs.doc_date', dateTo),
      sb.from('issue_items').select('qty, unit_price, materials(store_num,name,unit), issue_docs!inner(doc_date, is_cancelled, warehouses(name))')
        .eq('issue_docs.is_cancelled', false).gte('issue_docs.doc_date', dateFrom).lte('issue_docs.doc_date', dateTo),
    ]);
    if (purch.error) throw purch.error; if (sales.error) throw sales.error;
    const norm = (rows, docKey) => (rows || []).map(r => ({
      date: r[docKey].doc_date, warehouse: r[docKey].warehouses?.name || '', store_num: r.materials?.store_num || '',
      name: r.materials?.name || '', unit: r.materials?.unit || '', qty: Number(r.qty), value: Number(r.qty) * Number(r.unit_price || 0),
    }));
    return { purchases: norm(purch.data, 'receipt_docs'), sales: norm(sales.data, 'issue_docs') };
  },

  // ── كشف الفواتير المستحقة: أرصدة الزبائن المدينة حتى تاريخ اليوم ─────────────────────────────
  async dueCustomerBalances() {
    const customers = await this.listCustomers();
    const today = new Date().toISOString().split('T')[0];
    const out = [];
    for (const c of customers) {
      try {
        const st = await this.accountStatement(c.account_id, '1900-01-01', today);
        if (st.closing > 0) out.push({ customer: c.name, code: c.code, balance: st.closing });
      } catch (e) { /* تجاهل زبون بحساب معطوب */ }
    }
    return out.sort((a, b) => b.balance - a.balance);
  },

  // ── كشوفات تفصيلية: كل قيود اليومية بفترة (دفتر أستاذ عام موسّع) ─────────────────────────────
  async detailedLedgerAll(dateFrom, dateTo) {
    const { data, error } = await sb.from('journal_lines')
      .select('debit, credit, chart_of_accounts(code,name), journal_entries!inner(entry_no, entry_date, description)')
      .gte('journal_entries.entry_date', dateFrom).lte('journal_entries.entry_date', dateTo)
      .order('journal_entries(entry_date)', { ascending: true });
    if (error) throw error;
    return (data || []).map(l => ({ date: l.journal_entries.entry_date, entry_no: l.journal_entries.entry_no, description: l.journal_entries.description, code: l.chart_of_accounts?.code, name: l.chart_of_accounts?.name, debit: Number(l.debit || 0), credit: Number(l.credit || 0) }));
  },

  // ── كشوفات اجمالية: مجاميع مصنّفة حسب نوع الحساب (ميزان مراجعة مبسّط) ─────────────────────────────
  async accountTypeSummary() {
    const tb = await this.trialBalance();
    const byType = {};
    tb.forEach(r => {
      byType[r.type] = byType[r.type] || { type: r.type, debit: 0, credit: 0 };
      byType[r.type].debit += Number(r.total_debit || 0);
      byType[r.type].credit += Number(r.total_credit || 0);
    });
    return Object.values(byType);
  },

  // ── كشوفات الأصول والموازنة: يجمع الأصول الثابتة + الموازنة التقديرية بتقرير واحد ─────────────────────────────
  async assetsBudgetStatement() {
    const fy = await this.activeFiscalYear();
    const [assets, budget] = await Promise.all([this.listFixedAssets(true), fy ? this.listBudgets(fy.id) : []]);
    const totalAssetsCost = assets.reduce((s, a) => s + Number(a.cost || 0), 0);
    const totalBudget = (budget || []).reduce((s, b) => s + Number(b.budgeted_amount || 0), 0);
    return { fy, assets, budget: budget || [], totalAssetsCost, totalBudget };
  },

  // ── دليل مراكز الكلفة ─────────────────────────────
  async listCostCenters(activeOnly = true) {
    let q = sb.from('cost_centers').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createCostCenter(c) {
    const { data, error } = await sb.from('cost_centers').insert(c).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_cost_center', 'cost_centers', data.id, c);
    return data;
  },
  async updateCostCenter(id, patch) {
    const { error } = await sb.from('cost_centers').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_cost_center', 'cost_centers', id, patch);
  },
  async deactivateCostCenter(id) {
    const { error } = await sb.from('cost_centers').update({ is_active: false }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('deactivate_cost_center', 'cost_centers', id, {});
  },

  // ══════════════════════════════════════════════════════════════════
  //  المرحلة ٥: طلبيات البيع والشراء + ايصالات الشحن + يومية مبيعات
  // ══════════════════════════════════════════════════════════════════
  // ── طلبيات البيع والشراء ─────────────────────────────
  async listOrders(orderType, status = null, limit = 100) {
    let q = sb.from('sales_purchase_orders').select('*, customers(name), warehouses(name)')
      .eq('order_type', orderType).order('order_date', { ascending: false }).limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async orderItems(orderId) {
    const { data, error } = await sb.from('sales_purchase_order_items').select('*, materials(store_num,name,unit)').eq('order_id', orderId);
    if (error) throw error; return data;
  },
  async createOrder(header, items) {
    const session = await this.currentSession();
    const { data: ord, error: e1 } = await sb.from('sales_purchase_orders').insert({ ...header, created_by: session?.user?.id }).select().single();
    if (e1) throw friendlyDbError(e1);
    const { error: e2 } = await sb.from('sales_purchase_order_items').insert(items.map(it => ({ ...it, order_id: ord.id })));
    if (e2) { await sb.from('sales_purchase_orders').delete().eq('id', ord.id); throw friendlyDbError(e2); }
    await this.log('create_order', 'sales_purchase_orders', ord.id, { doc_num: header.doc_num, order_type: header.order_type, items: items.length });
    return ord;
  },
  async updateOrderStatus(id, status, fulfilledDocNum) {
    const patch = { status }; if (fulfilledDocNum) patch.fulfilled_doc_num = fulfilledDocNum;
    const { error } = await sb.from('sales_purchase_orders').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_order_status', 'sales_purchase_orders', id, patch);
  },
  async deleteOrder(id, docNum) {
    const { error } = await sb.from('sales_purchase_orders').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_order', 'sales_purchase_orders', id, { doc_num: docNum });
  },

  // ── ايصالات الشحن ─────────────────────────────
  async listShippingReceipts(limit = 100) {
    const { data, error } = await sb.from('shipping_receipts').select('*').order('ship_date', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async createShippingReceipt(r) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('shipping_receipts').insert({ ...r, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_shipping_receipt', 'shipping_receipts', data.id, { doc_num: r.doc_num });
    return data;
  },
  async updateShippingReceipt(id, patch) {
    const { error } = await sb.from('shipping_receipts').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_shipping_receipt', 'shipping_receipts', id, patch);
  },
  async deleteShippingReceipt(id, docNum) {
    const { error } = await sb.from('shipping_receipts').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_shipping_receipt', 'shipping_receipts', id, { doc_num: docNum });
  },

  // ── يومية مبيعات: كل فواتير الإصدار (عبر كل المخازن) بفترة، مرتّبة زمنياً ─────────────────────────────
  async salesJournal(dateFrom, dateTo) {
    const { data, error } = await sb.from('issue_docs').select('doc_num, doc_date, total, warehouses(name)')
      .eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo)
      .order('doc_date', { ascending: true });
    if (error) throw error;
    let running = 0;
    return (data || []).map(d => { running += Number(d.total || 0); return { date: d.doc_date, doc_num: d.doc_num, warehouse: d.warehouses?.name || '', total: Number(d.total || 0), running }; });
  },

  // ══════════════════════════════════════════════════════════════════
  //  المرحلة ٦: سندات الديون + تقاريرها
  // ══════════════════════════════════════════════════════════════════
  async listDebtNotes(noteType = null, status = null, limit = 200) {
    let q = sb.from('debt_notes').select('*, customers(name), debit:debit_account_id(code,name), credit:credit_account_id(code,name)')
      .order('due_date', { ascending: true }).limit(limit);
    if (noteType) q = q.eq('note_type', noteType);
    if (status) q = q.eq('status', status);
    const { data, error } = await q; if (error) throw error; return data;
  },
  // ينشئ سند الدين + يُرحِّل قيد إصداره فوراً (مدين/دائن حسب اختيار المستخدم)
  async createDebtNote(n) {
    const session = await this.currentSession();
    const je = await this.postManualEntry({
      entry_no: 'JE-DEBT-' + Date.now().toString().slice(-8), entry_date: n.issue_date, ref_type: 'debt_note',
      description: `سند دين ${n.doc_num} — ${n.note_type === 'receivable' ? 'دين لنا' : 'دين علينا'}`, created_by: session?.user?.id,
    }, [
      { account_id: n.debit_account_id, debit: n.amount, credit: 0 },
      { account_id: n.credit_account_id, debit: 0, credit: n.amount },
    ]);
    const { data, error } = await sb.from('debt_notes').insert({
      doc_num: n.doc_num, note_type: n.note_type, issue_date: n.issue_date, due_date: n.due_date || null, amount: n.amount,
      customer_id: n.customer_id || null, counterparty_name: n.counterparty_name || null,
      debit_account_id: n.debit_account_id, credit_account_id: n.credit_account_id,
      notes: n.notes || null, created_by: session?.user?.id, journal_entry_id: je.id,
    }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_debt_note', 'debt_notes', data.id, { doc_num: n.doc_num, amount: n.amount });
    return data;
  },
  // تحصيل/سداد السند: يُرحِّل قيد يقفل حساب السند مقابل حساب التحصيل/السداد الفعلي المختار
  async settleDebtNote(id, settlementAccountId, settledDate) {
    const note = (await sb.from('debt_notes').select('*').eq('id', id).single()).data;
    if (!note) throw new Error('سند الدين غير موجود');
    if (note.status !== 'open') throw new Error('السند ليس مفتوحاً');
    const session = await this.currentSession();
    const lines = note.note_type === 'receivable'
      ? [{ account_id: settlementAccountId, debit: note.amount, credit: 0 }, { account_id: note.debit_account_id, debit: 0, credit: note.amount }]
      : [{ account_id: note.credit_account_id, debit: note.amount, credit: 0 }, { account_id: settlementAccountId, debit: 0, credit: note.amount }];
    const je = await this.postManualEntry({
      entry_no: 'JE-DEBTSTL-' + Date.now().toString().slice(-8), entry_date: settledDate, ref_type: 'debt_note_settle',
      description: `تسوية سند دين ${note.doc_num}`, created_by: session?.user?.id,
    }, lines);
    const { error } = await sb.from('debt_notes').update({ status: 'settled', settled_date: settledDate, settlement_account_id: settlementAccountId, settlement_journal_entry_id: je.id }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('settle_debt_note', 'debt_notes', id, { doc_num: note.doc_num });
  },
  // إلغاء سند مفتوح لم يُسوَّ بعد: يُرحِّل قيداً عكسياً لإصداره الأصلي
  async cancelDebtNote(id) {
    const note = (await sb.from('debt_notes').select('*').eq('id', id).single()).data;
    if (!note) throw new Error('سند الدين غير موجود');
    if (note.status !== 'open') throw new Error('لا يمكن إلغاء سند مُسوًّى مسبقاً');
    const session = await this.currentSession();
    await this.postManualEntry({
      entry_no: 'JE-DEBTCXL-' + Date.now().toString().slice(-8), entry_date: todayISO(), ref_type: 'debt_note_cancel',
      description: `إلغاء سند دين ${note.doc_num}`, created_by: session?.user?.id,
    }, [
      { account_id: note.credit_account_id, debit: note.amount, credit: 0 },
      { account_id: note.debit_account_id, debit: 0, credit: note.amount },
    ]);
    const { error } = await sb.from('debt_notes').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('cancel_debt_note', 'debt_notes', id, { doc_num: note.doc_num });
  },
  // ── تقارير سندات الديون: تجميع حسب النوع + تقادم (كم متأخر عن الاستحقاق) ─────────────────────────────
  async debtNoteReport() {
    const notes = await this.listDebtNotes(null, 'open');
    const today = todayISO();
    const withAging = notes.map(n => ({ ...n, overdueDays: n.due_date ? Math.max(0, Math.floor((new Date(today) - new Date(n.due_date)) / 86400000)) : 0 }));
    const totalReceivable = withAging.filter(n => n.note_type === 'receivable').reduce((s, n) => s + Number(n.amount), 0);
    const totalPayable = withAging.filter(n => n.note_type === 'payable').reduce((s, n) => s + Number(n.amount), 0);
    return { notes: withAging, totalReceivable, totalPayable };
  },
  // حذف نهائي لسند دين (أي حالة) — مدير النظام فقط. يحذف قيوده المحاسبية المرتبطة (الإصدار والتسوية إن وُجدت) بنفس آلية حذف قيود صندوق المركز الآمنة
  async hardDeleteDebtNote(id, docNum, journalEntryId, settlementJournalEntryId) {
    if (settlementJournalEntryId) { const { error } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: settlementJournalEntryId }); if (error) throw friendlyDbError(error); }
    if (journalEntryId) { const { error } = await sb.rpc('fn_admin_delete_journal_entry', { p_entry_id: journalEntryId }); if (error) throw friendlyDbError(error); }
    const { error } = await sb.from('debt_notes').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('hard_delete_debt_note', 'debt_notes', id, { doc_num: docNum });
  },

  // ══════════════════════════════════════════════════════════════════
  //  المرحلة ٧: الملحقات (عقود/أرشيف/أعمال ومهام/تأجير) + التصنيع
  // ══════════════════════════════════════════════════════════════════
  // ── العقود ─────────────────────────────
  async listContracts() {
    const { data, error } = await sb.from('contracts').select('*, customers(name)').order('start_date', { ascending: false });
    if (error) throw error; return data;
  },
  async createContract(c) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('contracts').insert({ ...c, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_contract', 'contracts', data.id, { doc_num: c.doc_num });
    return data;
  },
  async updateContract(id, patch) {
    const { error } = await sb.from('contracts').update(patch).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_contract', 'contracts', id, patch);
  },
  async deleteContract(id, docNum) {
    const { error } = await sb.from('contracts').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_contract', 'contracts', id, { doc_num: docNum });
  },

  // ── الأرشيف ─────────────────────────────
  async listArchiveCards(term = '') {
    let q = sb.from('archive_cards').select('*').order('archive_date', { ascending: false });
    if (term) q = q.or(`title.ilike.%${term}%,category.ilike.%${term}%,tags.ilike.%${term}%,related_ref.ilike.%${term}%`);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createArchiveCard(a) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('archive_cards').insert({ ...a, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_archive_card', 'archive_cards', data.id, { doc_num: a.doc_num });
    return data;
  },
  async deleteArchiveCard(id, title) {
    const { error } = await sb.from('archive_cards').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_archive_card', 'archive_cards', id, { title });
  },

  // ── الأعمال والمهام ─────────────────────────────
  async listTasks(status = null) {
    let q = sb.from('tasks').select('*, profiles(full_name)').order('due_date', { ascending: true, nullsFirst: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createTask(t) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('tasks').insert({ ...t, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_task', 'tasks', data.id, { title: t.title });
    return data;
  },
  async updateTaskStatus(id, status) {
    const { error } = await sb.from('tasks').update({ status }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_task_status', 'tasks', id, { status });
  },
  async deleteTask(id, title) {
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_task', 'tasks', id, { title });
  },

  // ── التأجير ─────────────────────────────
  async listRentalItems() {
    const { data, error } = await sb.from('rental_items').select('*, customers(name)').order('start_date', { ascending: false });
    if (error) throw error; return data;
  },
  async createRentalItem(r) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('rental_items').insert({ ...r, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_rental_item', 'rental_items', data.id, { doc_num: r.doc_num });
    return data;
  },
  async updateRentalStatus(id, status) {
    const { error } = await sb.from('rental_items').update({ status }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('update_rental_status', 'rental_items', id, { status });
  },
  async deleteRentalItem(id, docNum) {
    const { error } = await sb.from('rental_items').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_rental_item', 'rental_items', id, { doc_num: docNum });
  },

  // ── التصنيع: نموذج تصنيع (BOM) ─────────────────────────────
  async listManufacturingModels() {
    const { data, error } = await sb.from('manufacturing_models')
      .select('*, materials(store_num,name,unit), manufacturing_model_components(id, qty_per_batch, materials(id,store_num,name,unit))')
      .eq('is_active', true).order('name');
    if (error) throw error; return data;
  },
  async createManufacturingModel(header, components) {
    const { data: model, error: e1 } = await sb.from('manufacturing_models').insert(header).select().single();
    if (e1) throw friendlyDbError(e1);
    const { error: e2 } = await sb.from('manufacturing_model_components').insert(components.map(c => ({ ...c, model_id: model.id })));
    if (e2) { await sb.from('manufacturing_models').delete().eq('id', model.id); throw friendlyDbError(e2); }
    await this.log('create_manufacturing_model', 'manufacturing_models', model.id, { code: header.code, components: components.length });
    return model;
  },
  async deactivateManufacturingModel(id) {
    const { error } = await sb.from('manufacturing_models').update({ is_active: false }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('deactivate_manufacturing_model', 'manufacturing_models', id, {});
  },

  // ── التصنيع: طلبية تصنيع ─────────────────────────────
  async listManufacturingOrders() {
    const { data, error } = await sb.from('manufacturing_orders')
      .select('*, manufacturing_models(name, materials(store_num,name,unit)), warehouses(name)')
      .order('order_date', { ascending: false });
    if (error) throw error; return data;
  },
  async createManufacturingOrder(o) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('manufacturing_orders').insert({ ...o, created_by: session?.user?.id }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('create_manufacturing_order', 'manufacturing_orders', data.id, { doc_num: o.doc_num });
    return data;
  },
  // تنفيذ طلبية التصنيع: يستهلك المكوّنات (وثيقة إصدار) وينتج المادة الجاهزة (وثيقة استلام)
  // بنفس الآلية الآمنة المستخدمة أصلاً بالفواتير (بلا لمس material_stock مباشرة) —
  // كلفة الإنتاج = التكلفة الفعلية للمكوّنات المستهلَكة (بمتوسط تكلفتها وقت الاستهلاك) ÷ الكمية المنتَجة.
  async completeManufacturingOrder(orderId) {
    const { data: order, error: e0 } = await sb.from('manufacturing_orders')
      .select('*, manufacturing_models(output_material_id, output_qty_per_batch, manufacturing_model_components(material_id, qty_per_batch))')
      .eq('id', orderId).single();
    if (e0) throw e0;
    if (order.status !== 'planned') throw new Error('الطلبية ليست بحالة "مخطَّطة"');
    const model = order.manufacturing_models;
    const outputQty = Number(model.output_qty_per_batch) * Number(order.batches);
    const session = await this.currentSession();

    // 1) استهلاك المكوّنات (وثيقة إصدار من نفس المخزن)
    const consumeItems = model.manufacturing_model_components.map(c => ({ material_id: c.material_id, qty: Number(c.qty_per_batch) * Number(order.batches) }));
    const issueDoc = await this.createIssue({
      doc_num: 'MFG-CONS-' + order.doc_num, doc_date: todayISO(), warehouse_id: order.warehouse_id,
      recipient_type: 'production', recipient_name: 'استهلاك تصنيع: ' + order.doc_num, recipient_person: '',
      notes: 'استهلاك مكوّنات طلبية تصنيع رقم ' + order.doc_num, created_by: session?.user?.id,
    }, consumeItems);

    // 2) حساب التكلفة الفعلية من أسعار الإصدار المُرحَّلة تلقائياً (متوسط التكلفة وقت الاستهلاك)
    const consumedItems = await this.issueItems(issueDoc.id);
    const totalCost = consumedItems.reduce((s, it) => s + Number(it.qty) * Number(it.unit_price || 0), 0);
    const unitCost = outputQty > 0 ? totalCost / outputQty : 0;

    // 3) إنتاج المادة الجاهزة (وثيقة استلام لنفس المخزن بكلفة الإنتاج الفعلية)
    const receiptDoc = await this.createReceipt({
      doc_num: 'MFG-PROD-' + order.doc_num, doc_date: todayISO(), warehouse_id: order.warehouse_id,
      supplier: '', purchase_ref: 'تصنيع: ' + order.doc_num, notes: 'إنتاج طلبية تصنيع رقم ' + order.doc_num, created_by: session?.user?.id,
    }, [{ material_id: model.output_material_id, qty: outputQty, unit_price: unitCost }]);

    const { error: e3 } = await sb.from('manufacturing_orders').update({
      status: 'completed', completed_date: todayISO(), consumption_issue_doc_id: issueDoc.id,
      production_receipt_doc_id: receiptDoc.id, actual_cost: totalCost,
    }).eq('id', orderId);
    if (e3) throw friendlyDbError(e3);
    await this.log('complete_manufacturing_order', 'manufacturing_orders', orderId, { totalCost, outputQty });
    return { totalCost, unitCost, outputQty };
  },
  async cancelManufacturingOrder(id) {
    const { error } = await sb.from('manufacturing_orders').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('cancel_manufacturing_order', 'manufacturing_orders', id, {});
  },

  // ══════════════════════════════════════════════════════════════════
  //  المرحلة ٨: البريد الداخلي + الباركود + أدوات صيانة/مزامنة/استيراد
  // ══════════════════════════════════════════════════════════════════
  // ── البريد الداخلي ─────────────────────────────
  async listInbox(limit = 100) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('internal_messages').select('*, sender:sender_id(full_name)')
      .or(`recipient_id.eq.${session.user.id},recipient_id.is.null`)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async listSentMail(limit = 100) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('internal_messages').select('*, recipient:recipient_id(full_name)')
      .eq('sender_id', session.user.id).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },
  async sendInternalMessage(recipientId, subject, body) {
    const session = await this.currentSession();
    const { data, error } = await sb.from('internal_messages').insert({ sender_id: session.user.id, recipient_id: recipientId || null, subject, body }).select().single();
    if (error) throw friendlyDbError(error);
    await this.log('send_internal_message', 'internal_messages', data.id, { subject });
    return data;
  },
  async markMessageRead(id) {
    const { error } = await sb.from('internal_messages').update({ is_read: true }).eq('id', id);
    if (error) throw error;
  },
  async deleteInternalMessage(id) {
    const { error } = await sb.from('internal_messages').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
  },
  async listAllUsers() {
    const { data, error } = await sb.from('profiles').select('id, full_name, role').eq('is_active', true).order('full_name');
    if (error) throw error; return data;
  },

  // ── الباركود ─────────────────────────────
  async setMaterialBarcode(materialId, barcode) {
    const { error } = await sb.from('materials').update({ barcode: barcode || null }).eq('id', materialId);
    if (error) throw friendlyDbError(error);
    await this.log('set_material_barcode', 'materials', materialId, { barcode });
  },
  async findMaterialByBarcode(barcode) {
    const { data, error } = await sb.from('materials').select('*').eq('barcode', barcode).maybeSingle();
    if (error) throw error; return data;
  },

  // ══════════════════════════════════════════════════════════════════
  //  اعدادات البرنامج الأساسية: بيانات الشركة + الثوابت العامة + الصلاحيات الأمنية
  // ══════════════════════════════════════════════════════════════════
  // ── إعدادات عامة دفعة واحدة (تُبنى فوق app_settings الموجود أصلاً) ─────────────────────────────
  async getAppSettingsBatch(keys) {
    const { data, error } = await sb.from('app_settings').select('key, value').in('key', keys);
    if (error) throw error;
    const map = {}; (data || []).forEach(r => { map[r.key] = r.value; }); return map;
  },
  async setAppSettingsBatch(obj) {
    const rows = Object.entries(obj).map(([key, value]) => ({ key, value: value === null || value === undefined ? '' : String(value) }));
    const { error } = await sb.from('app_settings').upsert(rows);
    if (error) throw friendlyDbError(error);
    await this.log('update_app_settings', 'app_settings', null, obj);
  },

  // ── الصلاحيات الأمنية: مصفوفة تجاوز (Override) فوق الأدوار الافتراضية المبرمجة بكل صفحة ─────────────────────────────
  async listPagePermissions() {
    const { data, error } = await sb.from('page_permissions').select('*');
    if (error) throw error; return data;
  },
  async setPagePermission(pageId, role, allowed) {
    const { error } = await sb.from('page_permissions').upsert({ page_id: pageId, role, allowed }, { onConflict: 'page_id,role' });
    if (error) throw friendlyDbError(error);
    await this.log('set_page_permission', 'page_permissions', null, { page_id: pageId, role, allowed });
  },
  async resetPagePermission(pageId, role) {
    const { error } = await sb.from('page_permissions').delete().eq('page_id', pageId).eq('role', role);
    if (error) throw friendlyDbError(error);
    await this.log('reset_page_permission', 'page_permissions', null, { page_id: pageId, role });
  },

  // ══════════════════════════════════════════════════════════════════
  //  البحث الشامل + مركز التنبيهات الموحَّد + سجل جلسات الدخول
  // ══════════════════════════════════════════════════════════════════
  async globalSearch(term) {
    if (!term || term.trim().length < 2) return {};
    const t = `%${term.trim()}%`;
    const [materials, customers, receipts, issues] = await Promise.all([
      sb.from('materials').select('id, store_num, name').or(`name.ilike.${t},store_num.ilike.${t}`).limit(5),
      sb.from('customers').select('id, code, name').or(`name.ilike.${t},code.ilike.${t}`).limit(5),
      sb.from('receipt_docs').select('id, doc_num, doc_date, total').ilike('doc_num', t).limit(5),
      sb.from('issue_docs').select('id, doc_num, doc_date, total').ilike('doc_num', t).limit(5),
    ]);
    return { materials: materials.data || [], customers: customers.data || [], receipts: receipts.data || [], issues: issues.data || [] };
  },

  // يجمع كل التنبيهات المتفرّقة (مخزون منخفض، موافقات معلّقة، سندات ديون متأخرة، مهام مستحقة) بمصدر واحد
  async unifiedNotifications() {
    const items = [];
    try {
      const low = await this.lowStock();
      if (low.length) items.push({ type: 'warning', label: `${low.length} مادة تحتاج إعادة طلب`, page: 'lowstock' });
    } catch (e) {}
    if (ME && can('admin', 'manager')) {
      try {
        const pu = await this.listPendingUsers();
        if (pu.length) items.push({ type: 'info', label: `${pu.length} مستخدم بانتظار الموافقة`, page: 'users' });
      } catch (e) {}
    }
    if (ME && can('admin')) {
      try {
        const pe = await this.listPendingEntries('pending');
        if (pe.length) items.push({ type: 'info', label: `${pe.length} قيد بانتظار الموافقة`, page: 'approvals' });
      } catch (e) {}
    }
    try {
      const { notes } = await this.debtNoteReport();
      const overdue = notes.filter(n => n.overdueDays > 0);
      if (overdue.length) items.push({ type: 'danger', label: `${overdue.length} سند دين متأخر عن الاستحقاق`, page: 'debtnotereports' });
    } catch (e) {}
    try {
      const { data: tasks } = await sb.from('tasks').select('id, due_date').neq('status', 'done').lte('due_date', todayISO());
      if (tasks && tasks.length) items.push({ type: 'warning', label: `${tasks.length} مهمة مستحقة أو متأخرة`, page: 'tasks' });
    } catch (e) {}
    return items;
  },

  // ── سجل جلسات الدخول: يُستنتَج من سجل المراجعة (audit_log) الموجود أصلاً — بلا جدول جديد ─────────────────────────────
  async loginSessionsLog(limit = 100) {
    const { data, error } = await sb.from('audit_log').select('*, profiles(full_name,role)')
      .in('action', ['login', 'logout']).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error; return data;
  },

  // ── ترقيم تلقائي حقيقي: يقترح الرقم التالي حسب البادئة المحفوظة بالإعدادات + عدد الوثائق الحالي (قابل للتعديل يدوياً) ─────────────────────────────
  async nextDocNumSuggestion(docType) {
    const key = docType === 'receive' ? 'invoice_num_prefix_receive' : 'invoice_num_prefix_issue';
    const table = docType === 'receive' ? 'receipt_docs' : 'issue_docs';
    const [prefixSetting, countRes] = await Promise.all([this.getSetting(key), sb.from(table).select('id', { count: 'exact', head: true })]);
    const prefix = prefixSetting || (docType === 'receive' ? 'REC-' : 'ISS-');
    const next = (countRes.count || 0) + 1;
    return prefix + String(next).padStart(6, '0');
  },

  // ══════════════════════════════════════════════════════════════════
  //  النسخ الاحتياطي والاستعادة
  //  نسخة احتياطية كاملة = قراءة فقط لكل الجداول (آمنة دائماً). الاستعادة
  //  تقتصر عمداً على الجداول المرجعية (Upsert) — استعادة الجداول المالية/
  //  الحركية (فواتير، قيود، أرصدة) عبر الواجهة خطر (تكرار ترحيل، تعارض
  //  تسلسلات، كسر قيود الربط) وتحتاج أداة قاعدة بيانات مباشرة (pg_dump/
  //  Point-in-time Recovery بلوحة Supabase) بإشراف مدير قاعدة بيانات.
  // ══════════════════════════════════════════════════════════════════
  BACKUP_ALL_TABLES: [
    'app_settings','archive_cards','audit_log','branches','budget_rollover_log','budgets','cash_reconciliations',
    'cash_transactions','chart_of_accounts','colors','contracts','cost_centers','count_items','customers','debt_notes',
    'depreciation_runs','discount_cards','employee_loans','employees','fiscal_years','fixed_assets',
    'indirect_expense_allocation_items','indirect_expense_allocations','internal_messages','invoice_template_items',
    'invoice_templates','issue_docs','issue_items','journal_entries','journal_lines','manufacturing_model_components',
    'manufacturing_models','manufacturing_orders','material_brands','material_categories','material_similarity_groups',
    'material_similarity_items','material_stock','materials','opening_balances','page_permissions','payroll_items',
    'payroll_runs','pending_journal_entries','petty_cash_advances','petty_cash_items','petty_cash_vouchers',
    'physical_counts','profit_partners','projects','receipt_docs','receipt_items','regions','rental_items',
    'sales_purchase_order_items','sales_purchase_orders','sales_reps','shipping_receipts','sizes',
    'stock_transfer_items','stock_transfers','streets','suppliers','tasks','warehouses',
  ],
  // الجداول المرجعية الآمنة للاستعادة (Upsert) من نسخة احتياطية — كل واحد بعمود مفتاحه الفريد للمطابقة
  RESTORABLE_REFERENCE_TABLES: {
    materials: 'store_num', warehouses: 'code', chart_of_accounts: 'code', customers: 'code',
    projects: 'code', branches: 'code', suppliers: 'id', material_categories: 'code',
    material_brands: 'id', colors: 'id', sizes: 'id', discount_cards: 'code', sales_reps: 'code',
  },
  async fullBackupExport(onProgress) {
    const bundle = { exported_at: new Date().toISOString(), app: window.APP_CONFIG?.APP_NAME || '', tables: {} };
    let done = 0;
    for (const t of this.BACKUP_ALL_TABLES) {
      const { data, error } = await sb.from(t).select('*');
      bundle.tables[t] = error ? { __error: error.message } : (data || []);
      done++; if (onProgress) onProgress(done, this.BACKUP_ALL_TABLES.length, t);
    }
    return bundle;
  },
  async restoreReferenceTable(tableName, rows) {
    const key = this.RESTORABLE_REFERENCE_TABLES[tableName];
    if (!key) throw new Error('هذا الجدول غير مسموح باستعادته من الواجهة');
    if (!rows || !rows.length) return { ok: 0, fail: 0 };
    const { error } = await sb.from(tableName).upsert(rows, { onConflict: key });
    if (error) throw friendlyDbError(error);
    await this.log('restore_reference_table', tableName, null, { rows: rows.length });
    return { ok: rows.length, fail: 0 };
  },

  // ══════════════════════════════════════════════════════════════════
  //  تقارير مستودعية إضافية + تصنيع موسّع
  // ══════════════════════════════════════════════════════════════════
  // ── كشف تفصيلي للمستودعات: كل المخازن جنباً لجنب (قيمة الرصيد + حركة الفترة) ─────────────────────────────
  async allWarehousesDetailed(dateFrom, dateTo) {
    const whs = await this.listWarehouses();
    const rows = [];
    for (const w of whs) {
      const t = await this.warehouseTotals(w.id, dateFrom, dateTo);
      rows.push({ warehouse: w.name, code: w.code, ...t });
    }
    return rows;
  },

  // ── متابعة المشتريات: فواتير الاستلام مجمّعة حسب المورّد (نصي، بلا ربط محاسبي) ─────────────────────────────
  async purchaseTracking(dateFrom, dateTo) {
    const { data, error } = await sb.from('receipt_docs').select('doc_num, doc_date, total, supplier, warehouses(name)')
      .eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo).order('doc_date', { ascending: false });
    if (error) throw error;
    const bySupplier = {};
    (data || []).forEach(d => {
      const key = d.supplier || 'غير محدَّد';
      bySupplier[key] = bySupplier[key] || { supplier: key, count: 0, total: 0 };
      bySupplier[key].count++; bySupplier[key].total += Number(d.total || 0);
    });
    return { rows: data || [], bySupplier: Object.values(bySupplier).sort((a,b) => b.total - a.total) };
  },

  // ── متابعة المبيعات اليومية: فواتير الإصدار مجمّعة حسب اليوم ─────────────────────────────
  async dailySalesTracking(dateFrom, dateTo) {
    const { data, error } = await sb.from('issue_docs').select('doc_date, total').eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo);
    if (error) throw error;
    const byDay = {};
    (data || []).forEach(d => { byDay[d.doc_date] = byDay[d.doc_date] || { date: d.doc_date, count: 0, total: 0 }; byDay[d.doc_date].count++; byDay[d.doc_date].total += Number(d.total || 0); });
    return Object.values(byDay).sort((a, b) => a.date < b.date ? -1 : 1);
  },

  // ── كشف تدفقات المخزون: إجمالي وارد/صادر عبر كل المخازن مجتمعة بفترة، مجمَّع يومياً ─────────────────────────────
  async stockFlowReport(dateFrom, dateTo) {
    const [rec, iss] = await Promise.all([
      sb.from('receipt_docs').select('doc_date, total').eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
      sb.from('issue_docs').select('doc_date, total').eq('is_cancelled', false).gte('doc_date', dateFrom).lte('doc_date', dateTo),
    ]);
    if (rec.error) throw rec.error; if (iss.error) throw iss.error;
    const byDay = {};
    (rec.data || []).forEach(d => { byDay[d.doc_date] = byDay[d.doc_date] || { date: d.doc_date, in: 0, out: 0 }; byDay[d.doc_date].in += Number(d.total || 0); });
    (iss.data || []).forEach(d => { byDay[d.doc_date] = byDay[d.doc_date] || { date: d.doc_date, in: 0, out: 0 }; byDay[d.doc_date].out += Number(d.total || 0); });
    let running = 0;
    return Object.values(byDay).sort((a,b) => a.date < b.date ? -1 : 1).map(r => { running += r.in - r.out; return { ...r, net: r.in - r.out, running }; });
  },

  // ── كشف ايصالات الشحن (تقرير) ─────────────────────────────
  async shippingReceiptsReport(dateFrom, dateTo) {
    const { data, error } = await sb.from('shipping_receipts').select('*').gte('ship_date', dateFrom).lte('ship_date', dateTo).order('ship_date', { ascending: false });
    if (error) throw error; return data;
  },

  // ── التصنيع: توزيع نفقات غير مباشرة على طلبيات مكتملة بفترة، حسب قيمة الإنتاج ─────────────────────────────
  async allocateIndirectExpense(expenseAccountId, dateFrom, dateTo, totalAmount, basis) {
    const { data: orders, error } = await sb.from('manufacturing_orders').select('id, doc_num, actual_cost').eq('status', 'completed').gte('completed_date', dateFrom).lte('completed_date', dateTo);
    if (error) throw error;
    if (!orders.length) throw new Error('لا توجد طلبيات تصنيع مكتملة بهذه الفترة لتوزيع النفقة عليها');
    const totalProdValue = orders.reduce((s, o) => s + Number(o.actual_cost || 0), 0);
    const items = orders.map(o => {
      const share = basis === 'equal' ? totalAmount / orders.length : (totalProdValue > 0 ? (Number(o.actual_cost || 0) / totalProdValue) * totalAmount : totalAmount / orders.length);
      return { manufacturing_order_id: o.id, allocated_amount: Math.round(share) };
    });
    const session = await this.currentSession();
    const { data: alloc, error: e1 } = await sb.from('indirect_expense_allocations').insert({ expense_account_id: expenseAccountId, period_from: dateFrom, period_to: dateTo, total_amount: totalAmount, basis, created_by: session?.user?.id }).select().single();
    if (e1) throw friendlyDbError(e1);
    const { error: e2 } = await sb.from('indirect_expense_allocation_items').insert(items.map(it => ({ ...it, allocation_id: alloc.id })));
    if (e2) throw friendlyDbError(e2);
    await this.log('allocate_indirect_expense', 'indirect_expense_allocations', alloc.id, { total: totalAmount, orders: orders.length });
    return { orders: orders.map((o, i) => ({ ...o, allocated: items[i].allocated_amount })), totalAmount };
  },
  async listIndirectExpenseAllocations() {
    const { data, error } = await sb.from('indirect_expense_allocations').select('*, chart_of_accounts(code,name), indirect_expense_allocation_items(allocated_amount, manufacturing_orders(doc_num))').order('created_at', { ascending: false });
    if (error) throw error; return data;
  },

  // ── التصنيع: كشف الاحتياجات (المكوّنات المطلوبة لطلبيات مخطَّطة مقابل الرصيد المتوفر) ─────────────────────────────
  async manufacturingRequirements() {
    const { data: orders, error } = await sb.from('manufacturing_orders').select('doc_num, batches, warehouse_id, warehouses(name), manufacturing_models(name, manufacturing_model_components(qty_per_batch, materials(id,store_num,name,unit)))').eq('status', 'planned');
    if (error) throw error;
    const rows = [];
    for (const o of orders) {
      for (const c of o.manufacturing_models.manufacturing_model_components) {
        const required = Number(c.qty_per_batch) * Number(o.batches);
        const { data: stock } = await sb.from('material_stock').select('qty_on_hand').eq('material_id', c.materials.id).eq('warehouse_id', o.warehouse_id).maybeSingle();
        const available = Number(stock?.qty_on_hand || 0);
        rows.push({ order: o.doc_num, warehouse: o.warehouses?.name, material: `${c.materials.store_num} — ${c.materials.name}`, unit: c.materials.unit, required, available, shortfall: Math.max(0, required - available) });
      }
    }
    return rows;
  },

  // ── التصنيع: كشف انحراف التكلفة (الفعلية مقابل المعيارية المشتقة من الـBOM بأسعار وسطية حالية) ─────────────────────────────
  async manufacturingVarianceReport() {
    const { data: orders, error } = await sb.from('manufacturing_orders').select('doc_num, batches, actual_cost, warehouse_id, completed_date, manufacturing_models(name, manufacturing_model_components(qty_per_batch, materials(id,store_num,name)))').eq('status', 'completed');
    if (error) throw error;
    const rows = [];
    for (const o of orders) {
      let standardCost = 0;
      for (const c of o.manufacturing_models.manufacturing_model_components) {
        const { data: stock } = await sb.from('material_stock').select('avg_price').eq('material_id', c.materials.id).eq('warehouse_id', o.warehouse_id).maybeSingle();
        standardCost += Number(c.qty_per_batch) * Number(o.batches) * Number(stock?.avg_price || 0);
      }
      rows.push({ order: o.doc_num, model: o.manufacturing_models.name, date: o.completed_date, standardCost, actualCost: Number(o.actual_cost || 0), variance: Number(o.actual_cost || 0) - standardCost });
    }
    return rows;
  },

  // ── التصنيع: جرد المواد والمكونات (كل مادة تدخل كمكوّن بأي BOM، مع رصيدها الحالي بكل مخزن) ─────────────────────────────
  async componentMaterialsInventory() {
    const { data: comps, error } = await sb.from('manufacturing_model_components').select('materials(id,store_num,name,unit)');
    if (error) throw error;
    const ids = [...new Map(comps.map(c => [c.materials.id, c.materials])).values()];
    const rows = [];
    for (const m of ids) {
      const { data: stock } = await sb.from('material_stock').select('qty_on_hand, warehouses(name)').eq('material_id', m.id);
      const total = (stock || []).reduce((s, r) => s + Number(r.qty_on_hand || 0), 0);
      rows.push({ store_num: m.store_num, name: m.name, unit: m.unit, total, byWarehouse: (stock || []).map(s => `${s.warehouses?.name}: ${s.qty_on_hand}`).join('، ') });
    }
    return rows;
  },
  async updateManufacturingOrderProcess(id, processNotes, laborCost) {
    const { error } = await sb.from('manufacturing_orders').update({ process_notes: processNotes, labor_cost: laborCost }).eq('id', id);
    if (error) throw friendlyDbError(error);
  },

  // ══════════════════════════════════════════════════════════════════
  //  بطاقة قالب افتراضي: قوالب فواتير جاهزة يُعاد استخدامها بضغطة زر
  // ══════════════════════════════════════════════════════════════════
  async listInvoiceTemplates(docType) {
    let q = sb.from('invoice_templates').select('*, warehouses(name), invoice_template_items(id, qty, unit_price, materials(id,store_num,name,unit))').order('created_at', { ascending: false });
    if (docType) q = q.eq('doc_type', docType);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createInvoiceTemplate(header, items) {
    const session = await this.currentSession();
    const { data: tpl, error: e1 } = await sb.from('invoice_templates').insert({ ...header, created_by: session?.user?.id }).select().single();
    if (e1) throw friendlyDbError(e1);
    const { error: e2 } = await sb.from('invoice_template_items').insert(items.map(it => ({ ...it, template_id: tpl.id })));
    if (e2) { await sb.from('invoice_templates').delete().eq('id', tpl.id); throw friendlyDbError(e2); }
    await this.log('create_invoice_template', 'invoice_templates', tpl.id, { name: header.name, items: items.length });
    return tpl;
  },
  async deleteInvoiceTemplate(id, name) {
    const { error } = await sb.from('invoice_templates').delete().eq('id', id);
    if (error) throw friendlyDbError(error);
    await this.log('delete_invoice_template', 'invoice_templates', id, { name });
  },

  // ══════════════════════════════════════════════════════════════════
  //  دفعة إضافية من اعدادات البرنامج: ألوان/قياسات، ماركات، خصومات، مندوبو مبيعات، شركاء أرباح، تدوير موازنة
  // ══════════════════════════════════════════════════════════════════
  // ── الألوان والقياسات ─────────────────────────────
  async listColors() { const { data, error } = await sb.from('colors').select('*').eq('is_active', true).order('name'); if (error) throw error; return data; },
  async createColor(c) { const { data, error } = await sb.from('colors').insert(c).select().single(); if (error) throw friendlyDbError(error); return data; },
  async deactivateColor(id) { const { error } = await sb.from('colors').update({ is_active: false }).eq('id', id); if (error) throw friendlyDbError(error); },
  async listSizes() { const { data, error } = await sb.from('sizes').select('*').eq('is_active', true).order('sort_order'); if (error) throw error; return data; },
  async createSize(s) { const { data, error } = await sb.from('sizes').insert(s).select().single(); if (error) throw friendlyDbError(error); return data; },
  async deactivateSize(id) { const { error } = await sb.from('sizes').update({ is_active: false }).eq('id', id); if (error) throw friendlyDbError(error); },

  // ── ماركات المواد ─────────────────────────────
  async listBrands() { const { data, error } = await sb.from('material_brands').select('*').eq('is_active', true).order('name'); if (error) throw error; return data; },
  async createBrand(b) { const { data, error } = await sb.from('material_brands').insert(b).select().single(); if (error) throw friendlyDbError(error); return data; },
  async deactivateBrand(id) { const { error } = await sb.from('material_brands').update({ is_active: false }).eq('id', id); if (error) throw friendlyDbError(error); },

  // ── بطاقات الخصم ─────────────────────────────
  async listDiscountCards() { const { data, error } = await sb.from('discount_cards').select('*').order('created_at', { ascending: false }); if (error) throw error; return data; },
  async createDiscountCard(d) { const { data, error } = await sb.from('discount_cards').insert(d).select().single(); if (error) throw friendlyDbError(error); return data; },
  async deactivateDiscountCard(id) { const { error } = await sb.from('discount_cards').update({ is_active: false }).eq('id', id); if (error) throw friendlyDbError(error); },

  // ── مندوبو المبيعات ─────────────────────────────
  async listSalesReps(activeOnly = true) {
    let q = sb.from('sales_reps').select('*').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q; if (error) throw error; return data;
  },
  async createSalesRep(r) { const { data, error } = await sb.from('sales_reps').insert(r).select().single(); if (error) throw friendlyDbError(error); return data; },
  async updateSalesRep(id, patch) { const { error } = await sb.from('sales_reps').update(patch).eq('id', id); if (error) throw friendlyDbError(error); },
  async deactivateSalesRep(id) { const { error } = await sb.from('sales_reps').update({ is_active: false }).eq('id', id); if (error) throw friendlyDbError(error); },
  // تقرير عمولات المندوبين: مجموع فواتير الإصدار المرتبطة بكل مندوب × نسبة عمولته، بفترة معيّنة
  async repCommissionReport(dateFrom, dateTo) {
    const { data, error } = await sb.from('issue_docs').select('total, sales_rep_id, sales_reps(name, commission_percent)')
      .eq('is_cancelled', false).not('sales_rep_id', 'is', null).gte('doc_date', dateFrom).lte('doc_date', dateTo);
    if (error) throw error;
    const map = {};
    (data || []).forEach(d => {
      const id = d.sales_rep_id;
      map[id] = map[id] || { name: d.sales_reps?.name || '', commission_percent: Number(d.sales_reps?.commission_percent || 0), totalSales: 0 };
      map[id].totalSales += Number(d.total || 0);
    });
    return Object.values(map).map(r => ({ ...r, commissionAmount: r.totalSales * r.commission_percent / 100 }));
  },

  // ── شركاء الأرباح (توزيع الأرباح) ─────────────────────────────
  async listProfitPartners() { const { data, error } = await sb.from('profit_partners').select('*').eq('is_active', true).order('name'); if (error) throw error; return data; },
  async createProfitPartner(p) { const { data, error } = await sb.from('profit_partners').insert(p).select().single(); if (error) throw friendlyDbError(error); return data; },
  async deactivateProfitPartner(id) { const { error } = await sb.from('profit_partners').update({ is_active: false }).eq('id', id); if (error) throw friendlyDbError(error); },

  // ── تدوير الميزانية ─────────────────────────────
  // ينسخ كل بنود موازنة سنة مالية مصدر إلى سنة مالية هدف، بزيادة نسبة مئوية اختيارية
  async rolloverBudget(fromFyId, toFyId, increasePercent) {
    const sourceBudgets = await this.listBudgets(fromFyId);
    if (!sourceBudgets.length) throw new Error('لا توجد بنود موازنة بالسنة المالية المصدر');
    const factor = 1 + (Number(increasePercent) || 0) / 100;
    const rows = sourceBudgets.map(b => ({ fiscal_year_id: toFyId, account_id: b.account_id, budgeted_amount: Math.round(Number(b.budgeted_amount) * factor), notes: b.notes }));
    const { error } = await sb.from('budgets').insert(rows);
    if (error) throw friendlyDbError(error);
    const session = await this.currentSession();
    await sb.from('budget_rollover_log').insert({ from_fiscal_year_id: fromFyId, to_fiscal_year_id: toFyId, increase_percent: increasePercent || 0, rows_created: rows.length, created_by: session?.user?.id });
    await this.log('rollover_budget', 'budgets', null, { from: fromFyId, to: toFyId, rows: rows.length });
    return rows.length;
  },

  // ── صيانة الملفات: لوحة فحص سريعة لصحة البيانات التشغيلية ─────────────────────────────
  async systemMaintenanceSummary() {
    const [low, pendingUsers, pendingEntries, materialsNoBarcode, archiveNoUrl] = await Promise.all([
      this.lowStock(), this.listPendingUsers(), this.listPendingEntries('pending'),
      sb.from('materials').select('id', { count: 'exact', head: true }).or('barcode.is.null,barcode.eq.'),
      sb.from('archive_cards').select('id', { count: 'exact', head: true }).is('file_url', null),
    ]);
    return {
      lowStockCount: low.length, pendingUsersCount: pendingUsers.length, pendingEntriesCount: pendingEntries.length,
      materialsNoBarcodeCount: materialsNoBarcode.count || 0, archiveNoUrlCount: archiveNoUrl.count || 0,
    };
  },

  // ── خدمات المزامنة: تصدير نسخة كاملة من الجداول المرجعية الأساسية بصيغة JSON ─────────────────────────────
  async exportSyncBundle() {
    const [customers, materials, coa, warehouses, projects, branches] = await Promise.all([
      this.listCustomers('', false), this.listMaterials('', null), this.chartOfAccounts(), this.listWarehouses(), this.listProjects(false), this.listBranches(false),
    ]);
    return { exported_at: new Date().toISOString(), customers, materials, chart_of_accounts: coa, warehouses, projects, branches };
  },

  // ── الاستيراد من اكسل: يعيد استخدام bulkCreateMaterials؛ الصفوف تُحضَّر بالواجهة من ملف XLSX ─────────────────────────────
  async importMaterialsFromRows(rows) { return this.bulkCreateMaterials(rows); },
};

window.DB = DB;
window.sb = sb;
