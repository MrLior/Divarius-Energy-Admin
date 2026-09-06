// Shared with the Edge Function. Units and validation are identical on both sides.
const n = (key, label, min = 0.001, max = 1000000, integer = false, optional = false) =>
  ({ key, label, type: 'number', min, max, integer, optional });
const t = (key, label, optional = false) => ({ key, label, type: 'text', optional });
export const common = [t('manufacturer', 'יצרן'), t('model_name', 'שם הדגם / התצורה'),
  n('price_ils', 'מחיר ליחידה מלאה (₪) — אופציונלי', 0, 1e9, false, true),
  t('datasheet_url', 'קישור למפרט יצרן — אופציונלי', true), t('notes', 'הערות — אופציונלי', true)];
export const schemas = {
  panels: { label: 'פנאלים', fields: [
    n('panel_power_w', 'הספק (W)', 1, 2000), n('panel_width_mm', 'רוחב (מ״מ)', 100, 5000),
    n('panel_length_mm', 'אורך (מ״מ)', 100, 6000), n('panel_thickness_mm', 'עובי (מ״מ)', 1, 300),
    n('module_voc_v', 'מתח ריקם Voc (V)', .1, 200), n('module_vmp_v', 'מתח עבודה Vmp (V)', .1, 200),
    n('module_isc_a', 'זרם קצר Isc (A)', .1, 100), n('module_imp_a', 'זרם עבודה Imp (A)', .1, 100),
    n('beta_voc_pct', 'מקדם טמפרטורה Voc (%/°C)', -5, 0),
    n('beta_vmp_pct', 'מקדם טמפרטורה Vmp (%/°C)', -5, 0)
  ] },
  inverters: { label: 'ממירים', fields: [
    n('ac_kw', 'הספק AC נקוב (kW)'), n('max_pv_kw', 'הספק PV מרבי מותר (kWp)'),
    {key:'phases',label:'מספר פאזות',type:'select',values:['1','3']},
    {key:'hybrid',label:'תומך באגירה',type:'boolean'},
    n('max_dc_v', 'מתח DC מרבי (V)'), n('start_v', 'מתח התנעה (V)'),
    n('mppt_min_v', 'מתח MPPT מזערי (V)'), n('mppt_max_v', 'מתח MPPT מרבי (V)'),
    n('mppt_count', 'מספר MPPT', 1, 100, true),
    n('inputs_per_mppt', 'כניסות סטרינג לכל MPPT', 1, 20, true),
    n('max_input_a', 'זרם עבודה מרבי לכל כניסת סטרינג (A)'),
    n('max_input_isc_a', 'זרם קצר מרבי לכל כניסת סטרינג (A)'),
    n('max_mppt_a', 'זרם עבודה מצטבר מרבי לכל MPPT (A)'),
    n('max_mppt_isc_a', 'זרם קצר מצטבר מרבי לכל MPPT (A)'),
    ...[n('battery_min_v', 'מתח סוללה מזערי (V)'), n('battery_max_v', 'מתח סוללה מרבי (V)'),
      n('battery_discharge_a', 'זרם פריקה מצטבר מרבי מסוללות (A)'),
      n('battery_charge_a', 'זרם טעינה מצטבר מרבי לסוללות (A)'),
      n('battery_discharge_kw', 'הספק פריקה רציף מרבי מהסוללות (kW)'),
      n('battery_charge_kw', 'הספק טעינה רציף מרבי לסוללות (kW)'),
      n('backup_ac_kw', 'הספק AC רציף במצב גיבוי (kW)'),
      n('max_banks', 'מספר בנקים מלאים מרבי לממיר', 1, 1000, true),
      n('max_parallel_inverters', 'מספר ממירים מרבי במערכת גיבוי מסונכרנת', 1, 1000, true)
    ].map(f => ({...f, hybridOnly:true}))
  ] },
  batteries: { label: 'סוללות', fields: [
    n('nominal_kwh', 'קיבולת נומינלית של בנק מלא (kWh)'),
    n('usable_kwh', 'קיבולת שימושית של בנק מלא (kWh)'),
    n('nominal_v', 'מתח נומינלי של בנק מלא (V)'),
    n('min_v', 'מתח עבודה מזערי (V)'), n('max_v', 'מתח עבודה מרבי (V)'),
    n('capacity_ah', 'קיבולת בנק (Ah) — אופציונלי', .001, 1e6, false, true),
    n('discharge_kw', 'הספק פריקה רציף (kW)'), n('charge_kw', 'הספק טעינה רציף (kW)'),
    n('discharge_a', 'זרם פריקה רציף (A)'), n('charge_a', 'זרם טעינה רציף (A)'),
    n('internal_modules', 'מספר מודולים בתוך בנק מלא', 1, 1000, true),
    n('max_parallel', 'בנקים זהים מרביים במקביל לממיר', 1, 1000, true),
    t('bms_protocol', 'פרוטוקול / פרופיל BMS'),
    t('compatibility_source', 'אסמכתת תאימות ותנאים: דף יצרן, קושחה, רכזת וכדומה'),
    {key:'compatible_inverter_ids',label:'דגמי ממירים תואמים לפי היצרן',type:'inverter-list'}
  ] }
};

