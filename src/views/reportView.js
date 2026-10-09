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

import { getConfig, saveConfig, saveCardStateById } from '../services/storage.js';
import { normalize, Status, computeTotals } from '../services/tracker.js';
import { buildReport, timeByMember, creationMsFromId, concludedByMember, bonusFor, daysSummary, daysSummaryMonth, labelCounts } from '../services/report.js';
import { toCsv } from '../services/exporter.js';
import { formatDuration, formatDateTime, now } from '../utils/time.js';
import { el, clear } from '../utils/dom.js';

const t = window.TrelloPowerUp.iframe();

const STATUS_LABEL = {
  idle: 'Aguardando', running: 'Em andamento', paused: 'Pausado', done: 'Concluído',
};

const TABS = [
  { id: 'geral', label: 'Geral' },
  { id: 'painel', label: 'Relatório' },
  { id: 'semanal', label: 'Semanal' },
  { id: 'mensal', label: 'Mensal' },
  { id: 'sessoes', label: 'Por sessão' },
  // OCULTO por enquanto — reativar removendo o comentário desta linha:
  // { id: 'bonificacao', label: 'Bonificação' },
];

let MODEL = null;             // { allCards, members, labels, memberName, config, at }
let activeTab = 'geral';
let includeUntracked = true; // mostra cards em fila (sem tempo) por padrão, com sua idade
let selectedMemberId = '';
let selectedLabelId = '';
let listFilter = null; // null = todas as listas; senão Set de idList incluídos
let listOpen = false;  // painel de seleção de listas aberto?
let searchText = '';
let bonifMonth = ''; // mês selecionado na aba Bonificação
let daysPeriodSel = { semanal: null, mensal: null }; // período escolhido no Resumo de dias ('__all__' = todos)
let viewMode = 'detalhada'; // 'detalhada' (tudo) | 'final' (só o relatório final programado)

// Etiquetas-chave do RELATÓRIO FINAL (quantitativo por etiqueta). Fácil de editar/ampliar.
const KPI_LABELS = [
  'alteração de prospecção própria',
  'rj',
  'sp',
  'nacional',
  'container',
  'franqueado pagante',
];
let sortState = { col: null, dir: 'desc' };
let keepFocus = false;
let restorePending = null; // backup carregado aguardando confirmação do usuário
const BACKUP_WARN_DAYS = 7; // avisa para fazer backup depois de N dias sem backup

// Seções que entram no "Relatório (HTML)" — todas marcadas por padrão.
const HTML_SECTIONS = [
  { id: 'graficos', label: 'Gráficos de tempo (barras)' },
  { id: 'linha', label: 'Gráfico de linha (tendência de dias)' },
  { id: 'geral', label: 'Geral (tabela por card)' },
  { id: 'resumoDias', label: 'Resumo de dias (histograma)' },
  { id: 'semanal', label: 'Semanal (tabelas)' },
  { id: 'mensal', label: 'Mensal (tabelas)' },
  { id: 'sessoes', label: 'Por sessão' },
  { id: 'membro', label: 'Por membro' },
  // OCULTO por enquanto — reativar removendo o comentário desta linha:
  // { id: 'bonificacao', label: 'Bonificação' },
];
const htmlSections = { graficos: true, linha: true, geral: true, resumoDias: true, semanal: true, mensal: true, sessoes: true, membro: true, bonificacao: false };

const fmt = (ms) => formatDuration(ms, MODEL.config.timeFormat);
const showPaused = () => !!MODEL.config.countPauses;
const matchesSearch = (name) => !searchText || name.toLowerCase().includes(searchText.toLowerCase());

// -- filtro + relatório (memoizado por membro+etiqueta) --------------------

function filteredCards() {
  return MODEL.allCards.filter((c) =>
    (!selectedMemberId || c.memberIds.has(selectedMemberId)) &&
    (!selectedLabelId || c.labelIds.has(selectedLabelId)) &&
    (!listFilter || listFilter.has(c.idList)));
}

/** Chave de cache dos filtros (membro + etiqueta + listas). */
function filterKey() {
  const listKey = listFilter ? Array.from(listFilter).sort().join(',') : 'all';
  return `${selectedMemberId}|${selectedLabelId}|${listKey}`;
}

/**
 * Data REAL de conclusão de um card (ms), ou null se não concluído.
 * Prioriza o carimbo gravado pelo Power-Up (state.completedAt); se não houver,
 * usa o fim real do tracker (lastEnd) quando o card foi finalizado por ele.
 * NÃO usa mais dateLastActivity (que se movia a cada atividade e inflava a conta).
 */
function completedMs(c) {
  const st = c && c.state;
  if (st && Number.isFinite(st.completedAt)) return st.completedAt;
  if (st && st.status === Status.DONE) {
    const le = computeTotals(st, MODEL.at, MODEL.config).lastEnd;
    if (Number.isFinite(le)) return le;
  }
  return null;
}

let _cacheKey = null;
let _cacheReport = null;
function getReport() {
  const key = filterKey();
  if (_cacheReport && _cacheKey === key) return _cacheReport;
  _cacheReport = buildReport(
    filteredCards().map((c) => ({
      name: c.name, lista: c.lista, state: c.state, createdAt: c.createdAt,
      dueComplete: c.dueComplete, dateLastActivity: c.dateLastActivity, labels: c.labelNames,
    })),
    MODEL.at, MODEL.config,
  );
  _cacheKey = key;
  return _cacheReport;
}

let _cacheDaysKey = null;
let _cacheDays = null;
function getDaysSummary() {
  const key = filterKey();
  if (_cacheDays && _cacheDaysKey === key) return _cacheDays;
  _cacheDays = daysSummary(
    filteredCards().map((c) => ({ createdAt: c.createdAt, completedAt: completedMs(c) })),
    MODEL.at, MODEL.config,
  );
  _cacheDaysKey = key;
  return _cacheDays;
}

