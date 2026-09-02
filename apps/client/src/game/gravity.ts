/**
 * Previsão de trajetória sob gravidade.
 *
 * Espelha a física do servidor para desenhar, no HUD, para onde a nave
 * está sendo levada. O servidor continua sendo a autoridade — isto é só
 * visualização — mas a fórmula precisa ser a MESMA, senão a curva fica
 * bonita e errada, sem nenhum erro visível.
 *
 * Por isso `gravityConstant` e `shipDrag` chegam na mensagem `Sector` em
 * vez de serem codificados aqui.
 *
 * Módulo puro: sem three.js, sem DOM.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Corpo celeste com o que a previsão precisa. */
export interface GravityBody {
  id: number;
  name: string;
  kind: string;
  pos: [number, number, number];
  radius: number;
  mass: number;
  color: number;
}

/**
 * Multiplicador do raio de influência por tipo.
 * Espelha `BodyKind::influence_scale` em `celestial.rs`.
 */
export function influenceScale(kind: string): number {
  switch (kind) {
    case 'GasGiant': return 20;
    case 'NeutronStar': return 40;
    case 'BlackHole': return 60;
    default: return 14;
  }
}

export function influenceRadius(body: GravityBody): number {
  return body.radius * influenceScale(body.kind);
}

/** Raio a partir do qual o HUD considera a nave "capturada". */
export function captureRadius(body: GravityBody): number {
  return body.radius * 5;
}

/**
 * Aceleração que `body` impõe em `pos`.
 * Zero fora do raio de influência; satura na superfície, como no servidor.
 */
export function gravityAt(body: GravityBody, pos: Vec3, g: number): Vec3 {
  const dx = body.pos[0] - pos.x;
  const dy = body.pos[1] - pos.y;
  const dz = body.pos[2] - pos.z;
  const distSq = dx * dx + dy * dy + dz * dz;

  const inf = influenceRadius(body);
  if (distSq > inf * inf || distSq <= 1e-12) return { x: 0, y: 0, z: 0 };

  const dist = Math.sqrt(distSq);
  // Piso na superfície: dentro do corpo a nave já colidiu, e sem o piso
  // a força tenderia ao infinito.
  const eff = Math.max(dist, body.radius);
  const accel = (g * body.mass) / (eff * eff);

  return { x: (dx / dist) * accel, y: (dy / dist) * accel, z: (dz / dist) * accel };
}

/** Soma da gravidade de todos os corpos. */
export function gravityTotal(bodies: readonly GravityBody[], pos: Vec3, g: number): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  for (const b of bodies) {
    const a = gravityAt(b, pos, g);
    out.x += a.x;
    out.y += a.y;
    out.z += a.z;
  }
  return out;
}

export function magnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Corpo cujo raio de captura contém `pos` — o mais próximo, se vários. */
export function dominantBody(
  bodies: readonly GravityBody[],
  pos: Vec3,
): { body: GravityBody; distance: number } | null {
  let melhor: { body: GravityBody; distance: number } | null = null;
  for (const b of bodies) {
    const d = Math.hypot(b.pos[0] - pos.x, b.pos[1] - pos.y, b.pos[2] - pos.z);
    if (d <= captureRadius(b) && (!melhor || d < melhor.distance)) {
      melhor = { body: b, distance: d };
    }
  }
  return melhor;
}

export interface TrajectoryOptions {
  /** Passo de integração, em segundos. */
  step?: number;
  /** Quantos passos simular. */
  steps?: number;
  /** Arrasto linear da nave (vem do servidor). */
  drag?: number;
}

export interface Trajectory {
  /** Pontos da curva prevista, incluindo a posição inicial. */
  points: Vec3[];
  /** Corpo em que a trajetória termina colidindo, se houver. */
  impact: GravityBody | null;
  /** Segundos até o impacto previsto, ou null. */
  timeToImpact: number | null;
}

/**
 * Integra a trajetória livre (sem empuxo) a partir do estado atual.
 *
 * Usa o mesmo esquema do servidor — semi-implícito: primeiro atualiza a
 * velocidade com a gravidade e o arrasto, depois a posição. Integrar na
 * ordem inversa daria uma curva sistematicamente adiantada.
 *
 * "Sem empuxo" é deliberado: o que interessa mostrar é *para onde a
 * gravidade leva se você não fizer nada*.
 */
export function predictTrajectory(
  bodies: readonly GravityBody[],
  pos: Vec3,
  vel: Vec3,
  gravityConstant: number,
  opts: TrajectoryOptions = {},
): Trajectory {
  const step = opts.step ?? 0.25;
  const steps = Math.max(1, Math.min(opts.steps ?? 160, 2000));
  const drag = opts.drag ?? 0;

  const points: Vec3[] = [{ ...pos }];
  const p = { ...pos };
  const v = { ...vel };
  // Fator de arrasto por passo, equivalente ao do servidor por tick.
  const dragFactor = Math.max(0, 1 - drag * step);

  for (let i = 0; i < steps; i++) {
    const g = gravityTotal(bodies, p, gravityConstant);
    v.x = (v.x + g.x * step) * dragFactor;
    v.y = (v.y + g.y * step) * dragFactor;
    v.z = (v.z + g.z * step) * dragFactor;
    p.x += v.x * step;
    p.y += v.y * step;
    p.z += v.z * step;
    points.push({ ...p });

    // Colidiu com alguma superfície? A curva termina ali.
    for (const b of bodies) {
      const d = Math.hypot(b.pos[0] - p.x, b.pos[1] - p.y, b.pos[2] - p.z);
      if (d <= b.radius) {
        return { points, impact: b, timeToImpact: (i + 1) * step };
      }
    }
  }

  return { points, impact: null, timeToImpact: null };
}

/**
 * Velocidade de escape a partir de `dist` — `sqrt(2 G M / r)`.
 * O HUD compara com a velocidade atual para dizer se dá para sair.
 */
export function escapeSpeed(body: GravityBody, dist: number, g: number): number {
  const r = Math.max(dist, body.radius);
  return Math.sqrt((2 * g * body.mass) / r);
}
