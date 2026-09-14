/**
 * time.js — utilitários puros de tempo e data.
 *
 * "Puros" significa: nenhuma dependência do Trello. São funções que recebem
 * números (timestamps em milissegundos, o padrão de `Date.now()`) e devolvem
 * strings ou números. Isso torna o módulo fácil de testar isoladamente e de
 * reaproveitar na V2 (dashboard, relatórios, exportação para Sheets).
 */

export const now = () => Date.now();

/** Divide "08:30" em [8, 30]. */
export function parseHM(str) {
  const [h, m] = String(str || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
  return [h, m];
}

/**
 * Formata uma duração (em ms) de acordo com o formato escolhido nas configurações.
 *   'hm'    -> "02h 37min"        (padrão, compacto)
 *   'hms'   -> "02h 37min 15s"
 *   'clock' -> "02:37:15"
 */
export function formatDuration(ms, fmt = 'hm') {
  if (ms == null || ms < 0 || Number.isNaN(ms)) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const pad = (n) => String(n).padStart(2, '0');

  switch (fmt) {
    case 'clock':
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    case 'hms':
      return `${pad(h)}h ${pad(m)}min ${pad(s)}s`;
    case 'hm':
    default:
      return `${pad(h)}h ${pad(m)}min`;
  }
}

// Um único Intl formatter reaproveitado (criar Intl a cada chamada é caro).
const dtf = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});
const df = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const tf = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "14/09/2026 08:32" */
export function formatDateTime(ms) {
  if (!ms) return '—';
  return dtf.format(new Date(ms)).replace(',', '');
}

/** "14/09/2026 às 08:32" — formato pedido nos detalhes do card. */
export function formatDateTimeLong(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${df.format(d)} às ${tf.format(d).slice(0, 5)}`;
}

/** "14/09 08:32" — formato curto para o histórico. */
export function formatHistory(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} ${tf.format(d).slice(0, 5)}`;
}
