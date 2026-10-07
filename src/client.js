/**
 * client.js — CONECTOR do Power-Up "Controle de Tempo".
 *
 * É carregado pelo index.html (que também carrega a power-up.min.js do Trello).
 * Aqui registramos, via TrelloPowerUp.initialize(), uma função para cada
 * "capability" (recurso) que o Power-Up usa. O Trello chama essas funções nos
 * momentos apropriados.
 *
 * Capabilities usadas:
 *   card-badges         -> badge na FRENTE do card: SÓ O STATUS (▶/⏸/✓)
 *   card-detail-badges  -> no topo do verso: STATUS + TEMPO efetivo (horas)
 *   card-back-section   -> painel "Controle de Tempo" (iframe /views/section.html)
 *   card-buttons        -> botões Iniciar/Pausar/Retomar/Finalizar
 *   board-buttons       -> botão "Relatório de Tempo" no topo do quadro (modal)
 *   show-settings       -> tela de configurações (/views/settings.html)
 *
 * ÍCONES: todos EMBUTIDOS como data-URI (abaixo). Não dependem de nenhum arquivo
 * em /public/icons — assim nunca aparecem como "imagem quebrada" no cabeçalho ou
 * nos botões, mesmo se um arquivo faltar ou o GitHub Pages servir errado.
 *
 * A CONTAGEM DE DIAS (idade do card) foi separada para um Power-Up próprio
 * ("Contagem de Dias"). Este aqui cuida só de TEMPO (horas). O relatório ainda
 * mostra a idade do card em dias, recalculada com a MESMA fórmula do outro
 * Power-Up (ver report.js) — sem precisar ler os dados dele.
 *
 * A detecção AUTOMÁTICA por mudança de lista é feita dentro do card-badges:
 * o Trello re-renderiza o badge logo após um card mudar de lista, então esse é
 * o gancho oficial recomendado para reagir a movimentos sem precisar de backend.
 */

import { getConfig, reconcileAndPersist, getState, apply } from './services/storage.js';
import { start, pause, resume, finish, computeTotals, Status } from './services/tracker.js';
import { now, formatDuration } from './utils/time.js';

// -- ícones embutidos (data-URI) ------------------------------------------
const GRAY = '#42526e';  // cinza do cabeçalho/botões claros
const WHITE = '#ffffff'; // para cabeçalho escuro

/** SVG de traço (outline) como data-URI. */
function strokeIcon(color, inner) {
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`);
}
/** SVG preenchido (sólido) como data-URI. */
function fillIcon(color, inner) {
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${color}">${inner}</svg>`);
}

const P = {
  calClock: '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M8 2v4M16 2v4M3 10h6"/><circle cx="17" cy="16" r="5"/><path d="M17 14.5V16l1 1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
};

const ICON = {
  clock: strokeIcon(GRAY, P.clock),
  play: fillIcon(GRAY, P.play),
  pause: fillIcon(GRAY, P.pause),
  resume: fillIcon(GRAY, P.play),
  stop: fillIcon(GRAY, P.stop),
  // botão do quadro: dois tons para cabeçalho claro/escuro
  reportDark: strokeIcon(WHITE, P.calClock),
  reportLight: strokeIcon(GRAY, P.calClock),
};

const BADGE_REFRESH = 15; // segundos (mínimo do Trello é 10; usamos 15)

/**
 * Badge da FRENTE do card: SÓ O STATUS, sem número.
 *   rodando  -> ▶ (azul)
 *   pausado  -> ⏸ (amarelo)
 *   concluído-> ✓ (verde)
 *   aguardando (idle) -> sem badge (null)
 */
function statusBadge(state) {
  switch (state.status) {
    case Status.RUNNING: return { text: '▶', color: 'blue' };
    case Status.PAUSED:  return { text: '⏸', color: 'yellow' };
    case Status.DONE:    return { text: '✓', color: 'green' };
    default:             return null; // idle
  }
}

window.TrelloPowerUp.initialize({
  // ---- Badge na frente do card: só o status ----------------------------
  'card-badges': function (t) {
    return getConfig(t).then((config) =>
      // O Trello re-executa card-badges logo após um card mudar de lista, então
      // reconciliamos aqui (detecção automática) e decidimos se há badge.
      reconcileAndPersist(t, config).then((state) => {
        if (!config.showBadge) return [];
        if (!statusBadge(state)) return []; // idle: nada na frente
        return [{
          // badge dinâmico: re-executa a cada `refresh` s (mantém a detecção
          // automática por movimentação de lista viva mesmo com o quadro parado).
          dynamic: function () {
            return reconcileAndPersist(t, config).then((s2) => {
              const b = statusBadge(s2);
              return b ? { text: b.text, color: b.color, refresh: BADGE_REFRESH }
                       : { text: '', refresh: BADGE_REFRESH };
            });
          },
        }];
      })
    );
  },

  // ---- Selo no verso do card: status + TEMPO efetivo -------------------
  'card-detail-badges': function (t) {
    return getConfig(t).then((config) =>
      reconcileAndPersist(t, config).then((state) => {
        const eff = computeTotals(state, now(), config).effectiveMs;
        const map = {
          idle:    { title: 'Controle de Tempo', text: 'Aguardando', color: 'light-gray' },
          running: { title: 'Controle de Tempo', text: 'Em andamento', color: 'blue' },
          paused:  { title: 'Controle de Tempo', text: 'Pausado', color: 'yellow' },
          done:    { title: 'Controle de Tempo', text: 'Concluído', color: 'green' },
        };
        const status = map[state.status] || map.idle;
        return [
          status,
          { title: 'Tempo', text: formatDuration(eff, config.timeFormat), color: null },
        ];
      })
    );
  },

  // ---- Painel "Controle de Tempo" no verso do card ---------------------
  'card-back-section': function (t) {
    return {
      title: 'Controle de Tempo',
      icon: ICON.clock, // data-URI embutido
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
  // Ícone EMBUTIDO (data-URI): nunca quebra no cabeçalho.
  'board-buttons': function () {
    return [{
      icon: { dark: ICON.reportDark, light: ICON.reportLight },
      text: 'Relatório de Tempo',
      callback: (tt) => tt.modal({
        title: 'Relatório de Tempo',
        url: tt.signUrl('./views/report.html'),
        fullscreen: true, // janela grande (tela cheia) para o relatório
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
