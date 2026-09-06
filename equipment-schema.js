const n=(key,label,min=.001,max=1e6,integer=false,optional=false)=>({key,label,type:'number',min,max,integer,optional});
const t=(key,label,optional=false)=>({key,label,type:'text',optional});
export const common=[t('manufacturer','יצרן'),t('model_name','שם הדגם'),n('price_ils','מחיר — אופציונלי',0,1e9,false,true)];
export const schemas={
 panels:{label:'פנאלים',fields:[n('panel_power_w','הספק (W)',1,2000),n('panel_width_mm','רוחב (מ״מ)',100,5000),n('panel_length_mm','אורך (מ״מ)',100,6000),n('module_voc_v','Voc (V)',.1,200),n('module_vmp_v','Vmp (V)',.1,200),n('module_isc_a','Isc (A)',.1,100),n('module_imp_a','Imp (A)',.1,100)]},
 inverters:{label:'ממירים',fields:[n('ac_kw','הספק AC (kW)'),n('max_pv_kw','הספק PV מרבי (kWp)'),{key:'phases',label:'מספר פאזות',type:'select',values:['1','3']},{key:'hybrid',label:'ממיר היברידי / אגירה',type:'boolean'},n('max_dc_v','מתח DC מרבי (V)'),n('mppt_min_v','מתח MPPT מזערי (V)'),n('mppt_max_v','מתח MPPT מרבי (V)'),n('mppt_count','מספר MPPT',1,100,true),n('inputs_per_mppt','כניסות לכל MPPT',1,20,true),n('max_input_a','זרם עבודה מרבי לכניסה (A)'),n('max_input_isc_a','זרם קצר מרבי לכניסה (A)'),{...n('battery_min_v','מתח סוללה מזערי (V)',.1,2000),hybridOnly:true},{...n('battery_max_v','מתח סוללה מרבי (V)',.1,2000),hybridOnly:true},{...n('battery_discharge_kw','הספק פריקה מרבי (kW)'),hybridOnly:true},{...n('backup_ac_kw','הספק גיבוי רציף (kW)'),hybridOnly:true}]},
 batteries:{label:'סוללות',fields:[n('nominal_kwh','קיבולת נומינלית (kWh)'),n('usable_kwh','קיבולת שימושית (kWh)'),n('min_v','מתח עבודה מזערי (V)'),n('max_v','מתח עבודה מרבי (V)'),n('discharge_kw','הספק פריקה רציף (kW)'),n('max_parallel','כמות מרבית במקביל',1,1000,true),{key:'compatible_inverter_ids',label:'ממירים תואמים',type:'inverter-list'}]}
};
export function normalizeEquipment(kind,input){
 if(!schemas[kind]||!input||typeof input!=='object'||Array.isArray(input))throw new Error('סוג ציוד אינו תקין.');
 const out={kind,active:input.active!==false};
 for(const f of [...common,...schemas[kind].fields]){
  if(f.hybridOnly&&input.hybrid!==true){out[f.key]=null;continue;}
  const v=input[f.key];
  if(f.type==='boolean'){out[f.key]=v===true;continue;}
  if(f.type==='inverter-list'){if(!Array.isArray(v)||!v.length||v.some(id=>!/^[0-9a-f-]{36}$/i.test(id)))throw new Error('יש לבחור ממיר תואם אחד לפחות.');out[f.key]=[...new Set(v)];continue;}
  if(v==null||String(v).trim()===''){if(f.optional){out[f.key]=f.type==='number'?null:'';continue;}throw new Error('שדה חובה: '+f.label);}
  if(f.type==='number'){const value=Number(v);if(!Number.isFinite(value)||value<f.min||value>f.max||(f.integer&&!Number.isInteger(value)))throw new Error('ערך אינו תקין: '+f.label);out[f.key]=value;}
  else if(f.type==='select'){if(!f.values.includes(String(v)))throw new Error('ערך אינו תקין: '+f.label);out[f.key]=String(v);}
  else out[f.key]=String(v).trim();
 }
 if(kind==='panels'){if(out.module_vmp_v>=out.module_voc_v||out.module_imp_a>out.module_isc_a)throw new Error('נדרש Vmp קטן מ־Voc ו־Imp שאינו גדול מ־Isc.');Object.assign(out,{panel_thickness_mm:35,beta_voc_pct:-.25,beta_vmp_pct:-.29});}
 if(kind==='inverters'){if(out.mppt_min_v>=out.mppt_max_v||out.mppt_max_v>out.max_dc_v)throw new Error('טווחי המתח של הממיר אינם תקינים.');Object.assign(out,{start_v:out.mppt_min_v,max_mppt_a:out.max_input_a*out.inputs_per_mppt,max_mppt_isc_a:out.max_input_isc_a*out.inputs_per_mppt});if(out.hybrid){if(out.battery_min_v>=out.battery_max_v)throw new Error('טווח מתח הסוללה בממיר אינו תקין.');Object.assign(out,{battery_discharge_a:out.battery_discharge_kw*1000/out.battery_min_v,battery_charge_a:out.battery_discharge_kw*1000/out.battery_min_v,battery_charge_kw:out.battery_discharge_kw,max_banks:1000,max_parallel_inverters:1000});}}
 if(kind==='batteries'){if(out.usable_kwh>out.nominal_kwh||out.min_v>=out.max_v)throw new Error('קיבולת או טווח מתח הסוללה אינם תקינים.');Object.assign(out,{nominal_v:(out.min_v+out.max_v)/2,discharge_a:out.discharge_kw*1000/out.min_v,charge_kw:out.discharge_kw,charge_a:out.discharge_kw*1000/out.min_v,internal_modules:1});}
 return out;
}
