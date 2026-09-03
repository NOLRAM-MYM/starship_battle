/**
 * Luzes de navegação: o que torna uma nave visível no escuro.
 *
 * O problema é de física, não de gosto: uma nave é um objeto pequeno e
 * escuro contra um fundo preto, iluminada por uma estrela distante. Ela
 * some — e some justamente a partir da distância em que se decide se
 * vale engajar ou fugir. Clarear o casco resolveria a percepção e
 * destruiria a cena: nave chapada, sem volume, flutuando num vazio que
 * deixa de parecer espaço.
 *
 * A saída é a mesma que a navegação real usa há um século: luzes
 * PRÓPRIAS, pequenas e muito brilhantes. Elas são visíveis a quilômetros
 * porque emitem, não porque refletem, e ocupam poucos pixels — o casco
 * continua escuro e volumoso, e o que se enxerga de longe é a assinatura
 * luminosa.
 *
 * A disposição segue a convenção náutica e aeronáutica, que não é
 * arbitrária: ela informa ORIENTAÇÃO. Vermelho a bombordo, verde a
 * estibordo, branco à popa. Vendo vermelho à esquerda e verde à direita,
 * a nave vem na sua direção; o inverso, ela se afasta; só branco, você
 * está atrás dela. Isso é informação de combate que nenhum marcador de
 * interface entrega, porque marcador não tem lado.
 *
 * Por cima disso vai um FAROL pulsante na cor da facção — é ele que
 * responde "amigo ou inimigo" antes de qualquer texto ser lido.
 */

import * as THREE from 'three/webgpu';

/** Uma luz montada no casco. */
export interface NavLight {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Brilho base, antes da pulsação. */
  baseOpacity: number;
  /**
   * Fase da pulsação, em segundos. `null` = luz fixa.
   *
   * Só o farol pulsa. Se tudo piscasse, a leitura de orientação se
   * perderia: as luzes de lado precisam estar acesas para dizer de que
   * ângulo a nave está sendo vista.
   */
  strobePeriod: number | null;
  /** Deslocamento da pulsação, para naves próximas não piscarem juntas. */
  strobeOffset: number;
}

export interface NavLightsHandle {
  group: THREE.Group;
  lights: NavLight[];
  /** Anima a pulsação. `t` é o tempo acumulado em segundos. */
  update(t: number): void;
  dispose(): void;
}

/** Cores de bordo, na convenção náutica. */
export const COR_BOMBORDO = 0xff2d3f;
export const COR_ESTIBORDO = 0x1fe06a;
export const COR_POPA = 0xffffff;

/** Período do farol, em segundos. */
const PERIODO_FAROL = 1.35;

interface Spec {
  pos: [number, number, number];
  color: number;
  raio: number;
  opacity: number;
  strobe: boolean;
}

/**
 * Monta as luzes para um casco de dimensões `len` × `wid` × `hei`.
 *
 * ATENÇÃO ao eixo: as luzes vão no referencial de DESENHO, em que o
 * nariz aponta para **-Z** — é `ShipMesh` que gira o conjunto para +Z no
 * fim. Escrever as posições como se a frente já fosse +Z coloca a luz de
 * popa no nariz e o farol atrás, que foi exatamente o primeiro erro
 * aqui.
 *
 * As posições vêm das dimensões e não de números fixos: um cargueiro tem
 * três vezes a largura de um interceptador, e luzes em coordenadas
 * absolutas cairiam dentro do casco de um e fora do outro.
 *
 * `beaconColor` é a cor da facção — é o farol que responde "amigo ou
 * inimigo" antes de o jogador ler qualquer texto.
 */
export function createNavLights(
  dims: { len: number; wid: number; hei: number },
  beaconColor: number,
  seed = 0,
): NavLightsHandle {
  const { len, wid, hei } = dims;
  const raio = wid * 0.055;
  /**
   * Piso de tamanho, aplicado ao raio FINAL de cada luz.
   *
   * Escalar sem piso faz a luz virar subpixel numa nave pequena e sumir
   * — o problema que ela existe para resolver. O piso tem que valer
   * depois do multiplicador de cada luz: aplicá-lo só ao raio base
   * deixava a luz de popa (0.85×) escapar por baixo.
   */
  const RAIO_MINIMO = 0.16;
  const comPiso = (r: number): number => Math.max(RAIO_MINIMO, r);

  const specs: Spec[] = [
    // Bombordo (esquerda da nave olhando para a frente = -X, já que a
    // frente é +Z e o referencial é destro).
    {
      pos: [-wid * 0.52, hei * 0.1, -len * 0.05],
      color: COR_BOMBORDO,
      raio: comPiso(raio),
      opacity: 0.95,
      strobe: false,
    },
    // Estibordo.
    {
      pos: [wid * 0.52, hei * 0.1, -len * 0.05],
      color: COR_ESTIBORDO,
      raio: comPiso(raio),
      opacity: 0.95,
      strobe: false,
    },
    // Popa: +Z no referencial de desenho, já que o nariz é -Z.
    {
      pos: [0, hei * 0.32, len * 0.46],
      color: COR_POPA,
      raio: comPiso(raio * 0.85),
      opacity: 0.8,
      strobe: false,
    },
    // Farol da facção, no dorso: o ponto mais alto, visível de cima e
    // dos lados, que é de onde a maior parte dos encontros acontece.
    {
      pos: [0, hei * 0.55, -len * 0.08],
      color: beaconColor,
      raio: comPiso(raio * 1.5),
      opacity: 1,
      strobe: true,
    },
  ];

  const group = new THREE.Group();
  group.name = 'nav-lights';
  const lights: NavLight[] = [];
  // Geometria compartilhada entre as quatro luzes desta nave.
  const geo = new THREE.SphereGeometry(1, 8, 6);

  for (const s of specs) {
    const material = new THREE.MeshBasicMaterial({
      color: s.color,
      transparent: true,
      opacity: s.opacity,
      // Aditivo: a luz SOMA ao que está atrás dela, que é o que faz um
      // ponto pequeno continuar legível contra o preto a distância.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Sem névoa: uma luz de navegação que some com a distância é
      // exatamente o oposto do que ela existe para fazer.
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
    mesh.scale.setScalar(s.raio);
    group.add(mesh);
    lights.push({
      mesh,
      material,
      baseOpacity: s.opacity,
      strobePeriod: s.strobe ? PERIODO_FAROL : null,
      // Naves próximas piscando em uníssono pareceriam um sistema só.
      strobeOffset: (seed % 100) / 100,
    });
  }

  return {
    group,
    lights,

    update(t: number): void {
      for (const l of lights) {
        if (l.strobePeriod === null) continue;
        // Pulso curto e forte, não uma senoide: um brilho que sobe e
        // desce suavemente lê como "brilho", enquanto um flash lê como
        // SINAL, e é o sinal que o olho detecta na periferia.
        const fase = ((t / l.strobePeriod) + l.strobeOffset) % 1;
        const pulso = fase < 0.12 ? 1 : 0.22;
        l.material.opacity = l.baseOpacity * pulso;
      }
    },

    dispose(): void {
      geo.dispose();
      for (const l of lights) l.material.dispose();
    },
  };
}
