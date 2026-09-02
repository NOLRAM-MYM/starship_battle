/**
 * Preset de qualidade gráfica, compartilhado pelo pipeline de render.
 *
 * Reusa exatamente os quatro valores que o painel de configurações já
 * expõe (`GraphicsQuality`), para não haver dois vocabulários — o bug
 * clássico de "med" virar "medium" no meio do caminho.
 */
export type RenderQuality = 'low' | 'med' | 'high' | 'ultra';

/** Multiplicador de densidade de partículas/estrelas por preset. */
export function densityFor(q: RenderQuality): number {
  switch (q) {
    case 'low': return 0.25;
    case 'med': return 0.6;
    case 'high': return 1;
    case 'ultra': return 1.5;
  }
}