export function normalizeEquipment(kind, input) {
  if (!schemas[kind] || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('סוג ציוד אינו תקין.');
  const out = {kind, active: input.active !== false};
  for (const f of [...common, ...schemas[kind].fields]) {
    if (f.hybridOnly && input.hybrid !== true) { out[f.key] = null; continue; }
    const v = input[f.key];
    if (f.type === 'boolean') { out[f.key] = v === true; continue; }
    if (f.type === 'inverter-list') {
      if (!Array.isArray(v) || !v.length || v.length > 500 || v.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error('יש לבחור ממיר תואם אחד לפחות.');
      out[f.key] = [...new Set(v)]; continue;
    }
    if (v == null || String(v).trim() === '') {
      if (f.optional) { out[f.key] = f.type === 'number' ? null : ''; continue; }
      throw new Error('שדה חובה: ' + f.label);
    }
    if (f.type === 'number') {
      const value = Number(v);
      if (!Number.isFinite(value) || value < f.min || value > f.max || (f.integer && !Number.isInteger(value))) throw new Error('ערך אינו תקין: ' + f.label);
      out[f.key] = value;
    } else if (f.type === 'select') {
      if (!f.values.includes(String(v))) throw new Error('ערך אינו תקין: ' + f.label);
      out[f.key] = String(v);
    } else {
      const value = String(v).trim();
      if (value.length > (['notes','compatibility_source'].includes(f.key) ? 2000 : 250)) throw new Error('טקסט ארוך מדי: ' + f.label);
      out[f.key] = value;
    }
  }
  if (out.datasheet_url) {
    try { if (!['https:', 'http:'].includes(new URL(out.datasheet_url).protocol)) throw new Error(); }
    catch (_) { throw new Error('קישור מפרט אינו תקין.'); }
  }
  if (kind === 'panels' && (out.module_vmp_v >= out.module_voc_v || out.module_imp_a > out.module_isc_a)) throw new Error('נדרש Vmp קטן מ־Voc ו־Imp שאינו גדול מ־Isc.');
  if (kind === 'inverters') {
    if (out.mppt_min_v >= out.mppt_max_v || out.mppt_max_v > out.max_dc_v || out.start_v > out.max_dc_v) throw new Error('טווחי המתח של הממיר אינם תקינים.');
    if (out.max_input_a > out.max_mppt_a || out.max_input_isc_a > out.max_mppt_isc_a) throw new Error('מגבלת כניסה אינה יכולה להיות גדולה מהמגבלה המצטברת של MPPT.');
    if (out.hybrid && out.battery_min_v >= out.battery_max_v) throw new Error('טווח מתח הסוללה בממיר אינו תקין.');
  }
  if (kind === 'batteries') {
    if (out.usable_kwh > out.nominal_kwh || out.min_v >= out.max_v || out.nominal_v < out.min_v || out.nominal_v > out.max_v) throw new Error('קיבולת או טווח מתח הסוללה אינם תקינים.');
    if (out.capacity_ah && Math.abs(out.capacity_ah * out.nominal_v / 1000 - out.nominal_kwh) > out.nominal_kwh * .1) throw new Error('קיבולת Ah כפול מתח נומינלי אינה תואמת לקיבולת kWh (סטייה מעל 10%).');
  }
  return out;
}
