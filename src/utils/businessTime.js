/**
 * businessTime.js — cálculo de "horas úteis".
 *
 * O requisito pedia deixar a arquitetura PREPARADA para contar apenas horas
 * úteis. Como a lógica é isolada e pura, ela já vem FUNCIONAL aqui — basta
 * ligar a opção nas configurações. Fica desligada por padrão.
 *
 * Observação importante sobre fuso horário: o cálculo usa o horário LOCAL do
 * navegador de quem está visualizando (via `Date.setHours`). Para uma equipe
 * no mesmo fuso isso é exato. Times em fusos diferentes veriam pequenas
 * variações — resolver isso de forma robusta é item de V2 (guardar o fuso do
 * quadro nas configurações).
 */
import { parseHM } from './time.js';

/**
 * Soma os milissegundos do intervalo [startMs, endMs] que caem dentro do
 * expediente definido em `cfg`.
 *
 * @param {number} startMs  início (epoch ms)
 * @param {number} endMs    fim (epoch ms)
 * @param {{days:number[], start:string, end:string}} cfg
 *        days: dias úteis no padrão de Date.getDay() -> 0=domingo ... 6=sábado.
 *              Ex.: [1,2,3,4,5] = segunda a sexta.
 *        start/end: "HH:MM" do expediente.
 * @returns {number} ms dentro do expediente
 */
export function businessMsBetween(startMs, endMs, cfg) {
  if (!(endMs > startMs)) return 0;

  const workDays = new Set(cfg && cfg.days ? cfg.days : [1, 2, 3, 4, 5]);
  const [sh, sm] = parseHM(cfg ? cfg.start : '08:00');
  const [eh, em] = parseHM(cfg ? cfg.end : '18:00');

  let total = 0;

  // Percorremos dia a dia, do dia de início ao dia de fim, somando a
  // interseção entre [startMs, endMs] e a janela de expediente daquele dia.
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);

  // Trava de segurança para nunca entrar em laço infinito (~10 anos de dias).
  let guard = 0;
  while (cursor.getTime() <= endMs && guard < 4000) {
    guard += 1;
    if (workDays.has(cursor.getDay())) {
      const winStart = new Date(cursor); winStart.setHours(sh, sm, 0, 0);
      const winEnd = new Date(cursor);   winEnd.setHours(eh, em, 0, 0);

      const a = Math.max(startMs, winStart.getTime());
      const b = Math.min(endMs, winEnd.getTime());
      if (b > a) total += b - a;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}
