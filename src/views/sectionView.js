/**
 * sectionView.js — controla o painel "Controle de Tempo" (verso do card).
 *
 * Roda dentro do próprio iframe, então usa `TrelloPowerUp.iframe()`.
 * Mostra, em ordem de prioridade: TEMPO -> STATUS -> INÍCIO -> CONCLUSÃO ->
 * (pausas) -> SESSÕES -> HISTÓRICO. O cronômetro visual é só uma projeção dos
 * timestamps: recalculamos a cada segundo, mas a verdade está no pluginData.
 */
import {
  getConfig, getState, apply, reconcileAndPersist,
} from '../services/storage.js';
import {
  computeTotals, start, pause, resume, finish, Status,
} from '../services/tracker.js';
import {
  formatDuration, formatDateTimeLong, formatHistory, now,
} from '../utils/time.js';
import { el, mount } from '../utils/dom.js';

const t = window.TrelloPowerUp.iframe();

let config = null;
let state = null;
let tickTimer = null;

const HISTORY_LABEL = {
  start: 'Iniciado', pause: 'Pausado', resume: 'Retomado', finish: 'Finalizado',
  'auto-start': 'Iniciado (mudança de lista)',
  'auto-finish': 'Finalizado (mudança de lista)',
  'auto-pause': 'Pausado (mudança de lista)',
  'auto-resume': 'Retomado (mudança de lista)',
  reopen: 'Reaberto',
};

const STATUS_LABEL = {
  idle: ['Aguardando', 'st-idle'],
  running: ['Em andamento', 'st-running'],
  paused: ['Pausado', 'st-paused'],
  done: ['Concluído', 'st-done'],
};

function actionButton(label, cls, op) {
  return el('button', {
    class: `tt-btn ${cls}`,
    text: label,
    onclick: async () => {
      await apply(t, op);      // grava; o Trello recarrega esta seção sozinho
      state = await getState(t);
      render();                // re-render imediato para resposta rápida
    },
  });
}

function buttonsFor(status) {
  const row = el('div', { class: 'tt-actions' });
  if (status === Status.IDLE || status === Status.DONE) {
    row.appendChild(actionButton('▶ Iniciar', 'is-primary', start));
  }
  if (status === Status.RUNNING) {
    row.appendChild(actionButton('⏸ Pausar', '', pause));
    row.appendChild(actionButton('⏹ Finalizar', 'is-danger', finish));
  }
  if (status === Status.PAUSED) {
    row.appendChild(actionButton('▶ Retomar', 'is-primary', resume));
    row.appendChild(actionButton('⏹ Finalizar', 'is-danger', finish));
  }
  return row;
}

function row(label, valueNode) {
  return el('div', { class: 'tt-row' }, [
    el('span', { class: 'tt-label', text: label }),
    typeof valueNode === 'string'
      ? el('span', { class: 'tt-value', text: valueNode })
      : valueNode,
  ]);
}

function render() {
  const totals = computeTotals(state, now(), config);
  const [statusText, statusCls] = STATUS_LABEL[state.status] || STATUS_LABEL.idle;

  const container = el('div', { class: 'tt-section' });

  // TEMPO (destaque) — atualizado a cada segundo pelo tick()
  const bigTime = el('span', { class: 'tt-big-time', id: 'ttBigTime',
    text: formatDuration(totals.effectiveMs, config.timeFormat) });
  container.appendChild(el('div', { class: `tt-hero ${statusCls}` }, [
    bigTime,
    el('span', { class: `tt-status-pill ${statusCls}`, text: statusText }),
  ]));

  // INÍCIO / CONCLUSÃO
  container.appendChild(row('Início', formatDateTimeLong(totals.firstStart)));
  if (state.status === Status.DONE) {
    container.appendChild(row('Conclusão', formatDateTimeLong(totals.lastEnd)));
  }

  // PAUSAS (só quando houver e quando a config contabiliza)
  if (config.countPauses && totals.pausedMs > 0) {
    container.appendChild(row('Tempo transcorrido',
      el('span', { class: 'tt-value', id: 'ttWorked',
        text: formatDuration(totals.workedMs, config.timeFormat) })));
    container.appendChild(row('Tempo pausado', formatDuration(totals.pausedMs, config.timeFormat)));
    container.appendChild(row('Tempo efetivo',
      el('span', { class: 'tt-value', id: 'ttEffective',
        text: formatDuration(totals.effectiveMs, config.timeFormat) })));
  }

  // BOTÕES
  container.appendChild(buttonsFor(state.status));

  // SESSÕES (quando há mais de uma, ou uma concluída + total acumulado)
  if (state.sessions.length > 0) {
    const box = el('div', { class: 'tt-block' }, [el('div', { class: 'tt-block-title', text: 'Sessões' })]);
    state.sessions.forEach((s, i) => {
      const eff = config.countPauses ? Math.max(0, (s.endedAt - s.startedAt) - s.pausedMs) : (s.endedAt - s.startedAt);
      box.appendChild(el('div', { class: 'tt-session' }, [
        el('span', { class: 'tt-session-idx', text: `Sessão ${i + 1}` }),
        el('span', { class: 'tt-session-range',
          text: `${formatHistory(s.startedAt)} → ${formatHistory(s.endedAt)}` }),
        el('span', { class: 'tt-session-time', text: formatDuration(eff, config.timeFormat) }),
      ]));
    });
    box.appendChild(el('div', { class: 'tt-session tt-total' }, [
      el('span', { class: 'tt-session-idx', text: 'Total acumulado' }),
      el('span', { class: 'tt-session-range', text: '' }),
      el('span', { class: 'tt-session-time', text: formatDuration(totals.effectiveMs, config.timeFormat) }),
    ]));
    container.appendChild(box);
  }

  // HISTÓRICO
  if (state.history.length > 0) {
    const box = el('div', { class: 'tt-block' }, [el('div', { class: 'tt-block-title', text: 'Histórico' })]);
    state.history.slice().reverse().forEach((h) => {
      box.appendChild(el('div', { class: 'tt-hist' }, [
        el('span', { class: 'tt-hist-when', text: formatHistory(h.at) }),
        el('span', { class: 'tt-hist-what', text: HISTORY_LABEL[h.type] || h.type }),
      ]));
    });
    container.appendChild(box);
  }

  mount('app', container);
  t.sizeTo('#app').catch(() => {});
}

/** Atualiza só os números que "correm", 1x por segundo. */
function tick() {
  if (!state || state.status !== Status.RUNNING) return;
  const totals = computeTotals(state, now(), config);
  const big = document.getElementById('ttBigTime');
  if (big) big.textContent = formatDuration(totals.effectiveMs, config.timeFormat);
  const worked = document.getElementById('ttWorked');
  if (worked) worked.textContent = formatDuration(totals.workedMs, config.timeFormat);
  const eff = document.getElementById('ttEffective');
  if (eff) eff.textContent = formatDuration(totals.effectiveMs, config.timeFormat);
}

async function boot() {
  config = await getConfig(t);
  // Ao abrir o card, também reconciliamos (caso ele tenha sido movido).
  state = await reconcileAndPersist(t, config);
  render();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
}

// t.render é chamado pelo Trello quando o iframe deve (re)desenhar.
t.render(boot);
boot();
