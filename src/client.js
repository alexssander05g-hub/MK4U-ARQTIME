/**
 * client.js — CONECTOR do Power-Up.
 *
 * É carregado pelo index.html (que também carrega a power-up.min.js do Trello).
 * Aqui registramos, via TrelloPowerUp.initialize(), uma função para cada
 * "capability" (recurso) que o Power-Up usa. O Trello chama essas funções nos
 * momentos apropriados.
 *
 * Capabilities usadas:
 *   card-badges         -> badge na FRENTE do card (🕐/⏸/✓ + tempo)
 *   card-detail-badges  -> selo de status no topo do verso do card
 *   card-back-section   -> painel "Controle de Tempo" (iframe /views/section.html)
 *   card-buttons        -> botões Iniciar/Pausar/Retomar/Finalizar
 *   board-buttons       -> botão "Relatório de Tempo" no topo do quadro (modal)
 *   show-settings       -> tela de configurações (/views/settings.html)
 *
 * A detecção AUTOMÁTICA por mudança de lista é feita dentro do card-badges:
 * o Trello re-renderiza o badge logo após um card mudar de lista, então esse é
 * o gancho oficial recomendado para reagir a movimentos sem precisar de backend.
 */

import { getConfig, reconcileAndPersist, getState, apply } from './services/storage.js';
import { computeTotals, start, pause, resume, finish, Status } from './services/tracker.js';
import { formatDuration, now } from './utils/time.js';

const ICON = {
  clock: './public/icons/clock.svg',
  clockLight: './public/icons/clock-light.svg',
  play: './public/icons/play.svg',
  pause: './public/icons/pause.svg',
  resume: './public/icons/resume.svg',
  stop: './public/icons/stop.svg',
  gear: './public/icons/gear.svg',
};

const BADGE_REFRESH = 15; // segundos (mínimo do Trello é 10; usamos 15)

/** Monta o texto/cor do badge a partir do estado + totais. */
function badgeFor(state, config) {
  const totals = computeTotals(state, now(), config);
  const time = formatDuration(totals.effectiveMs, config.timeFormat);
  switch (state.status) {
    case Status.RUNNING: return { text: `🕐 ${time}`, color: 'blue' };
    case Status.PAUSED:  return { text: `⏸ ${time}`, color: 'yellow' };
    case Status.DONE:    return { text: `✓ ${time}`, color: 'green' };
    default:             return null; // 'idle' -> sem badge na frente (quadro limpo)
  }
}

window.TrelloPowerUp.initialize({
  // ---- Badge na frente do card -----------------------------------------
  'card-badges': function (t) {
    return getConfig(t).then((config) =>
      // O Trello re-executa card-badges logo após um card mudar de lista, então
      // reconciliamos aqui (detecção automática) e decidimos se há badge.
      reconcileAndPersist(t, config).then((state) => {
        if (!config.showBadge || state.status === Status.IDLE) return []; // quadro limpo
        return [{
          // badge dinâmico: re-executa a cada `refresh` segundos p/ atualizar o tempo.
          dynamic: function () {
            return reconcileAndPersist(t, config).then((s2) => {
              const b = badgeFor(s2, config);
              return b ? { text: b.text, color: b.color, refresh: BADGE_REFRESH }
                       : { text: '', refresh: BADGE_REFRESH };
            });
          },
        }];
      })
    );
  },

  // ---- Selo de status no verso do card ---------------------------------
  'card-detail-badges': function (t) {
    return getConfig(t).then((config) =>
      reconcileAndPersist(t, config).then((state) => {
        const totals = computeTotals(state, now(), config);
        const map = {
          idle:    { title: 'Controle de Tempo', text: 'Aguardando', color: 'light-gray' },
          running: { title: 'Controle de Tempo', text: 'Em andamento', color: 'blue' },
          paused:  { title: 'Controle de Tempo', text: 'Pausado', color: 'yellow' },
          done:    { title: 'Controle de Tempo', text: 'Concluído', color: 'green' },
        };
        const status = map[state.status] || map.idle;
        return [
          status,
          { title: 'Tempo', text: formatDuration(totals.effectiveMs, config.timeFormat), color: null },
        ];
      })
    );
  },

  // ---- Painel "Controle de Tempo" no verso do card ---------------------
  'card-back-section': function (t) {
    return {
      title: 'Controle de Tempo',
      icon: ICON.clock,
      content: { type: 'iframe', url: t.signUrl('./views/section.html'), height: 260 },
    };
  },

  // ---- Botões manuais (adaptam-se ao status) ---------------------------
  'card-buttons': function (t) {
    return getState(t).then((state) => {
      const btns = [];
      if (state.status === Status.IDLE || state.status === Status.DONE) {
        btns.push({ icon: ICON.play, text: 'Iniciar', callback: (tt) => apply(tt, start) });
      }
      if (state.status === Status.RUNNING) {
        btns.push({ icon: ICON.pause, text: 'Pausar', callback: (tt) => apply(tt, pause) });
        btns.push({ icon: ICON.stop, text: 'Finalizar', callback: (tt) => apply(tt, finish) });
      }
      if (state.status === Status.PAUSED) {
        btns.push({ icon: ICON.resume, text: 'Retomar', callback: (tt) => apply(tt, resume) });
        btns.push({ icon: ICON.stop, text: 'Finalizar', callback: (tt) => apply(tt, finish) });
      }
      return btns;
    });
  },

  // ---- Botão do quadro: Relatório de Tempo -----------------------------
  // Abre um modal com a tabela consolidada de todos os cards + exportação CSV.
  'board-buttons': function () {
    return [{
      // dark = ícone para cabeçalho escuro (branco); light = para claro (cinza).
      icon: { dark: ICON.clockLight, light: ICON.clock },
      text: 'Relatório de Tempo',
      callback: (tt) => tt.modal({
        title: 'Relatório de Tempo',
        url: tt.signUrl('./views/report.html'),
        fullscreen: false,
        height: 600,
      }),
    }];
  },

  // ---- Configurações ---------------------------------------------------
  'show-settings': function (t) {
    return t.popup({
      title: 'Configurações — Controle de Tempo',
      url: './views/settings.html',
      height: 420,
    });
  },
});
