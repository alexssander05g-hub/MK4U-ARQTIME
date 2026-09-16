/**
 * reportView.js — Relatório do quadro (modal do botão de quadro).
 *
 * ABAS: Geral · Painel (gráficos) · Semanal · Mensal · Por sessão.
 * FILTROS (no topo, afetam todas as abas e o CSV): membro atribuído e etiqueta.
 * BUSCA: campo que filtra por nome do card (só visual, não afeta o CSV).
 * ORDENAÇÃO: clique nos cabeçalhos da aba Geral.
 * EXPORTAÇÃO: CSV da aba atual, ou "Baixar tudo" (todas as abas num arquivo).
 *
 * Agrupamento semanal/mensal automático pelo calendário (semana ISO, começa na
 * segunda). Tudo client-side; a matemática vem dos módulos puros report.js /
 * tracker.js, então os números batem com o verso de cada card.
 */

import { getConfig } from '../services/storage.js';
import { normalize, Status } from '../services/tracker.js';
import { buildReport, timeByMember } from '../services/report.js';
import { toCsv } from '../services/exporter.js';
import { formatDuration, formatDateTime, now } from '../utils/time.js';
import { el, clear } from '../utils/dom.js';

const t = window.TrelloPowerUp.iframe();

const STATUS_LABEL = {
  idle: 'Aguardando', running: 'Em andamento', paused: 'Pausado', done: 'Concluído',
};

const TABS = [
  { id: 'geral', label: 'Geral' },
  { id: 'painel', label: 'Painel' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'mensal', label: 'Mensal' },
  { id: 'sessoes', label: 'Por sessão' },
];

let MODEL = null;             // { allCards, members, labels, memberName, config, at }
let activeTab = 'geral';
let includeUntracked = false;
let selectedMemberId = '';
let selectedLabelId = '';
let searchText = '';
let sortState = { col: null, dir: 'desc' };
let keepFocus = false;

const fmt = (ms) => formatDuration(ms, MODEL.config.timeFormat);
const showPaused = () => !!MODEL.config.countPauses;
const matchesSearch = (name) => !searchText || name.toLowerCase().includes(searchText.toLowerCase());

// -- filtro + relatório (memoizado por membro+etiqueta) --------------------

function filteredCards() {
  return MODEL.allCards.filter((c) =>
    (!selectedMemberId || c.memberIds.has(selectedMemberId)) &&
    (!selectedLabelId || c.labelIds.has(selectedLabelId)));
}

let _cacheKey = null;
let _cacheReport = null;
function getReport() {
  const key = `${selectedMemberId}|${selectedLabelId}`;
  if (_cacheReport && _cacheKey === key) return _cacheReport;
  _cacheReport = buildReport(
    filteredCards().map((c) => ({ name: c.name, lista: c.lista, state: c.state })),
    MODEL.at, MODEL.config,
  );
  _cacheKey = key;
  return _cacheReport;
}

// -- ordenação (aba Geral) -------------------------------------------------

function sortGeneral(rows) {
  if (!sortState.col) return rows;
  const dir = sortState.dir === 'asc' ? 1 : -1;
  const val = (r) => ({
    card: r.card.toLowerCase(), lista: r.lista.toLowerCase(),
    dias: r.days, sessoes: r.sessions, pausado: r.pausedMs, tempo: r.effectiveMs,
  }[sortState.col]);
  return rows.slice().sort((a, b) => {
    const x = val(a); const y = val(b);
    if (x < y) return -1 * dir; if (x > y) return 1 * dir; return 0;
  });
}
function setSort(col) {
  if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  else sortState = { col, dir: (col === 'card' || col === 'lista') ? 'asc' : 'desc' };
  render();
}

// -- exportação ------------------------------------------------------------

