/**
 * Radar tático — canvas 2D leve desenhado por frame.
 *
 * Mostra contatos ao redor, rotacionado para o referencial da nave
 * (frente sempre para cima). Contatos fora de alcance grudam na borda
 * como setas, para o jogador saber de onde vem a ameaça.
 */

import { toRadarSpace, type Contact, type Vec3 } from '../game/targeting';

export interface RadarHandle {
  element: HTMLElement;
  /** Redesenha com os contatos atuais. */
  draw(origin: Vec3, heading: number, contacts: readonly Contact[], targetId: number | null): void;
  destroy(): void;
}

const COLORS: Record<Contact['faction'], string> = {
  hostile: '#ff5f6d',
  neutral: '#8ea0c4',
  ally: '#45e5a4',
};

export function createRadar(range = 900, size = 168): RadarHandle {
  const element = document.createElement('div');
  element.className = 'hud-radar';

  const label = document.createElement('div');
  label.className = 'hud-radar-label';
  label.textContent = 'radar';
  element.appendChild(label);

  const canvas = document.createElement('canvas');
  const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  element.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let sweep = 0;

  function draw(
    origin: Vec3,
    heading: number,
    contacts: readonly Contact[],
    targetId: number | null,
  ): void {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 2 * dpr;

    ctx.clearRect(0, 0, w, h);

    // --- Fundo e anéis de distância ---
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 11, 22, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.28)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(120, 160, 220, 0.14)';
    for (const frac of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Cruz de eixos.
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    // --- Varredura giratória (só decorativa, dá vida ao painel) ---
    sweep = (sweep + 0.02) % (Math.PI * 2);
    const grad = ctx.createConicGradient?.(sweep, cx, cy);
    if (grad) {
      grad.addColorStop(0, 'rgba(78, 201, 255, 0.22)');
      grad.addColorStop(0.12, 'rgba(78, 201, 255, 0)');
      grad.addColorStop(1, 'rgba(78, 201, 255, 0)');
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // --- Contatos ---
    for (const c of contacts) {
      const p = toRadarSpace(origin, heading, c.pos, range);
      const px = cx + p.x * r;
      const py = cy + p.y * r;
      const isTarget = targetId !== null && c.id === targetId;
      const color = COLORS[c.faction];

      if (p.clamped) {
        // Fora de alcance: triângulo apontando para fora, na borda.
        const angle = Math.atan2(p.y, p.x);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(4 * dpr, 0);
        ctx.lineTo(-3 * dpr, 3 * dpr);
        ctx.lineTo(-3 * dpr, -3 * dpr);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.65;
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        continue;
      }

      ctx.beginPath();
      ctx.arc(px, py, (isTarget ? 4 : 2.6) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isTarget) {
        ctx.beginPath();
        ctx.arc(px, py, 7 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    }

    // --- Nave do jogador no centro ---
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5 * dpr);
    ctx.lineTo(cx - 3.5 * dpr, cy + 4 * dpr);
    ctx.lineTo(cx + 3.5 * dpr, cy + 4 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#4ec9ff';
    ctx.fill();
  }

  return {
    element,
    draw,
    destroy(): void {
      element.remove();
    },
  };
}
