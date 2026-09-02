/**
 * Protocolo de rede espelhado em TypeScript.
 * Deve ficar em sincronia com crates/game-server/src/net/protocol.rs.
 *
 * Wire format: bincode (little-endian, int fixo, sem varint).
 *   - enums: u32 discriminante + payload
 *   - strings/Vec: u64 length + items
 *   - Option<T>: u8 tag (0=None, 1=Some) + payload
 *   - bool: u8 (0/1)
 */

export const PROTOCOL_VERSION = 8 as const;
/**
 * Precisa bater com `SNAPSHOT_RATE_HZ` do servidor — é o intervalo que a
 * interpolação usa como alvo. O servidor tica a 30Hz e envia snapshot a
 * cada 2 ticks; anunciava 20 por engano, o que fazia o cliente interpolar
 * contra um intervalo 33% menor que o real.
 */
export const SNAPSHOT_RATE_HZ = 15 as const;

// --- Tipos públicos ---

export interface JoinMsg {
  name: string;
  protocol: number;
  /**
   * `templateId`s equipados, em ORDEM DE SLOT.
   *
   * O cliente manda só os ids; quem resolve dano, escudo e empuxo é o
   * servidor, no catálogo dele. Enviar números daqui deixaria o dano
   * sob controle do cliente.
   */
  loadout: string[];
  /** Nós da árvore de skills desbloqueados pela conta. */
  skills: string[];
}
export interface InputMsg {
  /** -1..1 — guinada (yaw). */
  steer: number;
  /** -1..1 — arfagem (pitch): nariz para cima/baixo. */
  pitch: number;
  /** -1..1 — rolagem sobre o eixo longitudinal. */
  roll: number;
  /** 0..1 — aceleração. */
  thrust: number;
  fire: boolean;
  /**
   * Segundos que o gatilho ficou segurado antes de soltar.
   *
   * Quem decide o efeito é o SERVIDOR: ele conhece o tempo de carga da
   * arma equipada e satura o valor. O cliente só relata o tempo.
   */
  fireCharge: number;
  skill: ActiveSkill | null;
}
export interface PingMsg {
  nonce: number;
}
export type ClientMsg =
  | { type: 'Join'; payload: JoinMsg }
  | { type: 'Input'; payload: InputMsg }
  | { type: 'Ping'; payload: PingMsg };

export interface WelcomeMsg {
  player_id: number;
  protocol: number;
  tick_rate: number;
  world_seed: number;
}
export type EntityKind =
  | 'Ship'
  | 'Projectile'
  | 'Npc'
  | 'Asteroid'
  | 'Anomaly'
  | 'Wreck'
  /** Vórtice de dobra: rastro que impulsiona quem entrar (v6). */
  | 'Vortex';

export interface NpcPayload {
  archetype: number;
  ai_state: number;
  radius: number;
  target_id: number | null;
}
export interface AsteroidPayload {
  kind: number;
  radius: number;
  resource_units: number;
}
export interface AnomalyPayload {
  kind: number;
  radius: number;
  intensity: number;
  target_warp_id: number | null;
}
export interface WreckPayload {
  ship_template: string;
  radius: number;
  ttl_remaining: number;
  loot_count: number;
}
/** Payload de vórtice de dobra. */
export interface VortexPayload {
  /** Direção do impulso (unitária). */
  dir: [number, number, number];
  radius: number;
  /** 0..1 — potência restante; o vórtice enfraquece ao envelhecer. */
  strength: number;
}

export type EntityPayload =
  | { type: 'Npc'; payload: NpcPayload }
  | { type: 'Asteroid'; payload: AsteroidPayload }
  | { type: 'Anomaly'; payload: AnomalyPayload }
  | { type: 'Wreck'; payload: WreckPayload }
  | { type: 'Vortex'; payload: VortexPayload }
  | { type: 'Projectile'; payload: ProjectilePayload };

/**
 * Aparência de um projétil, decidida pelo servidor.
 *
 * O dano nunca vem por aqui — o servidor é a autoridade. Isto existe
 * só para o tiro PARECER o que é: sem ele todo projétil era a mesma
 * esfera amarela, e nem a arma equipada nem o tempo de carga apareciam
 * na tela.
 */
