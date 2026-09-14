/**
 * settingsView.js — tela de configurações (popup a partir de "show-settings").
 *
 * Preenche os seletores de lista com as listas REAIS do quadro (t.lists('all'))
 * — por isso os nomes das listas NÃO ficam fixos no código: você escolhe aqui.
 */
import { getConfig, saveConfig, DEFAULT_CONFIG } from '../services/storage.js';

const t = window.TrelloPowerUp.iframe();

const $ = (id) => document.getElementById(id);

function fillListSelect(select, lists, selectedId, placeholder) {
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = placeholder;
  select.appendChild(none);
  for (const l of lists) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;               // textContent = seguro contra XSS
    if (l.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
}

function toggleBusinessBox() {
  $('businessBox').style.display = $('businessHoursOnly').checked ? 'block' : 'none';
}

async function boot() {
  const [config, lists] = await Promise.all([
    getConfig(t),
    t.lists('all'),   // <- todas as listas abertas do quadro
  ]);

  fillListSelect($('startList'), lists, config.startListId, '— selecione —');
  fillListSelect($('doneList'), lists, config.doneListId, '— selecione —');
  fillListSelect($('todoList'), lists, config.todoListId, '(nenhuma)');

  $('countPauses').checked = config.countPauses;
  $('showBadge').checked = config.showBadge;
  $('timeFormat').value = config.timeFormat;
  $('businessHoursOnly').checked = config.businessHoursOnly;
  $('bhStart').value = config.business.start;
  $('bhEnd').value = config.business.end;
  [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
    const cb = $(`day${d}`);
    if (cb) cb.checked = config.business.days.includes(d);
  });
  toggleBusinessBox();

  $('businessHoursOnly').addEventListener('change', toggleBusinessBox);

  $('saveBtn').addEventListener('click', async () => {
    const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => $(`day${d}`) && $(`day${d}`).checked);
    const config2 = {
      ...DEFAULT_CONFIG,
      startListId: $('startList').value || null,
      doneListId: $('doneList').value || null,
      todoListId: $('todoList').value || null,
      countPauses: $('countPauses').checked,
      showBadge: $('showBadge').checked,
      timeFormat: $('timeFormat').value,
      businessHoursOnly: $('businessHoursOnly').checked,
      business: { days, start: $('bhStart').value || '08:00', end: $('bhEnd').value || '18:00' },
    };
    await saveConfig(t, config2);
    t.closePopup();
  });

  t.sizeTo('#app').catch(() => {});
}

boot();
