/**
 * report.js — agregações do relatório. PURO (nenhuma dependência do Trello).
 *
 * Toda a matemática de "dias úteis ativos" e de agrupamento por semana/mês/ano
 * vive aqui, isolada e testável. A tela (`reportView.js`) apenas busca os dados
 * no Trello, chama `buildReport()` e desenha.
 *
 * ---------------------------------------------------------------------------
 * O QUE É "1 DIA ATIVO" (definição acordada — opção A)
 * ---------------------------------------------------------------------------
 * É cada DIA ÚTIL DISTINTO tocado por uma sessão do card. Sábados e domingos
 * (ou o que `config.business.days` definir) não contam. Como as sessões só
 * existem enquanto o card está rodando/pausado e terminam ao ir para
 * "Concluído", a contagem naturalmente PARA no concluído.
 *
 * Aproximação honesta: contamos os dias úteis do INTERVALO da sessão
 * (início→fim). Um dia inteiro passado em pausa dentro desse intervalo ainda é
 * contado. Contar com precisão "só dias com trabalho real" exigiria guardar
 * cada intervalo de pausa (mudança de schema) — fica como refinamento futuro.
 *
 * O agrupamento por semana/mês/ano é AUTOMÁTICO pelo calendário: a partir do
 * timestamp de cada sessão, derivamos a semana ISO (começa na segunda) e o mês.
 * O usuário nunca informa datas de corte. (Usa o fuso do navegador — mesma
 * ressalva das horas úteis.)
 */

import { computeTotals, sessionEffectiveMs, Status } from './tracker.js';

const DEFAULT_DAYS = [1, 2, 3, 4, 5]; // seg..sex (padrão de Date.getDay())

// -- chaves de dia / semana / mês ------------------------------------------

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Lista das chaves 'YYYY-MM-DD' dos DIAS ÚTEIS tocados por [startMs, endMs].
 * @param {number[]} businessDays  dias válidos no padrão Date.getDay()
 */
export function businessDayKeys(startMs, endMs, businessDays = DEFAULT_DAYS) {
  const set = new Set(businessDays && businessDays.length ? businessDays : DEFAULT_DAYS);
  const out = [];
  if (!(endMs >= startMs)) return out;
  const cur = new Date(startMs);
  cur.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cur.getTime() <= endMs && guard < 4000) {
    guard += 1;
    if (set.has(cur.getDay())) out.push(dayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Total de dias úteis distintos ativos de um card (união de todas as sessões). */
export function cardActiveDays(state, at, config) {
  const bd = (config && config.business && config.business.days) || DEFAULT_DAYS;
  const set = new Set();
  for (const s of state.sessions) {
    for (const k of businessDayKeys(s.startedAt, s.endedAt, bd)) set.add(k);
  }
  if (state.session) {
    for (const k of businessDayKeys(state.session.startedAt, at, bd)) set.add(k);
  }
  return set.size;
}

/**
 * Data de CRIAÇÃO de um card, derivada do próprio ID do Trello.
 * Os 8 primeiros dígitos hex do ID são o timestamp Unix (segundos) da criação.
 * 100% client-side — não precisa de API nem token. Retorna ms, ou null.
 */
export function creationMsFromId(id) {
  if (typeof id !== 'string' || id.length < 8) return null;
  const secs = parseInt(id.slice(0, 8), 16);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

/**
 * IDADE do card em dias úteis — IDÊNTICA ao Power-Up "Contagem de Dias".
 *
 * Como o Contagem de Dias não guarda nada (deriva tudo do ID do card), aqui
 * recalculamos com a MESMA regra, sem precisar ler os dados dele:
 *   - o DIA DA CRIAÇÃO conta como 0 (a contagem começa no dia seguinte);
 *   - fins de semana (fora de business.days) não contam;
 *   - CONGELA quando o card é marcado como CONCLUÍDO no checkbox nativo
 *     (`dueComplete`): aí o fim passa a ser a última atividade do card
 *     (`dateLastActivity`), que é a melhor aproximação sem guardar data.
 *
 * @param {number|null} createdAtMs  criação (ms), via creationMsFromId(card.id)
 * @param {{dueComplete?:boolean, dateLastActivity?:string|number}} card
 * @param {number} at   "agora" (ms)
 */
export function cardDays(createdAtMs, card, at, config) {
  if (createdAtMs == null) return 0;
  const bd = (config && config.business && config.business.days) || DEFAULT_DAYS;
  const done = !!(card && card.dueComplete);
  let end = at;
  if (done && card && card.dateLastActivity != null) {
    const la = new Date(card.dateLastActivity).getTime();
    if (Number.isFinite(la)) end = la; // congela no momento (aprox.) da conclusão
  }
  // criação = dia 0: começa a contar no dia útil seguinte ao da criação
  const start = new Date(createdAtMs);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  return businessDayKeys(start.getTime(), end, bd).length;
}

/** Segunda-feira (00:00 local) da semana que contém `ms`. */
function mondayOf(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const off = (d.getDay() + 6) % 7; // seg=0 ... dom=6
  d.setDate(d.getDate() - off);
  return d;
}

/** Semana ISO (segunda como 1º dia; a quinta define o ano). */
export function isoWeek(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3); // quinta desta semana
  const firstThu = new Date(d.getFullYear(), 0, 4);
  const firstDay = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 864e5));
  return { year: d.getFullYear(), week };
}

