/**
 * Testes da Task 5.3 — decodificação de EntityPayload (v2).
 *
 * Quatro testes mínimos exigidos:
 *  1. Npc variant — roundtrip binário decodifica corretamente.
 *  2. Asteroid variant — idem.
 *  3. Anomaly variant — idem.
 *  4. Wreck variant — idem.
 *
 * Os buffers são montados manualmente com a mesma codificação bincode
 * que o servidor Rust produziria (little-endian, int fixo).
 */

import { describe, it, expect } from 'vitest';
import { decodeServerMsg } from '../src/net/protocol.js';
import type {
  EntityPayload,
  EntityState,
  SnapshotData,
} from '../src/net/protocol.js';

const SERVER_VARIANT_SNAPSHOT = 1;
const ENTITY_KIND_NPC = 2;
const ENTITY_KIND_ASTEROID = 3;
const ENTITY_KIND_ANOMALY = 4;
const ENTITY_KIND_WRECK = 5;
// Discriminantes do enum `EntityPayload` (u32 em bincode). NÃO incluem
// o byte do `Option` que vem antes — `pushPayloadTag` escreve os dois.
const PAYLOAD_TAG_NPC = 0;
const PAYLOAD_TAG_ASTEROID = 1;
const PAYLOAD_TAG_ANOMALY = 2;
const PAYLOAD_TAG_WRECK = 3;

function pushU8(parts: number[], v: number): void {
  parts.push(v & 0xff);
}
function pushU16(parts: number[], v: number): void {
  parts.push(v & 0xff, (v >>> 8) & 0xff);
}
function pushU32(parts: number[], v: number): void {
  parts.push(
    v & 0xff,
    (v >>> 8) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 24) & 0xff,
  );
}
function pushU64(parts: number[], v: number): void {
  const n = BigInt(v);
  for (let i = 0; i < 8; i++) parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
}
function pushF32(parts: number[], v: number): void {
  const b = new ArrayBuffer(4);
  new Float32Array(b)[0] = v;
  const u = new Uint8Array(b);
  parts.push(u[0] ?? 0, u[1] ?? 0, u[2] ?? 0, u[3] ?? 0);
}
function pushStr(parts: number[], s: string): void {
  const utf8 = new TextEncoder().encode(s);
  pushU64(parts, utf8.length);
  for (const b of utf8) parts.push(b);
}
function pushEntityHeader(parts: number[], id: number, kind: number): void {
  pushU32(parts, id);
  pushU32(parts, kind);
  for (let i = 0; i < 3; i++) pushF32(parts, 0); // pos
  for (let i = 0; i < 4; i++) pushF32(parts, 0); // rot
  for (let i = 0; i < 3; i++) pushF32(parts, 0); // vel
  pushU8(parts, 0); // hp = None
  pushU8(parts, 0); // name = None
}

/**
 * Escreve um `Option<EntityPayload>` presente.
 *
 * São DOIS campos: o byte do `Option` (1 = Some) e a discriminante u32
 * do enum. Escrever só um byte, como estas fixtures faziam antes,
 * desalinha tudo que vem depois no snapshot.
 */
function pushPayloadTag(parts: number[], variant: number): void {
  pushU8(parts, 1);
  pushU32(parts, variant);
}

function buildSnapshot(entityBytes: number[]): Uint8Array {
  const parts: number[] = [];
  pushU32(parts, SERVER_VARIANT_SNAPSHOT);
  pushU64(parts, 1); // tick
  pushU64(parts, 1000); // server_time_ms
  pushU64(parts, 1); // vec length
  for (const b of entityBytes) parts.push(b);
  return new Uint8Array(parts);
}

function decodeSnapshot(buf: Uint8Array): SnapshotData {
  const msg = decodeServerMsg(buf.buffer);
  if (msg.type !== 'Snapshot') throw new Error('expected Snapshot');
  return msg.payload;
}

