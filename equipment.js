import {common, schemas, normalizeEquipment} from './equipment-schema.js';

let mounted = false;
export function mount(api, showError) {
  if (mounted) return;
  mounted = true;
  const dashboard = document.getElementById('view-dashboard');
  const licenseNodes = [...dashboard.children].filter(node => !node.classList.contains('dashboard-top'));
  const tabs = document.createElement('nav');
  tabs.className = 'equipment-tabs';
  tabs.setAttribute('aria-label', 'לשוניות ניהול');
  tabs.innerHTML = '<button type="button" class="button primary" aria-pressed="true">רישיונות</button><button type="button" class="button secondary" aria-pressed="false">מאגר ציוד</button>';
  dashboard.querySelector('.dashboard-top').after(tabs);
  const panel = document.createElement('section');
  panel.className = 'card equipment-panel'; panel.hidden = true;
  panel.innerHTML = `<div class="section-heading"><h2>מאגר ציוד</h2><button type="button" class="button secondary" id="equipment-refresh">רענון</button></div>
    <nav class="equipment-tabs" id="equipment-kinds" aria-label="סוג ציוד"></nav>
    <div class="equipment-tools"><label>חיפוש במאגר<input id="equipment-search" type="search" placeholder="יצרן, דגם או ערך טכני"></label><button type="button" class="button secondary" id="equipment-import">ייבוא קובץ</button><input id="equipment-import-file" type="file" accept="application/json,.json" hidden><button type="button" class="button primary" id="equipment-add">הוסף ציוד</button></div>
    <p class="muted">אפשר לגרור שורה מעל או מתחת לשורה אחרת כדי לשנות את סדר ההצגה בתוסף.</p>
    <p id="equipment-status" role="status"></p><div class="equipment-table-wrap"><table><thead><tr><th>סדר</th><th>יצרן</th><th>דגם</th><th>נתונים</th><th>מחיר</th><th>מצב</th><th>פעולות</th></tr></thead><tbody id="equipment-rows"></tbody></table></div>`;
  dashboard.append(panel);
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = './equipment.css'; document.head.append(style);
  const dialog = document.createElement('dialog'); dialog.className = 'dialog equipment-dialog';
  dialog.innerHTML = '<form id="equipment-form"><h2 id="equipment-title"></h2><p id="equipment-help" class="muted"></p><div id="equipment-fields" class="equipment-fields"></div><p id="equipment-form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button danger" id="equipment-delete-dialog">מחק ציוד</button><button type="button" class="button secondary" id="equipment-cancel">ביטול</button><button type="submit" class="button primary">שמור ציוד</button></div></form>';
  document.body.append(dialog);
  let items = [], kind = 'panels', editing = null, loading = false, draggedId = null;
  const el = id => document.getElementById(id);
  const label = item => item.manufacturer + ' · ' + item.model_name;
  function render() {
    const query = el('equipment-search').value.trim().toLocaleLowerCase();
    const shown = items.filter(item => item.kind === kind && JSON.stringify(item).toLocaleLowerCase().includes(query));
    el('equipment-rows').replaceChildren();
    shown.sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0) || label(a).localeCompare(label(b), 'he')).forEach((item,index) => {
      const tr = document.createElement('tr');
      tr.dataset.id = item.id;
      tr.draggable = query === '';
      tr.className = query === '' ? 'equipment-draggable' : '';
      tr.ondragstart = event => { draggedId = item.id; tr.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; };
      tr.ondragend = () => { draggedId = null; tr.classList.remove('is-dragging'); };
      tr.ondragover = event => { if (draggedId && draggedId !== item.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } };
      tr.ondrop = async event => { event.preventDefault(); await moveItem(draggedId, item.id); };
      const summary = kind === 'panels' ? `${item.panel_power_w} W · ${item.panel_length_mm}×${item.panel_width_mm} מ״מ` :
        kind === 'inverters' ? `${item.ac_kw} kW · ${item.dc_architecture === 'optimizer' ? 'אופטימייזרים' : `${item.mppt_count} MPPT`} · ${item.hybrid ? 'היברידי' : 'רשת'}` :
          `${item.nominal_kwh} kWh · ${item.nominal_v} V · ${item.discharge_kw} kW`;
      [`☰ ${index + 1}`, item.manufacturer, item.model_name, summary, item.price_ils == null ? '—' : `${item.price_ils} ₪`, item.active ? 'פעיל' : 'מושבת'].forEach((value,column) => {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
        if (column === 0) td.className = 'equipment-order';
      });
      const td = document.createElement('td'), button = document.createElement('button');
      button.type = 'button'; button.className = 'button secondary'; button.textContent = 'עריכה';
      button.onclick = () => open(item); td.append(button);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'button danger equipment-delete'; remove.textContent = 'מחיקה';
      remove.onclick = () => deleteItem(item, remove);
      td.append(remove); tr.append(td); el('equipment-rows').append(tr);
    });
    el('equipment-status').textContent = shown.length ? `${shown.length} פריטים מוצגים` : 'אין פריטים להצגה. אפשר להוסיף דגם חדש.';
  }
  async function moveItem(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId || loading || el('equipment-search').value.trim()) return;
    const ordered = items.filter(item => item.kind === kind)
      .sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0) || label(a).localeCompare(label(b), 'he'));
    const sourceIndex = ordered.findIndex(item => item.id === sourceId);
    const targetIndex = ordered.findIndex(item => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = ordered.splice(sourceIndex, 1); ordered.splice(targetIndex, 0, moved);
    ordered.forEach((item,index) => { item.sort_order = index + 1; }); render();
    el('equipment-status').textContent = 'שומר את סדר הציוד…';
    try {
      await api('admin_equipment_reorder', {kind, ordered_ids:ordered.map(item => item.id)});
      await load();
    } catch (error) { showError(error.message); await load(); }
  }
  async function load() {
    if (loading) return;
    loading = true; el('equipment-status').textContent = 'טוען ציוד…';
    el('equipment-add').disabled = true;
    try {
      const loaded = []; let offset = 0;
      do {
        const response = await api('admin_equipment_list', {offset});
        loaded.push(...response.items); offset = response.next_offset;
      } while (offset !== null);
      items = loaded; render();
    } catch (error) { el('equipment-status').textContent = error.message; showError(error.message); }
    finally { loading = false; el('equipment-add').disabled = false; }
  }
  async function importFile(file) {
    if (!file || loading) return;
    el('equipment-status').textContent = 'קורא ומייבא את קובץ הציוד…';
    el('equipment-import').disabled = true;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(imported) || !imported.length) throw new Error('הקובץ אינו כולל רשימת ציוד תקינה.');
      const result = await api('admin_equipment_import', {items: imported});
      const failed = Array.isArray(result.failed) ? result.failed : [];
      const message = `הייבוא הסתיים: ${result.created || 0} נוספו, ${result.skipped || 0} כבר היו במאגר ודולגו, ${failed.length} נכשלו.`;
      await load();
      el('equipment-status').textContent = message;
      if (failed.length) showError(message + ' ' + failed.slice(0, 5).map(row => `שורה ${row.index}: ${row.message}`).join(' | '));
    } catch (error) {
      const message = error instanceof SyntaxError ? 'קובץ ה־JSON אינו תקין.' : error.message;
      el('equipment-status').textContent = message; showError(message);
    } finally {
      el('equipment-import').disabled = false;
      el('equipment-import-file').value = '';
    }
  }
  async function deleteItem(item, button) {
    if (!item || !window.confirm(`למחוק לצמיתות את ${label(item)} מהמאגר?`)) return;
    if (button) button.disabled = true;
    try {
      await api('admin_equipment_delete', {id:item.id, kind:item.kind, revision:item.revision});
      if (dialog.open) dialog.close();
      await load();
    } catch (error) {
      showError(error.message);
      if (button) button.disabled = false;
    }
  }
  function open(item) {
    editing = item;
    el('equipment-title').textContent = (item ? 'עריכת ' : 'הוספת ') + schemas[kind].label;
    el('equipment-form-error').textContent = '';
    el('equipment-delete-dialog').hidden = !item;
    el('equipment-help').textContent = 'הטופס כולל רק את הנתונים הנדרשים לבחירה ולחישוב בתוסף.';
    const fields = el('equipment-fields'); fields.replaceChildren();
    [...common, ...schemas[kind].fields, {key:'active',label:'פעיל וזמין לבחירה בתוסף',type:'boolean'}].forEach(f => {
      const wrap = document.createElement('label'); wrap.textContent = f.label;
      if (f.hybridOnly) wrap.dataset.hybridOnly = 'true';
      if (f.stringOnly) wrap.dataset.stringOnly = 'true';
      if (f.optimizerOnly) wrap.dataset.optimizerOnly = 'true';
      let input;
      if (f.type === 'inverter-list') {
        input = document.createElement('select'); input.multiple = true; input.size = 7;
        const available = items.filter(row => row.kind === 'inverters' && row.hybrid);
        available.forEach(row => { const opt = document.createElement('option'); opt.value = row.id; opt.textContent = label(row) + (row.active ? '' : ' (מושבת)'); input.append(opt); });
        [...input.options].forEach(opt => { opt.selected = !!item?.[f.key]?.includes(opt.value); });
        const help = document.createElement('small'); help.textContent = available.length ? 'לבחירת כמה דגמים: Ctrl + לחיצה (Mac: Cmd).' : 'יש להוסיף ממיר היברידי למאגר הממירים תחילה.'; wrap.append(help);
      } else if (f.type === 'select') {
        input = document.createElement('select');
        f.values.forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = f.valueLabels?.[v] || v; input.append(opt); });
        input.value = item?.[f.key] ?? f.values[0];
      } else {
        input = document.createElement(f.key === 'notes' || f.key === 'compatibility_source' ? 'textarea' : 'input');
        if (input.tagName === 'INPUT') input.type = f.type === 'boolean' ? 'checkbox' : f.type;
        if (f.type === 'boolean') input.checked = item ? item[f.key] === true : f.key === 'active';
        else input.value = f.type === 'number-list' && Array.isArray(item?.[f.key]) ? item[f.key].join(',') : item?.[f.key] ?? '';
        if (f.type === 'number') { input.min=f.min; input.max=f.max; input.step=f.integer?'1':'any'; input.inputMode='decimal'; }
        if (f.type === 'text') input.maxLength = ['notes','compatibility_source'].includes(f.key) ? 2000 : 250;
      }
      input.name = f.key;
      input.required = !f.optional && f.type !== 'boolean';
      wrap.append(input); fields.append(wrap);
    });
    function conditionalFields() {
      const hybrid = fields.querySelector('[name="hybrid"]')?.checked;
      const optimizer = fields.querySelector('[name="dc_architecture"]')?.value === 'optimizer';
      fields.querySelectorAll('[data-hybrid-only]').forEach(wrap => { const input=wrap.querySelector('input,select,textarea'); wrap.hidden = !hybrid; input.disabled = !hybrid; input.required = hybrid; });
      fields.querySelectorAll('[data-string-only]').forEach(wrap => { const input=wrap.querySelector('input,select,textarea'); wrap.hidden = optimizer; input.disabled = optimizer; input.required = !optimizer; });
      fields.querySelectorAll('[data-optimizer-only]').forEach(wrap => { const input=wrap.querySelector('input,select,textarea'); wrap.hidden = !optimizer; input.disabled = !optimizer; input.required = optimizer; });
    }
    fields.querySelector('[name="hybrid"]')?.addEventListener('change', conditionalFields);
    fields.querySelector('[name="dc_architecture"]')?.addEventListener('change', conditionalFields);
    conditionalFields();
    dialog.showModal();
  }
  el('equipment-form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      const input = {};
      el('equipment-fields').querySelectorAll('[name]').forEach(field => {
        input[field.name] = field.type === 'checkbox' ? field.checked : field.multiple ? [...field.selectedOptions].map(opt=>opt.value) : field.value;
      });
      const item = normalizeEquipment(kind, input);
      await api('admin_equipment_save', {kind, item, id:editing?.id, revision:editing?.revision});
      dialog.close(); await load();
    } catch (error) { el('equipment-form-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  el('equipment-cancel').onclick = () => dialog.close();
  el('equipment-delete-dialog').onclick = () => deleteItem(editing, el('equipment-delete-dialog'));
  [...tabs.children].forEach((button,index) => { button.onclick = () => {
    licenseNodes.forEach(node => { node.hidden = index !== 0; }); panel.hidden = index !== 1;
    [...tabs.children].forEach((tab,i) => {tab.className = 'button ' + (i===index?'primary':'secondary'); tab.setAttribute('aria-pressed',String(i===index));});
    if (index === 1) load();
  }; });
  Object.entries(schemas).forEach(([key,schema]) => {
    const button=document.createElement('button'); button.type='button'; button.textContent=schema.label;
    button.dataset.kind=key; button.className='button '+(key===kind?'primary':'secondary');
    button.setAttribute('aria-pressed', String(key===kind));
    button.onclick=()=>{ kind=key; el('equipment-search').value=''; [...el('equipment-kinds').children].forEach(b=>{b.className='button '+(b===button?'primary':'secondary');b.setAttribute('aria-pressed',String(b===button));});render(); };
    el('equipment-kinds').append(button);
  });
  el('equipment-add').onclick=()=>open(null);
  el('equipment-import').onclick=()=>el('equipment-import-file').click();
  el('equipment-import-file').onchange=event=>importFile(event.target.files?.[0]);
  el('equipment-search').oninput=render;
  el('equipment-refresh').onclick=load;
}
