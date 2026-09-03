/**
 * Aplica o subset de SnapshotData correspondente às entidades vivas do mundo
 * (Npc/Asteroid/Anomaly/Wreck) em entidades bitecs.
 *
 * Mantém um mapa serverId -> eid e metadados extras (payload completo) que
 * não cabem nos TypedArrays dos componentes ECS.
 */

import { addComponent, addEntity, removeEntity } from 'bitecs';
import { world } from '../world';
import { Transform } from '../components/transform';
import {
  NpcTag,
  AsteroidTag,
  AnomalyTag,
  WreckTag,
  WorldEntityKind,
} from '../components/worldEntities';
import type {
  EntityPayload,
  EntityState,
  SnapshotData,
  WorldChunkData,
} from '../../net/protocol';
import {
  pushSample,
  renderDelay,
  sampleAt,
  type History,
} from '../../game/interpolation';

export type WorldEntityKindStr = 'Npc' | 'Asteroid' | 'Anomaly' | 'Wreck';

export interface WorldEntityMeta {
  serverId: number;
  kind: WorldEntityKindStr;
  subKind: number;
  radius: number;
  payload: EntityPayload;
}

const byServerId = new Map<number, number>(); // server id -> eid
const meta = new Map<number, WorldEntityMeta>(); // eid -> meta
/**
 * Histórico de snapshots dos NPCs (os únicos móveis daqui).
 *
 * Asteroides e anomalias são estáticos e chegam por `WorldChunk`, então
 * não precisam de interpolação — escrevem a posição uma vez e pronto.
 */
const npcHistory = new Map<number, History>();

function isWorldEntityKind(k: EntityState['kind']): k is WorldEntityKindStr {
  return k === 'Npc' || k === 'Asteroid' || k === 'Anomaly' || k === 'Wreck';
}

function internalKindIndex(k: WorldEntityKindStr): number {
  switch (k) {
    case 'Npc':
      return 0;
    case 'Asteroid':
      return 1;
    case 'Anomaly':
      return 2;
    case 'Wreck':
      return 3;
  }
}

function applyPayloadToKind(
  e: EntityState,
): { subKind: number; radius: number } | null {
  if (!e.payload) return null;
  switch (e.payload.type) {
    case 'Npc':
      return { subKind: e.payload.payload.archetype, radius: e.payload.payload.radius };
    case 'Asteroid':
      return { subKind: e.payload.payload.kind, radius: e.payload.payload.radius };
    case 'Anomaly':
      return { subKind: e.payload.payload.kind, radius: e.payload.payload.radius };
    case 'Wreck':
      return { subKind: 0, radius: e.payload.payload.radius };
    case 'Vortex':
      // Vórtices não são entidades de mundo: têm renderizador próprio,
      // porque expiram em segundos e precisam de efeito animado.
      return null;
    case 'Projectile':
    case 'Torpedo':
      // Idem: projéteis e torpedos vivem no renderizador de entidades
      // remotas, que já os interpola quadro a quadro.
      return null;
  }
}

function addTag(eid: number, k: WorldEntityKindStr): void {
  switch (k) {
    case 'Npc':
      addComponent(world, NpcTag, eid);
      break;
    case 'Asteroid':
      addComponent(world, AsteroidTag, eid);
      break;
    case 'Anomaly':
      addComponent(world, AnomalyTag, eid);
      break;
    case 'Wreck':
      addComponent(world, WreckTag, eid);
      break;
  }
}

/**
 * Aplica as entidades vivas do mundo a partir de um snapshot.
 * Idempotente: pode ser chamado a 20Hz.
 */
/**
 * Insere ou atualiza uma entidade de mundo a partir do estado recebido.
 * Devolve o eid, ou `undefined` se o payload não permitir classificá-la.
 */
