// ══════════════════════════════════════════════════════════════════
//  توزيع الأرباح: شركاء ونسبهم + تقرير توزيع صافي الربح الفعلي
// ══════════════════════════════════════════════════════════════════

PAGE_RENDER.profitdistribution = async (root) => {
  const [partners, tb, accs] = await Promise.all([DB.listProfitPartners(), DB.trialBalance(), DB.chartOfAccounts()]);
  const cogsCodes = new Set(accs.filter(a => a.is_cogs).map(a => a.code));
  const tbWithCogs = tb.map(a => ({ ...a, is_cogs: cogsCodes.has(a.code) }));
  const t = tradingPlTotals(tbWithCogs);
  const totalShare = partners.reduce((s, p) => s + Number(p.share_percent), 0);
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">توزيع الأرباح</div><div class="ph-sub">توزيع صافي الربح الحالي (من كشف الأرباح والخسائر) على الشركاء حسب نسبهم</div></div>
      <div class="ph-actions">${can('admin') ? `<button class="btn btn-p btn-sm" onclick="openPartnerModal()">+ شريك جديد</button>` : ''}</div></div>
    <div class="stats">
      <div class="stat"><div class="stat-lbl">صافي الربح الحالي (تراكمي)</div><div class="stat-val ${t.netProfit>=0?'':'danger'}" style="color:${t.netProfit>=0?'var(--ok)':''}">${fmtIQD(t.netProfit)}</div></div>
      <div class="stat ${totalShare!==100?'warn':''}"><div class="stat-lbl">إجمالي نسب الشركاء</div><div class="stat-val">${totalShare}%</div></div>
    </div>
    ${totalShare !== 100 ? `<div class="card"><div class="ec" style="color:var(--warn)">⚠️ مجموع نسب الشركاء ${totalShare}% وليس 100% — راجع النسب قبل الاعتماد على التوزيع أدناه</div></div>` : ''}
    <div class="card"><div class="itw"><table><thead><tr><th>الشريك</th><th>النسبة</th><th>حصته من الربح</th><th></th></tr></thead>
    <tbody>${partners.map(p => `<tr><td>${p.name}</td><td class="mono">${p.share_percent}%</td>
      <td class="mono gold-txt">${fmtIQD(t.netProfit * p.share_percent / 100)}</td>
      <td>${can('admin') ? `<button class="btn btn-d btn-sm" onclick="deactivatePartnerConfirm('${p.id}')">إلغاء تفعيل</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="ec">لا يوجد شركاء بعد</td></tr>'}
    </tbody></table></div>
    <div class="grand-bar"><span class="grand-lbl">إجمالي الموزَّع</span><span class="grand-val">${fmtIQD(t.netProfit * totalShare / 100)}</span></div></div>
    <div class="card"><div class="ph-sub">ملاحظة: هذا احتساب عرضي للتوزيع فقط — لا يُرحَّل قيداً محاسبياً تلقائياً. لتوثيق الدفعة الفعلية لشريك، استخدم "أمر صرف" من قائمة الحركة اليومية.</div></div>`;
};
window.openPartnerModal = () => {
  showModal('شريك جديد', `<div class="fgroup"><label>الاسم</label><input id="m-pt-name"></div><div class="fgroup"><label>النسبة %</label><input id="m-pt-pct" type="number" step="0.01" max="100"></div>`, async () => {
    const name = gv('m-pt-name'), pct = Number(gv('m-pt-pct'));
    if (!name || !pct) { toast('الاسم والنسبة مطلوبان', 'e'); return false; }
    try { await DB.createProfitPartner({ name, share_percent: pct }); toast('تم', 's'); go('profitdistribution'); }
    catch (e) { toast('تعذر: ' + e.message, 'e'); return false; }
  });
};
window.deactivatePartnerConfirm = async (id) => {
  if (!confirm('إلغاء تفعيل هذا الشريك؟')) return;
  try { await DB.deactivateProfitPartner(id); toast('تم', 's'); go('profitdistribution'); } catch (e) { toast('تعذر: ' + e.message, 'e'); }
};
