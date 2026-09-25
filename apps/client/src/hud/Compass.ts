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

  // A fita também reaproveita seus nós.
  //
  // Ela refazia `innerHTML` das duas listas a cada quadro: o navegador
  // reinterpretava o HTML e recriava todos os elementos 60 vezes por
  // segundo, mesmo com a nave parada. Agora cada cardeal e cada marco tem
  // um nó fixo, e só a posição e o texto são atualizados — e só quando
  // mudam.
  const tickPool = new Map<string, HTMLElement>();
  const edgeParts = new WeakMap<HTMLElement, { seta: HTMLElement; nome: Text; dist: HTMLElement }>();
  const markPool = new Map<
    string,
    { node: HTMLElement; glyph: HTMLElement; name: HTMLElement; dist: HTMLElement }
  >();

  function update(
    origin: Vec3,
    heading: number,
    points: readonly NavPoint[],
    selectedId: string | null,
  ): void {
    texto(headingBox, `${Math.round(heading).toString().padStart(3, '0')}°`);

    // ---- Cardeais ----
    const cardeaisVivos = new Set<string>();
    for (const c of cardinalMarks(heading, FOV)) {
      cardeaisVivos.add(c.label);
      let node = tickPool.get(c.label);
      if (!node) {
        node = document.createElement('span');
        node.className = 'nav-tick';
        node.textContent = c.label;
        ticks.appendChild(node);
        tickPool.set(c.label, node);
      }
      estilo(node, 'left', `${(c.ribbonPos * 100).toFixed(2)}%`);
      estilo(node, 'display', '');
    }
    for (const [label, node] of tickPool) {
      if (!cardeaisVivos.has(label)) estilo(node, 'display', 'none');
    }

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

    const marcosVivos = new Set<string>();
    for (const m of naFita) {
      marcosVivos.add(m.point.id);
      let ref = markPool.get(m.point.id);
      if (!ref) {
        const node = document.createElement('span');
        const glyph = document.createElement('i');
        const name = document.createElement('b');
        const dist = document.createElement('u');
        node.append(glyph, name, dist);
        marks.appendChild(node);
        ref = { node, glyph, name, dist };
        markPool.set(m.point.id, ref);
      }
      const sel = m.point.id === selectedId ? ' selected' : '';
      if (ref.node.className !== `nav-mark${sel}`) ref.node.className = `nav-mark${sel}`;
      estilo(ref.node, 'left', `${((m.ribbonPos ?? 0) * 100).toFixed(2)}%`);
      estilo(ref.node, '--mk', `#${m.point.color.toString(16).padStart(6, '0')}`);
      estilo(ref.node, 'display', '');
      // textContent já escapa: o nome do marco não passa mais por HTML.
      texto(ref.glyph, GLYPH[m.point.kind] ?? '◆');
      texto(ref.name, m.point.name);
      texto(ref.dist, formatDistance(m.distance));
    }
    for (const [id, ref] of markPool) {
      if (!marcosVivos.has(id)) estilo(ref.node, 'display', 'none');
    }

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
        // Estrutura fixa: antes o marcador refazia `innerHTML` todo quadro.
        const seta = document.createElement('i');
        seta.textContent = '➤';
        const rotulo = document.createElement('span');
        // Nó de texto, como era: um <span> aqui herdaria o `display:flex`
        // de `.nav-edge span`.
        const nome = document.createTextNode('');
        const dist = document.createElement('b');
        rotulo.append(nome, dist);
        node.append(seta, rotulo);
        edgeParts.set(node, { seta, nome, dist });
        edges.appendChild(node);
        edgePool.set(m.point.id, node);
      }

      estilo(node, 'transform', `translate(${pos.x.toFixed(0)}px, ${pos.y.toFixed(0)}px)`);
      if (node.classList.contains('on-screen') !== pos.onScreen) {
        node.classList.toggle('on-screen', pos.onScreen);
      }
      const sel = m.point.id === selectedId;
      if (node.classList.contains('selected') !== sel) node.classList.toggle('selected', sel);
      estilo(node, '--mk', `#${m.point.color.toString(16).padStart(6, '0')}`);
      const partes = edgeParts.get(node)!;
      estilo(partes.seta, 'transform', `rotate(${pos.angle.toFixed(3)}rad)`);
      if (partes.nome.data !== m.point.name) partes.nome.data = m.point.name;
      texto(partes.dist, formatDistance(m.distance));
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

function texto(node: HTMLElement, v: string): void {
  if (node.textContent !== v) node.textContent = v;
}

/** Último valor escrito por propriedade (o navegador normaliza o que lê). */
const escritos = new WeakMap<HTMLElement, Map<string, string>>();

function estilo(node: HTMLElement, prop: string, v: string): void {
  let m = escritos.get(node);
  if (!m) {
    m = new Map();
    escritos.set(node, m);
  }
  if (m.get(prop) === v) return;
  m.set(prop, v);
  if (v === '') node.style.removeProperty(prop);
  else node.style.setProperty(prop, v);
}