let _cacheDMKey = null;
let _cacheDM = null;
function getDaysSummaryMonth() {
  const key = filterKey();
  if (_cacheDM && _cacheDMKey === key) return _cacheDM;
  _cacheDM = daysSummaryMonth(
    filteredCards().map((c) => ({ createdAt: c.createdAt, completedAt: completedMs(c) })),
    MODEL.at, MODEL.config,
  );
  _cacheDMKey = key;
  return _cacheDM;
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
    const head = ['Card', 'Lista', 'Etiquetas', 'Status', 'Início', 'Conclusão', 'Idade (dias)', 'Sessões',
      ...(paused ? ['Pausado'] : []), 'Tempo efetivo', 'Tempo (ms)'];
    const rows = (includeUntracked ? r.general : r.general.filter((x) => x.tracked)).map((x) => [
      x.card, x.lista, (x.labels || []).join(', '), STATUS_LABEL[x.status],
      x.inicio ? formatDateTime(x.inicio) : '', x.conclusao ? formatDateTime(x.conclusao) : '',
      x.days, x.sessions, ...(paused ? [fmt(x.pausedMs)] : []), fmt(x.effectiveMs), x.effectiveMs,
    ]);
    return toCsv(head, rows);
  }
  if (tabId === 'sessoes') {
    const head = ['Card', 'Início', 'Fim', 'Dias ativos', ...(paused ? ['Pausado'] : []), 'Tempo', 'Tempo (ms)'];
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
  if (tabId === 'bonificacao') {
    const all = concludedByMember(filteredCards(), MODEL.at, MODEL.config);
    const month = (bonifMonth && all.months.indexOf(bonifMonth) !== -1) ? bonifMonth : (all.months[0] || '');
    const data = concludedByMember(filteredCards(), MODEL.at, MODEL.config, month);
    const nm = (id) => MODEL.memberName.get(id) || id;
    const metas = MODEL.config.metas || {};
    const totalBy = new Map(data.rows.map((r) => [r.memberId, r]));
    const head = ['Membro', ...data.weeks.map((w) => weekShort(w.label)),
      'Entregue', 'Meta mín', 'Meta máx', 'Meta sem', 'Bonificação (R$)'];
    const rows = MODEL.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((m) => {
      const r = totalBy.get(m.id); const entregue = r ? r.total : 0; const meta = metas[m.id] || {};
      const b = bonusFor(entregue, metas[m.id]); const wm = weeklyMetaOf(metas[m.id]);
      return [nm(m.id), ...data.weeks.map((w) => (r ? (r.perWeek[w.key] || 0) : 0)), entregue,
        meta.min == null ? '' : meta.min, meta.max == null ? '' : meta.max,
        wm == null ? '' : wm, b == null ? '' : b];
    });
    return toCsv(head, rows);
  }
  const periods = tabId === 'semanal' ? r.weekly : r.monthly;
  const label = tabId === 'semanal' ? 'Semana' : 'Mês';
  const head = [label, 'Card', 'Dias ativos', 'Sessões', ...(paused ? ['Pausado'] : []), 'Tempo', 'Tempo (ms)'];
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
    // OCULTO por enquanto — reativar removendo o comentário: sec('BONIFICAÇÃO', 'bonificacao'),
  ].join('\r\n\r\n');
}

function downloadBlob(filename, text, mime, bom) {
  try {
    const blob = new Blob([(bom ? '\uFEFF' : '') + text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    return true;
  } catch (e) { return false; }
}
function downloadCsv(filename, text) { return downloadBlob(filename, text, 'text/csv;charset=utf-8;', true); }

// -- backup / restauração (proteção contra perda de dados) ----------------
// O Trello apaga TODOS os dados do Power-Up se ele for desativado sem "manter
// dados". Por isso a cópia de segurança fica FORA do Trello: um arquivo .json
// no computador, que a restauração reescreve de volta nos cards.

/** Monta o objeto de backup com todos os cards que têm tempo registrado. */
function buildBackup() {
  const cards = MODEL.allCards
    .filter((c) => c.state && c.state.status !== Status.IDLE)
    .map((c) => ({ id: c.id, name: c.name, state: c.state }));
  return {
    app: 'controle-de-tempo', version: 1, exportedAt: Date.now(),
    boardId: MODEL.boardId || '', boardName: MODEL.boardName || '',
    count: cards.length, cards,
  };
}

async function doBackup(btn) {
  const data = buildBackup();
  if (data.count === 0) { flash(btn, 'Nada para salvar'); return; }
  const name = `backup-controle-tempo-${new Date().toISOString().slice(0, 10)}.json`;
  const ok = downloadBlob(name, JSON.stringify(data, null, 2), 'application/json;charset=utf-8;', false);
  if (!ok) { flash(btn, 'Download bloqueado', 2200); return; }
  try { // marca a data; se o Power-Up for desativado some, e o aviso volta
    const nextCfg = { ...MODEL.config, lastBackupAt: Date.now() };
    await saveConfig(t, nextCfg); MODEL.config = nextCfg;
  } catch (e) { /* não impede o backup */ }
  flash(btn, 'Backup salvo!');
  render();
}

/** Lê e valida o arquivo escolhido; guarda em restorePending para confirmar. */
async function handleRestoreFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch (e) { restorePending = { error: 'Arquivo inválido (não é um JSON).' }; render(); return; }
  const cards = data && Array.isArray(data.cards) ? data.cards : null;
  if (!cards || !cards.length) { restorePending = { error: 'Backup vazio ou em formato desconhecido.' }; render(); return; }
  const validIds = new Set(MODEL.allCards.map((c) => c.id));
  const match = cards.filter((c) => c && c.id && validIds.has(c.id));
  restorePending = { cards: match, skipped: cards.length - match.length, total: cards.length, exportedAt: data.exportedAt || null };
  render();
}

/** Reescreve os estados do backup nos cards (em lotes), com progresso. */
async function doRestore(statusEl) {
  const items = restorePending && restorePending.cards ? restorePending.cards : [];
  if (!items.length) { restorePending = null; render(); return; }
  let next = 0; let done = 0; let fail = 0;
  const setTxt = (txt) => { if (statusEl) statusEl.textContent = txt; };
  async function worker() {
    while (next < items.length) {
      const i = next; next += 1;
      try { await saveCardStateById(t, items[i].id, normalize(items[i].state)); }
      catch (e) { fail += 1; }
      done += 1;
      if (done % 25 === 0 || done === items.length) setTxt(`Restaurando… ${done}/${items.length}`);
    }
  }
  setTxt(`Restaurando… 0/${items.length}`);
  await Promise.all(Array.from({ length: Math.min(30, items.length) }, worker));
  restorePending = null;
  setTxt(`Concluído: ${items.length - fail} restaurado(s)${fail ? `, ${fail} falhou(aram)` : ''}. Recarregando…`);
  await boot(); // recarrega os dados do quadro para refletir a restauração
}

/** Barra de backup/restauração + aviso, no topo do relatório. */
function backupBar() {
  const wrap = el('div', { style: 'margin:8px 0 4px;padding:10px 12px;border:1px solid #dfe1e6;border-radius:8px;background:#fafbfc' });

  const last = MODEL.config.lastBackupAt || null;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (last == null || days >= BACKUP_WARN_DAYS) {
    wrap.appendChild(el('div', {
      style: 'color:#974f0c;background:#fff7eb;border:1px solid #ffe2b8;padding:6px 10px;border-radius:6px;margin-bottom:8px;font-size:13px',
      text: last == null
        ? '⚠️ Você ainda não fez backup. Se o Power-Up for desativado, o Trello apaga os tempos dos cards. Faça um backup e guarde o arquivo.'
        : `⚠️ Último backup há ${days} dia(s). Recomendado fazer um novo.`,
    }));
  } else {
    wrap.appendChild(el('div', { style: 'color:#5e6c84;font-size:12px;margin-bottom:8px', text: `Último backup: ${formatDateTime(last)}.` }));
  }

  const btnBackup = el('button', { class: 'tt-btn is-primary', text: '⬇ Backup (.json)', onclick: () => doBackup(btnBackup) });
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileInput.addEventListener('change', () => { if (fileInput.files && fileInput.files[0]) handleRestoreFile(fileInput.files[0]); });
  const btnRestore = el('button', { class: 'tt-btn', text: '⬆ Restaurar backup', onclick: () => fileInput.click() });
  wrap.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [btnBackup, btnRestore, fileInput]));

  if (restorePending) {
    if (restorePending.error) {
      wrap.appendChild(el('div', { style: 'color:#ae2a19;margin-top:8px;font-size:13px', text: '❌ ' + restorePending.error }));
    } else {
      const statusEl = el('span', { style: 'font-size:12px;color:#5e6c84' });
      const when = restorePending.exportedAt ? ' de ' + formatDateTime(restorePending.exportedAt) : '';
      wrap.appendChild(el('div', { style: 'margin-top:10px;border-top:1px dashed #dfe1e6;padding-top:8px' }, [
        el('div', { style: 'font-size:13px;color:#172b4d;margin-bottom:8px',
          text: `Backup${when}: ${restorePending.cards.length} card(s) serão restaurados`
            + (restorePending.skipped ? ` (${restorePending.skipped} ignorado(s) — não existem neste quadro)` : '')
            + '. Isso SOBRESCREVE o tempo atual desses cards.' }),
        el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
          el('button', { class: 'tt-btn', text: 'Cancelar', onclick: () => { restorePending = null; render(); } }),
          el('button', { class: 'tt-btn is-danger', text: 'Confirmar restauração', onclick: () => doRestore(statusEl) }),
          statusEl,
        ]),
      ]));
    }
  }
  return wrap;
}

