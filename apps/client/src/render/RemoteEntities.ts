/**
 * Sincroniza entidades remotas do ECS com objetos Three.js.
 *
 * Antes cada nave era um `BoxGeometry(2,1,4)` verde ou azul e cada
 * projétil uma esfera lisa. Agora:
 *   - naves usam a geometria procedural de `ShipMesh` (mesma do hangar);
 *   - a nave local recebe cor de aliado e as demais, cor hostil;
 *   - motores acendem conforme a velocidade e deixam rastro de partículas;
 *   - dano recebido pulsa o casco em vermelho;
 *   - projéteis ganham brilho e rastro.
 *
 * Mantém `Map<serverId, Entry>` para diffar contra o snapshot.
 */

import * as THREE from 'three/webgpu';
import { defineQuery, hasComponent } from 'bitecs';
import { world } from '../ecs/world';
import { Transform } from '../ecs/components/transform';
import {
  getRemoteMeta,
  ProjectileTag,
  RemoteTag,
  type RemoteMeta,
} from '../ecs/systems/remoteShips';
import { createShipMesh, type ChassisSpec, type ShipMesh } from './ShipMesh';
import type { VfxSystem } from './effects';
import {
  createProjectileVisual,
  createTorpedoVisual,
  type ProjectileVisual,
} from './ProjectileLook';
import { createSkillFx, type SkillFxHandle, type SkillFxKind } from './SkillFx';

/** Cores por relação com o jogador. */
const COLOR_SELF = { hull: 0x2e5f7a, glow: 0x45e5a4 };
const COLOR_FOE = { hull: 0x5a2b38, glow: 0xff5f6d };
/**
 * Aliado: casco esverdeado, distinto do vermelho hostil.
 *
 * Sem isto todas as outras naves eram pintadas de vermelho, inclusive as
 * do próprio esquadrão — e a única forma de descobrir que alguém era
 * aliado era atirar nele e ver o tiro atravessar.
 */
const COLOR_ALLY = { hull: 0x2c5c46, glow: 0x45e5a4 };

interface Entry {
  group: THREE.Group;
  ship: ShipMesh | null;
  /** Visual do projétil, quando a entrada é um tiro. */
  shot: ProjectileVisual | null;
  /** HP do frame anterior, para detectar dano. */
  lastHp: number;
  /** Tempo restante de flash de dano, em segundos. */
  hitFlash: number;
  /** Posição do frame anterior, usada para emitir rastro. */
  lastPos: THREE.Vector3;
}

export class RemoteEntityRenderer {
  private readonly scene: THREE.Scene;
  private readonly entries = new Map<number, Entry>();
  private readonly host: HTMLElement;
  private vfx: VfxSystem | null = null;
  /**
   * Aparência da nave do jogador, vinda do hangar.
   *
   * Sem isto a nave em jogo era construída com um chassi FIXO e sem
   * loadout: o jogador montava um cruzador cheio de equipamentos no
   * estaleiro e entrava na arena pilotando um interceptador vazio.
   */
  private localSpec: ChassisSpec | null = null;
  /** 0..1 — carga do gatilho da nave local, para o brilho no cano. */
  private localCharge = 0;
  /** Time da nave local, para pintar aliados de outra cor. */
  private localTeam = 0;
  /** Tempo acumulado, para a pulsação dos faróis. */
  private tempo = 0;
  /**
   * Animações de habilidade, presas às naves.
   *
   * Vive aqui porque só este renderizador sabe qual grupo 3D pertence a
   * qual `serverId` — e o efeito precisa acompanhar a nave, não ficar
   * parado onde a habilidade foi acionada.
   */
  private readonly skillFx: SkillFxHandle = createSkillFx();
  private chargeOrb: THREE.Mesh | null = null;
  private chargeMat: THREE.MeshBasicMaterial | null = null;
  private chargeLight: THREE.PointLight | null = null;
  /** Chamado quando a nave do jogador leva dano (HUD + câmera). */
  private onLocalHit?: (severity: number) => void;

