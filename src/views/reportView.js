/**
 * reportView.js — Relatório consolidado do quadro (aberto pelo botão do quadro,
 * dentro de um modal).
 *
 * COMO LÊ O TEMPO DE TODOS OS CARDS
 * ---------------------------------
 * Um botão de quadro roda em contexto de QUADRO (não de card). O estado de cada
 * card é lido passando o PRÓPRIO ID DO CARD como escopo no t.get — a doc do
 * Trello lista "o ID de um card do quadro" como escopo válido. Assim lemos, de
 * qualquer contexto, o estado (escopo card/shared, chave "tt") de cada card e
 * aplicamos a MESMA função pura `computeTotals` que o card usa — ou seja, os
 * números do relatório batem exatamente com os do verso de cada card.
 *
 * (Isso gera uma leitura por card. Para os volumes típicos de um quadro é
 * tranquilo; se um dia precisar de leitura em massa real, o caminho é a REST
 * API `GET /boards/{id}/pluginData` — que exige backend + token, portanto V2.)
 *
 * NOTA: uma tentativa anterior usou `t.getAll()`, mas no contexto de quadro ele
 * não traz o estado por card (não há "card atual"), então o relatório vinha
 * zerado. Ler pelo id de cada card é o caminho correto.
 *
 * Tudo aqui é client-side: nenhuma chamada a servidor próprio, nenhum token.
 * (O envio automático para Google Sheets é o passo seguinte da V2, pois escrever
 * numa planilha externa exige backend + autenticação.)
 *
 * OBSERVAÇÃO: `t.cards('all')` retorna apenas cards VISÍVEIS (não arquivados e em
 * listas abertas). Cards arquivados não entram no relatório — coerente com a
 * ideia de "o que está em andamento no quadro".
 */

import { getConfig } from '../services/storage.js';
import { normalize, computeTotals, Status } from '../services/tracker.js';
import { toCsv } from '../services/exporter.js';
import { formatDuration, formatDateTime, now } from '../utils/time.js';
import { el, clear } from '../utils/dom.js';

const t = window.TrelloPowerUp.iframe();

const STATUS_LABEL = {
  idle: 'Aguardando',
  running: 'Em andamento',
  paused: 'Pausado',
  done: 'Concluído',
};

let MODEL = null;            // { rows, config } — carregado uma vez
let includeUntracked = false; // mostrar também cards sem tempo?

// -- montagem das linhas (estado lido por card) ----------------------------

function computeRows(cards, states, listName, config) {
  const at = now();
  return cards
    .map((c, i) => {
      const raw = states[i] || null;          // estado lido pelo id do card
      const state = normalize(raw);            // normalize(null) => estado 'idle'
      const totals = computeTotals(state, at, config);
      return {
        card: c.name,
        lista: listName.get(c.idList) || '—',
        status: state.status,
        inicio: totals.firstStart,
        conclusao: totals.lastEnd,
        effectiveMs: totals.effectiveMs,
        sessions: totals.sessionsCount,
        tracked: state.status !== Status.IDLE,
      };
    })
    .sort((a, b) => {
      if (a.tracked !== b.tracked) return a.tracked ? -1 : 1;   // rastreados primeiro
      if (b.effectiveMs !== a.effectiveMs) return b.effectiveMs - a.effectiveMs; // maior tempo no topo
      return a.card.localeCompare(b.card, 'pt-BR');
    });
}

function visibleRows() {
  return includeUntracked ? MODEL.rows : MODEL.rows.filter((r) => r.tracked);
}

// -- exportação ------------------------------------------------------------

function buildCsv() {
  const cfg = MODEL.config;
  const headers = ['Card', 'Lista', 'Status', 'Início', 'Conclusão', 'Sessões', 'Tempo efetivo', 'Tempo (ms)'];
  const rows = visibleRows().map((r) => [
    r.card,
    r.lista,
    STATUS_LABEL[r.status],
    r.inicio ? formatDateTime(r.inicio) : '',
    r.conclusao ? formatDateTime(r.conclusao) : '',
    r.sessions,
    formatDuration(r.effectiveMs, cfg.timeFormat),
    r.effectiveMs,
  ]);
  return toCsv(headers, rows, ';');
}