/** Fallback quando o download é bloqueado no iframe: abre o HTML em nova aba. */
function openInTab(html) {
  try {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.open(); w.document.write(html); w.document.close();
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

// -- relatório HTML autocontido (tabelas + gráficos; vira PDF via imprimir) --

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function barsHtml(title, items) {
  if (!items.length) return `<section class="chart"><h3>${esc(title)}</h3><p class="muted">Sem dados.</p></section>`;
  const max = items.reduce((m, i) => Math.max(m, i.value), 0) || 1;
  const rows = items.map((i) => (
    `<div class="bar"><span class="bl">${esc(i.label)}</span>`
    + `<span class="bt"><span class="bf" style="width:${Math.max(2, (i.value / max) * 100).toFixed(1)}%"></span></span>`
    + `<span class="bv">${esc(i.text)}</span></div>`
  )).join('');
  return `<section class="chart"><h3>${esc(title)}</h3>${rows}</section>`;
}

function tableHtml(headArr, rowArrs, footArr) {
  const head = `<tr>${headArr.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const body = rowArrs.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  const foot = footArr ? `<tfoot><tr>${footArr.map((c) => `<td>${esc(c)}</td>`).join('')}</tr></tfoot>` : '';
  return `<table><thead>${head}</thead><tbody>${body}</tbody>${foot}</table>`;
}

function daysBlockHtml(headLabel, dist, total, isGeral) {
  const head = `<div class="daysh">${esc(headLabel)}</div>`;
  if (!dist.length) return `<div class="daysc${isGeral ? ' geral' : ''}">${head}<p class="muted">Nenhum concluído.</p></div>`;
  const rows = dist.map((d) => `<div class="daysr"><span>${d.days}d</span><b>${d.count}</b></div>`).join('');
  return `<div class="daysc${isGeral ? ' geral' : ''}">${head}${rows}<div class="daysr dayst"><span>TOTAL</span><b>${total}</b></div></div>`;
}
function daysSectionHtml(dsum, kind) {
  const periods = kind === 'semanal' ? dsum.weekly : dsum.monthly;
  const blocks = periods.map((p) => daysBlockHtml(p.label, p.dist, p.total, false)).join('')
    + daysBlockHtml('Geral — todos os concluídos', dsum.general, dsum.generalTotal, true);
  return `<div class="daysgrid">${blocks}</div>`;
}

function buildHtmlReport(sections) {
  const r = getReport();
  const dsum = getDaysSummary();
  const paused = showPaused();
  const now_ = new Date();

  // filtros ativos (texto)
  const filterBits = [];
  if (selectedMemberId) filterBits.push('Membro: ' + (MODEL.memberName.get(selectedMemberId) || selectedMemberId));
  if (selectedLabelId) {
    const lbl = MODEL.labels.find((l) => l.id === selectedLabelId);
    filterBits.push('Etiqueta: ' + (lbl ? lbl.name : selectedLabelId));
  }
  const filterLine = filterBits.length ? filterBits.join(' · ') : 'Todos os cards';

  // gráficos
  const top = r.general.filter((x) => x.tracked).slice(0, 10)
    .map((x) => ({ label: x.card, value: x.effectiveMs, text: fmt(x.effectiveMs) }));
  const weeks = r.weekly.slice().reverse().map((p) => ({ label: p.label.split(' · ')[0], value: p.totalMs, text: fmt(p.totalMs) }));
  const months = r.monthly.slice().reverse().map((p) => ({ label: p.label, value: p.totalMs, text: fmt(p.totalMs) }));
  const byMember = timeByMember(filteredCards(), MODEL.at, MODEL.config)
    .map((m) => ({ label: MODEL.memberName.get(m.memberId) || m.memberId, value: m.effectiveMs, text: fmt(m.effectiveMs) }));

  const lineHtml = (title, pts) => `<section class="chart chart-wide"><h3>${esc(title)}</h3>${lineChartSvg(pts)}</section>`;
  const barCharts = [
    barsHtml('Top cards por tempo', top),
    barsHtml('Tempo por semana', weeks),
    barsHtml('Tempo por mês', months),
    MODEL.members.length ? barsHtml('Tempo por membro', byMember) : '',
  ].join('');
  const lineCharts = [
    lineHtml('Média de dias por semana — concluídos', avgPoints(dsum.weekly, 'semanal')),
    lineHtml('Média de dias por mês — concluídos', avgPoints(dsum.monthly, 'mensal')),
  ].join('');

  // tabela Geral — respeita "Incluir cards sem tempo"
  const gGeneral = includeUntracked ? r.general : r.general.filter((x) => x.tracked);
  const gHead = ['Card', 'Lista', 'Etiquetas', 'Status', 'Início', 'Conclusão', 'Idade (dias)', 'Sessões', ...(paused ? ['Pausado'] : []), 'Tempo'];
  const gRows = gGeneral.map((x) => [
    x.card, x.lista, (x.labels || []).join(', '), STATUS_LABEL[x.status],
    x.inicio ? formatDateTime(x.inicio) : '—', x.conclusao ? formatDateTime(x.conclusao) : '—',
    x.days, x.sessions, ...(paused ? [fmt(x.pausedMs)] : []), fmt(x.effectiveMs),
  ]);
  const gTotal = gGeneral.reduce((a, x) => a + x.effectiveMs, 0);
  const gFoot = ['Total', '', '', '', '', '', '', '', ...(paused ? [''] : []), fmt(gTotal)];

  // períodos
  const periodTables = (periods, word) => (periods.length
    ? periods.map((p) => {
      const head = ['Card', 'Dias ativos', 'Sessões', ...(paused ? ['Pausado'] : []), 'Tempo'];
      const rows = p.rows.map((row) => [row.card, row.days, row.sessions, ...(paused ? [fmt(row.pausedMs)] : []), fmt(row.effectiveMs)]);
      const foot = ['Total do período', p.totalDays, p.totalSessions, ...(paused ? [fmt(p.totalPausedMs)] : []), fmt(p.totalMs)];
      return `<h3>${esc(p.label)}</h3>${tableHtml(head, rows, foot)}`;
    }).join('')
    : `<p class="muted">Nenhum registro ${word}.</p>`);

  // Por sessão
  const sHead = ['Card', 'Início', 'Fim', 'Dias ativos', ...(paused ? ['Pausado'] : []), 'Tempo'];
  const sRows = r.sessions.map((s) => [
    s.card, formatDateTime(s.startedAt), s.endedAt ? formatDateTime(s.endedAt) : '(em aberto)',
    s.days, ...(paused ? [fmt(s.pausedMs)] : []), fmt(s.effectiveMs),
  ]);

  // Por membro
  const mRows = byMember.map((m) => [m.label, m.text]);

  // Bonificação: cards concluídos por membro (mês selecionado) + metas e valor
  const allBonif = concludedByMember(filteredCards(), MODEL.at, MODEL.config);
  const bMonth = (bonifMonth && allBonif.months.indexOf(bonifMonth) !== -1) ? bonifMonth : (allBonif.months[0] || '');
  const bonif = bMonth ? concludedByMember(filteredCards(), MODEL.at, MODEL.config, bMonth) : { weeks: [], rows: [] };
  const bName = (id) => MODEL.memberName.get(id) || id;
  const bMetas = MODEL.config.metas || {};
  const bTotalBy = new Map(bonif.rows.map((r) => [r.memberId, r]));
  let bonifHtml;
  if (bMonth && MODEL.members.length) {
    const bChart = barsHtml('Cards concluídos por membro', bonif.rows.map((r) => ({ label: bName(r.memberId), value: r.total, text: String(r.total) })));
    const bHead = ['Membro', ...bonif.weeks.map((w) => weekShort(w.label)), 'Entregue', 'Meta mín', 'Meta máx', 'Meta sem.', 'Bonificação'];
    const bRows = MODEL.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((m) => {
      const r = bTotalBy.get(m.id); const entregue = r ? r.total : 0; const meta = bMetas[m.id] || {};
      const bonus = bonusFor(entregue, bMetas[m.id]); const wm = weeklyMetaOf(bMetas[m.id]);
      return [bName(m.id), ...bonif.weeks.map((w) => (r ? (r.perWeek[w.key] || 0) : 0)), entregue,
        meta.min == null ? '—' : meta.min, meta.max == null ? '—' : meta.max,
        wm == null ? '—' : wm, brl(bonus)];
    });
    bonifHtml = `<p class="muted">Mês: ${esc(monthLabelPt(bMonth))}</p>` + bChart + tableHtml(bHead, bRows);
  } else {
    bonifHtml = '<p class="muted">Nenhum card concluído com membro atribuído.</p>';
  }

  const style = `
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d;margin:0;padding:24px;max-width:900px;margin:0 auto;background:#fff}
    h1{font-size:20px;margin:0 0 4px}
    h2{font-size:15px;margin:26px 0 8px;border-bottom:2px solid #dfe1e6;padding-bottom:4px}
    h3{font-size:13px;margin:16px 0 6px;color:#42526e}
    .meta{color:#6b778c;font-size:12px;line-height:1.6;margin-bottom:8px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px}
    th,td{border:1px solid #dfe1e6;padding:5px 8px;text-align:left}
    th{background:#f4f5f7;color:#42526e;font-size:11px;text-transform:uppercase;letter-spacing:.3px}
    tfoot td{font-weight:700;background:#fafbfc}
    td:nth-child(n+7){text-align:right;font-variant-numeric:tabular-nums}
    .charts{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    .chart-wide{grid-column:1 / -1}
    .chart h3{margin-top:0}
    .bar{display:grid;grid-template-columns:38% 1fr auto;align-items:center;gap:8px;margin-bottom:5px}
    .bl{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bt{background:#f4f5f7;border-radius:6px;height:13px;overflow:hidden}
    .bf{display:block;background:#0079bf;height:100%;border-radius:6px}
    .bv{font-size:11px;color:#6b778c;white-space:nowrap;font-variant-numeric:tabular-nums}
    .muted{color:#6b778c;font-size:12px}
    .daysgrid{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 16px}
    .daysc{border:1px solid #dfe1e6;border-radius:8px;padding:10px 12px;min-width:170px}
    .daysc.geral{background:#f4f9ff;border-color:#b3d4ff}
    .daysh{font-weight:700;font-size:12px;margin-bottom:6px}
    .daysr{display:flex;justify-content:space-between;gap:16px;font-size:12px;padding:2px 0}
    .daysr.dayst{border-top:1px solid #dfe1e6;margin-top:5px;padding-top:5px;font-weight:700}
    @media print{
      .daysc{page-break-inside:avoid}
      body{padding:0}
      h2{page-break-after:avoid}
      table,.chart{page-break-inside:avoid}
      .charts{grid-template-columns:1fr 1fr}
    }`;

  const body = [];
  if (sections.graficos) body.push(`<h2>Gráficos — tempo</h2><div class="charts">${barCharts}</div>`);
  if (sections.linha) body.push(`<h2>Tendência de dias (média — concluídos)</h2><div class="charts">${lineCharts}</div>`);
  if (sections.geral) body.push(`<h2>Geral (por card)</h2>${tableHtml(gHead, gRows, gFoot)}`);
  if (sections.resumoDias) {
    const dsm = getDaysSummaryMonth();
    const weekBlocks = dsm.weeks.length
      ? dsm.weeks.map((w) => daysBlockHtml(w.label, w.dist, w.total, false)).join('')
      : '<p class="muted">Nenhum projeto concluído neste mês ainda.</p>';
    body.push(`<h2>Resumo de dias — ${esc(dsm.month.label)}</h2>`
      + `<h3>Por semana (mês atual)</h3><div class="daysgrid">${weekBlocks}</div>`
      + `<h3>Total do mês</h3><div class="daysgrid">${daysBlockHtml('Total — ' + dsm.month.label, dsm.month.dist, dsm.month.total, true)}</div>`);
  }
  if (sections.semanal) body.push(`<h2>Semanal</h2>${periodTables(r.weekly, 'semanal')}`);
  if (sections.mensal) body.push(`<h2>Mensal</h2>${periodTables(r.monthly, 'mensal')}`);
  if (sections.sessoes) body.push(`<h2>Por sessão</h2>${tableHtml(sHead, sRows)}`);
  if (sections.membro && MODEL.members.length) body.push(`<h2>Por membro</h2>${tableHtml(['Membro', 'Tempo'], mRows)}`);
  if (sections.bonificacao) body.push(`<h2>Bonificação — cards concluídos por membro</h2>${bonifHtml}`);
  if (body.length === 0) body.push('<p class="muted">Nenhuma seção selecionada.</p>');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">`
    + `<title>Relatório de Tempo</title><style>${style}</style></head><body>`
    + `<h1>Relatório de Tempo${MODEL.boardName ? ' — ' + esc(MODEL.boardName) : ''}</h1>`
    + `<div class="meta">Gerado em ${esc(formatDateTime(now_.getTime()))} · Filtro: ${esc(filterLine)}<br>`
    + `${r.totals.trackedCount} card(s) com tempo · ${r.totals.visibleCount} no filtro · Total do quadro: ${esc(fmt(r.totals.totalMs))}</div>`
    + `<p class="muted">Dica: para gerar um PDF, use Imprimir (Ctrl+P) e escolha "Salvar como PDF".</p>`
    + body.join('')
    + `</body></html>`;
}

// -- exportação (fim) ------------------------------------------------------

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

// -- gráfico de LINHA (média de dias por período) --------------------------

const MESES_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Média de dias (ponderada pela contagem) de uma distribuição {days,count}. */
function avgDays(dist, total) {
  if (!total) return 0;
  let s = 0; for (const d of dist) s += d.days * d.count;
  return s / total;
}
/** Rótulo curto do eixo X. Semana: data de início "dd/mm". Mês: "out/26". */
function periodShortLabel(p, kind) {
  if (kind === 'semanal') { const s = weekShort(p.label); return (s.split('–')[0] || s).trim(); }
  const [y, m] = p.key.split('-');
  return `${MESES_ABBR[Number(m) - 1] || m}/${String(y).slice(2)}`;
}
/** Converte períodos (desc) em pontos do gráfico em ordem cronológica (asc). */
function avgPoints(periods, kind) {
  return periods.slice().reverse()
    .map((p) => ({ label: periodShortLabel(p, kind), value: avgDays(p.dist, p.total), count: p.total }));
}

/** Gera o SVG (string) de um gráfico de linha de 1 série. */
function lineChartSvg(points) {
  if (!points.length) return '<div class="tt-report-empty">Sem projetos concluídos para o gráfico.</div>';
  const W = 680, H = 230, L = 42, R = 18, T = 16, B = 42;
  const pw = W - L - R, ph = H - T - B;
  const n = points.length;
  const maxV = Math.max(1, ...points.map((p) => p.value));
  const niceMax = Math.max(1, Math.ceil(maxV));
  const X = (i) => (n === 1 ? L + pw / 2 : L + (i * pw) / (n - 1));
  const Y = (v) => T + ph - (v / niceMax) * ph;
  const grid = [0, 0.5, 1].map((f) => {
    const v = niceMax * f; const y = Y(v);
    return `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" stroke="#ebecf0"/>`
      + `<text x="${L - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#97a0af">${v % 1 ? v.toFixed(1) : v.toFixed(0)}</text>`;
  }).join('');
  const poly = points.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => {
    const x = X(i), y = Y(p.value);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#0079bf"/>`
      + `<text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="10" fill="#172b4d">${p.value.toFixed(1)}</text>`;
  }).join('');
  const rot = n > 8;
  const yLab = H - B + 14;
  const xlabels = points.map((p, i) => {
    const x = X(i);
    const tr = rot ? ` transform="rotate(-35 ${x.toFixed(1)} ${yLab})"` : '';
    return `<text x="${x.toFixed(1)}" y="${yLab}" text-anchor="${rot ? 'end' : 'middle'}" font-size="10" fill="#5e6c84"${tr}>${esc(p.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" style="max-width:720px">`
    + `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" stroke="#dfe1e6"/>`
    + `<line x1="${L}" y1="${T + ph}" x2="${W - R}" y2="${T + ph}" stroke="#dfe1e6"/>`
    + `${grid}<polyline fill="none" stroke="#0079bf" stroke-width="2" points="${poly}"/>${dots}${xlabels}</svg>`;
}

/** Nó DOM com título + gráfico de linha. */
function lineChart(title, points) {
  const box = document.createElement('div');
  box.className = 'tt-chart';
  box.innerHTML = `<div class="tt-chart-title">${esc(title)}</div>${lineChartSvg(points)}`;
  return box;
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
    td((x.labels && x.labels.length) ? x.labels.join(', ') : '—'),
    el('td', {}, statusChip(x.status)),
    td(x.inicio ? formatDateTime(x.inicio) : '—', 'nowrap'),
    td(x.conclusao ? formatDateTime(x.conclusao) : '—', 'nowrap'),
    td(String(x.days), 'num'), td(String(x.sessions), 'num'),
    ...(paused ? [td(fmt(x.pausedMs), 'num')] : []), td(fmt(x.effectiveMs), 'num'),
  ]));
  const foot = [td('Total'), td(''), td(''), td(''), td(''), td(''), td('', 'num'), td('', 'num'),
    ...(paused ? [td(fmt(totalPaused), 'num')] : []), td(fmt(totalMs), 'num')];
  const head = [
    sortableTh('Card', 'card'), sortableTh('Lista', 'lista'), th('Etiquetas'), th('Status'),
    th('Início'), th('Conclusão'),
    sortableTh('Idade (dias)', 'dias', 'num'), sortableTh('Sessões', 'sessoes', 'num'),
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
  const head = [th('Card'), th('Início'), th('Fim'), th('Dias ativos', 'num'),
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
    const head = [th('Card'), th('Dias ativos', 'num'), th('Sessões', 'num'),
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

/**
 * MONTADOR DE RELATÓRIO (aba "Relatório"): marque as seções → preview ao vivo,
 * idêntico ao que sai no HTML → baixar / imprimir. Respeita os filtros de
 * membro/etiqueta do topo (o preview é gerado com buildHtmlReport, que usa os
 * mesmos dados filtrados).
 */
function renderBuilder() {
  const wrap = el('div', { class: 'tt-builder', style: 'padding:4px 2px' });

  const frame = el('iframe', {
    class: 'tt-preview-frame',
    style: 'width:100%;height:600px;border:1px solid #dfe1e6;border-radius:8px;background:#fff;margin-top:10px',
  });
  const updatePreview = () => { try { frame.srcdoc = buildHtmlReport(htmlSections); } catch (e) { /* noop */ } };

  // checkboxes do que incluir
  const checks = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px 16px' });
  for (const s of HTML_SECTIONS) {
    const chk = el('input', { type: 'checkbox' });
    chk.checked = !!htmlSections[s.id];
    chk.addEventListener('change', () => { htmlSections[s.id] = chk.checked; updatePreview(); });
    checks.appendChild(el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px;color:#172b4d' }, [chk, s.label]));
  }

  const nomeArquivo = () => {
    const chosen = HTML_SECTIONS.filter((s) => htmlSections[s.id]);
    const tag = chosen.length === 1 ? chosen[0].id : (chosen.length === 0 ? 'vazio' : 'completo');
    return `relatorio-${tag}-${new Date().toISOString().slice(0, 10)}.html`;
  };
  const btnDl = el('button', {
    class: 'tt-btn is-primary', text: '⬇ Baixar relatório (HTML)',
    onclick: () => {
      const html = buildHtmlReport(htmlSections);
      if (downloadBlob(nomeArquivo(), html, 'text/html;charset=utf-8;', false)) { flash(btnDl, 'Baixado!'); return; }
      if (openInTab(html)) return;
      flash(btnDl, 'Bloqueado', 2200);
    },
  });
  const btnPrint = el('button', {
    class: 'tt-btn', text: '🖨 Imprimir / PDF',
    onclick: () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (e) { const html = buildHtmlReport(htmlSections); openInTab(html); }
    },
  });

  const chkUntracked = el('input', { type: 'checkbox' });
  chkUntracked.checked = includeUntracked;
  chkUntracked.addEventListener('change', () => { includeUntracked = chkUntracked.checked; updatePreview(); });
  const untrackedLabel = el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:13px;color:#172b4d;margin-top:10px' },
    [chkUntracked, 'Incluir cards sem tempo (na seção Geral)']);

  wrap.appendChild(el('div', { style: 'font-weight:700;color:#172b4d;margin-bottom:8px', text: 'Montar relatório — marque o que incluir:' }));
  wrap.appendChild(checks);
  wrap.appendChild(untrackedLabel);
  wrap.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, [btnDl, btnPrint]));
  wrap.appendChild(el('div', { style: 'font-size:12px;color:#5e6c84;margin-top:12px', text: 'Preview (igual ao relatório final — respeita os filtros de membro/etiqueta do topo):' }));
  wrap.appendChild(frame);

  updatePreview();
  return wrap;
}

// rótulo curto de semana ("dd/mm–dd/mm") a partir de "Semana NN · dd/mm–dd/mm"
function weekShort(label) { const p = label.split(' · '); return p[1] || label; }
function monthLabelPt(mk) {
  const [y, m] = mk.split('-').map(Number);
  const s = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
function weeklyMetaOf(meta) {
  if (!meta || meta.min == null || meta.min === '') return null;
  return Math.round(Number(meta.min) / 4); // meta semanal = meta mínima ÷ 4 semanas
}

function renderBonificacao() {
  const all = concludedByMember(filteredCards(), MODEL.at, MODEL.config);
  if (all.months.length === 0) {
    return el('div', { class: 'tt-report-empty', text: 'Nenhum card concluído (com membro atribuído). A contagem usa cards na lista de conclusão.' });
  }
  if (!bonifMonth || all.months.indexOf(bonifMonth) === -1) bonifMonth = all.months[0];
  const data = concludedByMember(filteredCards(), MODEL.at, MODEL.config, bonifMonth);
  const name = (id) => MODEL.memberName.get(id) || id;
  const metas = MODEL.config.metas || {};
  const totalBy = new Map(data.rows.map((r) => [r.memberId, r]));
  const memberList = MODEL.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .filter((m) => matchesSearch(m.name));

  const wrap = el('div', {});

  // seletor de mês + salvar metas
  const monthSel = el('select', { class: 'tt-select' });
  for (const mk of all.months) { const o = el('option', { value: mk, text: monthLabelPt(mk) }); if (mk === bonifMonth) o.selected = true; monthSel.appendChild(o); }
  monthSel.value = bonifMonth;
  monthSel.addEventListener('change', () => { bonifMonth = monthSel.value; render(); });

  const inputs = {};
  const mkInput = (val) => { const i = el('input', { type: 'number', class: 'tt-meta-input' }); i.value = (val == null ? '' : val); return i; };

  const btnSave = el('button', {
    class: 'tt-btn is-primary', text: 'Salvar metas',
    onclick: async () => {
      const next = { ...(MODEL.config.metas || {}) };
      for (const m of memberList) {
        const inp = inputs[m.id]; if (!inp) continue;
        const min = inp.min.value.trim(); const max = inp.max.value.trim();
        const bMin = inp.bonusMin.value.trim(); const bMax = inp.bonusMax.value.trim();
        if (min === '' && max === '' && bMin === '' && bMax === '') { delete next[m.id]; continue; }
        next[m.id] = {
          min: min === '' ? null : Number(min),
          max: max === '' ? null : Number(max),
          bonusMin: bMin === '' ? 500 : Number(bMin),
          bonusMax: bMax === '' ? 1000 : Number(bMax),
        };
      }
      await saveConfig(t, { ...MODEL.config, metas: next });
      MODEL.config = { ...MODEL.config, metas: next };
      flash(btnSave, 'Metas salvas!');
      render();
    },
  });

  wrap.appendChild(el('div', { class: 'tt-report-toolbar' }, [
    el('div', { class: 'tt-report-meta' }, [
      el('div', {}, [el('span', { class: 'tt-report-summary', text: 'Mês: ' }), monthSel]),
      el('div', { class: 'tt-report-summary', text: 'Regra: <mín → R$0 · entre mín e máx → bônus mín · ≥ máx → bônus máx. Meta semanal = meta mínima ÷ 4.' }),
    ]),
    el('div', { class: 'tt-report-actions' }, [btnSave]),
  ]));

  // gráfico do mês
  wrap.appendChild(el('div', { class: 'tt-dash' },
    barChart('Cards concluídos por membro — ' + monthLabelPt(bonifMonth),
      data.rows.map((r) => ({ label: name(r.memberId), value: r.total, text: String(r.total) })))));

  // tabela editável
  const head = [th('Membro'), ...data.weeks.map((w) => th(weekShort(w.label), 'num')),
    th('Entregue', 'num'), th('Meta mín', 'num'), th('Meta máx', 'num'),
    th('Bônus mín', 'num'), th('Bônus máx', 'num'), th('Meta sem.', 'num'), th('Bonificação', 'num')];
  const body = memberList.map((m) => {
    const r = totalBy.get(m.id);
    const entregue = r ? r.total : 0;
    const meta = metas[m.id] || {};
    const inp = { min: mkInput(meta.min), max: mkInput(meta.max), bonusMin: mkInput(meta.bonusMin), bonusMax: mkInput(meta.bonusMax) };
    inputs[m.id] = inp;
    const bonus = bonusFor(entregue, metas[m.id]);
    const wm = weeklyMetaOf(metas[m.id]);
    return el('tr', {}, [
      td(m.name, 'tt-td-card'),
      ...data.weeks.map((w) => td(String(r ? (r.perWeek[w.key] || 0) : 0), 'num')),
      td(String(entregue), 'num'),
      el('td', { class: 'num' }, inp.min), el('td', { class: 'num' }, inp.max),
      el('td', { class: 'num' }, inp.bonusMin), el('td', { class: 'num' }, inp.bonusMax),
      td(wm == null ? '—' : String(wm), 'num'),
      td(brl(bonus), 'num'),
    ]);
  });
  wrap.appendChild(el('div', { class: 'tt-scroll' }, tableEl(head, body)));
  return wrap;
}

// -- resumo de dias (histograma de projetos concluídos) --------------------

function injectDaysCss() {
  if (document.getElementById('tt-days-css')) return;
  const s = document.createElement('style'); s.id = 'tt-days-css';
  s.textContent = `
    .tt-days-wrap{margin-top:16px}
    .tt-days-title{font-size:14px;font-weight:700;color:#172b4d;margin:8px 0 10px}
    .tt-days-grid{display:flex;flex-wrap:wrap;gap:10px}
    .tt-days-card{border:1px solid #dfe1e6;border-radius:8px;padding:12px 14px;background:#fff;min-width:200px}
    .tt-days-head{font-weight:700;color:#172b4d;margin-bottom:8px;font-size:13px}
    .tt-days-row{display:flex;justify-content:space-between;gap:16px;font-size:13px;padding:3px 0}
    .tt-days-row.is-total{border-top:1px solid #dfe1e6;margin-top:6px;padding-top:6px;font-weight:700}
    .tt-days-card.is-geral{background:#f4f9ff;border-color:#b3d4ff}
    .tt-days-empty{color:#97a0af;font-size:12px}
  `;
  document.head.appendChild(s);
}

function daysSummaryBlock(headLabel, dist, total, isGeral) {
  injectDaysCss();
  const card = el('div', { class: `tt-days-card${isGeral ? ' is-geral' : ''}` }, [
    el('div', { class: 'tt-days-head', text: headLabel }),
  ]);
  if (!dist.length) { card.appendChild(el('div', { class: 'tt-days-empty', text: 'Nenhum projeto concluído.' })); return card; }
  for (const d of dist) {
    card.appendChild(el('div', { class: 'tt-days-row' }, [
      el('span', { text: `${d.days}d` }), el('b', { text: String(d.count) }),
    ]));
  }
  card.appendChild(el('div', { class: 'tt-days-row is-total' }, [
    el('span', { text: 'TOTAL' }), el('b', { text: String(total) }),
  ]));
  return card;
}

/** Bloco "Resumo de dias" para a aba de período (semanal/mensal): seletor + período + geral. */
function renderDaysSummary(kind) {
  const ds = getDaysSummary();
  const periods = kind === 'semanal' ? ds.weekly : ds.monthly;
  const keys = periods.map((p) => p.key);

  // resolve a seleção: default = período mais recente (periods já vêm desc)
  let sel = daysPeriodSel[kind];
  if (sel == null || (sel !== '__all__' && !keys.includes(sel))) sel = keys[0] || '__all__';
  daysPeriodSel[kind] = sel;

  const select = el('select', { class: 'tt-select' });
  select.appendChild(el('option', { value: '__all__', text: kind === 'semanal' ? 'Todas as semanas' : 'Todos os meses' }));
  for (const p of periods) {
    const o = el('option', { value: p.key, text: p.label });
    if (p.key === sel) o.selected = true;
    select.appendChild(o);
  }
  select.value = sel;
  select.addEventListener('change', () => { daysPeriodSel[kind] = select.value; render(); });

  const header = el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px' }, [
    el('div', { class: 'tt-days-title', style: 'margin:0', text: 'Resumo de dias — projetos concluídos (idade em dias úteis)' }),
    el('label', { style: 'font-size:12px;color:#5e6c84;display:flex;align-items:center;gap:6px' },
      [kind === 'semanal' ? 'Semana:' : 'Mês:', select]),
  ]);

  const shown = sel === '__all__' ? periods : periods.filter((p) => p.key === sel);
  const grid = el('div', { class: 'tt-days-grid' });
  if (!shown.length) grid.appendChild(el('div', { class: 'tt-days-empty', text: 'Nenhum projeto concluído no período.' }));
  for (const p of shown) grid.appendChild(daysSummaryBlock(p.label, p.dist, p.total, false));
  grid.appendChild(daysSummaryBlock('Geral — todos os concluídos', ds.general, ds.generalTotal, true));

  return el('div', { class: 'tt-days-wrap' }, [header, grid]);
}

/** Só o bloco geral — usado no fim da aba Geral. */
function renderDaysGeneral() {
  const ds = getDaysSummary();
  return el('div', { class: 'tt-days-wrap' }, [
    el('div', { class: 'tt-days-title', text: 'Resumo de dias — projetos concluídos (geral)' }),
    el('div', { class: 'tt-days-grid' }, [daysSummaryBlock('Todos os concluídos', ds.general, ds.generalTotal, true)]),
  ]);
}

function renderBody(r) {
  switch (activeTab) {
    case 'painel': return renderBuilder();
    case 'semanal': return renderPeriods(r.weekly, 'semanal');
    case 'mensal': return renderPeriods(r.monthly, 'mensal');
    case 'sessoes': return renderSessoes(r);
    case 'bonificacao': return renderBonificacao();
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

/** Filtro de LISTAS (várias, com checkboxes). null = todas (sem filtro). */
function listFilterRow() {
  const lists = (MODEL && MODEL.lists) || [];
  if (!lists.length) return el('div', { style: 'display:none' });
  const total = lists.length;
  const selCount = listFilter ? listFilter.size : total;
  const row = el('div', { style: 'margin:6px 0' });
  const btn = el('button', {
    class: 'tt-select', style: 'cursor:pointer',
    text: `Listas: ${selCount}/${total} ${listOpen ? '▴' : '▾'}`,
    onclick: () => { listOpen = !listOpen; render(); },
  });
  row.appendChild(btn);

  if (listOpen) {
    const checks = [];
    const panel = el('div', { style: 'margin-top:6px;border:1px solid #dfe1e6;border-radius:8px;padding:10px;max-width:420px;background:#fafbfc' });
    panel.appendChild(el('div', { style: 'display:flex;gap:8px;margin-bottom:8px' }, [
      el('button', { type: 'button', class: 'tt-btn', text: 'Marcar todas', onclick: () => checks.forEach((c) => { c.checked = true; }) }),
      el('button', { type: 'button', class: 'tt-btn', text: 'Limpar', onclick: () => checks.forEach((c) => { c.checked = false; }) }),
    ]));
    const grid = el('div', { style: 'display:flex;flex-direction:column;gap:2px;max-height:220px;overflow:auto' });
    for (const l of lists) {
      const c = el('input', { type: 'checkbox' });
      c.checked = !listFilter || listFilter.has(l.id);
      c.dataset.listId = l.id;
      checks.push(c);
      grid.appendChild(el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px;color:#172b4d;padding:2px' }, [c, l.name]));
    }
    panel.appendChild(grid);
    panel.appendChild(el('button', {
      type: 'button', class: 'tt-btn is-primary', style: 'margin-top:8px',
      text: 'Aplicar filtro de listas',
      onclick: () => {
        const checked = checks.filter((c) => c.checked).map((c) => c.dataset.listId);
        listFilter = (checked.length === lists.length) ? null : new Set(checked);
        listOpen = false;
        render();
      },
    }));
    row.appendChild(panel);
  }
  return row;
}

// -- RELATÓRIO FINAL (conteúdo fixo, sem seleção) --------------------------

const prettyLabel = (k) => { const t = String(k || '').trim(); return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1); };

/** Todos os cards do quadro (o relatório final não usa os filtros de tela). */
function finalCards() {
  return MODEL.allCards.map((c) => ({ createdAt: c.createdAt, completedAt: completedMs(c), labels: c.labelNames }));
}

function buildFinalHtml() {
  const cards = finalCards();
  const dsm = daysSummaryMonth(cards, MODEL.at, MODEL.config);
  const labs = labelCounts(cards, MODEL.at, KPI_LABELS);
  const totalLab = labs.reduce((s, l) => s + l.count, 0);
  const weekBlocks = dsm.weeks.length
    ? dsm.weeks.map((w) => daysBlockHtml(w.label, w.dist, w.total, false)).join('')
    : '<p class="muted">Nenhum projeto concluído neste mês ainda.</p>';
  const labRows = labs.map((l) => `<tr><td>${esc(prettyLabel(l.key))}</td><td class="n"><b>${l.count}</b></td></tr>`).join('');
  const style = `
    @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&display=swap');
    *{box-sizing:border-box}
    body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d;margin:0 auto;padding:24px;max-width:860px;background:#fff}
    .logo{font-family:'Baloo 2','Trebuchet MS',system-ui,sans-serif;font-weight:800;font-size:38px;letter-spacing:-.5px;line-height:1;margin-bottom:8px}
    .logo .m{color:#98c830}.logo .u{color:#111}
    h1{font-size:18px;margin:0 0 4px}
    h2{font-size:15px;margin:24px 0 8px;border-bottom:2px solid #dfe1e6;padding-bottom:4px}
    h3{font-size:13px;margin:14px 0 6px;color:#42526e}
    .meta{color:#6b778c;font-size:12px;margin-bottom:8px}
    .muted{color:#6b778c;font-size:12px}
    .daysgrid{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 10px}
    .daysc{border:1px solid #dfe1e6;border-radius:8px;padding:10px 12px;min-width:160px}
    .daysc.geral{background:#f4f9ff;border-color:#b3d4ff}
    .daysh{font-weight:700;font-size:12px;margin-bottom:6px}
    .daysr{display:flex;justify-content:space-between;gap:16px;font-size:12px;padding:2px 0}
    .daysr.dayst{border-top:1px solid #dfe1e6;margin-top:5px;padding-top:5px;font-weight:700}
    table{border-collapse:collapse;font-size:13px;min-width:320px;margin-top:4px}
    th,td{border:1px solid #dfe1e6;padding:6px 10px;text-align:left}
    th{background:#f4f5f7;color:#42526e;font-size:11px;text-transform:uppercase}
    td.n{text-align:right;font-variant-numeric:tabular-nums}
    tfoot td{font-weight:700;background:#fafbfc}
    @media print{.daysc,table{page-break-inside:avoid}}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Final</title><style>${style}</style></head><body>`
    + '<div class="logo"><span class="m">market</span><span class="u">4u</span></div>'
    + `<h1>Relatório Final${MODEL.boardName ? ' — ' + esc(MODEL.boardName) : ''}</h1>`
    + `<div class="meta">${esc(dsm.month.label)} · gerado em ${esc(formatDateTime(now()))}</div>`
    + `<h2>Resumo de dias — por semana (mês atual)</h2><div class="daysgrid">${weekBlocks}</div>`
    + `<h3>Total do mês</h3><div class="daysgrid">${daysBlockHtml('Total — ' + dsm.month.label, dsm.month.dist, dsm.month.total, true)}</div>`
    + `<h2>Projetos concluídos por etiqueta (mês atual)</h2>`
    + `<table><thead><tr><th>Etiqueta</th><th class="n">Projetos</th></tr></thead><tbody>${labRows}</tbody>`
    + `<tfoot><tr><td>Total</td><td class="n">${totalLab}</td></tr></tfoot></table>`
    + '</body></html>';
}

function renderFinal() {
  const wrap = el('div', { style: 'padding:4px 2px' });
  const frame = el('iframe', { style: 'width:100%;height:640px;border:1px solid #dfe1e6;border-radius:8px;background:#fff;margin-top:10px' });
  frame.srcdoc = buildFinalHtml();
  const btnDl = el('button', {
    class: 'tt-btn is-primary', text: '⬇ Baixar relatório final (HTML)',
    onclick: () => {
      const html = buildFinalHtml();
      const name = `relatorio-final-${new Date().toISOString().slice(0, 10)}.html`;
      if (downloadBlob(name, html, 'text/html;charset=utf-8;', false)) { flash(btnDl, 'Baixado!'); return; }
      if (openInTab(html)) return;
      flash(btnDl, 'Bloqueado', 2200);
    },
  });
  const btnPrint = el('button', {
    class: 'tt-btn', text: '🖨 Imprimir / PDF',
    onclick: () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { openInTab(buildFinalHtml()); } },
  });
  wrap.appendChild(el('div', { style: 'font-size:12px;color:#5e6c84;margin-bottom:6px', text: 'Relatório final — conteúdo fixo: resumo de dias do mês (por semana) + projetos concluídos por etiqueta.' }));
  wrap.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [btnDl, btnPrint]));
  wrap.appendChild(frame);
  return wrap;
}

/** Dois botões no topo: Detalhada (tudo) × Relatório final (fixo). */
function modeSwitch() {
  const mk = (id, label) => el('button', {
    class: `tt-btn${viewMode === id ? ' is-primary' : ''}`,
    style: 'font-size:14px;padding:8px 16px',
    text: label,
    onclick: () => { if (viewMode !== id) { viewMode = id; render(); } },
  });
  return el('div', { style: 'display:flex;gap:8px;margin-bottom:12px' }, [
    mk('detalhada', '📋 Detalhada'),
    mk('final', '⭐ Relatório final'),
  ]);
}

function render() {
  const root = document.getElementById('app');
  clear(root);
  root.appendChild(modeSwitch());
  if (viewMode === 'final') {
    root.appendChild(renderFinal());
    t.sizeTo('#app').catch(() => {});
    return;
  }
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
  root.appendChild(listFilterRow());
  root.appendChild(backupBar());

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

// Lê o estado ('tt') de cada card em LOTES (concorrência limitada) em vez de
// disparar milhares de chamadas de uma vez — o que travava o relatório em
// quadros grandes (3000+ cards). Atualiza o progresso no "Carregando…".
const LOAD_CONCURRENCY = 30;
async function loadStates(cards, onProgress) {
  const out = new Array(cards.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < cards.length) {
      const i = next;
      next += 1;
      try { out[i] = await t.get(cards[i].id, 'shared', 'tt'); }
      catch (e) { out[i] = null; }
      done += 1;
      if (onProgress && (done % 50 === 0 || done === cards.length)) onProgress(done, cards.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, cards.length) }, worker));
  return out;
}

async function boot() {
  const root = document.getElementById('app');
  try {
    const config = await getConfig(t);
    const [board, cards, lists] = await Promise.all([
      t.board('id', 'name').catch(() => ({})),
      t.cards('id', 'name', 'idList', 'members', 'labels', 'dueComplete', 'dateLastActivity'),
      t.lists('id', 'name'),
    ]);
    const listName = new Map(lists.map((l) => [l.id, l.name]));
    const setLoading = (txt) => { if (root) root.textContent = txt; };
    if (cards.length > 150) setLoading(`Carregando dados de ${cards.length} cards…`);
    const states = await loadStates(cards, (d, total) => setLoading(`Carregando dados dos cards… ${d}/${total}`));

    const memberName = new Map();
    const labelName = new Map();
    const allCards = cards.map((c, i) => {
      const members = Array.isArray(c.members) ? c.members : [];
      const labels = Array.isArray(c.labels) ? c.labels : [];
      const memberIds = new Set();
      const labelIds = new Set();
      for (const m of members) { memberIds.add(m.id); if (!memberName.has(m.id)) memberName.set(m.id, m.fullName || m.username || m.id); }
      for (const l of labels) { labelIds.add(l.id); if (!labelName.has(l.id)) labelName.set(l.id, l.name || `(cor ${l.color || '—'})`); }
      return {
        id: c.id, idList: c.idList,
        name: c.name, lista: listName.get(c.idList) || '—', state: normalize(states[i] || null),
        memberIds, labelIds,
        labelNames: labels.map((l) => (l.name && l.name.trim() ? l.name : `(${l.color || 'sem cor'})`)),
        createdAt: creationMsFromId(c.id),
        dueComplete: !!c.dueComplete, dateLastActivity: c.dateLastActivity || null,
      };
    });
    const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
    const members = Array.from(memberName, ([id, name]) => ({ id, name })).sort(byName);
    const labels = Array.from(labelName, ([id, name]) => ({ id, name })).sort(byName);

    MODEL = {
      allCards, members, labels, memberName, config, at: now(),
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
      boardId: board && board.id ? board.id : '', boardName: board && board.name ? board.name : '',
    };
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
