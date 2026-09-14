/**
 * storage.js — a ÚNICA camada que conversa com o armazenamento do Trello.
 *
 * Tudo é gravado via `t.set(escopo, visibilidade, chave, valor)` e lido via
 * `t.get(...)`. Nada de servidor próprio, nada de tokens.
 *
 * ONDE OS DADOS FICAM:
 *   - Configuração do quadro  -> escopo 'board', visibilidade 'shared', chave 'config'
 *   - Estado de cada card     -> escopo 'card',  visibilidade 'shared', chave 'tt'
 *
 * Por que 'shared' e não 'private'? Porque é uma ferramenta de EQUIPE: todos os
 * membros do quadro precisam ver o mesmo cronômetro. 'shared' NÃO deve guardar
 * segredos (tokens etc.) — e aqui não guardamos nenhum. O Trello inclusive
 * bloqueia gravar chaves com aparência de segredo em 'shared'.
 *
 * LIMITES (documentados pelo Trello):
 *   - card/shared:  4096 caracteres
 *   - board/shared: 8192 caracteres
 * Por isso o estado é compacto (timestamps numéricos) e o histórico rotaciona.
 */

import { normalize, reconcile, computeTotals } from './tracker.js';
import { now } from '../utils/time.js';

const CONFIG_KEY = 'config';
const CARD_KEY = 'tt';

export const DEFAULT_CONFIG = Object.freeze({
  startListId: null,     // lista que INICIA o cronômetro (ex.: "Em andamento")
  doneListId: null,      // lista que FINALIZA (ex.: "Concluído")
  todoListId: null,      // opcional: lista "A fazer" (pausa ao voltar pra cá)
  countPauses: true,     // descontar pausas do tempo efetivo?
  timeFormat: 'hm',      // 'hm' | 'hms' | 'clock'
  showBadge: true,       // exibir badge na frente do card?
  businessHoursOnly: false,               // contar só horas úteis? (preparado)
  business: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' },
});

// -- configuração do quadro -----------------------------------------------

export async function getConfig(t) {
  const stored = await t.get('board', 'shared', CONFIG_KEY);
  return {
    ...DEFAULT_CONFIG,
    ...(stored || {}),
    business: { ...DEFAULT_CONFIG.business, ...((stored && stored.business) || {}) },
  };
}

export async function saveConfig(t, config) {
  return t.set('board', 'shared', CONFIG_KEY, config);
}

// -- estado do card --------------------------------------------------------

export async function getState(t) {
  const raw = await t.get('card', 'shared', CARD_KEY);
  return normalize(raw);
}

export async function saveState(t, state) {
  return t.set('card', 'shared', CARD_KEY, state);
}

/**
 * Aplica um comando manual (start/pause/resume/finish do tracker) e persiste.
 * @param {*} t
 * @param {(state:object, at:number)=>object} op  função pura do tracker
 */
export async function apply(t, op) {
  const state = await getState(t);
  const next = op(state, now());
  if (next !== state) await saveState(t, next);
  return next;
}

/**
 * Lê o estado + a lista atual do card, reconcilia (detecção de movimento) e
 * grava SÓ se algo mudou. É o coração da automação; deve ser chamado nos
 * pontos de renderização (badge, detalhes, seção).
 *
 * Usamos `card.dateLastActivity` como melhor aproximação do horário do
 * movimento quando disponível; caso contrário, o "agora".
 */
export async function reconcileAndPersist(t, config) {
  const [state, card] = await Promise.all([
    getState(t),
    t.card('idList', 'dateLastActivity'),
  ]);
  const at = card && card.dateLastActivity ? new Date(card.dateLastActivity).getTime() : now();
  const { state: next, changed } = reconcile(state, card && card.idList, config, at);
  if (changed) await saveState(t, next);
  return next;
}

/** Atalho conveniente usado pelas telas para obter estado + totais já calculados. */
export async function getStateAndTotals(t, config) {
  const state = await getState(t);
  return { state, totals: computeTotals(state, now(), config) };
}