function csvForTab(tabId = activeTab) {
  const r = getReport();
  const paused = showPaused();
  if (tabId === 'geral') {
    const head = ['Card', 'Lista', 'Status', 'Início', 'Conclusão', 'Dias', 'Sessões',
      ...(paused ? ['Pausado'] : []), 'Tempo efetivo', 'Tempo (ms)'];
    const rows = (includeUntracked ? r.general : r.general.filter((x) => x.tracked)).map((x) => [
      x.card, x.lista, STATUS_LABEL[x.status],
      x.inicio ? formatDateTime(x.inicio) : '', x.conclusao ? formatDateTime(x.conclusao) : '',
      x.days, x.sessions, ...(paused ? [fmt(x.pausedMs)] : []), fmt(x.effectiveMs), x.effectiveMs,
    ]);
    return toCsv(head, rows);
  }
  if (tabId === 'sessoes') {
    const head = ['Card', 'Início', 'Fim', 'Dias', ...(paused ? ['Pausado'] : []), 'Tempo', 'Tempo (ms)'];
    const rows = r.sessions.map((s) => [
      s.card, formatDateTime(s.startedAt), s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)',
      s.days, ...(paused ? [fmt(s.pausedMs)] : []), fmt(s.effectiveMs), s.effectiveMs,
    ]);
    return toCsv(head, rows);
  }
  if (tabId === 'painel') {
    // exporta a base do painel: tempo por membro
    const rows = timeByMember(filteredCards(), MODEL.at, MODEL.config)
      .map((m) => [MODEL.memberName.get(m.memberId) || m.memberId, m.cardCount, fmt(m.effectiveMs), m.effectiveMs]);
    return toCsv(['Membro', 'Cards', 'Tempo', 'Tempo (ms)'], rows);
  }
  const periods = tabId === 'semanal' ? r.weekly : r.monthly;
  const label = tabId === 'semanal' ? 'Semana' : 'Mês';
  const head = [label, 'Card', 'Dias', 'Sessões', ...(paused ? ['Pausado'] : []), 'Tempo', 'Tempo (ms)'];
  const rows = [];
  for (const p of periods) {
    for (const row of p.rows) {
      rows.push([p.label, row.card, row.days, row.sessions,
        ...(paused ? [fmt(row.pausedMs)] : []), fmt(row.effectiveMs), row.effectiveMs]);
    }
  }
  return toCsv(head, rows);
}

function csvAll() {
  const sec = (title, id) => `== ${title} ==\r\n${csvForTab(id)}`;
  return [
    sec('GERAL', 'geral'), sec('SEMANAL', 'semanal'),
    sec('MENSAL', 'mensal'), sec('POR SESSÃO', 'sessoes'), sec('POR MEMBRO', 'painel'),
  ].join('\r\n\r\n');
}

function downloadCsv(filename, text) {
  try {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    return true;
  } catch (e) { return false; }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try {
      const ta = el('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
    } catch (e2) { return false; }
  }
}

function flash(btn, msg, ms = 1600) {
  const original = btn.textContent; btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, ms);
}

// -- helpers de tabela / gráfico -------------------------------------------

function th(text, cls) { return el('th', cls ? { class: cls, text } : { text }); }
function td(text, cls) { return el('td', cls ? { class: cls, text } : { text }); }
function statusChip(status) { return el('span', { class: `tt-badge-mini st-${status}`, text: STATUS_LABEL[status] }); }

function sortableTh(label, col, cls) {
  const active = sortState.col === col;
  const arrow = active ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return el('th', {
    class: `tt-th-sort${active ? ' is-active' : ''}${cls ? ' ' + cls : ''}`,
    text: label + arrow, onclick: () => setSort(col),
  });
}

function tableEl(headCells, bodyRows, footCells) {
  const parts = [el('thead', {}, el('tr', {}, headCells)), el('tbody', {}, bodyRows)];
  if (footCells) parts.push(el('tfoot', {}, el('tr', {}, footCells)));
  return el('table', { class: 'tt-table' }, parts);
}