function upsert(e: EntityState): number | undefined {
  if (!isWorldEntityKind(e.kind)) return undefined;
  if (!e.payload) return undefined; // payload obrigatório para essas categorias
  const info = applyPayloadToKind(e);
  if (!info) return undefined;

  let eid = byServerId.get(e.id);
  if (eid === undefined) {
    eid = addEntity(world);
    addComponent(world, Transform, eid);
    addComponent(world, WorldEntityKind, eid);
    addTag(eid, e.kind);
    byServerId.set(e.id, eid);
    meta.set(eid, {
      serverId: e.id,
      kind: e.kind,
      subKind: info.subKind,
      radius: info.radius,
      payload: e.payload,
    });
  }

  Transform.posX[eid] = e.pos[0];
  Transform.posY[eid] = e.pos[1];
  Transform.posZ[eid] = e.pos[2];
  Transform.rotX[eid] = e.rot[0];
  Transform.rotY[eid] = e.rot[1];
  Transform.rotZ[eid] = e.rot[2];
  Transform.scale[eid] = 1;

  WorldEntityKind.kind[eid] = internalKindIndex(e.kind);
  WorldEntityKind.subKind[eid] = info.subKind;
  WorldEntityKind.radius[eid] = info.radius;

  const m = meta.get(eid);
  if (m) {
    m.subKind = info.subKind;
    m.radius = info.radius;
    m.payload = e.payload;
  }
  return eid;
}

/** Remove uma entidade pelo id do servidor. */
function drop(serverId: number): void {
  const eid = byServerId.get(serverId);
  if (eid === undefined) return;
  removeEntity(world, eid);
  byServerId.delete(serverId);
  meta.delete(eid);
  npcHistory.delete(eid);
}

/** Escreve a posição interpolada dos NPCs. Chamar uma vez por quadro. */
export function interpolateWorldEntities(nowMs?: number): void {
  const now = nowMs ?? performance.now();
  for (const [eid, h] of npcHistory) {
    const s = sampleAt(h, now - renderDelay(h));
    if (!s) continue;
    Transform.posX[eid] = s.pos[0];
    Transform.posY[eid] = s.pos[1];
    Transform.posZ[eid] = s.pos[2];
  }
}

/**
 * Aplica as entidades DINÂMICAS de mundo do snapshot — hoje só NPCs.
 *
 * No protocolo v3 asteroides, anomalias e destroços não vêm mais aqui:
 * eles chegam por `applyWorldChunk`. Por isso a varredura de remoção
 * abaixo considera apenas NPCs — antes ela apagava tudo que faltasse no
 * snapshot, o que com v3 significaria destruir o cenário inteiro a cada
 * tick.
 */
export function applyWorldEntities(snap: SnapshotData, receivedAt?: number): void {
  const now = receivedAt ?? performance.now();
  const seenNpcs = new Set<number>();

  for (const e of snap.entities) {
    if (e.kind !== 'Npc') continue;
    const eid = upsert(e);
    if (eid === undefined) continue;
    seenNpcs.add(e.id);

    // NPCs se movem: entram na interpolação como as naves.
    let h = npcHistory.get(eid);
    if (!h) {
      h = [];
      npcHistory.set(eid, h);
    }
    pushSample(h, {
      t: now,
      pos: [e.pos[0], e.pos[1], e.pos[2]],
      quat: [e.rot[0], e.rot[1], e.rot[2], e.rot[3]],
    });
  }

  for (const [serverId, eid] of byServerId) {
    const m = meta.get(eid);
    // Só NPCs saem por ausência; estáticos só saem por chunk/destroy.
    if (m?.kind !== 'Npc') continue;
    if (!seenNpcs.has(serverId)) drop(serverId);
  }
}

/**
 * Aplica um lote de entidades ESTÁTICAS (asteroides, anomalias, destroços).
 *
 * `entities` traz o que acabou de entrar no raio de interesse; `expired`,
 * o que saiu. Como elas não se movem, o servidor não as reenvia a cada
 * tick — o estado aqui é acumulado entre lotes.
 */
export function applyWorldChunk(chunk: WorldChunkData): void {
  for (const e of chunk.entities) upsert(e);
  for (const id of chunk.expired) drop(id);
}

/**
 * Handler de EntityDestroyed: remove imediatamente sem esperar próximo snapshot.
 */
export function handleWorldEntityDestroyed(entityId: number): void {
  drop(entityId);
}

export function getWorldEntityByServerId(serverId: number): number | undefined {
  return byServerId.get(serverId);
}

export function getWorldEntityMeta(eid: number): WorldEntityMeta | undefined {
  return meta.get(eid);
}

export function getAllWorldEntities(): ReadonlyMap<number, number> {
  return byServerId;
}

/** Reseta o estado (útil entre desconexões ou unload). */
export function clearWorldEntities(): void {
  for (const eid of byServerId.values()) {
    removeEntity(world, eid);
  }
  byServerId.clear();
  meta.clear();
}
