/**
 * reportView.js — Relatório do quadro (modal do botão de quadro).
 *
 * ABAS: Geral · Semanal · Mensal · Por sessão. O agrupamento por semana/mês é
 * automático pelo calendário (semana ISO, começa na segunda) — o usuário não
 * informa datas. Toda a matemática vem do módulo puro `report.js`; aqui só
 * buscamos os dados e desenhamos.
 *
 * COMO LÊ O TEMPO DE CADA CARD
 * ----------------------------
 * Contexto de QUADRO. O estado de cada card é lido passando o ID do card como
 * escopo no `t.get` (a doc lista "o ID de um card do quadro" como escopo válido)
 * — uma leitura por card. Depois, `buildReport` aplica as mesmas funções puras
 * do card, então os números do relatório batem com o verso de cada card.
 * Tudo client-side: sem backend, sem token. (Leitura em massa real exigiria a
 * REST API `GET /boards/{id}/pluginData` + backend + token — V2.)
 */

import { getConfig } from '../services/storage.js';
import { normalize, Status } from '../services/tracker.js';
import { buildReport } from '../services/report.js';
import { toCsv } from '../services/exporter.js';
import { formatDuration, formatDateTime, now } from '../utils/time.js';
import { el, clear } from '../utils/dom.js';

const t = window.TrelloPowerUp.iframe();

const STATUS_LABEL = {
  idle: 'Aguardando', running: 'Em andamento', paused: 'Pausado', done: 'Concluído',
};

const TABS = [
  { id: 'geral', label: 'Geral' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'mensal', label: 'Mensal' },
  { id: 'sessoes', label: 'Por sessão' },
];

let MODEL = null;             // { report, config }
let activeTab = 'geral';
let includeUntracked = false; // só afeta a aba Geral

const fmt = (ms) => formatDuration(ms, MODEL.config.timeFormat);

// -- exportação ------------------------------------------------------------

function csvForTab() {
  const r = MODEL.report;
  if (activeTab === 'geral') {
    const rows = (includeUntracked ? r.general : r.general.filter((x) => x.tracked)).map((x) => [
      x.card, x.lista, STATUS_LABEL[x.status],
      x.inicio ? formatDateTime(x.inicio) : '', x.conclusao ? formatDateTime(x.conclusao) : '',
      x.days, x.sessions, fmt(x.effectiveMs), x.effectiveMs,
    ]);
    return toCsv(['Card', 'Lista', 'Status', 'Início', 'Conclusão', 'Dias', 'Sessões', 'Tempo efetivo', 'Tempo (ms)'], rows);
  }
  if (activeTab === 'sessoes') {
    const rows = r.sessions.map((s) => [
      s.card, formatDateTime(s.startedAt), s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)',
      s.days, fmt(s.effectiveMs), s.effectiveMs,
    ]);
    return toCsv(['Card', 'Início', 'Fim', 'Dias', 'Tempo', 'Tempo (ms)'], rows);
  }
  // semanal / mensal
  const periods = activeTab === 'semanal' ? r.weekly : r.monthly;
  const head = activeTab === 'semanal' ? 'Semana' : 'Mês';
  const rows = [];
  for (const p of periods) {
    for (const row of p.rows) rows.push([p.label, row.card, row.days, row.sessions, fmt(row.effectiveMs), row.effectiveMs]);
  }
  return toCsv([head, 'Card', 'Dias', 'Sessões', 'Tempo', 'Tempo (ms)'], rows);
}

function downloadCsv(filename, text) {
  try {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    return true;
  } catch (e) { return false; }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = el('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) { return false; }
  }
}

function flash(btn, msg, ms = 1600) {
  const original = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, ms);
}

// -- helpers de tabela -----------------------------------------------------

function th(text, cls) { return el('th', cls ? { class: cls, text } : { text }); }
function td(text, cls) { return el('td', cls ? { class: cls, text } : { text }); }

function statusChip(status) {
  return el('span', { class: `tt-badge-mini st-${status}`, text: STATUS_LABEL[status] });
}

function tableEl(headCells, bodyRows, footCells) {
  const parts = [el('thead', {}, el('tr', {}, headCells)), el('tbody', {}, bodyRows)];
  if (footCells) parts.push(el('tfoot', {}, el('tr', {}, footCells)));
  return el('table', { class: 'tt-table' }, parts);
}

// -- abas ------------------------------------------------------------------

function renderGeral() {
  const rows = includeUntracked ? MODEL.report.general : MODEL.report.general.filter((x) => x.tracked);
  if (rows.length === 0) {
    return el('div', { class: 'tt-report-empty', text: 'Nenhum card com tempo registrado ainda. Mova um card para a lista de início (ou clique em "Iniciar") para começar.' });
  }
  const totalMs = rows.reduce((a, r) => a + r.effectiveMs, 0);
  const body = rows.map((r) => el('tr', {}, [
    td(r.card, 'tt-td-card'), td(r.lista),
    el('td', {}, statusChip(r.status)),
    td(r.inicio ? formatDateTime(r.inicio) : '—', 'nowrap'),
    td(r.conclusao ? formatDateTime(r.conclusao) : '—', 'nowrap'),
    td(String(r.days), 'num'), td(String(r.sessions), 'num'), td(fmt(r.effectiveMs), 'num'),
  ]));
  const foot = [td('Total'), td(''), td(''), td(''), td(''), td('', 'num'), td('', 'num'), td(fmt(totalMs), 'num')];
  const head = [th('Card'), th('Lista'), th('Status'), th('Início'), th('Conclusão'), th('Dias', 'num'), th('Sessões', 'num'), th('Tempo', 'num')];
  return el('div', { class: 'tt-scroll' }, tableEl(head, body, foot));
}

