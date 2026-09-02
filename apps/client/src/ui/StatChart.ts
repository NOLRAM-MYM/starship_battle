/**
 * Gráfico radar (pentágono) dos atributos da nave.
 *
 * O painel de status antigo dizia "Massa total: 120 t" — um número sem
 * referência. O radar mostra a *forma* da build: dá para ver de relance
 * que a nave é rápida e frágil, ou lenta e blindada, e comparar com a
 * build anterior sobreposta em tracejado.
 *
 * SVG puro, sem dependência de biblioteca de gráficos.
 */

export type StatAxis = 'agilidade' | 'poder' | 'defesa' | 'alcance' | 'suporte';

export const AXES: StatAxis[] = ['agilidade', 'poder', 'defesa', 'alcance', 'suporte'];

const LABELS: Record<StatAxis, string> = {
  agilidade: 'AGI',
  poder: 'PWR',
  defesa: 'DEF',
  alcance: 'SEN',
  suporte: 'SUP',
};

/**
 * Converte um índice de eixo em ponto cartesiano.
 * O primeiro eixo aponta para cima; os demais seguem no sentido horário.
 */
export function axisPoint(
  index: number,
  total: number,
  value: number,
  radius: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const r = (Math.max(0, Math.min(100, value)) / 100) * radius;
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

function polygon(values: number[], radius: number, cx: number, cy: number): string {
  return values
    .map((v, i) => {
      const p = axisPoint(i, values.length, v, radius, cx, cy);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
}

export interface StatChartOptions {
  /** Valores 0..100 por eixo. */
  values: Record<StatAxis, number>;
  /** Build anterior, desenhada em tracejado para comparação. */
  compare?: Record<StatAxis, number> | null;
  size?: number;
}

/** Retorna o markup SVG do radar. Chamador insere via `innerHTML`. */
export function statChartSvg(opts: StatChartOptions): string {
  const size = opts.size ?? 190;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.36;

  const values = AXES.map((a) => opts.values[a] ?? 0);
  const rings = [25, 50, 75, 100]
    .map(
      (level) =>
        `<polygon points="${polygon(AXES.map(() => level), radius, cx, cy)}"
          fill="none" stroke="rgba(120,160,220,.14)" stroke-width="1"/>`,
    )
    .join('');

  const spokes = AXES.map((_, i) => {
    const p = axisPoint(i, AXES.length, 100, radius, cx, cy);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"
            stroke="rgba(120,160,220,.14)" stroke-width="1"/>`;
  }).join('');

  const labels = AXES.map((axis, i) => {
    const p = axisPoint(i, AXES.length, 128, radius, cx, cy);
    return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" fill="#5a6a8c"
            font-size="9" font-weight="700" letter-spacing="1"
            text-anchor="middle" dominant-baseline="middle">${LABELS[axis]}</text>`;
  }).join('');

  const comparePoly = opts.compare
    ? `<polygon points="${polygon(AXES.map((a) => opts.compare?.[a] ?? 0), radius, cx, cy)}"
        fill="none" stroke="rgba(255,195,78,.75)" stroke-width="1.5"
        stroke-dasharray="4 3"/>`
    : '';

  const dots = values
    .map((v, i) => {
      const p = axisPoint(i, values.length, v, radius, cx, cy);
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="#4ec9ff"/>`;
    })
    .join('');

  return `
<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" role="img"
     aria-label="Perfil de atributos da nave">
  ${rings}
  ${spokes}
  ${comparePoly}
  <polygon points="${polygon(values, radius, cx, cy)}"
           fill="rgba(78,201,255,.22)" stroke="#4ec9ff" stroke-width="2"
           stroke-linejoin="round"/>
  ${dots}
  ${labels}
</svg>`.trim();
}