function downloadCsv(filename, text) {
  try {
    // BOM (\uFEFF) garante que o Excel leia os acentos como UTF-8.
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
    return true;
  } catch (e) {
    return false;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback para iframes onde a Clipboard API é bloqueada.
    try {
      const ta = el('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

// -- render ----------------------------------------------------------------

function flash(btn, msg, ms = 1600) {
  const original = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, ms);
}

function render() {
  const root = document.getElementById('app');
  clear(root);
  const cfg = MODEL.config;
  const rows = visibleRows();
  const totalMs = rows.reduce((acc, r) => acc + r.effectiveMs, 0);
  const trackedCount = MODEL.rows.filter((r) => r.tracked).length;

  // ---- barra superior: resumo + ações ----
  const summary = el('div', {
    class: 'tt-report-summary',
    text: `${trackedCount} card(s) com tempo · ${MODEL.rows.length} visível(is) · total ${formatDuration(totalMs, cfg.timeFormat)}`,
  });

  const chkAll = el('input', { type: 'checkbox' });
  chkAll.checked = includeUntracked;
  chkAll.addEventListener('change', () => { includeUntracked = chkAll.checked; render(); });
  const toggle = el('label', { class: 'tt-check tt-report-toggle' }, [chkAll, ' Incluir cards sem tempo']);

  const btnCsv = el('button', {
    class: 'tt-btn is-primary',
    text: 'Baixar CSV',
    onclick: async () => {
      const name = `relatorio-tempo-${new Date().toISOString().slice(0, 10)}.csv`;
      if (downloadCsv(name, buildCsv())) return;
      // Se o download for bloqueado no iframe, cai para copiar.
      const ok = await copyText(buildCsv());
      flash(btnCsv, ok ? 'Copiado! (cole na planilha)' : 'Use "Copiar"', 2200);
    },
  });

  const btnCopy = el('button', {
    class: 'tt-btn',
    text: 'Copiar',
    onclick: async () => {
      const ok = await copyText(buildCsv());
      flash(btnCopy, ok ? 'Copiado!' : 'Falhou');
    },
  });

  const actions = el('div', { class: 'tt-report-actions' }, [btnCopy, btnCsv]);
  const toolbar = el('div', { class: 'tt-report-toolbar' }, [
    el('div', { class: 'tt-report-meta' }, [summary, toggle]),
    actions,
  ]);
  root.appendChild(toolbar);

  // ---- vazio ----
  if (rows.length === 0) {
    root.appendChild(el('div', {
      class: 'tt-report-empty',
      text: 'Nenhum card com tempo registrado ainda. Mova um card para a lista de início (ou clique em "Iniciar" no card) para começar a cronometrar.',
    }));
    t.sizeTo('#app').catch(() => {});
    return;
  }

  // ---- tabela ----
  const thead = el('thead', {}, el('tr', {}, [
    el('th', { text: 'Card' }),
    el('th', { text: 'Lista' }),
    el('th', { text: 'Status' }),
    el('th', { text: 'Início' }),
    el('th', { text: 'Conclusão' }),
    el('th', { class: 'num', text: 'Sessões' }),
    el('th', { class: 'num', text: 'Tempo' }),
  ]));

  const body = rows.map((r) => el('tr', {}, [
    el('td', { class: 'tt-td-card', text: r.card }),
    el('td', { text: r.lista }),
    el('td', {}, el('span', { class: `tt-badge-mini st-${r.status}`, text: STATUS_LABEL[r.status] })),
    el('td', { class: 'nowrap', text: r.inicio ? formatDateTime(r.inicio) : '—' }),
    el('td', { class: 'nowrap', text: r.conclusao ? formatDateTime(r.conclusao) : '—' }),
    el('td', { class: 'num', text: String(r.sessions) }),
    el('td', { class: 'num', text: formatDuration(r.effectiveMs, cfg.timeFormat) }),
  ]));

  const tfoot = el('tfoot', {}, el('tr', {}, [
    el('td', { text: 'Total' }),
    el('td', {}), el('td', {}), el('td', {}), el('td', {}),
    el('td', { class: 'num' }),
    el('td', { class: 'num', text: formatDuration(totalMs, cfg.timeFormat) }),
  ]));

  const table = el('table', { class: 'tt-table' }, [thead, el('tbody', {}, body), tfoot]);
  root.appendChild(el('div', { class: 'tt-scroll' }, table));

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
    // Lê o estado de cada card usando o ID do card como escopo do t.get.
    // (.catch → null mantém o relatório de pé mesmo se um card específico falhar.)
    const states = await Promise.all(
      cards.map((c) => t.get(c.id, 'shared', 'tt').catch(() => null))
    );
    MODEL = { rows: computeRows(cards, states, listName, config), config };
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
