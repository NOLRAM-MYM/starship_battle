/**
 * Marcadores de contato: onde estão as naves, mesmo quando não dá para
 * vê-las.
 *
 * As luzes de navegação resolvem a percepção a média distância, mas
 * param de resolver em dois casos que decidem combate:
 *
 * 1. **Longe** — a partir de algumas centenas de unidades a nave inteira
 *    cabe em poucos pixels, e as luzes viram um ponto indistinguível de
 *    uma estrela do fundo.
 * 2. **Fora da tela** — o campo da câmera é ~70°, e o combate acontece
 *    nos 360°. Uma nave às suas seis horas simplesmente não existe.
 *
 * O radar cobre parcialmente o caso 2, mas exige desviar o olhar para o
 * canto e traduzir mentalmente um plano 2D em direção 3D — no meio de
 * uma manobra, isso não acontece.
 *
 * Os marcadores são desenhados num canvas sobreposto, e não como
 * elementos DOM: com dezenas de contatos, um elemento por nave produz
 * recomposição de layout a cada quadro, e o custo aparece exatamente
 * quando há muita coisa acontecendo.
 */

export interface ContactMarker {
  /** Posição na tela, em pixels. */
  x: number;
  y: number;
  /** `true` quando o contato está fora do campo de visão. */
  offscreen: boolean;
  /** Ângulo, em radianos, para onde apontar quando fora da tela. */
  angle: number;
  /** Distância em unidades, para o rótulo. */
  distance: number;
  faction: 'hostile' | 'ally' | 'neutral';
  /** `true` para o alvo atual — recebe destaque. */
  isTarget: boolean;
  label: string | null;
}

export interface ContactMarkersHandle {
  canvas: HTMLCanvasElement;
  resize(w: number, h: number, dpr: number): void;
  draw(markers: readonly ContactMarker[]): void;
  dispose(): void;
}

const CORES: Record<ContactMarker['faction'], string> = {
  hostile: '#ff5f6d',
  ally: '#45e5a4',
  neutral: '#8ea0c4',
};

/**
 * Raio do colchete na tela, em pixels.
 *
 * FIXO, e não proporcional à distância: um marcador que encolhe com a
 * distância reintroduz o problema que ele veio resolver. O tamanho
 * aparente da nave já comunica distância; o marcador comunica presença.
 */
const RAIO = 13;
/** Margem da borda para os indicadores de fora da tela. */
const MARGEM = 34;

export function createContactMarkers(): ContactMarkersHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'hud-contacts';
  const ctx = canvas.getContext('2d');
  let larg = 0;
  let alt = 0;

  function colchete(c: ContactMarker, cor: string): void {
    if (!ctx) return;
    const r = c.isTarget ? RAIO * 1.35 : RAIO;
    ctx.strokeStyle = cor;
    ctx.lineWidth = c.isTarget ? 2 : 1.4;
    // Quatro cantos em vez de um círculo fechado: o colchete aberto
    // deixa a nave visível no meio, que é o ponto — o marcador aponta,
    // não substitui.
    const braco = r * 0.5;
    const cantos: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sy] of cantos) {
      ctx.beginPath();
      ctx.moveTo(c.x + sx * r, c.y + sy * r - sy * braco);
      ctx.lineTo(c.x + sx * r, c.y + sy * r);
      ctx.lineTo(c.x + sx * r - sx * braco, c.y + sy * r);
      ctx.stroke();
    }
  }

  function seta(c: ContactMarker, cor: string): void {
    if (!ctx) return;
    // Triângulo apontando para fora, na borda: diz a DIREÇÃO em que
    // virar. É a informação que falta quando o alvo está às suas costas.
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-6, 7);
    ctx.lineTo(-6, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function rotulo(c: ContactMarker, cor: string): void {
    if (!ctx) return;
    // Distância em km quando passa de 1000: quatro dígitos ocupam
    // espaço e não acrescentam precisão útil a essa distância.
    const d =
      c.distance >= 1000
        ? `${(c.distance / 1000).toFixed(1)} km`
        : `${Math.round(c.distance)} u`;
    const texto = c.label ? `${c.label}  ${d}` : d;
    ctx.fillStyle = cor;
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(texto, c.x, c.y + RAIO + 14);
  }

  return {
    canvas,

    resize(w, h, dpr): void {
      larg = w;
      alt = h;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // Desenhamos em pixels de CSS; a escala converte para os do
      // dispositivo. Sem isto, num monitor 2x tudo sai na metade.
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    draw(markers): void {
      if (!ctx) return;
      ctx.clearRect(0, 0, larg, alt);
      for (const c of markers) {
        const cor = CORES[c.faction];
        if (c.offscreen) {
          seta(c, cor);
        } else {
          colchete(c, cor);
          // Rótulo só no alvo e nos contatos próximos: um rótulo por
          // nave numa refrega vira uma parede de texto que esconde
          // justamente o que se quer ver.
          if (c.isTarget || c.distance < 700) rotulo(c, cor);
        }
      }
    },

    dispose(): void {
      canvas.remove();
    },
  };
}

/**
 * Converte uma posição projetada em marcador de tela.
 *
 * `ndc` é o ponto já projetado (x,y em -1..1). `aFrente` diz se o ponto
 * está à frente da câmera — atrás dela a projeção produz coordenadas
 * espelhadas, e usá-las sem checar colocaria o marcador no lado errado
 * da tela, que é pior que não mostrar nada.
 */
export function markerFromProjection(
  ndc: { x: number; y: number },
  aFrente: boolean,
  larg: number,
  alt: number,
  dados: Omit<ContactMarker, 'x' | 'y' | 'offscreen' | 'angle'>,
): ContactMarker {
  const dentro = aFrente && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
  if (dentro) {
    return {
      ...dados,
      x: (ndc.x * 0.5 + 0.5) * larg,
      y: (-ndc.y * 0.5 + 0.5) * alt,
      offscreen: false,
      angle: 0,
    };
  }

  // Fora do campo: projeta na borda, na direção do contato. Atrás da
  // câmera o sinal do NDC se inverte, então espelhamos para a seta
  // apontar para o lado certo de virar.
  const sx = aFrente ? ndc.x : -ndc.x;
  const sy = aFrente ? ndc.y : -ndc.y;
  const ang = Math.atan2(-sy, sx);
  const cx = larg / 2;
  const cy = alt / 2;
  const rx = cx - MARGEM;
  const ry = cy - MARGEM;
  // Escala o vetor até tocar a borda do retângulo, e não de um círculo:
  // num monitor largo, um círculo deixaria as setas laterais longe da
  // borda, onde o olho não as procura.
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const escala = Math.min(
    Math.abs(c) < 1e-6 ? Infinity : rx / Math.abs(c),
    Math.abs(s) < 1e-6 ? Infinity : ry / Math.abs(s),
  );
  return {
    ...dados,
    x: cx + c * escala,
    y: cy + s * escala,
    offscreen: true,
    angle: ang,
  };
}