export interface ProjectilePayload {
  /** Família visual da arma: 0 cinético, 1 laser, 2 plasma, 3 lança. */
  visual: number;
  /** 0..1 — carga aproveitada no disparo. */
  charge: number;
  /** Raio real do projétil, já com o bônus de carga. */
  radius: number;
}

export interface EntityState {
  id: number;
  kind: EntityKind;
  pos: [number, number, number];
  rot: [number, number, number, number]; // quaternion x,y,z,w
  vel: [number, number, number];
  hp_ratio: number | null;
  display_name: string | null;
  payload: EntityPayload | null;
}
export interface SnapshotData {
  tick: number;
  server_time_ms: number;
  entities: EntityState[];
}
export interface EntityDestroyedMsg {
  entity_id: number;
}
export interface XpGainedMsg {
  amount: number;
  reason: string;
}
export type ActiveSkill = 'Dash' | 'Emp' | 'Repair';
export interface SkillActivatedMsg {
  entity_id: number;
  skill: ActiveSkill;
}
export interface VfxMsg {
  effect_id: number;
  pos: [number, number, number];
}
export interface PongMsg {
  nonce: number;
}
export interface ErrorMsg {
  reason: string;
}
/**
 * Lote de entidades estáticas (asteroides, anomalias, destroços).
 *
 * No protocolo v3 elas saíram do snapshot de 20Hz: como não se movem, o
 * servidor manda cada uma UMA vez, quando entra no raio de interesse, e
 * lista em `expired` as que saíram. O cliente acumula entre os lotes.
 */
export interface WorldChunkData {
  tick: number;
  entities: EntityState[];
  /** Ids que saíram do raio e podem ser liberados pelo cliente. */
  expired: number[];
}

/** Tipo de corpo celeste. Mesma ordem do enum em Rust. */
export type BodyKind = 'Star' | 'Planet' | 'GasGiant' | 'Moon' | 'NeutronStar' | 'BlackHole';

/**
 * Corpo celeste do setor: estrela, planeta, gigante ou lua.
 *
 * Vem do SERVIDOR (mensagem `Sector`), não é mais gerado no cliente.
 * Estes corpos têm massa e exercem gravidade real na simulação, então
 * os dois lados precisam concordar sobre onde cada um está.
 */
export interface CelestialBody {
  id: number;
  kind: BodyKind;
  name: string;
  pos: [number, number, number];
  radius: number;
  mass: number;
  color: number;
  hasRings: boolean;
}

export interface SectorData {
  bodies: CelestialBody[];
  /**
   * Constante gravitacional do shard.
   *
   * Vem do servidor em vez de ser fixa aqui: a previsão de trajetória
   * usa a mesma fórmula, e um valor diferente dos dois lados daria uma
   * curva plausível e errada, sem erro nenhum aparecendo.
   */
  gravityConstant: number;
  /** Arrasto da nave, para a previsão bater com a física real. */
  shipDrag: number;
}

export type ServerMsg =
  | { type: 'Welcome'; payload: WelcomeMsg }
  | { type: 'Snapshot'; payload: SnapshotData }
  | { type: 'Sector'; payload: SectorData }
  | { type: 'WorldChunk'; payload: WorldChunkData }
  | { type: 'EntityDestroyed'; payload: EntityDestroyedMsg }
  | { type: 'XpGained'; payload: XpGainedMsg }
  | { type: 'SkillActivated'; payload: SkillActivatedMsg }
  | { type: 'Vfx'; payload: VfxMsg }
  | { type: 'Pong'; payload: PongMsg }
  | { type: 'Error'; payload: ErrorMsg };

