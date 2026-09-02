/**
 * Bússola de navegação: fita no topo + marcadores de borda.
 *
 * O radar responde "o que está perto de mim". Ele não responde "para
 * onde eu estou apontando" nem "onde fica aquele planeta". A fita dá o
 * rumo absoluto com pontos cardeais; os marcadores de borda apontam para
 * marcos que estão fora do campo de visão.
 */

import {
  cardinalMarks,
  compassMarks,
  edgeMarker,
  formatDistance,
  type NavPoint,
  type Vec3,
} from '../game/navigation';

export interface CompassHandle {
  element: HTMLElement;
  /** Redesenha para o estado atual da nave. */
  update(origin: Vec3, heading: number, points: readonly NavPoint[], selectedId: string | null): void;
  destroy(): void;
}

/** Glifo por tipo de marco, para leitura imediata na borda da tela. */
const GLYPH: Record<string, string> = {
  sun: '☀',
  star: '☀',
  planet: '●',
  giant: '◍',
  belt: '⋯',
  station: '⌂',
  exotic: '◉',
};

const FOV = 150;

/** Distância mínima entre rótulos na fita, em fração da largura. */
const RIBBON_MIN_GAP = 0.11;

/** Distância mínima entre marcadores de borda, em pixels. */
const EDGE_MIN_GAP_PX = 64;

export function createCompass(): CompassHandle {
  const element = document.createElement('div');
  element.className = 'hud-nav';

  // --- Fita de rumo ---
  const ribbon = document.createElement('div');
  ribbon.className = 'nav-ribbon';
  const ticks = document.createElement('div');
  ticks.className = 'nav-ticks';
  const marks = document.createElement('div');
  marks.className = 'nav-marks';
  const headingBox = document.createElement('div');
  headingBox.className = 'nav-heading';
  ribbon.append(ticks, marks, headingBox);

  // --- Marcadores de borda ---
  const edges = document.createElement('div');
  edges.className = 'nav-edges';

  element.append(ribbon, edges);

  /** Reaproveita nós entre frames: recriar tudo geraria lixo a 60fps. */
  const edgePool = new Map<string, HTMLElement>();

  function update(
    origin: Vec3,
    heading: number,
    points: readonly NavPoint[],
    selectedId: string | null,
  ): void {
    headingBox.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;

    // ---- Cardeais ----
    ticks.innerHTML = cardinalMarks(heading, FOV)
      .map(
        (c) =>
          `<span class="nav-tick" style="left:${(c.ribbonPos * 100).toFixed(2)}%">${c.label}</span>`,
      )
      .join('');

    // ---- Marcos na fita ----
    // `compassMarks` já vem ordenado do mais próximo ao mais distante.
    // Descartamos quem cairia em cima de um rótulo já desenhado: dois
    // marcos com rumos parecidos empilhavam texto ilegível.
    const cm = compassMarks(origin, heading, points, FOV);
    const ocupados: number[] = [];
    const naFita = cm.filter((m) => {
      if (m.ribbonPos === null) return false;
      const colide = ocupados.some((p) => Math.abs(p - m.ribbonPos!) < RIBBON_MIN_GAP);
      if (colide) return false;
      ocupados.push(m.ribbonPos);
      return true;
    });

    marks.innerHTML = naFita
      .map((m) => {
        const sel = m.point.id === selectedId ? ' selected' : '';
        const cor = `#${m.point.color.toString(16).padStart(6, '0')}`;
        return `<span class="nav-mark${sel}" style="left:${((m.ribbonPos ?? 0) * 100).toFixed(2)}%;--mk:${cor}">
                  <i>${GLYPH[m.point.kind] ?? '◆'}</i>
                  <b>${escapeHtml(m.point.name)}</b>
                  <u>${formatDistance(m.distance)}</u>
                </span>`;
      })
      .join('');

    // ---- Marcadores de borda ----
    const w = window.innerWidth;
    const h = window.innerHeight;
    const vivos = new Set<string>();
    const colocados: Array<{ x: number; y: number }> = [];

    for (const m of cm.slice(0, 6)) {
      // Componente vertical: diferença de altura relativa à distância.
      const dyPre = m.point.position.y - origin.y;
      const verticalPre = Math.max(-1, Math.min(1, dyPre / Math.max(1, m.distance)));
      const pos = edgeMarker(m.delta, verticalPre, w, h);

      // Mesma regra da fita: o mais próximo tem prioridade e o resto
      // que cairia por cima é omitido.
      const perto = colocados.some(
        (c) => Math.hypot(c.x - pos.x, c.y - pos.y) < EDGE_MIN_GAP_PX,
      );
      if (perto) continue;
      colocados.push({ x: pos.x, y: pos.y });

      vivos.add(m.point.id);
      let node = edgePool.get(m.point.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'nav-edge';
        edges.appendChild(node);
        edgePool.set(m.point.id, node);
      }

      node.style.transform = `translate(${pos.x.toFixed(0)}px, ${pos.y.toFixed(0)}px)`;
      node.classList.toggle('on-screen', pos.onScreen);
      node.classList.toggle('selected', m.point.id === selectedId);
      node.style.setProperty('--mk', `#${m.point.color.toString(16).padStart(6, '0')}`);
      node.innerHTML = `<i style="transform:rotate(${pos.angle.toFixed(3)}rad)">➤</i>
                        <span>${escapeHtml(m.point.name)}<b>${formatDistance(m.distance)}</b></span>`;
    }

    for (const [id, node] of edgePool) {
      if (!vivos.has(id)) {
        node.remove();
        edgePool.delete(id);
      }
    }
  }

  return {
    element,
    update,
    destroy(): void {
      element.remove();
      edgePool.clear();
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