function renderSessoes() {
  const rows = MODEL.report.sessions;
  if (rows.length === 0) return el('div', { class: 'tt-report-empty', text: 'Nenhuma sessão registrada ainda.' });
  const body = rows.map((s) => el('tr', {}, [
    td(s.card, 'tt-td-card'),
    td(formatDateTime(s.startedAt), 'nowrap'),
    td(s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)', 'nowrap'),
    td(String(s.days), 'num'), td(fmt(s.effectiveMs), 'num'),
  ]));
  const head = [th('Card'), th('Início'), th('Fim'), th('Dias', 'num'), th('Tempo', 'num')];
  return el('div', { class: 'tt-scroll' }, tableEl(head, body));
}

function renderPeriods(periods, periodWord) {
  if (periods.length === 0) return el('div', { class: 'tt-report-empty', text: `Nenhum registro ${periodWord} ainda.` });
  const wrap = el('div', { class: 'tt-scroll' });
  for (const p of periods) {
    const head = [th('Card'), th('Dias', 'num'), th('Sessões', 'num'), th('Tempo', 'num')];
    const body = p.rows.map((r) => el('tr', {}, [
      td(r.card, 'tt-td-card'), td(String(r.days), 'num'), td(String(r.sessions), 'num'), td(fmt(r.effectiveMs), 'num'),
    ]));
    const foot = [td('Total do período'), td(String(p.totalDays), 'num'), td(String(p.totalSessions), 'num'), td(fmt(p.totalMs), 'num')];
    wrap.appendChild(el('div', { class: 'tt-period' }, [
      el('div', { class: 'tt-period-head' }, [
        el('span', { class: 'tt-period-title', text: p.label }),
        el('span', { class: 'tt-period-sum', text: fmt(p.totalMs) }),
      ]),
      tableEl(head, body, foot),
    ]));
  }
  return wrap;
}

function renderBody() {
  switch (activeTab) {
    case 'semanal': return renderPeriods(MODEL.report.weekly, 'semanal');
    case 'mensal': return renderPeriods(MODEL.report.monthly, 'mensal');
    case 'sessoes': return renderSessoes();
    case 'geral':
    default: return renderGeral();
  }
}

function render() {
  const root = document.getElementById('app');
  clear(root);
  const { totals } = MODEL.report;

  // --- barra: resumo + ações ---
  const summary = el('div', {
    class: 'tt-report-summary',
    text: `${totals.trackedCount} card(s) com tempo · ${totals.visibleCount} visível(is) · total ${fmt(totals.totalMs)}`,
  });
  const btnCsv = el('button', {
    class: 'tt-btn is-primary', text: 'Baixar CSV',
    onclick: async () => {
      const name = `relatorio-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
      if (downloadCsv(name, csvForTab())) return;
      const ok = await copyText(csvForTab());
      flash(btnCsv, ok ? 'Copiado! (cole na planilha)' : 'Use "Copiar"', 2200);
    },
  });
  const btnCopy = el('button', {
    class: 'tt-btn', text: 'Copiar',
    onclick: async () => { const ok = await copyText(csvForTab()); flash(btnCopy, ok ? 'Copiado!' : 'Falhou'); },
  });
  const toolbar = el('div', { class: 'tt-report-toolbar' }, [
    summary,
    el('div', { class: 'tt-report-actions' }, [btnCopy, btnCsv]),
  ]);
  root.appendChild(toolbar);

  // --- abas ---
  const tabBar = el('div', { class: 'tt-tabs' }, TABS.map((tab) => el('button', {
    class: `tt-tab${tab.id === activeTab ? ' is-active' : ''}`,
    text: tab.label,
    onclick: () => { activeTab = tab.id; render(); },
  })));
  root.appendChild(tabBar);

  // --- toggle "incluir cards sem tempo" (só na Geral) ---
  if (activeTab === 'geral') {
    const chk = el('input', { type: 'checkbox' });
    chk.checked = includeUntracked;
    chk.addEventListener('change', () => { includeUntracked = chk.checked; render(); });
    root.appendChild(el('label', { class: 'tt-check tt-report-toggle' }, [chk, ' Incluir cards sem tempo']));
  }

  // --- conteúdo da aba ---
  root.appendChild(renderBody());
  t.sizeTo('#app').catch(() => {});
}

// -- boot ------------------------------------------------------------------

async function boot() {
  const root = document.getElementById('app');
  try {
    const config = await getConfig(t);
    const [cards, lists] = await Promise.all([
      t.cards('id', 'name', 'idList'),
      t.lists('id', 'name'),
    ]);
    const listName = new Map(lists.map((l) => [l.id, l.name]));
    const states = await Promise.all(
      cards.map((c) => t.get(c.id, 'shared', 'tt').catch(() => null)),
    );
    const withState = cards.map((c, i) => ({
      name: c.name,
      lista: listName.get(c.idList) || '—',
      state: normalize(states[i] || null),
    }));
    MODEL = { report: buildReport(withState, now(), config), config };
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