// --- Discriminantes (ordem deve bater com a declaração em Rust) ---
const CLIENT_VARIANT = { Join: 0, Input: 1, Ping: 2 } as const;
const SERVER_VARIANT = {
  Welcome: 0,
  Snapshot: 1,
  // v5 inseriu `Sector` aqui, deslocando o resto em 1. A ordem tem que
  // bater exatamente com o enum ServerMsg em
  // `crates/game-server/src/net/protocol.rs`.
  Sector: 2,
  WorldChunk: 3,
  EntityDestroyed: 4,
  XpGained: 5,
  SkillActivated: 6,
  Vfx: 7,
  Pong: 8,
  Error: 9,
} as const;
const ENTITY_KIND = {
  Ship: 0, Projectile: 1, Npc: 2, Asteroid: 3, Anomaly: 4, Wreck: 5,
  // v6: vórtice de dobra.
  Vortex: 6,
} as const;
/**
 * Variantes de `EntityPayload`.
 *
 * ATENÇÃO ao encaixe com `Option`: bincode escreve um `Option<T>` como
 * um byte (0 = None, 1 = Some) SEGUIDO do valor, e um enum como
 * discriminante de **u32**. Portanto `Option<EntityPayload>` ocupa
 * 1 + 4 bytes quando presente, não 1.
 *
 * A versão anterior lia um único byte e usava `None: 0, Npc: 1, ...`,
 * o que por acaso funcionava enquanto TODA entidade vinha com payload
 * `None` (o byte 0 batia). O vórtice da v6 foi o primeiro payload de
 * verdade e o desalinhamento derrubou o snapshot inteiro, com o erro
 * enganoso `EntityKind desconhecido: 2147483648`.
 */
const PAYLOAD_VARIANT = {
  Npc: 0,
  Asteroid: 1,
  Anomaly: 2,
  Wreck: 3,
  Vortex: 4,
  // v7, acrescentada no fim: as anteriores mantêm a discriminante.
  Projectile: 5,
} as const;

// --- Encoder binário (apenas o que precisamos emitir) ---

class BincodeWriter {
  private readonly parts: number[] = [];
  writeU8(v: number): void {
    this.parts.push(v & 0xff);
  }
  writeU16(v: number): void {
    this.parts.push(v & 0xff, (v >>> 8) & 0xff);
  }
  writeU32(v: number): void {
    this.parts.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff,
    );
  }
  writeU64(v: number | bigint): void {
    const n = typeof v === 'bigint' ? v : BigInt(v);
    for (let i = 0; i < 8; i++) {
      this.parts.push(Number((n >> BigInt(i * 8)) & 0xffn));
    }
  }
  writeF32(v: number): void {
    const buf = new ArrayBuffer(4);
    new Float32Array(buf)[0] = v;
    const u = new Uint8Array(buf);
    this.parts.push(u[0] ?? 0, u[1] ?? 0, u[2] ?? 0, u[3] ?? 0);
  }
  writeBool(v: boolean): void {
    this.parts.push(v ? 1 : 0);
  }
  writeString(v: string): void {
    const utf8 = new TextEncoder().encode(v);
    this.writeU64(utf8.length);
    for (const b of utf8) this.parts.push(b);
  }
  toBytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

// --- Decoder binário (apenas o que precisamos ler) ---

class BincodeReader {
  private readonly view: DataView;
  private pos: number;
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
    this.pos = 0;
  }
  readU8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  readU16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  readU32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readU64(): number {
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return Number(v);
  }
  readF32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  readBool(): boolean {
    return this.readU8() !== 0;
  }
  readString(): string {
    const len = this.readU64();
    const start = this.pos;
    this.pos += len;
    return new TextDecoder().decode(new Uint8Array(this.view.buffer, start, len));
  }
  readOptionU32(): number | null {
    const tag = this.readU8();
    if (tag === 0) return null;
    return this.readU32();
  }
}

function kindFromIdx(idx: number): EntityKind {
  switch (idx) {
    case ENTITY_KIND.Ship:
      return 'Ship';
    case ENTITY_KIND.Projectile:
      return 'Projectile';
    case ENTITY_KIND.Npc:
      return 'Npc';
    case ENTITY_KIND.Asteroid:
      return 'Asteroid';
    case ENTITY_KIND.Anomaly:
      return 'Anomaly';
    case ENTITY_KIND.Wreck:
      return 'Wreck';
    case ENTITY_KIND.Vortex:
      return 'Vortex';
    default:
      throw new Error(`[protocol] EntityKind desconhecido: ${idx}`);
  }
}