function barChart(title, items) {
  if (!items.length) {
    return el('div', { class: 'tt-chart' }, [
      el('div', { class: 'tt-chart-title', text: title }),
      el('div', { class: 'tt-report-empty', text: 'Sem dados para este filtro.' }),
    ]);
  }
  const max = items.reduce((m, i) => Math.max(m, i.value), 0) || 1;
  const rows = items.map((i) => el('div', { class: 'tt-bar-row' }, [
    el('div', { class: 'tt-bar-label', title: i.label, text: i.label }),
    el('div', { class: 'tt-bar-track' }, el('div', { class: 'tt-bar-fill', style: `width:${Math.max(2, (i.value / max) * 100)}%` })),
    el('div', { class: 'tt-bar-val', text: i.text }),
  ]));
  return el('div', { class: 'tt-chart' }, [el('div', { class: 'tt-chart-title', text: title }), ...rows]);
}

// -- abas ------------------------------------------------------------------

function renderGeral(r) {
  const paused = showPaused();
  let rows = (includeUntracked ? r.general : r.general.filter((x) => x.tracked)).filter((x) => matchesSearch(x.card));
  rows = sortGeneral(rows);
  if (rows.length === 0) return el('div', { class: 'tt-report-empty', text: 'Nenhum card para este filtro/busca.' });
  const totalMs = rows.reduce((a, x) => a + x.effectiveMs, 0);
  const totalPaused = rows.reduce((a, x) => a + x.pausedMs, 0);
  const body = rows.map((x) => el('tr', {}, [
    td(x.card, 'tt-td-card'), td(x.lista),
    el('td', {}, statusChip(x.status)),
    td(x.inicio ? formatDateTime(x.inicio) : '—', 'nowrap'),
    td(x.conclusao ? formatDateTime(x.conclusao) : '—', 'nowrap'),
    td(String(x.days), 'num'), td(String(x.sessions), 'num'),
    ...(paused ? [td(fmt(x.pausedMs), 'num')] : []), td(fmt(x.effectiveMs), 'num'),
  ]));
  const foot = [td('Total'), td(''), td(''), td(''), td(''), td('', 'num'), td('', 'num'),
    ...(paused ? [td(fmt(totalPaused), 'num')] : []), td(fmt(totalMs), 'num')];
  const head = [
    sortableTh('Card', 'card'), sortableTh('Lista', 'lista'), th('Status'),
    th('Início'), th('Conclusão'),
    sortableTh('Dias', 'dias', 'num'), sortableTh('Sessões', 'sessoes', 'num'),
    ...(paused ? [sortableTh('Pausado', 'pausado', 'num')] : []), sortableTh('Tempo', 'tempo', 'num'),
  ];
  return el('div', { class: 'tt-scroll' }, tableEl(head, body, foot));
}

function renderSessoes(r) {
  const paused = showPaused();
  const rows = r.sessions.filter((s) => matchesSearch(s.card));
  if (rows.length === 0) return el('div', { class: 'tt-report-empty', text: 'Nenhuma sessão para este filtro/busca.' });
  const body = rows.map((s) => el('tr', {}, [
    td(s.card, 'tt-td-card'),
    td(formatDateTime(s.startedAt), 'nowrap'),
    td(s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)', 'nowrap'),
    td(String(s.days), 'num'),
    ...(paused ? [td(fmt(s.pausedMs), 'num')] : []), td(fmt(s.effectiveMs), 'num'),
  ]));
  const head = [th('Card'), th('Início'), th('Fim'), th('Dias', 'num'),
    ...(paused ? [th('Pausado', 'num')] : []), th('Tempo', 'num')];
  return el('div', { class: 'tt-scroll' }, tableEl(head, body));
}

