/**
 * Aplica SnapshotData do servidor em entidades bitecs.
 *
 * - Cria entidades remotas conforme necessário (mapeadas por server id).
 * - Atualiza Transform (posX/Y/Z + quaternion armazenado em metadados).
 * - Remove entidades que sumiram do snapshot.
 *
 * Metadados extras (server id, display_name, hp, rotW) ficam em Map<eid, Meta>
 * porque a ECS de bitecs não tem slot dinâmico para string.
 */

import { addComponent, addEntity, defineComponent, removeEntity } from 'bitecs';
import { world } from '../world';
import { ShipTag } from '../components/ship';
import { Transform } from '../components/transform';
import type { EntityState, SnapshotData } from '../../net/protocol';
import {
  extrapolateWithVelocity,
  pushSample,
  renderDelay,
  sampleAt,
  type History,
} from '../../game/interpolation';

/** Marca entidade como remota (vinda do servidor), distinguindo da local. */
export const RemoteTag = defineComponent();

/** Marca projéteis (não devem ser tratados como Ship). */
export const ProjectileTag = defineComponent();

export interface RemoteMeta {
  serverId: number;
  kind: 'Ship' | 'Projectile' | 'Torpedo';
  displayName: string | null;
  hpRatio: number | null;
  /** Quaternion completo: rotX, rotY, rotZ, rotW. */
  quat: [number, number, number, number];
  /**
   * Velocidade linear do snapshot. Alimenta o rig de câmera (FOV por
   * velocidade, antecipação do olhar) e o rastro dos motores — sem ela
   * a câmera não tem como saber para onde a nave está indo.
   */
  vel: [number, number, number];
  /**
   * Aparência do projétil, quando a entidade é um tiro.
   *
   * Chega uma única vez, na criação: o servidor manda o payload em todo
   * snapshot, mas arma e carga não mudam durante o voo do projétil.
   */
  shot: ShotLook | null;
  /**
   * Dados do torpedo, quando a entidade é um.
   *
   * `locked` é o que decide o alerta: um torpedo que ainda persegue
   * exige reação, um que perdeu a trava só precisa ser evitado.
   */
  torpedo: TorpedoLook | null;
  /**
   * Time da nave. `0` = sem time, hostil a todos.
   *
   * Duas naves com o mesmo time não-zero são aliadas — e os tiros nem
   * acertam entre elas, então marcá-las como alvo seria mentira.
   */
  team: number;
}

/** Torpedo em voo, para o renderizador e o alerta. */
export interface TorpedoLook {
  dir: [number, number, number];
  radius: number;
  hpRatio: number;
  locked: boolean;
}

/** Arma e carga de um disparo, para o renderizador. */
export interface ShotLook {
  /** 0 cinético, 1 laser, 2 plasma, 3 lança. */
  visual: number;
  /** 0..1 */
  charge: number;
  radius: number;
}

const byServerId = new Map<number, number>(); // server id -> eid
const meta = new Map<number, RemoteMeta>(); // eid -> meta
/**
 * Histórico de snapshots por entidade.
 *
 * O `Transform` da ECS passou a guardar a posição INTERPOLADA (o que se
 * desenha); a verdade crua do servidor fica aqui. Antes o snapshot era
 * escrito direto no Transform e a entidade andava aos saltos, um passo a
 * cada ~66ms repetido por 4 quadros.
 */
const history = new Map<number, History>(); // eid -> amostras
const nameLabel = new Map<number, string>(); // serverId -> nome (para display)

/**
 * Aplica um snapshot completo. Idempotente: pode ser chamado a 20Hz.
 */
