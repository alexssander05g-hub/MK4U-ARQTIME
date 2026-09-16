/**
 * tracker.js — máquina de estados PURA do controle de tempo.
 *
 * Nenhuma função aqui fala com o Trello. Elas recebem o estado atual + o
 * "agora" (ms) e devolvem um NOVO estado. Manter a lógica pura significa que:
 *   - a contagem depende só de timestamps (sobrevive a fechar o navegador,
 *     desligar o PC, abrir de outra máquina — o estado mora no pluginData);
 *   - dá para testar cada transição sem subir o Trello;
 *   - a V2 (dashboard/relatórios/Sheets) reaproveita `computeTotals` direto.
 *
 * ---------------------------------------------------------------------------
 * MODELO DE DADOS (guardado no card, escopo shared, chave "tt")
 * ---------------------------------------------------------------------------
 *   {
 *     v: 1,                     // versão do schema, para migrações futuras
 *     status: 'idle'|'running'|'paused'|'done',
 *     lastListId: string|null,  // última lista conhecida (detecção de movimento)
 *     session: null | {         // a sessão ABERTA (em andamento), se houver
 *       startedAt: number,      // epoch ms
 *       pausedMs: number,       // soma das pausas já concluídas nesta sessão
 *       pauseStartedAt: number|null  // != null enquanto pausado
 *     },
 *     sessions: [ {             // sessões CONCLUÍDAS (reabertura cria outra)
 *       startedAt, endedAt, pausedMs
 *     } ],
 *     history: [ { at:number, type:string } ]   // limitado (rotaciona)
 *   }
 *
 * Repare que NÃO guardamos "tempo total" nem "tempo pausado": eles são
 * DERIVADOS dos timestamps por `computeTotals`. Guardar valores derivados só
 * criaria duas fontes de verdade que podem divergir. Essa é uma decisão de
 * arquitetura deliberada.
 */

import { businessMsBetween } from '../utils/businessTime.js';

export const SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 60; // mantém os últimos N eventos (protege o limite de 4096 chars)

export const Status = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  DONE: 'done',
});

/** Estado inicial de um card que nunca foi cronometrado. */
export function initState() {
  return {
    v: SCHEMA_VERSION,
    status: Status.IDLE,
    lastListId: null,
    session: null,
    sessions: [],
    history: [],
  };
}

/**
 * Garante que qualquer objeto lido do pluginData tenha a forma esperada
 * (e aplica migrações de schema quando a versão mudar no futuro).
 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return initState();
  const s = { ...initState(), ...raw };
  s.sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
  s.history = Array.isArray(raw.history) ? raw.history : [];
  s.session = raw.session && typeof raw.session === 'object' ? raw.session : null;
  // Ponto de migração: if (raw.v < SCHEMA_VERSION) { ... }
  s.v = SCHEMA_VERSION;
  return s;
}

// -- helpers internos ------------------------------------------------------

function pushHistory(state, type, at) {
  const history = state.history.concat([{ at, type }]);
  // rotaciona mantendo apenas os mais recentes
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  return { ...state, history };
}

const hasOpenSession = (s) => s.status === Status.RUNNING || s.status === Status.PAUSED;

// -- transições (comandos manuais) ----------------------------------------

/**
 * Iniciar / Retomar-por-novo-início.
 * - Se já existe sessão aberta, não faz nada (idempotente).
 * - Se estava 'idle' ou 'done', ABRE UMA NOVA SESSÃO. É exatamente isso que
 *   garante o requisito de "reabrir card cria nova sessão sem apagar histórico".
 */
export function start(state, at, meta = 'start') {
  if (hasOpenSession(state)) return state;
  let s = {
    ...state,
    status: Status.RUNNING,
    session: { startedAt: at, pausedMs: 0, pauseStartedAt: null },
  };
  return pushHistory(s, meta, at);
}

/** Pausar: só faz sentido se estiver rodando. */
export function pause(state, at, meta = 'pause') {
  if (state.status !== Status.RUNNING || !state.session) return state;
  const session = { ...state.session, pauseStartedAt: at };
  return pushHistory({ ...state, status: Status.PAUSED, session }, meta, at);
}

/** Retomar: fecha a pausa corrente somando-a ao acumulado. */
export function resume(state, at, meta = 'resume') {
  if (state.status !== Status.PAUSED || !state.session || !state.session.pauseStartedAt) return state;
  const pausedMs = state.session.pausedMs + (at - state.session.pauseStartedAt);
  const session = { ...state.session, pausedMs, pauseStartedAt: null };
  return pushHistory({ ...state, status: Status.RUNNING, session }, meta, at);
}

/** Finalizar: fecha a sessão aberta e a move para o array de sessões concluídas. */
export function finish(state, at, meta = 'finish') {
  if (!hasOpenSession(state) || !state.session) return state;
  // se estiver pausado ao finalizar, incorpora a pausa em aberto
  let pausedMs = state.session.pausedMs;
  if (state.session.pauseStartedAt) pausedMs += at - state.session.pauseStartedAt;

  const completed = { startedAt: state.session.startedAt, endedAt: at, pausedMs };
  const s = {
    ...state,
    status: Status.DONE,
    session: null,
    sessions: state.sessions.concat([completed]),
  };
  return pushHistory(s, meta, at);
}