function renderPeriods(periods, periodWord) {
  const paused = showPaused();
  const filtered = periods
    .map((p) => ({ ...p, rows: p.rows.filter((row) => matchesSearch(row.card)) }))
    .filter((p) => p.rows.length > 0);
  if (filtered.length === 0) return el('div', { class: 'tt-report-empty', text: `Nenhum registro ${periodWord} para este filtro/busca.` });
  const wrap = el('div', { class: 'tt-scroll' });
  for (const p of filtered) {
    const head = [th('Card'), th('Dias', 'num'), th('Sessões', 'num'),
      ...(paused ? [th('Pausado', 'num')] : []), th('Tempo', 'num')];
    const body = p.rows.map((row) => el('tr', {}, [
      td(row.card, 'tt-td-card'), td(String(row.days), 'num'), td(String(row.sessions), 'num'),
      ...(paused ? [td(fmt(row.pausedMs), 'num')] : []), td(fmt(row.effectiveMs), 'num'),
    ]));
    const sumMs = p.rows.reduce((a, x) => a + x.effectiveMs, 0);
    wrap.appendChild(el('div', { class: 'tt-period' }, [
      el('div', { class: 'tt-period-head' }, [
        el('span', { class: 'tt-period-title', text: p.label }),
        el('span', { class: 'tt-period-sum', text: fmt(sumMs) }),
      ]),
      tableEl(head, body),
    ]));
  }
  return wrap;
}

function renderPainel(r) {
  const wrap = el('div', { class: 'tt-scroll tt-dash' });
  const top = r.general.filter((x) => x.tracked && matchesSearch(x.card)).slice(0, 10)
    .map((x) => ({ label: x.card, value: x.effectiveMs, text: fmt(x.effectiveMs) }));
  wrap.appendChild(barChart('Top cards por tempo', top));

  const weeks = r.weekly.slice().reverse()
    .map((p) => ({ label: p.label.split(' · ')[0], value: p.totalMs, text: fmt(p.totalMs) }));
  wrap.appendChild(barChart('Tempo por semana', weeks));

  const months = r.monthly.slice().reverse()
    .map((p) => ({ label: p.label, value: p.totalMs, text: fmt(p.totalMs) }));
  wrap.appendChild(barChart('Tempo por mês', months));

  if (MODEL.members.length) {
    const bm = timeByMember(filteredCards(), MODEL.at, MODEL.config)
      .map((m) => ({ label: MODEL.memberName.get(m.memberId) || m.memberId, value: m.effectiveMs, text: fmt(m.effectiveMs) }));
    wrap.appendChild(barChart('Tempo por membro', bm));
  }
  return wrap;
}

function renderBody(r) {
  switch (activeTab) {
    case 'painel': return renderPainel(r);
    case 'semanal': return renderPeriods(r.weekly, 'semanal');
    case 'mensal': return renderPeriods(r.monthly, 'mensal');
    case 'sessoes': return renderSessoes(r);
    case 'geral':
    default: return renderGeral(r);
  }
}