export function isoWeekKey(ms) {
  const { year, week } = isoWeek(ms);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const dm = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

function weekLabel(ms) {
  const { week } = isoWeek(ms);
  const mon = mondayOf(ms);
  const fri = new Date(mon); fri.setDate(fri.getDate() + 4); // seg→sex (não mostra fim de semana)
  return `Semana ${String(week).padStart(2, '0')} · ${dm.format(mon)}–${dm.format(fri)}`;
}

export function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const mf = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
function monthLabel(ms) {
  const d = new Date(ms);
  const s = mf.format(new Date(d.getFullYear(), d.getMonth(), 1));
  return s.charAt(0).toUpperCase() + s.slice(1); // "Setembro de 2026"
}

/**
 * Tempo efetivo por MEMBRO (para o painel de gráficos). Como o cronômetro do
 * card é compartilhado, o tempo de um card é atribuído a CADA membro atribuído
 * a ele (atribuição compartilhada — não é "tempo individual").
 * @param {{memberIds:Iterable<string>, state:object}[]} cards
 * @returns {{memberId:string, effectiveMs:number, cardCount:number}[]} desc
 */
export function timeByMember(cards, at, config) {
  const map = new Map();
  for (const c of cards) {
    const eff = computeTotals(c.state, at, config).effectiveMs;
    if (eff <= 0) continue;
    for (const id of c.memberIds) {
      const cur = map.get(id) || { memberId: id, effectiveMs: 0, cardCount: 0 };
      cur.effectiveMs += eff;
      cur.cardCount += 1;
      map.set(id, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.effectiveMs - a.effectiveMs);
}

/**
 * Cards CONCLUÍDOS por membro, por semana (base da aba "Bonificação").
 * Um card conta quando está "Concluído"; é atribuído à SEMANA da sua data de
 * conclusão e a CADA membro atribuído a ele (atribuição compartilhada, como no
 * timeByMember). Cards concluídos sem membro não entram (como na planilha).
 * @param {{name:string, memberIds:Iterable<string>, state:object}[]} cards
 * @returns {{ weeks:{key:string,label:string}[], rows:{memberId:string, perWeek:Object, total:number}[] }}
 */
export function concludedByMember(cards, at, config, monthFilter) {
  const monthsSet = new Set();
  const weekKeys = new Map(); // key -> {key,label,ts}
  const members = new Map();  // memberId -> {memberId, perWeek, total}
  for (const c of cards) {
    if (!c.state || c.state.status !== Status.DONE) continue;
    const end = computeTotals(c.state, at, config).lastEnd;
    if (end == null) continue;
    monthsSet.add(monthKey(end));
    if (monthFilter && monthKey(end) !== monthFilter) continue; // escopo do mês
    const wk = isoWeekKey(end);
    if (!weekKeys.has(wk)) weekKeys.set(wk, { key: wk, label: weekLabel(end), ts: mondayOf(end).getTime() });
    for (const id of c.memberIds) {
      let m = members.get(id);
      if (!m) { m = { memberId: id, perWeek: {}, total: 0 }; members.set(id, m); }
      m.perWeek[wk] = (m.perWeek[wk] || 0) + 1;
      m.total += 1;
    }
  }
  const weeks = Array.from(weekKeys.values()).sort((a, b) => a.ts - b.ts).map(({ key, label }) => ({ key, label }));
  const rows = Array.from(members.values()).sort((a, b) => b.total - a.total);
  const months = Array.from(monthsSet).sort().reverse(); // mais recente primeiro
  return { weeks, rows, months };
}

/**
 * RESUMO DE DIAS (histograma) — projetos CONCLUÍDOS agrupados por quantos dias
 * úteis levaram (a "idade em dias", igual à coluna do relatório e ao Power-Up
 * Contagem de Dias). Conta quantos projetos caíram em cada valor de dias.
 *
 * Um card entra quando está CONCLUÍDO (dueComplete = checkbox nativo). É contado
 * na SEMANA/MÊS da conclusão (dateLastActivity, o mesmo instante que congela a
 * idade). Retorna a distribuição geral + por semana + por mês.
 *
 * @param {{createdAt:number, dueComplete?:boolean, dateLastActivity?:string|number}[]} cards
 * @returns {{
 *   general: {days:number,count:number}[], generalTotal:number,
 *   weekly:  {key:string,label:string,dist:{days:number,count:number}[],total:number}[],
 *   monthly: {key:string,label:string,dist:{days:number,count:number}[],total:number}[]
 * }}
 */
export function daysSummary(cards, at, config) {
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const general = new Map();
  const weeks = new Map();
  const months = new Map();

  for (const c of cards) {
    if (!c || !c.dueComplete) continue; // só concluídos (checkbox nativo)
    const age = cardDays(c.createdAt, c, at, config);
    bump(general, age);
    const compMs = c.dateLastActivity != null ? new Date(c.dateLastActivity).getTime() : NaN;
    if (!Number.isFinite(compMs)) continue;
    const wk = isoWeekKey(compMs);
    if (!weeks.has(wk)) weeks.set(wk, { key: wk, label: weekLabel(compMs), ts: mondayOf(compMs).getTime(), dist: new Map(), total: 0 });
    const w = weeks.get(wk); bump(w.dist, age); w.total += 1;
    const mk = monthKey(compMs);
    const md = new Date(compMs);
    if (!months.has(mk)) months.set(mk, { key: mk, label: monthLabel(compMs), ts: new Date(md.getFullYear(), md.getMonth(), 1).getTime(), dist: new Map(), total: 0 });
    const m = months.get(mk); bump(m.dist, age); m.total += 1;
  }

  const toSorted = (map) => Array.from(map.entries())
    .map(([days, count]) => ({ days: Number(days), count }))
    .sort((a, b) => a.days - b.days);
  const finalize = (map) => Array.from(map.values())
    .sort((a, b) => b.ts - a.ts) // período mais recente primeiro
    .map((p) => ({ key: p.key, label: p.label, dist: toSorted(p.dist), total: p.total }));

  return {
    general: toSorted(general),
    generalTotal: Array.from(general.values()).reduce((s, n) => s + n, 0),
    weekly: finalize(weeks),
    monthly: finalize(months),
  };
}

/** Índice da semana DENTRO do mês (1, 2, 3…), contando a partir da semana que contém o dia 1. */
function weekOfMonthIndex(mondayMs, atMs) {
  const d = new Date(atMs);
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const firstMon = mondayOf(firstOfMonth); // segunda da semana que contém o dia 1
  return Math.round((mondayMs - firstMon.getTime()) / (7 * 864e5)) + 1;
}

/**
 * RESUMO DE DIAS do MÊS ATUAL (histograma). Igual ao daysSummary, mas pega SÓ
 * os projetos concluídos no MÊS corrente (monthKey(at)), e numera as semanas
 * dentro do mês (Semana 1, 2, 3…). Começa vazio a cada mês novo — sem puxar
 * histórico antigo.
 *
 * @returns {{ month:{key,label,dist,total}, weeks:{key,label,weekOfMonth,dist,total}[] }}
 */
export function daysSummaryMonth(cards, at, config) {
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const curMonth = monthKey(at);
  const monthDist = new Map();
  const weeks = new Map(); // weekKey -> {key, monMs, dist, total}

  for (const c of cards) {
    if (!c || !c.dueComplete) continue;
    const compMs = c.dateLastActivity != null ? new Date(c.dateLastActivity).getTime() : NaN;
    if (!Number.isFinite(compMs) || monthKey(compMs) !== curMonth) continue; // só o mês atual
    const age = cardDays(c.createdAt, c, at, config);
    bump(monthDist, age);
    const wk = isoWeekKey(compMs);
    if (!weeks.has(wk)) weeks.set(wk, { key: wk, monMs: mondayOf(compMs).getTime(), dist: new Map(), total: 0 });
    const w = weeks.get(wk); bump(w.dist, age); w.total += 1;
  }

  const toSorted = (m) => Array.from(m.entries()).map(([days, count]) => ({ days: Number(days), count })).sort((a, b) => a.days - b.days);
  // A semana 1 começa nos PRIMEIROS DIAS DO MÊS (não no mês anterior): o rótulo
  // é "cortado" nas bordas do mês — início nunca antes do dia 1, fim nunca depois
  // do último dia do mês.
  const dAt = new Date(at);
  const firstOfMonth = new Date(dAt.getFullYear(), dAt.getMonth(), 1).getTime();
  const lastOfMonth = new Date(dAt.getFullYear(), dAt.getMonth() + 1, 0).getTime();
  const weekArr = Array.from(weeks.values()).sort((a, b) => a.monMs - b.monMs).map((w) => {
    const friDate = new Date(w.monMs); friDate.setDate(friDate.getDate() + 4);
    const start = new Date(Math.max(w.monMs, firstOfMonth));
    const end = new Date(Math.min(friDate.getTime(), lastOfMonth));
    const idx = weekOfMonthIndex(w.monMs, at);
    return { key: w.key, label: `Semana ${idx} · ${dm.format(start)}–${dm.format(end)}`, weekOfMonth: idx, dist: toSorted(w.dist), total: w.total };
  });

  return {
    month: { key: curMonth, label: monthLabel(at), dist: toSorted(monthDist), total: Array.from(monthDist.values()).reduce((s, n) => s + n, 0) },
    weeks: weekArr,
  };
}

/**
 * QUANTITATIVO POR ETIQUETA — quantos projetos CONCLUÍDOS no mês atual têm cada
 * etiqueta-chave. Um card conta em todas as etiquetas-chave que ele tiver.
 * O casamento de nome é tolerante a acento/caixa: igual, ou a chave aparece como
 * palavra inteira no nome da etiqueta (chaves com 5+ letras também casam por "contém").
 *
 * @param {{dueComplete?:boolean, dateLastActivity?:string|number, labels?:string[]}[]} cards
 * @param {number} at
 * @param {string[]} keyLabels  nomes das etiquetas a contar, na ordem desejada
 * @returns {{key:string, count:number}[]}
 */
export function labelCounts(cards, at, keyLabels) {
  const curMonth = monthKey(at);
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const matches = (labelName, key) => {
    const nl = norm(labelName); const nk = norm(key);
    if (!nl || !nk) return false;
    if (nl === nk) return true;
    if (nl.split(' ').includes(nk)) return true;      // chave como palavra inteira
    return nk.length >= 5 && nl.includes(nk);          // frases longas: "contém"
  };
  const counts = keyLabels.map((k) => ({ key: k, count: 0 }));
  for (const c of cards) {
    if (!c || !c.dueComplete) continue;
    const compMs = c.dateLastActivity != null ? new Date(c.dateLastActivity).getTime() : NaN;
    if (!Number.isFinite(compMs) || monthKey(compMs) !== curMonth) continue;
    const labels = Array.isArray(c.labels) ? c.labels : [];
    for (let i = 0; i < keyLabels.length; i++) {
      if (labels.some((ln) => matches(ln, keyLabels[i]))) counts[i].count += 1;
    }
  }
  return counts;
}

/**
 * Bonificação (R$) de uma pessoa, a partir do total entregue no mês e da meta.
 * Regra: entregue < mín → 0; mín ≤ entregue < máx → bonusMin; entregue ≥ máx → bonusMax.
 * @param {number} entregue  cards concluídos no mês
 * @param {{min:number,max:number,bonusMin:number,bonusMax:number}} meta
 * @returns {number|null} valor em R$, ou null se a meta não estiver configurada
 */
export function bonusFor(entregue, meta) {
  if (!meta || meta.min == null || meta.min === '') return null;
  const min = Number(meta.min);
  const max = meta.max == null || meta.max === '' ? min : Number(meta.max);
  const bMin = Number(meta.bonusMin || 0);
  const bMax = Number(meta.bonusMax || 0);
  if (entregue >= max) return bMax;
  if (entregue >= min) return bMin;
  return 0;
}

// -- construção do relatório -----------------------------------------------

/**
 * @param {{name:string, lista:string, state:object}[]} cards  estados já normalizados
 * @param {number} at   "agora" (ms)
 * @param {object} config
 * @returns {{
 *   general: object[], sessions: object[],
 *   weekly: object[], monthly: object[],
 *   totals: {trackedCount:number, visibleCount:number, totalMs:number}
 * }}
 */
export function buildReport(cards, at, config) {
  const bd = (config && config.business && config.business.days) || DEFAULT_DAYS;
  const general = [];
  const sessionRows = [];
  const weekMap = new Map();
  const monthMap = new Map();

  const addTo = (map, key, label, ts, card, effMs, pausedMs, dayKeys) => {
    let period = map.get(key);
    if (!period) { period = { key, label, ts, cards: new Map(), dayKeys: new Set() }; map.set(key, period); }
    let agg = period.cards.get(card);
    if (!agg) { agg = { card, effectiveMs: 0, pausedMs: 0, sessions: 0, dayKeys: new Set() }; period.cards.set(card, agg); }
    agg.effectiveMs += effMs;
    agg.pausedMs += pausedMs;
    agg.sessions += 1;
    for (const k of dayKeys) { agg.dayKeys.add(k); period.dayKeys.add(k); }
  };

  let totalMs = 0;
  let trackedCount = 0;

  for (const c of cards) {
    const st = c.state;
    const totals = computeTotals(st, at, config);
    const days = cardDays(c.createdAt, c, at, config); // idade (igual ao PU Contagem de Dias)
    const tracked = st.status !== Status.IDLE;
    if (tracked) { trackedCount += 1; totalMs += totals.effectiveMs; }

    general.push({
      card: c.name, lista: c.lista, status: st.status,
      inicio: totals.firstStart, conclusao: totals.lastEnd,
      effectiveMs: totals.effectiveMs, pausedMs: totals.pausedMs,
      sessions: totals.sessionsCount, days, tracked,
      labels: Array.isArray(c.labels) ? c.labels : [],
    });

    // sessões concluídas + a aberta (se houver)
    const items = st.sessions.map((s) => ({ s, open: false }));
    if (st.session) items.push({ s: st.session, open: true });

    for (const { s, open } of items) {
      const endRef = open ? at : s.endedAt;
      const effMs = sessionEffectiveMs(open ? st.session : s, at, config);
      const pausedMs = open
        ? ((st.session.pausedMs || 0) + (st.session.pauseStartedAt ? at - st.session.pauseStartedAt : 0))
        : (s.pausedMs || 0);
      const dayKeys = businessDayKeys(s.startedAt, endRef, bd);
      sessionRows.push({
        card: c.name, startedAt: s.startedAt, endedAt: open ? null : s.endedAt,
        effectiveMs: effMs, pausedMs, days: dayKeys.length, open,
      });
      // Agrupa pela CONCLUSÃO (endRef = fim da sessão; ou "agora" se ainda aberta),
      // não pelo início — assim um card que terminou nesta semana aparece nela,
      // mesmo que tenha começado numa semana anterior. Alinha com a aba Bonificação.
      addTo(weekMap, isoWeekKey(endRef), weekLabel(endRef), mondayOf(endRef).getTime(), c.name, effMs, pausedMs, dayKeys);
      const md = new Date(endRef);
      addTo(monthMap, monthKey(endRef), monthLabel(endRef), new Date(md.getFullYear(), md.getMonth(), 1).getTime(), c.name, effMs, pausedMs, dayKeys);
    }
  }

  const finalize = (map) => Array.from(map.values())
    .sort((a, b) => b.ts - a.ts) // período mais recente primeiro
    .map((p) => {
      const rows = Array.from(p.cards.values())
        .map((a) => ({ card: a.card, effectiveMs: a.effectiveMs, pausedMs: a.pausedMs, sessions: a.sessions, days: a.dayKeys.size }))
        .sort((x, y) => (y.effectiveMs - x.effectiveMs) || x.card.localeCompare(y.card, 'pt-BR'));
      return {
        key: p.key, label: p.label, rows,
        totalMs: rows.reduce((s, r) => s + r.effectiveMs, 0),
        totalPausedMs: rows.reduce((s, r) => s + r.pausedMs, 0),
        totalSessions: rows.reduce((s, r) => s + r.sessions, 0),
        totalDays: p.dayKeys.size,
      };
    });

  general.sort((a, b) => {
    if (a.tracked !== b.tracked) return a.tracked ? -1 : 1;
    if (b.effectiveMs !== a.effectiveMs) return b.effectiveMs - a.effectiveMs;
    return a.card.localeCompare(b.card, 'pt-BR');
  });
  sessionRows.sort((a, b) => b.startedAt - a.startedAt);

  return {
    general,
    sessions: sessionRows,
    weekly: finalize(weekMap),
    monthly: finalize(monthMap),
    totals: { trackedCount, visibleCount: cards.length, totalMs },
  };
}