// -- detecção automática por movimentação de lista -------------------------

/**
 * Reconcilia o estado com a lista atual do card.
 *
 * Chamado toda vez que o Trello re-renderiza o badge/detalhes do card (o que
 * acontece logo após um movimento). Comparamos a lista atual com a última
 * conhecida e reagimos:
 *
 *   entrou na lista de INÍCIO  -> retoma (se pausado) ou abre nova sessão
 *   entrou na lista de FIM     -> finaliza a sessão aberta
 *   entrou na lista "A FAZER"  -> pausa a sessão (não destrói nada)
 *
 * Retorna { state, changed }. `changed` diz se algo mudou de fato — só nesse
 * caso o chamador deve persistir (evita gravações desnecessárias).
 *
 * LIMITAÇÃO HONESTA: o Trello não emite evento de movimento para Power-Ups
 * sem backend. A detecção ocorre quando alguém com o Power-Up ativo VÊ o card.
 * Se o card for movido com o quadro fechado por todos, a transição é aplicada
 * na próxima renderização. O horário registrado é o do momento da detecção
 * (aproximação). Timestamps de servidor exatos exigem a REST API/webhooks (V2).
 */
export function reconcile(state, currentListId, config, at) {
  if (!currentListId || currentListId === state.lastListId) {
    // primeira vez que vemos o card: apenas memoriza a lista, sem efeitos,
    // a menos que ele já esteja na lista de início.
    if (state.lastListId == null && currentListId) {
      let s = { ...state, lastListId: currentListId };
      if (currentListId === config.startListId && !hasOpenSession(s)) {
        s = start(s, at, 'auto-start');
      }
      return { state: s, changed: s !== state };
    }
    return { state, changed: false };
  }

  let s = { ...state, lastListId: currentListId };

  if (config.startListId && currentListId === config.startListId) {
    if (s.status === Status.PAUSED) s = resume(s, at, 'auto-resume');
    else if (!hasOpenSession(s)) s = start(s, at, 'auto-start');
  } else if (config.doneListId && currentListId === config.doneListId) {
    if (hasOpenSession(s)) s = finish(s, at, 'auto-finish');
  } else if (config.todoListId && currentListId === config.todoListId) {
    if (s.status === Status.RUNNING) s = pause(s, at, 'auto-pause');
  }

  return { state: s, changed: true };
}

// -- seletor de totais (derivado, usado pela UI e pela V2) -----------------

function sessionEffective(startedAt, endedAt, pausedMs, config) {
  if (config.businessHoursOnly) {
    let biz = businessMsBetween(startedAt, endedAt, config.business);
    if (config.countPauses) biz = Math.max(0, biz - pausedMs);
    return biz;
  }
  const worked = endedAt - startedAt;
  return config.countPauses ? Math.max(0, worked - pausedMs) : worked;
}

/**
 * Tempo efetivo (ms) de UMA sessão — usado pelo relatório (semanal/mensal/por
 * sessão). Aceita tanto sessão concluída (tem `endedAt`) quanto a sessão aberta
 * (sem `endedAt`; usa `at` como fim e incorpora a pausa em aberto). Reaproveita
 * exatamente a mesma regra de `sessionEffective`, então bate com computeTotals.
 */
export function sessionEffectiveMs(session, at, config) {
  if (!session) return 0;
  if (session.endedAt != null) {
    return sessionEffective(session.startedAt, session.endedAt, session.pausedMs || 0, config);
  }
  const activePaused = (session.pausedMs || 0) +
    (session.pauseStartedAt ? at - session.pauseStartedAt : 0);
  return sessionEffective(session.startedAt, at, activePaused, config);
}

/**
 * Calcula todos os números exibidos, a partir dos timestamps.
 * @returns {{
 *   workedMs:number, pausedMs:number, effectiveMs:number,
 *   sessionsCount:number, firstStart:number|null, lastEnd:number|null
 * }}
 */
export function computeTotals(state, at, config) {
  let worked = 0, paused = 0, effective = 0;
  let firstStart = null, lastEnd = null;

  for (const s of state.sessions) {
    worked += s.endedAt - s.startedAt;
    paused += s.pausedMs;
    effective += sessionEffective(s.startedAt, s.endedAt, s.pausedMs, config);
    if (firstStart == null || s.startedAt < firstStart) firstStart = s.startedAt;
    if (lastEnd == null || s.endedAt > lastEnd) lastEnd = s.endedAt;
  }

  if (state.session) {
    const st = state.session.startedAt;
    const activePaused = state.session.pausedMs +
      (state.session.pauseStartedAt ? at - state.session.pauseStartedAt : 0);
    worked += at - st;
    paused += activePaused;
    effective += sessionEffective(st, at, activePaused, config);
    if (firstStart == null || st < firstStart) firstStart = st;
  }

  return {
    workedMs: worked,
    pausedMs: paused,
    effectiveMs: effective,
    sessionsCount: state.sessions.length + (state.session ? 1 : 0),
    firstStart,
    lastEnd: state.session ? null : lastEnd, // se há sessão aberta, "conclusão" não se aplica
  };
}