function selectFilter(placeholder, options, selected, onChange) {
  const sel = el('select', { class: 'tt-select' });
  sel.appendChild(el('option', { value: '', text: placeholder }));
  for (const o of options) {
    const opt = el('option', { value: o.id, text: o.name });
    if (o.id === selected) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.value = selected;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function render() {
  const root = document.getElementById('app');
  clear(root);
  const r = getReport();

  const summary = el('div', {
    class: 'tt-report-summary',
    text: `${r.totals.trackedCount} card(s) com tempo · ${r.totals.visibleCount} no filtro · total ${fmt(r.totals.totalMs)}`,
  });

  const memberSel = selectFilter('Todos os membros', MODEL.members, selectedMemberId,
    (v) => { selectedMemberId = v; render(); });
  const labelSel = MODEL.labels.length
    ? selectFilter('Todas as etiquetas', MODEL.labels, selectedLabelId, (v) => { selectedLabelId = v; render(); })
    : null;

  const search = el('input', { type: 'search', class: 'tt-search', placeholder: 'Buscar card…', value: searchText });
  search.addEventListener('input', () => { searchText = search.value; keepFocus = true; render(); });

  const btnCsv = el('button', {
    class: 'tt-btn is-primary', text: 'CSV da aba',
    onclick: async () => {
      const name = `relatorio-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
      if (downloadCsv(name, csvForTab())) return;
      const ok = await copyText(csvForTab());
      flash(btnCsv, ok ? 'Copiado!' : 'Use "Copiar"', 2200);
    },
  });
  const btnAll = el('button', {
    class: 'tt-btn', text: 'Baixar tudo',
    onclick: async () => {
      const name = `relatorio-completo-${new Date().toISOString().slice(0, 10)}.csv`;
      if (downloadCsv(name, csvAll())) return;
      const ok = await copyText(csvAll());
      flash(btnAll, ok ? 'Copiado!' : 'Falhou', 2200);
    },
  });
  const btnCopy = el('button', {
    class: 'tt-btn', text: 'Copiar',
    onclick: async () => { const ok = await copyText(csvForTab()); flash(btnCopy, ok ? 'Copiado!' : 'Falhou'); },
  });

  const filters = el('div', { class: 'tt-report-filters' }, [memberSel, labelSel, search].filter(Boolean));
  const toolbar = el('div', { class: 'tt-report-toolbar' }, [
    el('div', { class: 'tt-report-meta' }, [summary, filters]),
    el('div', { class: 'tt-report-actions' }, [btnCopy, btnCsv, btnAll]),
  ]);
  root.appendChild(toolbar);

  root.appendChild(el('div', { class: 'tt-tabs' }, TABS.map((tab) => el('button', {
    class: `tt-tab${tab.id === activeTab ? ' is-active' : ''}`, text: tab.label,
    onclick: () => { activeTab = tab.id; render(); },
  }))));

  if (activeTab === 'geral') {
    const chk = el('input', { type: 'checkbox' });
    chk.checked = includeUntracked;
    chk.addEventListener('change', () => { includeUntracked = chk.checked; render(); });
    root.appendChild(el('label', { class: 'tt-check tt-report-toggle' }, [chk, ' Incluir cards sem tempo']));
  }

  root.appendChild(renderBody(r));

  if (keepFocus) { // devolve o foco ao campo de busca após o re-render
    const s = root.querySelector('.tt-search');
    if (s) { s.focus(); const v = s.value; s.value = ''; s.value = v; }
    keepFocus = false;
  }
  t.sizeTo('#app').catch(() => {});
}

// -- boot ------------------------------------------------------------------

async function boot() {
  const root = document.getElementById('app');
  try {
    const config = await getConfig(t);
    const [cards, lists] = await Promise.all([
      t.cards('id', 'name', 'idList', 'members', 'labels'),
      t.lists('id', 'name'),
    ]);
    const listName = new Map(lists.map((l) => [l.id, l.name]));
    const states = await Promise.all(cards.map((c) => t.get(c.id, 'shared', 'tt').catch(() => null)));

    const memberName = new Map();
    const labelName = new Map();
    const allCards = cards.map((c, i) => {
      const members = Array.isArray(c.members) ? c.members : [];
      const labels = Array.isArray(c.labels) ? c.labels : [];
      const memberIds = new Set();
      const labelIds = new Set();
      for (const m of members) { memberIds.add(m.id); if (!memberName.has(m.id)) memberName.set(m.id, m.fullName || m.username || m.id); }
      for (const l of labels) { labelIds.add(l.id); if (!labelName.has(l.id)) labelName.set(l.id, l.name || `(cor ${l.color || '—'})`); }
      return { name: c.name, lista: listName.get(c.idList) || '—', state: normalize(states[i] || null), memberIds, labelIds };
    });
    const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
    const members = Array.from(memberName, ([id, name]) => ({ id, name })).sort(byName);
    const labels = Array.from(labelName, ([id, name]) => ({ id, name })).sort(byName);

    MODEL = { allCards, members, labels, memberName, config, at: now() };
    render();
  } catch (e) {
    clear(root);
    root.appendChild(el('div', {
      class: 'tt-report-empty',
      text: 'Não foi possível carregar o relatório: ' + (e && e.message ? e.message : String(e)),
    }));
  }
}

boot();
