// ══════════════════════════════════════════════════════════════════
//  المرحلة ٧ (١): الملحقات — العقود + الأرشيف + الأعمال والمهام + التأجير
//  أنظمة عامة (نظام محاسبي عام حسب توضيحك) — بطاقات وقوائم بسيطة وعملية
// ══════════════════════════════════════════════════════════════════

// ── العقود ─────────────────────────────
PAGE_RENDER.contracts = async (root) => {
  const list = await DB.listContracts();
  const typeLabel = { rental: 'إيجار', supply: 'توريد', service: 'خدمة', other: 'أخرى' };
  const statusChip = (s) => s === 'active' ? '<span class="chip chip-ok">ساري</span>' : s === 'expired' ? '<span class="chip chip-gold">منتهي</span>' : '<span class="chip chip-danger">مفسوخ</span>';
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">📜 العقود</div><div class="ph-sub">عقود إيجار/توريد/خدمة — بطاقة متابعة بلا ترحيل محاسبي تلقائي</div></div>
      <div class="ph-actions">${can('admin','accountant','manager') ? `<button class="btn btn-p btn-sm" onclick="openContractModal()">+ عقد جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرقم</th><th>النوع</th><th>الطرف</th><th>من</th><th>إلى</th><th>القيمة</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(c => `<tr><td class="doc-num">${c.doc_num}</td><td>${typeLabel[c.contract_type]}</td><td>${c.customers?.name || c.party_name || '—'}</td>
      <td class="mono">${c.start_date}</td><td class="mono">${c.end_date||'—'}</td><td class="mono gold-txt">${c.value?fmtIQD(c.value):'—'}</td><td>${statusChip(c.status)}</td>
      <td>${can('admin','accountant','manager') ? `
        <select onchange="updateContractStatus('${c.id}', this.value)" style="width:auto;font-size:11px;padding:4px 8px">
          <option value="active" ${c.status==='active'?'selected':''}>ساري</option>
          <option value="expired" ${c.status==='expired'?'selected':''}>منتهي</option>
          <option value="terminated" ${c.status==='terminated'?'selected':''}>مفسوخ</option>
        </select>` : ''}
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteContractConfirm('${c.id}','${c.doc_num}')">حذف</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="8" class="ec">لا توجد عقود بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openContractModal = async () => {
  const customers = await DB.listCustomers();
  showModal('عقد جديد', `
    <div class="fg2">
      <div class="fgroup"><label>رقم العقد</label><input id="m-ct-num" value="CT-${Date.now().toString().slice(-8)}"></div>
      <div class="fgroup"><label>النوع</label><select id="m-ct-type"><option value="rental">إيجار</option><option value="supply">توريد</option><option value="service">خدمة</option><option value="other">أخرى</option></select></div>
    </div>
    <div class="fgroup"><label>الزبون (اختياري)</label><select id="m-ct-customer"><option value="">— بدون —</option>${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
    <div class="fgroup"><label>أو اسم طرف آخر</label><input id="m-ct-party"></div>
    <div class="fg2">
      <div class="fgroup"><label>تاريخ البدء</label><input id="m-ct-start" type="date" value="${todayISO()}"></div>
      <div class="fgroup"><label>تاريخ الانتهاء</label><input id="m-ct-end" type="date"></div>
    </div>
    <div class="fg2">
      <div class="fgroup"><label>القيمة (اختياري)</label><input id="m-ct-value" type="number" step="1"></div>
      <div class="fgroup"><label>تذكير التجديد (اختياري)</label><input id="m-ct-remind" type="date"></div>
    </div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-ct-notes"></div>
  `, async () => {
    const doc_num = gv('m-ct-num'), start_date = gv('m-ct-start');
    if (!doc_num || !start_date) { toast('رقم العقد وتاريخ البدء مطلوبان', 'e'); return false; }
    try {
      await DB.createContract({
        doc_num, contract_type: document.getElementById('m-ct-type').value, customer_id: gv('m-ct-customer') || null,
        party_name: gv('m-ct-party') || null, start_date, end_date: gv('m-ct-end') || null,
        value: gv('m-ct-value') ? Number(gv('m-ct-value')) : null, renewal_reminder_date: gv('m-ct-remind') || null, notes: gv('m-ct-notes'),
      });
      toast('تم الحفظ', 's'); go('contracts');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.updateContractStatus = async (id, status) => {
  try { await DB.updateContract(id, { status }); toast('تم التحديث', 's'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
window.deleteContractConfirm = async (id, docNum) => {
  if (!confirm(`حذف العقد "${docNum}"؟`)) return;
  try { await DB.deleteContract(id, docNum); toast('تم الحذف', 's'); go('contracts'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── الأرشيف ─────────────────────────────
PAGE_RENDER.archive = async (root) => {
  const list = await DB.listArchiveCards();
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🗄 الأرشيف</div><div class="ph-sub">فهرسة مستندات/ملفات — رابط خارجي للملف نفسه (لا يوجد تخزين ملفات مدمج بهذه المرحلة)</div></div>
      <div class="ph-actions"><input id="arc-search" placeholder="بحث..." style="max-width:220px" oninput="searchArchive(this.value)">
      ${can('admin','accountant','manager') ? `<button class="btn btn-p btn-sm" onclick="openArchiveModal()">+ بطاقة أرشيف</button>` : ''}</div></div>
    <div class="card" id="arc-list"><div class="itw"><table><thead><tr><th>الرقم</th><th>العنوان</th><th>التصنيف</th><th>التاريخ</th><th>مرجع</th><th></th></tr></thead>
    <tbody>${list.map(a => `<tr><td class="doc-num">${a.doc_num}</td><td>${a.file_url?`<a href="${a.file_url}" target="_blank">${a.title}</a>`:a.title}</td>
      <td>${a.category||'—'}</td><td class="mono">${a.archive_date}</td><td class="mono">${a.related_ref||'—'}</td>
      <td><button class="btn btn-o btn-sm" onclick='printArchiveCard(${JSON.stringify(a).replace(/'/g,"&#39;")})'>🖨 طباعة</button>
      ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteArchiveConfirm('${a.id}','${a.title.replace(/'/g,"")}')">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد بطاقات أرشيف بعد</td></tr>'}
    </tbody></table></div></div>
    <div id="archive-print-area"></div>`;
};
window.printArchiveCard = async (a) => {
  const html = `<div style="padding:20px 4px;font-size:13px;line-height:2">
      <div>العنوان: <b>${a.title}</b></div>
      <div>التصنيف: ${a.category||'—'}</div>
      <div>التاريخ: ${a.archive_date}</div>
      <div>المرجع المرتبط: ${a.related_ref||'—'}</div>
      <div>الوسوم: ${a.tags||'—'}</div>
      ${a.notes ? `<div>ملاحظات: ${a.notes}</div>` : ''}
    </div>`;
  await renderPrintArea(`بطاقة أرشيف — ${a.doc_num}`, html);
  window.print();
};
window.searchArchive = async (term) => {
  const list = await DB.listArchiveCards(term);
  document.getElementById('arc-list').innerHTML = `<div class="itw"><table><thead><tr><th>الرقم</th><th>العنوان</th><th>التصنيف</th><th>التاريخ</th><th>مرجع</th><th></th></tr></thead>
    <tbody>${list.map(a => `<tr><td class="doc-num">${a.doc_num}</td><td>${a.file_url?`<a href="${a.file_url}" target="_blank">${a.title}</a>`:a.title}</td>
      <td>${a.category||'—'}</td><td class="mono">${a.archive_date}</td><td class="mono">${a.related_ref||'—'}</td>
      <td>${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteArchiveConfirm('${a.id}','${a.title.replace(/'/g,"")}')">حذف</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا نتائج</td></tr>'}</tbody></table></div>`;
};
window.openArchiveModal = () => {
  showModal('بطاقة أرشيف جديدة', `
    <div class="fg2">
      <div class="fgroup"><label>الرقم</label><input id="m-ar-num" value="ARC-${Date.now().toString().slice(-8)}"></div>
      <div class="fgroup"><label>التاريخ</label><input id="m-ar-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="fgroup"><label>العنوان</label><input id="m-ar-title"></div>
    <div class="fg2">
      <div class="fgroup"><label>التصنيف</label><input id="m-ar-cat"></div>
      <div class="fgroup"><label>مرجع مرتبط (رقم فاتورة/عقد/آخر)</label><input id="m-ar-ref"></div>
    </div>
    <div class="fgroup"><label>رابط الملف (اختياري)</label><input id="m-ar-url" placeholder="https://..."></div>
    <div class="fgroup"><label>وسوم (اختياري)</label><input id="m-ar-tags"></div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-ar-notes"></div>
  `, async () => {
    const title = gv('m-ar-title');
    if (!title) { toast('العنوان مطلوب', 'e'); return false; }
    try {
      await DB.createArchiveCard({ doc_num: gv('m-ar-num'), title, category: gv('m-ar-cat'), related_ref: gv('m-ar-ref'), file_url: gv('m-ar-url') || null, tags: gv('m-ar-tags'), archive_date: gv('m-ar-date'), notes: gv('m-ar-notes') });
      toast('تم الحفظ', 's'); go('archive');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.deleteArchiveConfirm = async (id, title) => {
  if (!confirm(`حذف بطاقة الأرشيف "${title}"؟`)) return;
  try { await DB.deleteArchiveCard(id, title); toast('تم الحذف', 's'); go('archive'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── الأعمال والمهام ─────────────────────────────
PAGE_RENDER.tasks = async (root) => {
  const list = await DB.listTasks();
  const prLabel = { low: 'منخفضة', normal: 'عادية', high: 'عالية' };
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">✅ الأعمال والمهام</div><div class="ph-sub">متابعة مهام داخلية للفريق</div></div>
      <div class="ph-actions"><button class="btn btn-p btn-sm" onclick="openTaskModal()">+ مهمة جديدة</button></div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>المهمة</th><th>المسؤول</th><th>الاستحقاق</th><th>الأولوية</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(t => `<tr><td>${t.title}</td><td>${t.profiles?.full_name||'—'}</td><td class="mono">${t.due_date||'—'}</td>
      <td><span class="chip ${t.priority==='high'?'chip-danger':t.priority==='low'?'':'chip-gold'}">${prLabel[t.priority]}</span></td>
      <td><select onchange="updateTaskStatus('${t.id}', this.value)" style="width:auto;font-size:11px;padding:4px 8px">
        <option value="todo" ${t.status==='todo'?'selected':''}>لم تبدأ</option>
        <option value="in_progress" ${t.status==='in_progress'?'selected':''}>قيد التنفيذ</option>
        <option value="done" ${t.status==='done'?'selected':''}>مكتملة</option>
      </select></td>
      <td><button class="btn btn-d btn-sm" onclick="deleteTaskConfirm('${t.id}','${t.title.replace(/'/g,"")}')">حذف</button></td></tr>`).join('') || '<tr><td colspan="6" class="ec">لا توجد مهام بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openTaskModal = () => {
  showModal('مهمة جديدة', `
    <div class="fgroup"><label>عنوان المهمة</label><input id="m-tk-title"></div>
    <div class="fg2">
      <div class="fgroup"><label>تاريخ الاستحقاق</label><input id="m-tk-due" type="date"></div>
      <div class="fgroup"><label>الأولوية</label><select id="m-tk-priority"><option value="normal">عادية</option><option value="low">منخفضة</option><option value="high">عالية</option></select></div>
    </div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-tk-notes"></div>
  `, async () => {
    const title = gv('m-tk-title');
    if (!title) { toast('عنوان المهمة مطلوب', 'e'); return false; }
    try {
      await DB.createTask({ title, due_date: gv('m-tk-due') || null, priority: document.getElementById('m-tk-priority').value, notes: gv('m-tk-notes') });
      toast('تم الحفظ', 's'); go('tasks');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.updateTaskStatus = async (id, status) => {
  try { await DB.updateTaskStatus(id, status); toast('تم التحديث', 's'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
window.deleteTaskConfirm = async (id, title) => {
  if (!confirm(`حذف المهمة "${title}"؟`)) return;
  try { await DB.deleteTask(id, title); toast('تم الحذف', 's'); go('tasks'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};

// ── التأجير ─────────────────────────────
PAGE_RENDER.rental = async (root) => {
  const list = await DB.listRentalItems();
  const stChip = (s) => s === 'active' ? '<span class="chip chip-ok">فعّال</span>' : s === 'returned' ? '<span class="chip">مُعاد</span>' : '<span class="chip chip-danger">متأخر</span>';
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">🔑 التأجير</div><div class="ph-sub">تأجير معدات/عقارات لطرف ثالث</div></div>
      <div class="ph-actions">${can('admin','accountant','manager') ? `<button class="btn btn-p btn-sm" onclick="openRentalModal()">+ عقد تأجير جديد</button>` : ''}</div></div>
    <div class="card"><div class="itw"><table><thead><tr><th>الرقم</th><th>الأصل المؤجَّر</th><th>المستأجر</th><th>من</th><th>إلى</th><th>القيمة</th><th>الحالة</th><th></th></tr></thead>
    <tbody>${list.map(r => `<tr><td class="doc-num">${r.doc_num}</td><td>${r.asset_name}</td><td>${r.customers?.name || r.renter_name || '—'}</td>
      <td class="mono">${r.start_date}</td><td class="mono">${r.end_date||'—'}</td><td class="mono gold-txt">${r.rental_amount?fmtIQD(r.rental_amount):'—'}</td><td>${stChip(r.status)}</td>
      <td>${can('admin','accountant','manager') ? `
        <select onchange="updateRentalStatus('${r.id}', this.value)" style="width:auto;font-size:11px;padding:4px 8px">
          <option value="active" ${r.status==='active'?'selected':''}>فعّال</option>
          <option value="returned" ${r.status==='returned'?'selected':''}>مُعاد</option>
          <option value="overdue" ${r.status==='overdue'?'selected':''}>متأخر</option>
        </select>` : ''}
        ${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deleteRentalConfirm('${r.id}','${r.doc_num}')">حذف</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="8" class="ec">لا توجد عقود تأجير بعد</td></tr>'}
    </tbody></table></div></div>`;
};
window.openRentalModal = async () => {
  const customers = await DB.listCustomers();
  showModal('عقد تأجير جديد', `
    <div class="fg2">
      <div class="fgroup"><label>الرقم</label><input id="m-rt-num" value="RNT-${Date.now().toString().slice(-8)}"></div>
      <div class="fgroup"><label>الأصل المؤجَّر</label><input id="m-rt-asset"></div>
    </div>
    <div class="fgroup"><label>المستأجر (زبون)</label><select id="m-rt-customer"><option value="">— بدون —</option>${customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
    <div class="fgroup"><label>أو اسم مستأجر حر</label><input id="m-rt-name"></div>
    <div class="fg2">
      <div class="fgroup"><label>من تاريخ</label><input id="m-rt-start" type="date" value="${todayISO()}"></div>
      <div class="fgroup"><label>إلى تاريخ</label><input id="m-rt-end" type="date"></div>
    </div>
    <div class="fgroup"><label>قيمة الإيجار</label><input id="m-rt-amount" type="number" step="1"></div>
    <div class="fgroup"><label>ملاحظات</label><input id="m-rt-notes"></div>
  `, async () => {
    const doc_num = gv('m-rt-num'), asset_name = gv('m-rt-asset'), start_date = gv('m-rt-start');
    if (!doc_num || !asset_name || !start_date) { toast('الرقم والأصل المؤجَّر وتاريخ البدء مطلوبة', 'e'); return false; }
    try {
      await DB.createRentalItem({ doc_num, asset_name, customer_id: gv('m-rt-customer') || null, renter_name: gv('m-rt-name') || null, start_date, end_date: gv('m-rt-end') || null, rental_amount: gv('m-rt-amount') ? Number(gv('m-rt-amount')) : null, notes: gv('m-rt-notes') });
      toast('تم الحفظ', 's'); go('rental');
    } catch (e) { toast('تعذر الحفظ: ' + e.message, 'e'); return false; }
  });
};
window.updateRentalStatus = async (id, status) => {
  try { await DB.updateRentalStatus(id, status); toast('تم التحديث', 's'); }
  catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
window.deleteRentalConfirm = async (id, docNum) => {
  if (!confirm(`حذف عقد التأجير "${docNum}"؟`)) return;
  try { await DB.deleteRentalItem(id, docNum); toast('تم الحذف', 's'); go('rental'); }
  catch (e) { toast('تعذر الحذف: ' + e.message, 'e'); }
};
