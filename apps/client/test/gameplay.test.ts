/**
 * Testes da camada pura introduzida no polimento de visual/jogabilidade.
 *
 * Cobre o que dá para verificar sem WebGPU nem DOM:
 *   - agregação de atributos (componentes + modificadores de piloto);
 *   - seleção e ciclagem de alvo;
 *   - projeção do radar;
 *   - amortecimento e FOV da câmera;
 *   - determinismo do avatar do piloto;
 *   - geometria de distribuição de nacelas.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateStats,
  statsForLoadout,
  statsDelta,
  statRating,
  BASE_HULL_MASS,
  BASE_HULL_HP,
} from '../src/game/shipStats.js';
import { componentById, COMPONENT_LIBRARY } from '../src/ui/componentLibrary.js';
import { pilotClassById, avatarTraitsFor, hashCallsign } from '../src/data/pilots.js';
import { pickTarget, cycleTarget, rankTargets, toRadarSpace, type Contact } from '../src/game/targeting.js';
import { damp, fovForSpeed } from '../src/render/CameraRig.js';
import { lateralOffsets, chassisForArchetype } from '../src/render/ShipMesh.js';

describe('shipStats — agregação', () => {
  it('nave vazia devolve o casco base, sem atributos', () => {
    const s = aggregateStats([]);
    expect(s.mass).toBe(BASE_HULL_MASS);
    expect(s.hull).toBe(BASE_HULL_HP);
    expect(s.dps).toBe(0);
    expect(s.acceleration).toBe(0);
  });

  it('soma massa, custo e empuxo dos componentes instalados', () => {
    const engine = componentById('engine_mk1')!;
    const gun = componentById('railgun_s')!;
    const s = aggregateStats([engine, gun]);

    expect(s.mass).toBe(BASE_HULL_MASS + engine.mass + gun.mass);
    expect(s.cost).toBe(engine.cost + gun.cost);
    expect(s.thrust).toBe(engine.stats.thrust);
    // DPS = dano * cadência.
    expect(s.dps).toBe(Math.round(gun.stats.damage! * gun.stats.fireRate!));
  });

  it('aceleração é empuxo por massa — mais massa, menos aceleração', () => {
    const engine = componentById('engine_mk1')!;
    const light = aggregateStats([engine]);
    const heavy = aggregateStats([engine, componentById('cargo_hauler')!]);
    expect(heavy.acceleration).toBeLessThan(light.acceleration);
  });

  it('modificadores do piloto se aplicam sobre a soma dos componentes', () => {
    const engine = componentById('engine_mk1')!;
    const base = aggregateStats([engine]);
    const ace = aggregateStats([engine], pilotClassById('ace'));
    // Ás tem thrust 1.18 e casco 0.9.
    expect(ace.thrust).toBe(Math.round(base.thrust * 1.18));
    expect(ace.hull).toBeLessThan(base.hull);
  });

  it('Colosso troca velocidade por resistência frente ao Ás', () => {
    const build = [componentById('engine_mk1')!, componentById('shield_bio')!];
    const ace = aggregateStats(build, pilotClassById('ace'));
    const jug = aggregateStats(build, pilotClassById('juggernaut'));
    expect(jug.effectiveHp).toBeGreaterThan(ace.effectiveHp);
    expect(jug.acceleration).toBeLessThan(ace.acceleration);
  });

  it('furtividade fica saturada em 0..0.9 mesmo com peças negativas', () => {
    const negative = aggregateStats([componentById('engine_void')!]);
    expect(negative.stealth).toBeGreaterThanOrEqual(0);
    const stacked = aggregateStats([
      componentById('cloak_umbra')!,
      componentById('cloak_lvl1')!,
    ], pilotClassById('ghost'));
    expect(stacked.stealth).toBeLessThanOrEqual(0.9);
  });

  it('statsForLoadout ignora templateIds desconhecidos', () => {
    const s = statsForLoadout([
      { slotId: 1, templateId: 'engine_mk1', tier: 1 },
      { slotId: 2, templateId: 'nao_existe', tier: 9 },
    ]);
    expect(s.thrust).toBe(componentById('engine_mk1')!.stats.thrust);
  });

  it('statsDelta reporta só o que mudou', () => {
    const before = aggregateStats([componentById('engine_mk1')!]);
    const after = aggregateStats([componentById('engine_mk3')!]);
    const delta = statsDelta(before, after);
    expect(delta.thrust).toBeGreaterThan(0);
    expect(delta.mass).toBeGreaterThan(0);
    // Nada de dano mudou entre dois motores.
    expect(delta.dps).toBeUndefined();
  });

  it('statRating devolve todos os eixos entre 0 e 100', () => {
    const s = aggregateStats(COMPONENT_LIBRARY.slice(0, 6));
    for (const v of Object.values(statRating(s))) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('targeting', () => {
  const origin = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };

  const ahead: Contact = {
    id: 1, name: 'À frente', pos: { x: 0, y: 0, z: -100 }, faction: 'hostile', hpRatio: 1,
  };
  // Ao lado e bem mais perto: serve para provar que o alinhamento pesa
  // mais que a distância. Um contato exatamente ATRÁS não serviria — a
  // mira o descarta por `minAlignment`, e o teste passaria por engano.
  const beside: Contact = {
    id: 2, name: 'Ao lado', pos: { x: 40, y: 0, z: 0 }, faction: 'hostile', hpRatio: 1,
  };
  const behind: Contact = {
    id: 4, name: 'Atrás', pos: { x: 0, y: 0, z: 40 }, faction: 'hostile', hpRatio: 1,
  };
  const neutral: Contact = {
    id: 3, name: 'Neutro', pos: { x: 0, y: 0, z: -20 }, faction: 'neutral', hpRatio: 1,
  };

  it('prefere o alvo alinhado ao nariz mesmo se o outro está mais perto', () => {
    const t = pickTarget(origin, forward, [beside, ahead]);
    expect(t?.id).toBe(ahead.id);
  });

  it('descarta o que está diretamente às costas', () => {
    expect(pickTarget(origin, forward, [behind])).toBeNull();
    // Com o cone aberto para 360°, volta a ser um alvo válido.
    expect(pickTarget(origin, forward, [behind], { minAlignment: -1 })?.id).toBe(behind.id);
  });

  it('ignora contatos não hostis', () => {
    expect(pickTarget(origin, forward, [neutral])).toBeNull();
  });

  it('ignora contatos além do alcance', () => {
    const far: Contact = { ...ahead, id: 9, pos: { x: 0, y: 0, z: -5000 } };
    expect(pickTarget(origin, forward, [far], { maxRange: 1000 })).toBeNull();
  });

  it('rankTargets ordena por score decrescente', () => {
    const ranked = rankTargets(origin, forward, [beside, ahead]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
  });

  it('cycleTarget percorre a lista e volta ao início', () => {
    const contacts = [ahead, beside];
    const first = cycleTarget(null, origin, forward, contacts);
    expect(first?.id).toBe(ahead.id);
    const second = cycleTarget(first!.id, origin, forward, contacts);
    expect(second?.id).toBe(beside.id);
    const wrapped = cycleTarget(second!.id, origin, forward, contacts);
    expect(wrapped?.id).toBe(ahead.id);
  });

  it('cycleTarget cai no melhor alvo se o atual sumiu', () => {
    const next = cycleTarget(999, origin, forward, [ahead]);
    expect(next?.id).toBe(ahead.id);
  });

  it('radar coloca o que está à frente no topo (y positivo)', () => {
    const p = toRadarSpace(origin, 0, { x: 0, y: 0, z: -100 }, 200);
    expect(p.y).toBeGreaterThan(0);
    expect(Math.abs(p.x)).toBeLessThan(0.001);
    expect(p.clamped).toBe(false);
  });

  it('radar gruda contatos fora de alcance na borda', () => {
    const p = toRadarSpace(origin, 0, { x: 0, y: 0, z: -5000 }, 200);
    expect(p.clamped).toBe(true);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 5);
  });

  it('radar acompanha o rumo da nave', () => {
    // Nave virada 90° — o contato à frente do mundo vai para o lado.
    const p = toRadarSpace(origin, Math.PI / 2, { x: 0, y: 0, z: -100 }, 200);
    expect(Math.abs(p.x)).toBeGreaterThan(Math.abs(p.y));
  });
});

describe('CameraRig — matemática de suavização', () => {
  it('damp aproxima do alvo sem ultrapassar', () => {
    let v = 0;
    for (let i = 0; i < 10; i++) v = damp(v, 100, 6, 1 / 60);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });

  it('damp converge para o alvo com tempo suficiente', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = damp(v, 100, 6, 1 / 60);
    expect(v).toBeCloseTo(100, 1);
  });

  it('damp é estável com dt inválido ou zero', () => {
    expect(damp(5, 100, 6, 0)).toBe(5);
    expect(damp(5, 100, 6, Number.NaN)).toBe(5);
  });

  it('FOV abre com a velocidade e satura', () => {
    const parado = fovForSpeed(0);
    const medio = fovForSpeed(60);
    const rapido = fovForSpeed(120);
    const absurdo = fovForSpeed(100000);
    expect(parado).toBe(70);
    expect(medio).toBeGreaterThan(parado);
    expect(rapido).toBeGreaterThan(medio);
    // Saturado: além do máximo não abre mais.
    expect(absurdo).toBeCloseTo(rapido, 5);
  });
});

describe('pilotos e casco', () => {
  it('avatar é determinístico por callsign', () => {
    expect(avatarTraitsFor('Nova')).toEqual(avatarTraitsFor('Nova'));
    expect(hashCallsign('Nova')).toBe(hashCallsign('Nova'));
  });

  it('callsigns diferentes geram traços diferentes', () => {
    const a = avatarTraitsFor('Nova');
    const b = avatarTraitsFor('Corvo');
    expect(a.hue === b.hue && a.helmet === b.helmet && a.insignia === b.insignia).toBe(false);
  });

  it('iniciais têm sempre dois caracteres', () => {
    expect(avatarTraitsFor('X').initials).toHaveLength(2);
    expect(avatarTraitsFor('').initials).toHaveLength(2);
    expect(avatarTraitsFor('Nova').initials).toBe('NO');
  });

  it('nacelas ficam simétricas em torno do eixo', () => {
    expect(lateralOffsets(0, 5)).toEqual([]);
    expect(lateralOffsets(1, 5)).toEqual([0]);
    const two = lateralOffsets(2, 5);
    expect(two[0]).toBe(-5);
    expect(two[1]).toBe(5);
    // Contagem ímpar mantém uma nacela no centro.
    expect(lateralOffsets(3, 6)[1]).toBe(0);
  });

  it('arquétipo de NPC mapeia para casco distinto', () => {
    expect(chassisForArchetype(1)).toBe('skirmisher');
    expect(chassisForArchetype(2)).toBe('cruiser');
    expect(chassisForArchetype(3)).toBe('hauler');
    expect(chassisForArchetype(99)).toBe('interceptor');
  });
});

describe('prioridade de torpedo na mira', () => {
  // Abater o torpedo é uma das quatro defesas contra ele, e a que exige
  // o tiro mais difícil do jogo. Se ele não subisse na ordem, o jogador
  // teria de encontrá-lo manualmente entre os contatos justamente nos
  // segundos em que não há tempo para isso.
  const origin = { x: 0, y: 0, z: 0 };
  const forward = { x: 0, y: 0, z: -1 };

  const nave: Contact = {
    id: 1, name: 'Inimigo', pos: { x: 0, y: 0, z: -200 },
    faction: 'hostile', kind: 'ship', hpRatio: 1,
  };
  const torpedo: Contact = {
    id: 2, name: 'Torpedo', pos: { x: 0, y: 0, z: -220 },
    faction: 'hostile', kind: 'torpedo', hpRatio: 1,
  };

  it('um torpedo a caminho ganha da nave a distância parecida', () => {
    expect(pickTarget(origin, forward, [nave, torpedo])?.id).toBe(torpedo.id);
  });

  it('mas um torpedo distante perde para uma nave colada', () => {
    // Ganho, não prioridade absoluta: a nave a 30 unidades é o perigo
    // mais imediato.
    const colada: Contact = { ...nave, pos: { x: 0, y: 0, z: -30 } };
    const longe: Contact = { ...torpedo, pos: { x: 0, y: 0, z: -1000 } };
    expect(pickTarget(origin, forward, [colada, longe])?.id).toBe(colada.id);
  });

  it('contato sem `kind` continua funcionando como nave', () => {
    // O campo é opcional: código antigo que monta contatos sem ele não
    // pode passar a receber prioridade de torpedo por acidente.
    const semKind: Contact = { ...nave, id: 9 };
    delete (semKind as { kind?: string }).kind;
    const r = rankTargets(origin, forward, [semKind, torpedo]);
    expect(r[0]?.contact.id).toBe(torpedo.id);
  });
});