describe('EntityPayload decoder (Task 5.3)', () => {
  it('handles Npc variant', () => {
    const ent: number[] = [];
    pushEntityHeader(ent, 7, ENTITY_KIND_NPC);
    pushPayloadTag(ent, PAYLOAD_TAG_NPC);
    pushU8(ent, 1); // archetype = Pirate
    pushU8(ent, 2); // ai_state = Chase
    pushF32(ent, 5.0); // radius
    pushU8(ent, 1); // Option tag = Some
    pushU32(ent, 42); // target_id

    const snap = decodeSnapshot(buildSnapshot(ent));
    expect(snap.entities).toHaveLength(1);
    const e0: EntityState = snap.entities[0]!;
    expect(e0.kind).toBe('Npc');
    expect(e0.payload).not.toBeNull();
    const p = e0.payload as EntityPayload;
    expect(p.type).toBe('Npc');
    if (p.type !== 'Npc') throw new Error('unreachable');
    expect(p.payload.archetype).toBe(1);
    expect(p.payload.ai_state).toBe(2);
    expect(p.payload.radius).toBeCloseTo(5.0);
    expect(p.payload.target_id).toBe(42);
  });

  it('handles Asteroid variant', () => {
    const ent: number[] = [];
    pushEntityHeader(ent, 99, ENTITY_KIND_ASTEROID);
    pushPayloadTag(ent, PAYLOAD_TAG_ASTEROID);
    pushU8(ent, 1); // kind = Iron
    pushF32(ent, 25.0); // radius
    pushU32(ent, 50); // resource_units

    const snap = decodeSnapshot(buildSnapshot(ent));
    expect(snap.entities).toHaveLength(1);
    const e0: EntityState = snap.entities[0]!;
    expect(e0.kind).toBe('Asteroid');
    expect(e0.payload).not.toBeNull();
    const p = e0.payload as EntityPayload;
    expect(p.type).toBe('Asteroid');
    if (p.type !== 'Asteroid') throw new Error('unreachable');
    expect(p.payload.kind).toBe(1);
    expect(p.payload.radius).toBeCloseTo(25.0);
    expect(p.payload.resource_units).toBe(50);
  });

  it('handles Anomaly variant', () => {
    const ent: number[] = [];
    pushEntityHeader(ent, 12, ENTITY_KIND_ANOMALY);
    pushPayloadTag(ent, PAYLOAD_TAG_ANOMALY);
    pushU8(ent, 0); // kind = Warp
    pushF32(ent, 80.0); // radius
    pushF32(ent, 1.0); // intensity
    pushU8(ent, 1); // Option tag = Some
    pushU32(ent, 13); // target_warp_id

    const snap = decodeSnapshot(buildSnapshot(ent));
    expect(snap.entities).toHaveLength(1);
    const e0: EntityState = snap.entities[0]!;
    expect(e0.kind).toBe('Anomaly');
    expect(e0.payload).not.toBeNull();
    const p = e0.payload as EntityPayload;
    expect(p.type).toBe('Anomaly');
    if (p.type !== 'Anomaly') throw new Error('unreachable');
    expect(p.payload.kind).toBe(0);
    expect(p.payload.radius).toBeCloseTo(80.0);
    expect(p.payload.intensity).toBeCloseTo(1.0);
    expect(p.payload.target_warp_id).toBe(13);
  });

  it('handles Wreck variant', () => {
    const ent: number[] = [];
    pushEntityHeader(ent, 33, ENTITY_KIND_WRECK);
    pushPayloadTag(ent, PAYLOAD_TAG_WRECK);
    pushStr(ent, 'hauler_light');
    pushF32(ent, 12.0); // radius
    pushU64(ent, 4500); // ttl_remaining
    pushU32(ent, 3); // loot_count

    const snap = decodeSnapshot(buildSnapshot(ent));
    expect(snap.entities).toHaveLength(1);
    const e0: EntityState = snap.entities[0]!;
    expect(e0.kind).toBe('Wreck');
    expect(e0.payload).not.toBeNull();
    const p = e0.payload as EntityPayload;
    expect(p.type).toBe('Wreck');
    if (p.type !== 'Wreck') throw new Error('unreachable');
    expect(p.payload.ship_template).toBe('hauler_light');
    expect(p.payload.radius).toBeCloseTo(12.0);
    expect(p.payload.ttl_remaining).toBe(4500);
    expect(p.payload.loot_count).toBe(3);
  });
});
