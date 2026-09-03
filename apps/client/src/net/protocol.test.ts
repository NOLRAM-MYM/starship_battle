/**
 * Testes do protocolo cliente.
 * Validam o roundtrip binário dos tipos públicos para garantir
 * paridade com a implementação Rust (crates/game-server/src/net/protocol.rs).
 */

import { describe, it, expect } from 'vitest';
import {
  decodeServerMsg,
  encodeClientMsg,
  PROTOCOL_VERSION,
  type EntityState,
  type SnapshotData,
  type WelcomeMsg,
  type ServerMsg,
  type ClientMsg,
} from './protocol';

describe('protocol roundtrip', () => {
  it('encode Join then decode bytes matches expected layout', () => {
    const msg: ClientMsg = {
      type: 'Join',
      payload: { name: 'alice', protocol: PROTOCOL_VERSION, loadout: [], skills: [], consumables: [], practice: false },
    };
    const bytes = encodeClientMsg(msg);
    // Esperado:
    //   u32 variant Join=0  -> 4 bytes LE
    //   u64 len("alice")=5  -> 8 bytes LE
    //   "alice"             -> 5 bytes
    //   u16 protocol=1      -> 2 bytes LE
    // v5: + u64 com o comprimento do Vec<String> do loadout (vazio aqui).
    // v8: + u64 com o comprimento do Vec<String> das skills.
    // v9: + u64 com o comprimento do Vec<ConsumableSlot>.
    // v11: + u8 do campo de provas.
    expect(bytes.byteLength).toBe(4 + 8 + 5 + 2 + 8 + 8 + 8 + 1);

    // Confere os primeiros bytes (variant + len)
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(0);
    expect(Number(dv.getBigUint64(4, true))).toBe(5);
  });

  it('encode Ping is exact', () => {
    const msg: ClientMsg = { type: 'Ping', payload: { nonce: 0xdeadbeef } };
    const bytes = encodeClientMsg(msg);
    // u32 variant=2 + u32 nonce
    expect(bytes.byteLength).toBe(8);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(2);
    expect(dv.getUint32(4, true)).toBe(0xdeadbeef);
  });

  it('encode Input is exact', () => {
    const msg: ClientMsg = {
      type: 'Input',
      payload: {
        steer: 0.25, pitch: -0.5, roll: 0.75, thrust: 1.0,
        fire: true, fireCharge: 1.5, skill: null, useConsumable: null, launchTorpedo: null, deployDecoys: false, fineControl: false, aimTarget: null,
      },
    };
    const bytes = encodeClientMsg(msg);
    // v6: u32 variante + f32 steer/pitch/roll/thrust + u8 fire
    //     + f32 fireCharge + tag Option da skill.
    // v9: + tag Option do slot de consumível.
    // v10: + tag Option do alvo do torpedo + u8 das iscas.
    // v12: + u8 do modo de precisão.
    // v14: + tag Option do alvo de mira.
    expect(bytes.byteLength).toBe(4 + 4 * 4 + 1 + 4 + 1 + 1 + 1 + 1 + 1 + 1);

    // Confere a ORDEM dos eixos: se ela divergir do enum em Rust, o
    // servidor lê pitch como roll e a nave voa errado sem erro nenhum.
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(1);
    expect(dv.getFloat32(4, true)).toBeCloseTo(0.25, 5);
    expect(dv.getFloat32(8, true)).toBeCloseTo(-0.5, 5);
    expect(dv.getFloat32(12, true)).toBeCloseTo(0.75, 5);
    expect(dv.getFloat32(16, true)).toBeCloseTo(1.0, 5);
    expect(dv.getUint8(20)).toBe(1);
    expect(dv.getFloat32(21, true)).toBeCloseTo(1.5, 5);
    expect(dv.getUint8(25)).toBe(0);
  });

  it('decode Welcome matches encode layout', () => {
    // Constrói bytes manualmente como o servidor faria.
    const w = (() => {
      const parts: number[] = [];
      const pushU32 = (v: number) =>
        parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
      const pushU16 = (v: number) => parts.push(v & 0xff, (v >>> 8) & 0xff);
      // variant Welcome=0
      pushU32(0);
      // player_id (u32), protocol (u16), tick_rate (u32), world_seed (u32)
      pushU32(42);
      pushU16(2);
      pushU32(20);
      pushU32(0xc0ffee);
      return new Uint8Array(parts);
    })();
    const msg = decodeServerMsg(w.buffer);
    expect(msg.type).toBe('Welcome');
    if (msg.type !== 'Welcome') throw new Error('unreachable');
    const expected: WelcomeMsg = { player_id: 42, protocol: 2, tick_rate: 20, world_seed: 0xc0ffee };
    expect(msg.payload).toEqual(expected);
  });

  it('decode Snapshot with one Ship and one Projectile', () => {
    const w = (() => {
      const parts: number[] = [];
      const pushU32 = (v: number) =>
        parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
      const pushU64 = (v: number) => {
        const n = BigInt(v);
        for (let i = 0; i < 8; i++) parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
      };
      const pushF32 = (v: number) => {
        const b = new ArrayBuffer(4);
        new Float32Array(b)[0] = v;
        const u = new Uint8Array(b);
        parts.push(u[0]!, u[1]!, u[2]!, u[3]!);
      };
      const pushU8 = (v: number) => parts.push(v & 0xff);
      const pushStr = (s: string) => {
        const utf8 = new TextEncoder().encode(s);
        pushU64(utf8.length);
        for (const b of utf8) parts.push(b);
      };
      const pushEntity = (
        id: number,
        kind: number,
        pos: [number, number, number],
        rot: [number, number, number, number],
        vel: [number, number, number],
        hp: number | null,
        name: string | null,
      ) => {
        pushU32(id);
        pushU32(kind);
        for (const p of pos) pushF32(p);
        for (const r of rot) pushF32(r);
        for (const v of vel) pushF32(v);
        if (hp === null) pushU8(0);
        else {
          pushU8(1);
          pushF32(hp);
        }
        if (name === null) pushU8(0);
        else {
          pushU8(1);
          pushStr(name);
        }
        // payload_tag = 0 (None) — Ship/Projectile não carregam payload.
        pushU8(0);
      };

      // variant Snapshot=1
      pushU32(1);
      // tick + server_time
      pushU64(100);
      pushU64(5000);
      // vec length = 2
      pushU64(2);
      // entity 0: ship
      pushEntity(
        1,
        0,
        [1, 2, 3],
        [0, 0, 0, 1],
        [10, 0, 0],
        0.75,
        'pilot-1',
      );
      // entity 1: projectile (sem hp/name)
      pushEntity(2, 1, [-1, 0, 5], [0, 0, 0, 1], [0, 0, 0], null, null);

      return new Uint8Array(parts);
    })();

    const msg = decodeServerMsg(w.buffer);
    expect(msg.type).toBe('Snapshot');
    if (msg.type !== 'Snapshot') throw new Error('unreachable');
    const snap: SnapshotData = msg.payload;
    expect(snap.tick).toBe(100);
    expect(snap.server_time_ms).toBe(5000);
    expect(snap.entities).toHaveLength(2);

    const e0: EntityState = snap.entities[0]!;
    expect(e0.id).toBe(1);
    expect(e0.kind).toBe('Ship');
    expect(e0.pos).toEqual([1, 2, 3]);
    expect(e0.hp_ratio).toBeCloseTo(0.75);
    expect(e0.display_name).toBe('pilot-1');

    const e1: EntityState = snap.entities[1]!;
    expect(e1.id).toBe(2);
    expect(e1.kind).toBe('Projectile');
    expect(e1.hp_ratio).toBeNull();
    expect(e1.display_name).toBeNull();
  });

  it('decode EntityDestroyed and Pong', () => {
    const makeU32 = (...vs: number[]): Uint8Array => {
      const parts: number[] = [];
      for (const v of vs) {
        parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
      }
      return new Uint8Array(parts);
    };
    // v5: `Sector` entrou como 2, então EntityDestroyed=4 e Pong=8.
    const destroyed = decodeServerMsg(
      makeU32(4 /* EntityDestroyed */, 999).buffer,
    );
    expect(destroyed.type).toBe('EntityDestroyed');
    if (destroyed.type !== 'EntityDestroyed') throw new Error('unreachable');
    expect(destroyed.payload.entity_id).toBe(999);

    const pong = decodeServerMsg(makeU32(8 /* Pong */, 123).buffer);
    expect(pong.type).toBe('Pong');
    if (pong.type !== 'Pong') throw new Error('unreachable');
    expect(pong.payload.nonce).toBe(123);
  });

  it('decode Error with message', () => {
    const parts: number[] = [];
    const pushU32 = (v: number) =>
      parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const pushU64 = (v: number) => {
      const n = BigInt(v);
      for (let i = 0; i < 8; i++) parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
    };
    // v5: Error passou de 8 para 9 (`Sector` entrou como 2).
    pushU32(9 /* Error */);
    const reason = 'protocol mismatch';
    const utf8 = new TextEncoder().encode(reason);
    pushU64(utf8.length);
    for (const b of utf8) parts.push(b);
    const msg = decodeServerMsg(new Uint8Array(parts).buffer);
    expect(msg.type).toBe('Error');
    if (msg.type !== 'Error') throw new Error('unreachable');
    expect(msg.payload.reason).toBe(reason);
  });

  it('decode ephemeral events (XpGained, SkillActivated, Vfx)', () => {
    const parts: number[] = [];
    const pushU8 = (v: number) => parts.push(v & 0xff);
    const pushU32 = (v: number) =>
      parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const pushU64 = (v: number) => {
      const n = BigInt(v);
      for (let i = 0; i < 8; i++) parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
    };
    const pushF32 = (v: number) => {
      const b = new ArrayBuffer(4);
      new Float32Array(b)[0] = v;
      const u = new Uint8Array(b);
      parts.push(u[0]!, u[1]!, u[2]!, u[3]!);
    };
    const pushStr = (s: string) => {
      const utf8 = new TextEncoder().encode(s);
      pushU64(utf8.length);
      for (const b of utf8) parts.push(b);
    };

    // XpGained (variant 5 no protocolo v5)
    parts.length = 0;
    pushU32(5);
    pushU32(50);
    pushStr("Kill");
    const xpMsg = decodeServerMsg(new Uint8Array(parts).buffer);
    expect(xpMsg.type).toBe('XpGained');
    if (xpMsg.type !== 'XpGained') throw new Error('unreachable');
    expect(xpMsg.payload.amount).toBe(50);
    expect(xpMsg.payload.reason).toBe('Kill');

    // SkillActivated (variant 6 no protocolo v5)
    parts.length = 0;
    pushU32(6);
    pushU32(42); // entity_id
    pushU32(1); // Emp (enum tag 1)
    const skillMsg = decodeServerMsg(new Uint8Array(parts).buffer);
    expect(skillMsg.type).toBe('SkillActivated');
    if (skillMsg.type !== 'SkillActivated') throw new Error('unreachable');
    expect(skillMsg.payload.entity_id).toBe(42);
    expect(skillMsg.payload.skill).toBe('Emp');

    // Vfx (variant 7 no protocolo v5)
    parts.length = 0;
    pushU32(7);
    pushU8(2); // effect_id
    pushF32(10.0); pushF32(20.0); pushF32(30.0);
    const vfxMsg = decodeServerMsg(new Uint8Array(parts).buffer);
    expect(vfxMsg.type).toBe('Vfx');
    if (vfxMsg.type !== 'Vfx') throw new Error('unreachable');
    expect(vfxMsg.payload.effect_id).toBe(2);
    expect(vfxMsg.payload.pos).toEqual([10.0, 20.0, 30.0]);
  });

  it('decodes WorldChunk (variant 3) com entidades e expirados', () => {
    const parts: number[] = [];
    const pushU8 = (v: number) => parts.push(v & 0xff);
    const pushU32 = (v: number) =>
      parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    const pushU64 = (v: number) => {
      const n = BigInt(v);
      for (let i = 0; i < 8; i++) parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
    };
    const pushF32 = (v: number) => {
      const b = new Uint8Array(new Float32Array([v]).buffer);
      for (const x of b) parts.push(x);
    };

    pushU32(3); // WorldChunk
    pushU64(99); // tick
    pushU64(1); // 1 entidade
    pushU32(7); // id
    pushU32(3); // kind = Asteroid
    pushF32(1);
    pushF32(2);
    pushF32(3);
    pushF32(0);
    pushF32(0);
    pushF32(0);
    pushF32(1); // rot
    pushF32(0);
    pushF32(0);
    pushF32(0); // vel
    pushU8(0); // hp_ratio = None
    pushU8(0); // display_name = None
    // Option<EntityPayload>: byte do Option, depois a discriminante u32.
    pushU8(1); // Some
    pushU32(1); // variante = Asteroid
    pushU8(1); // kind
    pushF32(4.0); // radius
    pushU32(100); // resource_units
    pushU64(2); // 2 expirados
    pushU32(11);
    pushU32(12);

    const msg = decodeServerMsg(new Uint8Array(parts).buffer);
    expect(msg.type).toBe('WorldChunk');
    if (msg.type !== 'WorldChunk') throw new Error('unreachable');
    expect(msg.payload.tick).toBe(99);
    expect(msg.payload.entities).toHaveLength(1);
    expect(msg.payload.entities[0]!.id).toBe(7);
    expect(msg.payload.entities[0]!.kind).toBe('Asteroid');
    expect(msg.payload.expired).toEqual([11, 12]);
  });

  it('decodifica TODOS os tipos de corpo celeste', () => {
    // Regressão: o servidor ganhou `NeutronStar` (4) e `BlackHole` (5) e
    // o cliente só conhecia 0..3. O decode lançava e a mensagem `Sector`
    // inteira era perdida — o setor ficava sem nenhum planeta, sem erro
    // visível além de um log.
    //
    // Se um tipo novo entrar no enum em Rust, este teste falha.
    const TIPOS = ['Star', 'Planet', 'GasGiant', 'Moon', 'NeutronStar', 'BlackHole'];

    for (let idx = 0; idx < TIPOS.length; idx++) {
      const parts: number[] = [];
      const pushU8 = (v: number) => parts.push(v & 0xff);
      const pushU32 = (v: number) =>
        parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
      const pushU64 = (v: number) => {
        const n = BigInt(v);
        for (let i = 0; i < 8; i++) parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
      };
      const pushF32 = (v: number) => {
        for (const b of new Uint8Array(new Float32Array([v]).buffer)) parts.push(b);
      };
      const pushStr = (t: string) => {
        const u = new TextEncoder().encode(t);
        pushU64(u.length);
        for (const b of u) parts.push(b);
      };

      pushU32(2); // Sector
      pushU64(1); // 1 corpo
      pushU32(7); // id
      pushU32(idx); // kind
      pushStr('Corpo');
      pushF32(1); pushF32(2); pushF32(3); // pos
      pushF32(500); // radius
      pushF32(1e6); // mass
      pushU32(0xabcdef); // color
      pushU8(0); // hasRings
      pushF32(125); // gravity_constant
      pushF32(0.5); // ship_drag

      const msg = decodeServerMsg(new Uint8Array(parts).buffer);
      expect(msg.type).toBe('Sector');
      if (msg.type !== 'Sector') throw new Error('unreachable');
      expect(msg.payload.bodies[0]!.kind, `índice ${idx}`).toBe(TIPOS[idx]);
      // As constantes de física vêm junto e são o que mantém a previsão
      // de trajetória alinhada com o servidor.
      expect(msg.payload.gravityConstant).toBeCloseTo(125, 3);
      expect(msg.payload.shipDrag).toBeCloseTo(0.5, 3);
    }
  });

  it('unknown variant throws', () => {
    const parts: number[] = [];
    parts.push(0xff, 0xff, 0xff, 0xff);
    expect(() => decodeServerMsg(new Uint8Array(parts).buffer)).toThrow();
  });
});

describe('protocol types sanity', () => {
  it('ServerMsg is a discriminated union', () => {
    const msgs: ServerMsg[] = [
      { type: 'Welcome', payload: { player_id: 1, protocol: 2, tick_rate: 20, world_seed: 0xdeadbeef } },
      { type: 'Snapshot', payload: { tick: 0, server_time_ms: 0, entities: [] } },
      { type: 'EntityDestroyed', payload: { entity_id: 1 } },
      { type: 'XpGained', payload: { amount: 10, reason: 'test' } },
      { type: 'SkillActivated', payload: { entity_id: 1, skill: 'Dash' } },
      { type: 'Vfx', payload: { effect_id: 1, pos: [0,0,0] } },
      { type: 'Pong', payload: { nonce: 1 } },
      { type: 'Error', payload: { reason: 'x' } },
    ];
    expect(msgs).toHaveLength(8);
  });
});