function readPayload(r: BincodeReader): EntityPayload | null {
  // Primeiro o byte do Option; só então a discriminante u32 do enum.
  if (r.readU8() === 0) return null;
  const tag = r.readU32();
  switch (tag) {
    case PAYLOAD_VARIANT.Npc:
      return {
        type: 'Npc',
        payload: {
          archetype: r.readU8(),
          ai_state: r.readU8(),
          radius: r.readF32(),
          target_id: r.readOptionU32(),
        },
      };
    case PAYLOAD_VARIANT.Asteroid:
      return {
        type: 'Asteroid',
        payload: {
          kind: r.readU8(),
          radius: r.readF32(),
          resource_units: r.readU32(),
        },
      };
    case PAYLOAD_VARIANT.Anomaly:
      return {
        type: 'Anomaly',
        payload: {
          kind: r.readU8(),
          radius: r.readF32(),
          intensity: r.readF32(),
          target_warp_id: r.readOptionU32(),
        },
      };
    case PAYLOAD_VARIANT.Wreck:
      return {
        type: 'Wreck',
        payload: {
          ship_template: r.readString(),
          radius: r.readF32(),
          ttl_remaining: r.readU64(),
          loot_count: r.readU32(),
        },
      };
    case PAYLOAD_VARIANT.Vortex:
      return {
        type: 'Vortex',
        payload: {
          dir: [r.readF32(), r.readF32(), r.readF32()],
          radius: r.readF32(),
          strength: r.readF32(),
        },
      };
    case PAYLOAD_VARIANT.Projectile:
      return {
        type: 'Projectile',
        payload: {
          visual: r.readU8(),
          charge: r.readF32(),
          radius: r.readF32(),
        },
      };
    default:
      throw new Error(`[protocol] EntityPayload desconhecido: ${tag}`);
  }
}

/**
 * Lê um `Vec<EntityState>` bincode. Extraído porque `Snapshot` e
 * `WorldChunk` carregam exatamente o mesmo layout de entidade — duplicar
 * o laço seria mais uma chance de os dois saírem de sincronia.
 */
function readEntityVec(r: BincodeReader): EntityState[] {
  const vecLen = r.readU64();
  const entities: EntityState[] = new Array(vecLen);
  for (let i = 0; i < vecLen; i++) {
    const id = r.readU32();
    const kindIdx = r.readU32();
    const kind = kindFromIdx(kindIdx);
    const pos: [number, number, number] = [r.readF32(), r.readF32(), r.readF32()];
    const rot: [number, number, number, number] = [
      r.readF32(),
      r.readF32(),
      r.readF32(),
      r.readF32(),
    ];
    const vel: [number, number, number] = [r.readF32(), r.readF32(), r.readF32()];
    const hpTag = r.readU8();
    const hp_ratio = hpTag === 0 ? null : r.readF32();
    const nameTag = r.readU8();
    const display_name = nameTag === 0 ? null : r.readString();
    const payload = readPayload(r);
    entities[i] = { id, kind, pos, rot, vel, hp_ratio, display_name, payload };
  }
  return entities;
}

/** Índice do enum `BodyKind` em Rust -> string. */
function bodyKindFromIdx(i: number): BodyKind {
  switch (i) {
    case 0: return 'Star';
    case 1: return 'Planet';
    case 2: return 'GasGiant';
    case 3: return 'Moon';
    case 4: return 'NeutronStar';
    case 5: return 'BlackHole';
    default: throw new Error(`[protocol] BodyKind desconhecido: ${i}`);
  }
}

function readActiveSkill(r: BincodeReader): ActiveSkill {
  const tag = r.readU32(); // enum in bincode by default uses u32 for discriminant
  switch (tag) {
    case 0: return 'Dash';
    case 1: return 'Emp';
    case 2: return 'Repair';
    default: throw new Error(`[protocol] ActiveSkill desconhecido: ${tag}`);
  }
}

// --- API pública ---

function writeActiveSkill(w: BincodeWriter, skill: ActiveSkill) {
  switch (skill) {
    case 'Dash': w.writeU32(0); break;
    case 'Emp': w.writeU32(1); break;
    case 'Repair': w.writeU32(2); break;
  }
}