  private static readonly remotesQuery = defineQuery([RemoteTag, Transform]);

  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, host: HTMLElement) {
    this.scene = scene;
    this.host = host;
  }

  /** Liga o sistema de partículas (rastros, impactos, explosões). */
  setVfx(vfx: VfxSystem): void {
    this.vfx = vfx;
  }

  /** Define a aparência da nave local (mesmo spec usado no hangar). */
  setLocalShipSpec(spec: ChassisSpec): void {
    this.localSpec = spec;
  }

  /**
   * Informa quanto o gatilho está carregado (0..1).
   *
   * A nave passa a acusar a carga no próprio cano. Antes o único
   * retorno era uma barra de 4px no HUD, e segurar o gatilho parecia
   * não fazer nada — o jogador soltava antes de valer a pena.
   */
  /** Informa o time do jogador, para distinguir aliados de inimigos. */
  setLocalTeam(team: number): void {
    this.localTeam = team;
  }

  setLocalCharge(t: number): void {
    this.localCharge = Math.min(1, Math.max(0, t));
  }

  /**
   * Toca a animação de uma habilidade na nave indicada.
   *
   * Vale para QUALQUER nave, não só a do jogador: ver o inimigo usar um
   * PEM ou o aliado se curando muda a decisão de avançar ou recuar, e
   * antes isso era completamente invisível.
   */
  playSkillFx(serverId: number, kind: SkillFxKind): void {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    this.skillFx.play(kind, entry.group);
  }

  setOnLocalHit(cb: (severity: number) => void): void {
    this.onLocalHit = cb;
  }

  /**
   * Sincroniza o estado das entidades remotas. Chamado por frame
   * (depois de `applySnapshot`). `dt` alimenta flashes e rastros.
   */
  sync(dt = 0.016): void {
    this.skillFx.update(dt);
    // Relógio das luzes de navegação. Compartilhado por todas as naves:
    // o que separa as piscadas é a fase de cada uma, não o relógio.
    this.tempo += dt;
    const eids = RemoteEntityRenderer.remotesQuery(world) as readonly number[];
    const liveServerIds = new Set<number>();
    const localId = this.localId();

    for (let i = 0; i < eids.length; i++) {
      const eid = eids[i];
      if (eid === undefined) continue;
      if (!hasComponent(world, Transform, eid)) continue;
      const meta = getRemoteMeta(eid);
      if (!meta) continue;

      liveServerIds.add(meta.serverId);
      let entry = this.entries.get(meta.serverId);
      if (entry === undefined) {
        entry =
          meta.kind === 'Ship'
            ? this.createShipEntry(meta, localId)
            : this.createProjectileEntry(meta);
        this.scene.add(entry.group);
        this.entries.set(meta.serverId, entry);
      }
      this.updateEntry(entry, eid, meta, dt, localId);
    }

    // Remove entidades que morreram — com explosão se era uma nave.
    for (const [serverId, entry] of this.entries) {
      if (liveServerIds.has(serverId)) continue;
      if (entry.ship && this.vfx) {
        this.vfx.emit('explosion', entry.group.position);
      }
      this.scene.remove(entry.group);
      this.disposeEntry(entry);
      this.entries.delete(serverId);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      this.scene.remove(entry.group);
      this.disposeEntry(entry);
    }
    this.entries.clear();
  }

  private createShipEntry(meta: RemoteMeta, localId: number): Entry {
    const group = new THREE.Group();
    const isLocal = meta.serverId === localId;
    const palette = isLocal
      ? COLOR_SELF
      : meta.team !== 0 && meta.team === this.localTeam
        ? COLOR_ALLY
        : COLOR_FOE;

    // A nave do próprio jogador usa o spec montado no hangar — mesmo
    // chassi, mesmas peças. As demais usam um contorno genérico
    // hostil, porque o servidor não envia o loadout alheio.
    const ship = createShipMesh(
      isLocal && this.localSpec
        ? // Cores do hangar preservadas: a nave do jogador tem que ser
          // reconhecidamente a MESMA que ele pintou e montou. A paleta
          // de time serve para distinguir os outros, não a si mesmo.
          this.localSpec
        : {
            kind: isLocal ? 'interceptor' : 'skirmisher',
            hull: palette.hull,
            glow: palette.glow,
            engines: 2,
            weapons: 2,
          },
    );
    group.add(ship.group);

    // Halo próprio: mantém a nave legível mesmo contra o fundo escuro.
    const halo = new THREE.PointLight(palette.glow, 8, 60);
    group.add(halo);

    return {
      group,
      ship,
      shot: null,
      lastHp: meta.hpRatio ?? 1,
      hitFlash: 0,
      lastPos: new THREE.Vector3(),
    };
  }

  private createProjectileEntry(meta: RemoteMeta): Entry {
    const group = new THREE.Group();
    // A aparência vem do servidor (arma + carga). Sem isso todo tiro
    // era a mesma esfera amarela e nem a arma nem o tempo de gatilho
    // apareciam em combate.
    // Torpedo tem silhueta própria: confundi-lo com um tiro comum faria
    // o jogador ignorá-lo até acertar, e as defesas só servem para quem
    // o reconhece a tempo.
    const shot = meta.torpedo
      ? createTorpedoVisual(meta.torpedo.radius, meta.torpedo.locked)
      : createProjectileVisual(meta.shot);
    group.add(shot.group);

    return {
      group,
      ship: null,
      shot,
      lastHp: 1,
      hitFlash: 0,
      lastPos: new THREE.Vector3(),
    };
  }

  private updateEntry(
    entry: Entry,
    eid: number,
    meta: RemoteMeta,
    dt: number,
    localId: number,
  ): void {
    const px = Transform.posX[eid] ?? 0;
    const py = Transform.posY[eid] ?? 0;
    const pz = Transform.posZ[eid] ?? 0;
    entry.group.position.set(px, py, pz);

    const [qx, qy, qz, qw] = meta.quat;
    entry.group.quaternion.set(qx, qy, qz, qw);

    if (!entry.ship) {
      entry.lastPos.set(px, py, pz);
      return;
    }

    // --- Luzes de navegação ---
    //
    // A cor do farol é da facção, então ela é reaplicada aqui: o time
    // só chega pelo snapshot, depois da nave já ter sido criada.
    entry.ship.navLights.update(this.tempo);

    // --- Motores reagem à velocidade ---
    const speed = Math.hypot(meta.vel[0], meta.vel[1], meta.vel[2]);
    const throttle = Math.min(1, speed / 60);
    entry.ship.engineMaterial.opacity = 0.35 + throttle * 0.65;

    // --- Rastro de propulsão ---
    if (this.vfx && throttle > 0.15) {
      // Emite atrás da nave (-Z local: a frente é +Z), na direção
      // oposta ao movimento.
      this.tmpVec.set(0, 0, -2.4).applyQuaternion(entry.group.quaternion).add(entry.group.position);
      this.tmpDir.set(meta.vel[0], meta.vel[1], meta.vel[2]).normalize().negate();
      this.vfx.emit('thruster', this.tmpVec, this.tmpDir);
    }

    // --- Flash de dano ---
    const hp = meta.hpRatio ?? entry.lastHp;
    if (hp < entry.lastHp - 0.001) {
      const severity = Math.min(1, (entry.lastHp - hp) * 4);
      entry.hitFlash = 0.22;
      if (this.vfx) this.vfx.emit('impact', entry.group.position);
      if (meta.serverId === localId) this.onLocalHit?.(severity);
    }
    entry.lastHp = hp;

    if (entry.hitFlash > 0) {
      entry.hitFlash = Math.max(0, entry.hitFlash - dt);
      const k = entry.hitFlash / 0.22;
      entry.ship.hullMaterial.emissive.setRGB(k * 0.9, k * 0.12, k * 0.12);
    } else {
      entry.ship.hullMaterial.emissive.setRGB(0, 0, 0);
    }

    // --- Brilho de carga, só na nave do jogador ---
    if (meta.serverId === localId) this.updateChargeOrb(entry);

    entry.lastPos.set(px, py, pz);
  }

  /**
   * Bola de energia crescendo na boca do cano enquanto o gatilho está
   * preso.
   *
   * Vive presa ao grupo da nave local e é criada sob demanda: quem nunca
   * carrega um tiro não paga geometria nenhuma. Fica em +Z porque é para
   * lá que a nave aponta e de onde o projétil sai (o servidor gera o
   * tiro a 3 unidades da frente).
   */
  private updateChargeOrb(entry: Entry): void {
    const t = this.localCharge;

    if (t <= 0.02) {
      if (this.chargeOrb) this.chargeOrb.visible = false;
      if (this.chargeLight) this.chargeLight.visible = false;
      return;
    }

    if (!this.chargeOrb) {
      const geo = new THREE.SphereGeometry(1, 10, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9fe8ff,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const orb = new THREE.Mesh(geo, mat);
      orb.position.z = 3;
      this.chargeOrb = orb;
      this.chargeMat = mat;
      this.chargeLight = new THREE.PointLight(0x9fe8ff, 0, 30);
      this.chargeLight.position.z = 3;
    }

    // Reanexa se a nave foi recriada (respawn, troca de entrada).
    if (this.chargeOrb.parent !== entry.group) {
      this.chargeOrb.parent?.remove(this.chargeOrb);
      this.chargeLight?.parent?.remove(this.chargeLight);
      entry.group.add(this.chargeOrb);
      if (this.chargeLight) entry.group.add(this.chargeLight);
    }

    this.chargeOrb.visible = true;
    // Cresce e esquenta: azul frio no começo, branco quente no fim.
    this.chargeOrb.scale.setScalar(0.25 + 1.15 * t * t);
    if (this.chargeMat) {
      this.chargeMat.opacity = 0.35 + 0.5 * t;
      this.chargeMat.color.setHSL(0.55 - 0.13 * t, 1, 0.6 + 0.35 * t);
    }
    if (this.chargeLight) {
      this.chargeLight.visible = true;
      this.chargeLight.intensity = 12 * t * t;
    }
  }

  private disposeEntry(entry: Entry): void {
    if (entry.ship) entry.ship.dispose();
    if (entry.shot) entry.shot.dispose();
    entry.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
    });
  }

  private localId(): number {
    // O caller injeta o player_id no Welcome; 0 antes disso.
    return (globalThis as { __localEntityId?: number }).__localEntityId ?? 0;
  }
}
