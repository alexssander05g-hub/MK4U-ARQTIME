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
 * Dias úteis do card contados DESDE A CRIAÇÃO dele (sem contar fins de semana),
 * até agora — ou até a conclusão, quando o card está "Concluído" (a contagem
 * congela ao ir para a lista de fim). Se por algum motivo não der para derivar
 * a criação, cai para o primeiro início registrado.
 */
export function cardDays(createdAtMs, state, at, config) {
  const bd = (config && config.business && config.business.days) || DEFAULT_DAYS;
  const totals = computeTotals(state, at, config);
  const startMs = createdAtMs != null ? createdAtMs : totals.firstStart;
  if (startMs == null) return 0;
  const end = state.status === Status.DONE ? (totals.lastEnd || at) : at;
  return businessDayKeys(startMs, end, bd).length;
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
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  return `Semana ${String(week).padStart(2, '0')} · ${dm.format(mon)}–${dm.format(sun)}`;
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
    const days = cardDays(c.createdAt, st, at, config);
    const tracked = st.status !== Status.IDLE;
    if (tracked) { trackedCount += 1; totalMs += totals.effectiveMs; }

    general.push({
      card: c.name, lista: c.lista, status: st.status,
      inicio: totals.firstStart, conclusao: totals.lastEnd,
      effectiveMs: totals.effectiveMs, pausedMs: totals.pausedMs,
      sessions: totals.sessionsCount, days, tracked,
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
      addTo(weekMap, isoWeekKey(s.startedAt), weekLabel(s.startedAt), mondayOf(s.startedAt).getTime(), c.name, effMs, pausedMs, dayKeys);
      const md = new Date(s.startedAt);
      addTo(monthMap, monthKey(s.startedAt), monthLabel(s.startedAt), new Date(md.getFullYear(), md.getMonth(), 1).getTime(), c.name, effMs, pausedMs, dayKeys);
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
