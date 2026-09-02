/**
 * Renderer visual para as 4 categorias de entidades vivas do mundo
 * (Npc / Asteroid / Anomaly / Wreck).
 *
 * Itera entidades com `WorldEntityKind` via defineQuery, criando ou
 * atualizando um `THREE.Group` por server id. Remove grupos órfãos
 * no fim do sync (diff por serverId).
 */

import * as THREE from 'three/webgpu';
import { defineQuery, hasComponent } from 'bitecs';
import { world } from '../ecs/world';
import { Transform } from '../ecs/components/transform';
import { WorldEntityKind } from '../ecs/components/worldEntities';
import {
  getWorldEntityMeta,
  type WorldEntityMeta,
} from '../ecs/systems/worldEntities';
import {
  anomalyColorFor,
  asteroidMaterialFor,
  npcColorFor,
} from './materials';
import { chassisForArchetype, createShipMesh, type ShipMesh } from './ShipMesh';

export class WorldEntityRenderer {
  private readonly scene: THREE.Scene;
  private readonly groups = new Map<number, THREE.Group>(); // serverId -> group
  /** Materiais/geometrias das naves de NPC, para liberar no dispose. */
  private readonly npcShips = new Map<THREE.Group, ShipMesh>();

  private static readonly worldQuery = defineQuery([WorldEntityKind, Transform]);

  /** Tempo acumulado — alimenta a rotação lenta de asteroides e portais. */
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Sincroniza meshes com o estado atual da ECS. Chamado por frame
   * (depois de applyWorldEntities).
   */
  sync(dt = 0): void {
    this.elapsed += dt;
    const eids = WorldEntityRenderer.worldQuery(world) as readonly number[];
    const liveServerIds = new Set<number>();

    for (let i = 0; i < eids.length; i++) {
      const eid = eids[i];
      if (eid === undefined) continue;
      if (!hasComponent(world, Transform, eid)) continue;
      const meta = getWorldEntityMeta(eid);
      if (!meta) continue;

      liveServerIds.add(meta.serverId);
      let group = this.groups.get(meta.serverId);
      if (group === undefined) {
        group = this.createGroupForKind(meta);
        this.scene.add(group);
        this.groups.set(meta.serverId, group);
        console.info(
          '[WorldEntityRenderer] mesh criado para',
          meta.serverId,
          meta.kind,
        );
      }
      this.updateGroup(group, eid, meta);
    }

    // Remove grupos de entidades que sumiram.
    for (const [serverId, group] of this.groups) {
      if (!liveServerIds.has(serverId)) {
        this.scene.remove(group);
        this.disposeGroup(group);
        this.groups.delete(serverId);
        console.info('[WorldEntityRenderer] mesh removido', serverId);
      }
    }
  }

  clear(): void {
    for (const group of this.groups.values()) {
      this.scene.remove(group);
      this.disposeGroup(group);
    }
    this.groups.clear();
  }

  private createGroupForKind(meta: WorldEntityMeta): THREE.Group {
    switch (meta.kind) {
      case 'Npc':
        return this.createNpcGroup(meta);
      case 'Asteroid':
        return this.createAsteroidGroup(meta);
      case 'Anomaly':
        return this.createAnomalyGroup(meta);
      case 'Wreck':
        return this.createWreckGroup(meta);
    }
  }

  private createNpcGroup(meta: WorldEntityMeta): THREE.Group {
    const group = new THREE.Group();
    const color = npcColorFor(meta.subKind);

    // NPCs usam a mesma geometria procedural das naves de jogador; o
    // arquétipo escolhe o casco, então dá para identificar um pirata de
    // um cargueiro só pela silhueta, antes de ler a cor.
    const ship = createShipMesh({
      kind: chassisForArchetype(meta.subKind),
      hull: color,
      glow: color,
      engines: 2,
      weapons: meta.subKind === 3 ? 1 : 2, // mineradores mal armados
    });
    group.add(ship.group);
    this.npcShips.set(group, ship);

    // Halo local: destaca o contato contra o fundo escuro.
    const light = new THREE.PointLight(color, 5, 45);
    group.add(light);
    return group;
  }

  private createAsteroidGroup(meta: WorldEntityMeta): THREE.Group {
    const group = new THREE.Group();
    const radius = Math.max(0.1, meta.radius);
    const geo = new THREE.IcosahedronGeometry(radius, 0);
    const mat = asteroidMaterialFor(meta.subKind);
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    return group;
  }

  private createAnomalyGroup(meta: WorldEntityMeta): THREE.Group {
    const group = new THREE.Group();
    const radius = Math.max(0.1, meta.radius);
    const geo = new THREE.TorusGeometry(radius, 1, 8, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: anomalyColorFor(meta.subKind),
      transparent: true,
      opacity: 0.5,
    });
    const ring = new THREE.Mesh(geo, mat);
    // Rotaciona o toro para ficar "deitado" no plano XZ, como um portal.
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    return group;
  }

  private createWreckGroup(meta: WorldEntityMeta): THREE.Group {
    const group = new THREE.Group();
    const r = Math.max(0.1, meta.radius);
    const geo = new THREE.BoxGeometry(r, r * 0.5, r * 1.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x666666 });
    group.add(new THREE.Mesh(geo, mat));
    return group;
  }

  private updateGroup(group: THREE.Group, eid: number, meta: WorldEntityMeta): void {
    const px = Transform.posX[eid] ?? 0;
    const py = Transform.posY[eid] ?? 0;
    const pz = Transform.posZ[eid] ?? 0;
    group.position.set(px, py, pz);

    // Rotação lenta e determinística por serverId: nada no mundo fica
    // completamente parado, mas dois clientes veem a mesma orientação.
    if (meta.kind === 'Asteroid' || meta.kind === 'Wreck') {
      const phase = (meta.serverId % 97) / 97;
      group.rotation.y = this.elapsed * (0.05 + phase * 0.12) + phase * Math.PI * 2;
      group.rotation.x = this.elapsed * (0.03 + phase * 0.05);
    } else if (meta.kind === 'Anomaly') {
      // Portais giram mais rápido — sinalizam que são interativos.
      group.rotation.z = this.elapsed * 0.6;
    }
  }

  private disposeGroup(group: THREE.Group): void {
    const ship = this.npcShips.get(group);
    if (ship) {
      ship.dispose();
      this.npcShips.delete(group);
    }
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
    });
  }
}
