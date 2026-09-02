/**
 * Matemática de navegação: rumo, projeção de marcos e marcadores de borda.
 *
 * O radar mostra o que está PERTO, no plano. Ele não responde "para onde
 * eu vou" nem "onde fica aquele planeta que eu vi antes". Estas funções
 * alimentam a bússola e os marcadores de borda, que resolvem as duas
 * perguntas.
 *
 * Módulo puro — sem three.js, sem DOM — para poder ser testado direto.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Ponto de interesse navegável (planeta, estação, cinturão...). */
export interface NavPoint {
  id: string;
  name: string;
  /** Categoria — o HUD escolhe o glifo por ela. */
  kind: 'star' | 'planet' | 'giant' | 'belt' | 'station' | 'exotic';
  position: Vec3;
  color: number;
}

/**
 * Rumo em graus (0..360) de `from` para `to`, no plano XZ.
 *
 * 0° = norte do setor (-Z), 90° = leste (+X). É a mesma convenção da
 * bússola náutica, que é o que a maioria das pessoas já intui.
 */
export function bearingTo(from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Rumo em graus para o qual a nave aponta, dado seu vetor de frente. */
export function headingFromForward(forward: Vec3): number {
  const deg = (Math.atan2(forward.x, -forward.z) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Menor diferença angular com sinal, em graus (-180..180].
 *
 * Positivo = o alvo está à direita. Sem isso a bússola daria voltas de
 * 359° quando o rumo cruza o zero.
 */
export function angleDelta(fromDeg: number, toDeg: number): number {
  let d = ((toDeg - fromDeg + 540) % 360) - 180;
  // `-180` e `180` são o mesmo ângulo; normalizamos para +180.
  if (d === -180) d = 180;
  return d;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Distância legível: 850 u, 4.2 km, 18 km. */
export function formatDistance(units: number): string {
  if (!Number.isFinite(units) || units < 0) return '—';
  if (units < 1000) return `${Math.round(units)} u`;
  const km = units / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export interface CompassMark {
  point: NavPoint;
  /** Rumo absoluto do marco. */
  bearing: number;
  /** Diferença para o rumo atual (-180..180]. */
  delta: number;
  distance: number;
  /**
   * Posição na fita da bússola, 0..1, onde 0.5 é o centro (à frente).
   * `null` quando está fora do campo de visão da fita.
   */
  ribbonPos: number | null;
}

/**
 * Prepara os marcos para a fita de bússola.
 *
 * `fovDegrees` é a largura angular que a fita representa; marcos fora
 * dela recebem `ribbonPos: null` e o HUD os desenha como seta lateral.
 */
export function compassMarks(
  origin: Vec3,
  heading: number,
  points: readonly NavPoint[],
  fovDegrees = 150,
): CompassMark[] {
  const half = fovDegrees / 2;
  return points
    .map((point) => {
      const bearing = bearingTo(origin, point.position);
      const delta = angleDelta(heading, bearing);
      return {
        point,
        bearing,
        delta,
        distance: distance(origin, point.position),
        ribbonPos: Math.abs(delta) <= half ? 0.5 + delta / fovDegrees : null,
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Marcadores cardeais (N/NE/E/...) posicionados na fita.
 * Dá referência absoluta mesmo quando nenhum marco está à frente.
 */
export const CARDINALS: ReadonlyArray<{ label: string; bearing: number }> = [
  { label: 'N', bearing: 0 },
  { label: 'NE', bearing: 45 },
  { label: 'L', bearing: 90 },
  { label: 'SE', bearing: 135 },
  { label: 'S', bearing: 180 },
  { label: 'SO', bearing: 225 },
  { label: 'O', bearing: 270 },
  { label: 'NO', bearing: 315 },
];

export function cardinalMarks(
  heading: number,
  fovDegrees = 150,
): Array<{ label: string; ribbonPos: number }> {
  const half = fovDegrees / 2;
  const out: Array<{ label: string; ribbonPos: number }> = [];
  for (const c of CARDINALS) {
    const delta = angleDelta(heading, c.bearing);
    if (Math.abs(delta) <= half) {
      out.push({ label: c.label, ribbonPos: 0.5 + delta / fovDegrees });
    }
  }
  return out;
}

/**
 * Onde desenhar o marcador de um alvo fora da tela.
 *
 * Devolve um ponto na borda de um retângulo `width x height` na direção
 * do alvo, mais o ângulo para girar a seta. `onScreen` diz se o alvo já
 * está visível (aí o HUD desenha um losango no lugar da seta).
 */
export function edgeMarker(
  delta: number,
  verticalRatio: number,
  width: number,
  height: number,
  margin = 48,
): { x: number; y: number; angle: number; onScreen: boolean } {
  const onScreen = Math.abs(delta) <= 40;

  // Direção no plano da tela: delta horizontal, verticalRatio vertical.
  const rad = (delta * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -verticalRatio;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;

  const halfW = width / 2 - margin;
  const halfH = height / 2 - margin;
  // Escala até tocar a borda do retângulo (o eixo que estourar primeiro).
  const scale = Math.min(
    Math.abs(nx) > 1e-6 ? halfW / Math.abs(nx) : Infinity,
    Math.abs(ny) > 1e-6 ? halfH / Math.abs(ny) : Infinity,
  );

  return {
    x: width / 2 + nx * scale,
    y: height / 2 + ny * scale,
    angle: Math.atan2(ny, nx),
    onScreen,
  };
}