export function applySnapshot(snap: SnapshotData, receivedAt?: number): void {
  const now = receivedAt ?? performance.now();
  const seen = new Set<number>();

  for (const e of snap.entities) {
    // Ship, Projectile e Torpedo são gerenciados aqui; Npc, Asteroid,
    // Anomaly e Wreck pertencem ao sistema worldEntities.
    //
    // O torpedo estava fora desta lista e era DESCARTADO em silêncio: o
    // servidor o enviava, o cliente jogava fora, e o alerta de
    // perseguição nunca aparecia — a defesa contra ele dependia de o
    // jogador adivinhar.
    if (e.kind !== 'Ship' && e.kind !== 'Projectile' && e.kind !== 'Torpedo') continue;
    seen.add(e.id);
    let eid = byServerId.get(e.id);
    if (eid === undefined) {
      eid = addEntity(world);
      addComponent(world, Transform, eid);
      addComponent(world, RemoteTag, eid);
      if (e.kind === 'Ship') addComponent(world, ShipTag, eid);
      // Torpedo entra como projétil no ECS: o renderizador o distingue
      // pelo payload, e ele se move igual quadro a quadro.
      else addComponent(world, ProjectileTag, eid);
      byServerId.set(e.id, eid);
      meta.set(eid, {
        serverId: e.id,
        kind: e.kind,
        displayName: e.display_name,
        hpRatio: e.hp_ratio,
        quat: [e.rot[0], e.rot[1], e.rot[2], e.rot[3]],
        vel: [e.vel[0], e.vel[1], e.vel[2]],
        shot: e.payload?.type === 'Projectile' ? { ...e.payload.payload } : null,
        torpedo: e.payload?.type === 'Torpedo' ? { ...e.payload.payload } : null,
        team: e.payload?.type === 'Ship' ? e.payload.payload.team : 0,
      });
      if (e.display_name) nameLabel.set(e.id, e.display_name);
      console.info('[remoteShips] nova entidade', e.id, e.kind, e.display_name);
    }

    // Alimenta o histórico de interpolação em vez de escrever a
    // posição direto: quem escreve o Transform é `interpolateRemotes`.
    let h = history.get(eid);
    if (!h) {
      h = [];
      history.set(eid, h);
    }
    pushSample(h, {
      t: now,
      pos: [e.pos[0], e.pos[1], e.pos[2]],
      quat: [e.rot[0], e.rot[1], e.rot[2], e.rot[3]],
    });

    // Entidade nova: sem histórico não há o que interpolar, então
    // posiciona já para não aparecer na origem por um instante.
    if (h.length === 1) {
      Transform.posX[eid] = e.pos[0];
      Transform.posY[eid] = e.pos[1];
      Transform.posZ[eid] = e.pos[2];
      Transform.rotX[eid] = e.rot[0];
      Transform.rotY[eid] = e.rot[1];
      Transform.rotZ[eid] = e.rot[2];
    }

    const m = meta.get(eid);
    if (m) {
      m.quat[0] = e.rot[0];
      m.quat[1] = e.rot[1];
      m.quat[2] = e.rot[2];
      m.quat[3] = e.rot[3];
      m.vel[0] = e.vel[0];
      m.vel[1] = e.vel[1];
      m.vel[2] = e.vel[2];
      m.hpRatio = e.hp_ratio;
      m.displayName = e.display_name;
    }
  }

  // Remove entidades que sumiram do snapshot (dessincronizou).
  for (const [serverId, eid] of byServerId) {
    if (!seen.has(serverId)) {
      removeEntity(world, eid);
      byServerId.delete(serverId);
      meta.delete(eid);
      history.delete(eid);
      nameLabel.delete(serverId);
    }
  }
}

/**
 * Handler de EntityDestroyed: remove imediatamente sem esperar próximo snapshot.
 */
export function handleEntityDestroyed(entityId: number): void {
  const eid = byServerId.get(entityId);
  if (eid === undefined) return;
  removeEntity(world, eid);
  byServerId.delete(entityId);
  meta.delete(eid);
  history.delete(eid);
  nameLabel.delete(entityId);
}

/**
 * Escreve no `Transform` o estado interpolado no instante atual.
 *
 * Chamada uma vez por QUADRO (não por snapshot). Renderiza um pouco
 * atrás do presente para sempre ter duas amostras cercando o instante
 * desenhado — é o que transforma 15 atualizações por segundo em
 * movimento contínuo a 60fps.
 */
export function interpolateRemotes(nowMs?: number, localServerId?: number): void {
  const now = nowMs ?? performance.now();
  for (const [eid, h] of history) {
    const m = meta.get(eid);

    // A NAVE DO PRÓPRIO JOGADOR é desenhada no PRESENTE, projetada pela
    // velocidade que o servidor informou. Interpolá-la como as outras
    // adicionava ~100ms entre a tecla e a reação na tela.
    const ehLocal = localServerId !== undefined && m?.serverId === localServerId;
    const s = ehLocal && m
      ? extrapolateWithVelocity(h, m.vel, now)
      : sampleAt(h, now - renderDelay(h));
    if (!s) continue;

    Transform.posX[eid] = s.pos[0];
    Transform.posY[eid] = s.pos[1];
    Transform.posZ[eid] = s.pos[2];
    Transform.rotX[eid] = s.quat[0];
    Transform.rotY[eid] = s.quat[1];
    Transform.rotZ[eid] = s.quat[2];

    // O renderer lê a orientação do meta, não do Transform.
    if (m) {
      m.quat[0] = s.quat[0];
      m.quat[1] = s.quat[1];
      m.quat[2] = s.quat[2];
      m.quat[3] = s.quat[3];
    }
  }
}

export function getRemoteEntityByServerId(serverId: number): number | undefined {
  return byServerId.get(serverId);
}

export function getRemoteMeta(eid: number): RemoteMeta | undefined {
  return meta.get(eid);
}

export function getAllRemoteEntities(): ReadonlyMap<number, number> {
  return byServerId;
}

/** Reseta o estado (útil entre desconexões). */
export function clearRemotes(): void {
  for (const eid of byServerId.values()) {
    removeEntity(world, eid);
  }
  byServerId.clear();
  meta.clear();
  history.clear();
  nameLabel.clear();
}
