// ══════════════════════════════════════════════════════════════════
//  تدوير الميزانية: نسخ بنود الموازنة من سنة مالية إلى أخرى بزيادة نسبة مئوية اختيارية
// ══════════════════════════════════════════════════════════════════
PAGE_RENDER.budgetrollover = async (root) => {
  if (!can('admin','manager')) { root.innerHTML = '<div class="card"><div class="ec">لا تملك صلاحية الوصول لهذه الصفحة</div></div>'; return; }
  const years = await DB.listFiscalYears();
  if (years.length < 2) { root.innerHTML = '<div class="card"><div class="ec">تحتاج سنتين ماليتين على الأقل (مصدر وهدف) — أنشئ السنة المالية الجديدة أولاً من "السنوات المالية"</div></div>'; return; }
  root.innerHTML = `
    <div class="ph"><div><div class="ph-title">تدوير الميزانية</div><div class="ph-sub">ينسخ كل بنود موازنة سنة مالية إلى سنة أخرى، بزيادة نسبة مئوية اختيارية على كل بند</div></div></div>
    <div class="card" style="max-width:520px">
      <div class="fg2">
        <div class="fgroup"><label>من السنة المالية (المصدر)</label><select id="rl-from">${years.map(y => `<option value="${y.id}">${y.year}</option>`).join('')}</select></div>
        <div class="fgroup"><label>إلى السنة المالية (الهدف)</label><select id="rl-to">${years.map(y => `<option value="${y.id}">${y.year}</option>`).join('')}</select></div>
      </div>
      <div class="fgroup" style="margin-top:10px"><label>نسبة الزيادة % (اختياري، سالبة للتخفيض)</label><input id="rl-pct" type="number" step="0.1" value="0"></div>
      <div class="form-foot"><button class="btn btn-p" onclick="runBudgetRollover()">تنفيذ التدوير</button></div>
      <div id="rl-result" style="margin-top:12px;font-size:12.5px"></div>
    </div>`;
};
window.runBudgetRollover = async () => {
  const fromId = gv('rl-from'), toId = gv('rl-to'), pct = Number(gv('rl-pct')) || 0;
  if (fromId === toId) { toast('اختر سنتين مختلفتين', 'e'); return; }
  if (!confirm(`سيتم نسخ كل بنود موازنة السنة المصدر إلى السنة الهدف${pct ? ` بزيادة ${pct}%` : ''}. متابعة؟`)) return;
  const box = document.getElementById('rl-result');
  box.innerHTML = 'جارِ التنفيذ...';
  try {
    const count = await DB.rolloverBudget(fromId, toId, pct);
    box.innerHTML = `تم نسخ <b style="color:var(--ok)">${count}</b> بند موازنة بنجاح.`;
    toast('تم تدوير الموازنة', 's');
  } catch (e) { box.innerHTML = ''; toast('تعذر التنفيذ: ' + e.message, 'e'); }
};
