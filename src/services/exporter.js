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

/**
 * Gera um CSV a partir de um cabeçalho + linhas (arrays de valores). PURO.
 *
 * Detalhes que importam na prática:
 *   - Separador padrão ';' — é o que o Excel em pt-BR espera; o Google Sheets
 *     também detecta. (Passe ',' se preferir o padrão internacional.)
 *   - Cada campo é "escapado" (aspas duplas) só quando contém o separador,
 *     aspas ou quebra de linha — seguindo a convenção RFC-4180.
 *   - Linhas terminam em CRLF (\r\n), o formato mais compatível com planilhas.
 *
 * A responsabilidade de adicionar BOM (para acentos no Excel) fica em quem
 * escreve o arquivo — aqui devolvemos apenas o texto puro.
 *
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @param {string} [sep=';']
 * @returns {string}
 */
export function toCsv(headers, rows, sep = ';') {
  const needsQuote = new RegExp('["\\n\\r' + sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']');
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return needsQuote.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const line = (arr) => arr.map(esc).join(sep);
  return [line(headers), ...rows.map(line)].join('\r\n');
}
