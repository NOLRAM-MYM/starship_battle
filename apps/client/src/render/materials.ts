/**
 * Materiais e cores visuais para as entidades vivas do mundo (Fase 4).
 *
 * - Asteroides: PBR-ish por kind (Rock, Iron, Gold, DarkMatter).
 * - NPCs: cor por archetype.
 * - Anomalias: cor translúcida por kind.
 */

import * as THREE from 'three/webgpu';

/**
 * Material PBR para asteroide conforme `kind` (0=Rock, 1=Iron, 2=Gold, 3=DarkMatter).
 * Outros kinds caem em um fallback Rock-like.
 */
export function asteroidMaterialFor(kind: number): THREE.MeshStandardMaterial {
  switch (kind) {
    case 0: // Rock
      return new THREE.MeshStandardMaterial({
        color: 0x888888,
        metalness: 0.1,
        roughness: 0.95,
      });
    case 1: // Iron
      return new THREE.MeshStandardMaterial({
        color: 0xaa6644,
        metalness: 0.65,
        roughness: 0.55,
      });
    case 2: // Gold
      return new THREE.MeshStandardMaterial({
        color: 0xffcc44,
        metalness: 0.9,
        roughness: 0.25,
        emissive: 0x332200,
      });
    case 3: // DarkMatter
      return new THREE.MeshStandardMaterial({
        color: 0x442266,
        metalness: 0.3,
        roughness: 0.4,
        emissive: 0x110022,
      });
    default:
      return new THREE.MeshStandardMaterial({
        color: 0x888888,
        metalness: 0.1,
        roughness: 0.95,
      });
  }
}

/**
 * Cor para NPC conforme `archetype` (1=Pirate, 2=Patrol, 3=Miner).
 * Arquétipos desconhecidos recebem branco.
 */
export function npcColorFor(archetype: number): number {
  switch (archetype) {
    case 1:
      return 0xff3333; // Pirate (vermelho)
    case 2:
      return 0x3333ff; // Patrol (azul)
    case 3:
      return 0xffcc00; // Miner (amarelo)
    default:
      return 0xffffff;
  }
}

/**
 * Cor para anomalia conforme `kind` (0=Warp, 1=Radiation, 2=GravityWell).
 * Kinds desconhecidos recebem rosa choque.
 */
export function anomalyColorFor(kind: number): number {
  switch (kind) {
    case 0:
      return 0x66ccff; // Warp (ciano)
    case 1:
      return 0x66ff66; // Radiation (verde)
    case 2:
      return 0xaa44ff; // GravityWell (roxo)
    default:
      return 0xff66cc;
  }
}
