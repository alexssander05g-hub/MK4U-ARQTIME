/**
 * exporter.js — "costura" (seam) pronta para a V2: transforma o estado de um
 * card em uma LINHA de relatório. É puro e sem rede de propósito.
 *
 * Na V2, o dashboard/relatórios e o envio para Google Sheets vão apenas:
 *   1. percorrer os cards (t.cards('all')),
 *   2. ler o estado de cada um (storage.getState),
 *   3. chamar toRow() aqui,
 *   4. e então renderizar (dashboard) ou POSTar (Sheets, via backend + token).
 *
 * Deixar isso isolado agora evita reescrever a lógica depois.
 */

import { computeTotals } from './tracker.js';
import { formatDateTime, formatDuration, now } from '../utils/time.js';

/**
 * @param {object} params
 * @param {string} params.cardName
 * @param {string} [params.member]     responsável (nome), quando disponível
 * @param {string} [params.project]    projeto/etiqueta, quando disponível
 * @param {object} params.state        estado do tracker
 * @param {object} params.config
 * @returns {{card,responsavel,inicio,conclusao,tempo,projeto, _raw:object}}
 */
export function toRow({ cardName, member = '', project = '', state, config }) {
  const totals = computeTotals(state, now(), config);
  return {
    card: cardName,
    responsavel: member,
    inicio: formatDateTime(totals.firstStart),
    conclusao: formatDateTime(totals.lastEnd),
    tempo: formatDuration(totals.effectiveMs, config.timeFormat),
    projeto: project,
    // números crus para agregações (tempo médio, totais, por pessoa, etc.)
    _raw: {
      effectiveMs: totals.effectiveMs,
      workedMs: totals.workedMs,
      pausedMs: totals.pausedMs,
      sessions: totals.sessionsCount,
      status: state.status,
      firstStart: totals.firstStart,
      lastEnd: totals.lastEnd,
    },
  };
}

/** Cabeçalho correspondente (útil para CSV / Sheets). */
export const REPORT_HEADERS = ['Card', 'Responsável', 'Início', 'Conclusão', 'Tempo', 'Projeto'];
