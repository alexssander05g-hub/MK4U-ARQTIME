/**
 * reportView.js — Relatório do quadro (modal do botão de quadro).
 *
 * ABAS: Geral · Semanal · Mensal · Por sessão. Agrupamento semanal/mensal
 * automático pelo calendário (semana ISO, começa na segunda).
 *
 * FILTRO POR MEMBRO
 * -----------------
 * Um seletor no topo filtra TODAS as abas (e o CSV) pelos cards em que a pessoa
 * está ATRIBUÍDA (os avatares do card). Isso NÃO é "tempo por pessoa": um card
 * tem um cronômetro só, compartilhado — o filtro apenas restringe QUAIS cards
 * entram. Os nomes vêm dos próprios cards (t.cards(...,'members')), client-side.
 *
 * TEMPO PAUSADO
 * -------------
 * Quando a configuração conta pausas, o relatório mostra a coluna "Pausado"
 * além do tempo efetivo — como no verso do card.
 *
 * COMO LÊ O ESTADO DE CADA CARD
 * -----------------------------
 * Contexto de QUADRO: lê passando o ID do card como escopo no `t.get` (uma
 * leitura por card). `buildReport` usa as mesmas funções puras do card, então
 * os números batem. Client-side; leitura em massa real seria REST API + token.
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

let MODEL = null;             // { allCards, members, config, at }
let activeTab = 'geral';
let includeUntracked = false; // só afeta a aba Geral
let selectedMemberId = '';    // '' = todos

const fmt = (ms) => formatDuration(ms, MODEL.config.timeFormat);
const showPaused = () => !!MODEL.config.countPauses;

// -- relatório filtrado (memoizado por membro) -----------------------------

let _cacheId = null;
let _cacheReport = null;
function getReport() {
  if (_cacheReport && _cacheId === selectedMemberId) return _cacheReport;
  const filtered = selectedMemberId
    ? MODEL.allCards.filter((c) => c.memberIds.has(selectedMemberId))
    : MODEL.allCards;
  _cacheReport = buildReport(
    filtered.map((c) => ({ name: c.name, lista: c.lista, state: c.state })),
    MODEL.at, MODEL.config,
  );
  _cacheId = selectedMemberId;
  return _cacheReport;
}

// -- exportação ------------------------------------------------------------

function csvForTab() {
  const r = getReport();
  const paused = showPaused();
  if (activeTab === 'geral') {
    const head = ['Card', 'Lista', 'Status', 'Início', 'Conclusão', 'Dias', 'Sessões',
      ...(paused ? ['Pausado'] : []), 'Tempo efetivo', 'Tempo (ms)'];
    const rows = (includeUntracked ? r.general : r.general.filter((x) => x.tracked)).map((x) => [
      x.card, x.lista, STATUS_LABEL[x.status],
      x.inicio ? formatDateTime(x.inicio) : '', x.conclusao ? formatDateTime(x.conclusao) : '',
      x.days, x.sessions, ...(paused ? [fmt(x.pausedMs)] : []), fmt(x.effectiveMs), x.effectiveMs,
    ]);
    return toCsv(head, rows);
  }
  if (activeTab === 'sessoes') {
    const head = ['Card', 'Início', 'Fim', 'Dias', ...(paused ? ['Pausado'] : []), 'Tempo', 'Tempo (ms)'];
    const rows = r.sessions.map((s) => [
      s.card, formatDateTime(s.startedAt), s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)',
      s.days, ...(paused ? [fmt(s.pausedMs)] : []), fmt(s.effectiveMs), s.effectiveMs,
    ]);
    return toCsv(head, rows);
  }
  const periods = activeTab === 'semanal' ? r.weekly : r.monthly;
  const label = activeTab === 'semanal' ? 'Semana' : 'Mês';
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
function statusChip(status) { return el('span', { class: `tt-badge-mini st-${status}`, text: STATUS_LABEL[status] }); }

function tableEl(headCells, bodyRows, footCells) {
  const parts = [el('thead', {}, el('tr', {}, headCells)), el('tbody', {}, bodyRows)];
  if (footCells) parts.push(el('tfoot', {}, el('tr', {}, footCells)));
  return el('table', { class: 'tt-table' }, parts);
}

// -- abas ------------------------------------------------------------------

function renderGeral(r) {
  const paused = showPaused();
  const rows = includeUntracked ? r.general : r.general.filter((x) => x.tracked);
  if (rows.length === 0) {
    return el('div', { class: 'tt-report-empty', text: 'Nenhum card com tempo para este filtro.' });
  }
  const totalMs = rows.reduce((a, x) => a + x.effectiveMs, 0);
  const totalPaused = rows.reduce((a, x) => a + x.pausedMs, 0);
  const body = rows.map((x) => el('tr', {}, [
    td(x.card, 'tt-td-card'), td(x.lista),
    el('td', {}, statusChip(x.status)),
    td(x.inicio ? formatDateTime(x.inicio) : '—', 'nowrap'),
    td(x.conclusao ? formatDateTime(x.conclusao) : '—', 'nowrap'),
    td(String(x.days), 'num'), td(String(x.sessions), 'num'),
    ...(paused ? [td(fmt(x.pausedMs), 'num')] : []),
    td(fmt(x.effectiveMs), 'num'),
  ]));
  const foot = [td('Total'), td(''), td(''), td(''), td(''), td('', 'num'), td('', 'num'),
    ...(paused ? [td(fmt(totalPaused), 'num')] : []), td(fmt(totalMs), 'num')];
  const head = [th('Card'), th('Lista'), th('Status'), th('Início'), th('Conclusão'),
    th('Dias', 'num'), th('Sessões', 'num'), ...(paused ? [th('Pausado', 'num')] : []), th('Tempo', 'num')];
  return el('div', { class: 'tt-scroll' }, tableEl(head, body, foot));
}

function renderSessoes(r) {
  const paused = showPaused();
  const rows = r.sessions;
  if (rows.length === 0) return el('div', { class: 'tt-report-empty', text: 'Nenhuma sessão para este filtro.' });
  const body = rows.map((s) => el('tr', {}, [
    td(s.card, 'tt-td-card'),
    td(formatDateTime(s.startedAt), 'nowrap'),
    td(s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)', 'nowrap'),
    td(String(s.days), 'num'),
    ...(paused ? [td(fmt(s.pausedMs), 'num')] : []),
    td(fmt(s.effectiveMs), 'num'),
  ]));
  const head = [th('Card'), th('Início'), th('Fim'), th('Dias', 'num'),
    ...(paused ? [th('Pausado', 'num')] : []), th('Tempo', 'num')];
  return el('div', { class: 'tt-scroll' }, tableEl(head, body));
}

function renderPeriods(periods, periodWord) {
  const paused = showPaused();
  if (periods.length === 0) return el('div', { class: 'tt-report-empty', text: `Nenhum registro ${periodWord} para este filtro.` });
  const wrap = el('div', { class: 'tt-scroll' });
  for (const p of periods) {
    const head = [th('Card'), th('Dias', 'num'), th('Sessões', 'num'),
      ...(paused ? [th('Pausado', 'num')] : []), th('Tempo', 'num')];
    const body = p.rows.map((row) => el('tr', {}, [
      td(row.card, 'tt-td-card'), td(String(row.days), 'num'), td(String(row.sessions), 'num'),
      ...(paused ? [td(fmt(row.pausedMs), 'num')] : []), td(fmt(row.effectiveMs), 'num'),
    ]));
    const foot = [td('Total do período'), td(String(p.totalDays), 'num'), td(String(p.totalSessions), 'num'),
      ...(paused ? [td(fmt(p.totalPausedMs), 'num')] : []), td(fmt(p.totalMs), 'num')];
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

function renderBody(r) {
  switch (activeTab) {
    case 'semanal': return renderPeriods(r.weekly, 'semanal');
    case 'mensal': return renderPeriods(r.monthly, 'mensal');
    case 'sessoes': return renderSessoes(r);
    case 'geral':
    default: return renderGeral(r);
  }
}

function render() {
  const root = document.getElementById('app');
  clear(root);
  const r = getReport();

  // --- barra: resumo + filtro de membro + ações ---
  const summary = el('div', {
    class: 'tt-report-summary',
    text: `${r.totals.trackedCount} card(s) com tempo · ${r.totals.visibleCount} no filtro · total ${fmt(r.totals.totalMs)}`,
  });

  const memberSelect = el('select', { class: 'tt-select' });
  memberSelect.appendChild(el('option', { value: '', text: 'Todos os membros' }));
  for (const m of MODEL.members) {
    const opt = el('option', { value: m.id, text: m.name });
    if (m.id === selectedMemberId) opt.selected = true;
    memberSelect.appendChild(opt);
  }
  memberSelect.value = selectedMemberId;
  memberSelect.addEventListener('change', () => { selectedMemberId = memberSelect.value; render(); });

  const btnCsv = el('button', {
    class: 'tt-btn is-primary', text: 'Baixar CSV',
    onclick: async () => {
      const who = selectedMemberId ? '-' + (MODEL.members.find((m) => m.id === selectedMemberId) || {}).id : '';
      const name = `relatorio-${activeTab}${who}-${new Date().toISOString().slice(0, 10)}.csv`;
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
    el('div', { class: 'tt-report-meta' }, [summary, memberSelect]),
    el('div', { class: 'tt-report-actions' }, [btnCopy, btnCsv]),
  ]);
  root.appendChild(toolbar);

  // --- abas ---
  root.appendChild(el('div', { class: 'tt-tabs' }, TABS.map((tab) => el('button', {
    class: `tt-tab${tab.id === activeTab ? ' is-active' : ''}`,
    text: tab.label,
    onclick: () => { activeTab = tab.id; render(); },
  }))));

  // --- toggle "incluir cards sem tempo" (só na Geral) ---
  if (activeTab === 'geral') {
    const chk = el('input', { type: 'checkbox' });
    chk.checked = includeUntracked;
    chk.addEventListener('change', () => { includeUntracked = chk.checked; render(); });
    root.appendChild(el('label', { class: 'tt-check tt-report-toggle' }, [chk, ' Incluir cards sem tempo']));
  }

  root.appendChild(renderBody(r));
  t.sizeTo('#app').catch(() => {});
}

// -- boot ------------------------------------------------------------------

async function boot() {
  const root = document.getElementById('app');
  try {
    const config = await getConfig(t);
    const [cards, lists] = await Promise.all([
      t.cards('id', 'name', 'idList', 'members'),
      t.lists('id', 'name'),
    ]);
    const listName = new Map(lists.map((l) => [l.id, l.name]));
    const states = await Promise.all(
      cards.map((c) => t.get(c.id, 'shared', 'tt').catch(() => null)),
    );

    // membros: união dos atribuídos aos cards (id -> nome)
    const memberName = new Map();
    const allCards = cards.map((c, i) => {
      const members = Array.isArray(c.members) ? c.members : [];
      const memberIds = new Set();
      for (const m of members) {
        memberIds.add(m.id);
        if (!memberName.has(m.id)) memberName.set(m.id, m.fullName || m.username || m.id);
      }
      return {
        name: c.name,
        lista: listName.get(c.idList) || '—',
        state: normalize(states[i] || null),
        memberIds,
      };
    });
    const members = Array.from(memberName, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    MODEL = { allCards, members, config, at: now() };
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