export function encodeClientMsg(msg: ClientMsg): Uint8Array {
  const w = new BincodeWriter();
  switch (msg.type) {
    case 'Join': {
      w.writeU32(CLIENT_VARIANT.Join);
      w.writeString(msg.payload.name);
      w.writeU16(msg.payload.protocol);
      // Vec<String> em bincode: u64 de comprimento + cada string.
      const lo = msg.payload.loadout;
      w.writeU64(lo.length);
      for (const id of lo) w.writeString(id);
      // v8: as skills entram logo depois, no mesmo formato. É o
      // servidor que converte id em número — aqui só vão ids.
      const sk = msg.payload.skills;
      w.writeU64(sk.length);
      for (const id of sk) w.writeString(id);
      break;
    }
    case 'Input':
      w.writeU32(CLIENT_VARIANT.Input);
      // Ordem idêntica à declaração de `ClientMsg::Input` em Rust:
      // steer, pitch, roll, thrust, fire, skill.
      w.writeF32(msg.payload.steer);
      w.writeF32(msg.payload.pitch);
      w.writeF32(msg.payload.roll);
      w.writeF32(msg.payload.thrust);
      w.writeBool(msg.payload.fire);
      w.writeF32(msg.payload.fireCharge);
      if (msg.payload.skill === null) {
        w.writeU8(0);
      } else {
        w.writeU8(1);
        writeActiveSkill(w, msg.payload.skill);
      }
      break;
    case 'Ping':
      w.writeU32(CLIENT_VARIANT.Ping);
      w.writeU32(msg.payload.nonce);
      break;
  }
  return w.toBytes();
}

export function decodeServerMsg(buf: ArrayBuffer): ServerMsg {
  const r = new BincodeReader(buf);
  const variant = r.readU32();
  switch (variant) {
    case SERVER_VARIANT.Welcome:
      return {
        type: 'Welcome',
        payload: {
          player_id: r.readU32(),
          protocol: r.readU16(),
          tick_rate: r.readU32(),
          world_seed: r.readU32(),
        },
      };
    case SERVER_VARIANT.Snapshot: {
      const tick = r.readU64();
      const server_time_ms = r.readU64();
      const entities = readEntityVec(r);
      return {
        type: 'Snapshot',
        payload: { tick, server_time_ms, entities },
      };
    }
    case SERVER_VARIANT.Sector: {
      const n = r.readU64();
      const bodies: CelestialBody[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const id = r.readU32();
        const kind = bodyKindFromIdx(r.readU32());
        const name = r.readString();
        const pos: [number, number, number] = [r.readF32(), r.readF32(), r.readF32()];
        const radius = r.readF32();
        const mass = r.readF32();
        const color = r.readU32();
        const hasRings = r.readBool();
        bodies[i] = { id, kind, name, pos, radius, mass, color, hasRings };
      }
      const gravityConstant = r.readF32();
      const shipDrag = r.readF32();
      return { type: 'Sector', payload: { bodies, gravityConstant, shipDrag } };
    }
    case SERVER_VARIANT.WorldChunk: {
      const tick = r.readU64();
      const entities = readEntityVec(r);
      const expiredLen = r.readU64();
      const expired: number[] = new Array(expiredLen);
      for (let i = 0; i < expiredLen; i++) expired[i] = r.readU32();
      return { type: 'WorldChunk', payload: { tick, entities, expired } };
    }
    case SERVER_VARIANT.EntityDestroyed:
      return { type: 'EntityDestroyed', payload: { entity_id: r.readU32() } };
    case SERVER_VARIANT.XpGained:
      return {
        type: 'XpGained',
        payload: {
          amount: r.readU32(),
          reason: r.readString(),
        },
      };
    case SERVER_VARIANT.SkillActivated:
      return {
        type: 'SkillActivated',
        payload: {
          entity_id: r.readU32(),
          skill: readActiveSkill(r),
        },
      };
    case SERVER_VARIANT.Vfx:
      return {
        type: 'Vfx',
        payload: {
          effect_id: r.readU8(),
          pos: [r.readF32(), r.readF32(), r.readF32()],
        },
      };
    case SERVER_VARIANT.Pong:
      return { type: 'Pong', payload: { nonce: r.readU32() } };
    case SERVER_VARIANT.Error:
      return { type: 'Error', payload: { reason: r.readString() } };
    default:
      throw new Error(`[protocol] variante de servidor desconhecida: ${variant}`);
  }
}
