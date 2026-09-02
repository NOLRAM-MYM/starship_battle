/**
 * Controlador de input touch (joystick virtual + botões FIRE/BRAKE + swipe).
 *
 * Compatível com PointerEvent (mouse, touch, pen). Usa apenas APIs DOM
 * nativas — zero dependências externas.
 *
 * Layout (overlay fixo, configurado inline via cssText):
 *  - Joystick virtual: canto inferior esquerdo, ~50% largura, 30% altura.
 *  - Botão BRAKE: canto inferior esquerdo, próximo ao joystick.
 *  - Botão FIRE: canto inferior direito, círculo 60px.
 *
 * Cálculo de estado:
 *  - `steer = dx / radius` clamped em [-1, 1]
 *  - `thrust = -dy / radius` clamped em [-1, 1]  (arrastar para cima = frente)
 */

export interface TouchInputState {
  thrust: number; // -1..1
  steer: number; // -1..1
  fire: boolean;
  brake: boolean;
}

export function createTouchInputState(): TouchInputState {
  return { thrust: 0, steer: 0, fire: false, brake: false };
}

export interface TouchControllerOpts {
  container: HTMLElement;
  onChange?: (s: TouchInputState) => void;
}

interface JoystickRefs {
  root: HTMLDivElement;
  knob: HTMLDivElement;
  radius: number;
  centerX: number;
  centerY: number;
  activePointerId: number | null;
}

interface ButtonRefs {
  el: HTMLDivElement;
  pressed: boolean;
  flag: 'fire' | 'brake';
  activePointerId: number | null;
}

export class TouchController {
  private readonly container: HTMLElement;
  private readonly onChange: ((s: TouchInputState) => void) | undefined;
  private readonly state: TouchInputState = createTouchInputState();
  private readonly joystick: JoystickRefs;
  private readonly fireBtn: ButtonRefs;
  private readonly brakeBtn: ButtonRefs;
  private started = false;
  private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e);
  private readonly onPointerCancel = (e: PointerEvent): void => this.handlePointerUp(e);

  constructor(opts: TouchControllerOpts) {
    this.container = opts.container;
    this.onChange = opts.onChange;
    this.joystick = createJoystick();
    this.fireBtn = createButton('FIRE', 'fire');
    this.brakeBtn = createButton('BRAKE', 'brake');
    this.container.appendChild(this.brakeBtn.el);
    this.container.appendChild(this.fireBtn.el);
    this.container.appendChild(this.joystick.root);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.onPointerCancel);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.onPointerCancel);
    this.resetState();
  }

  getState(): TouchInputState {
    return {
      thrust: this.state.thrust,
      steer: this.state.steer,
      fire: this.state.fire,
      brake: this.state.brake,
    };
  }

  private resetState(): void {
    this.state.thrust = 0;
    this.state.steer = 0;
    this.state.fire = false;
    this.state.brake = false;
    this.joystick.knob.style.transform = 'translate(0px, 0px)';
    this.joystick.activePointerId = null;
    this.fireBtn.pressed = false;
    this.fireBtn.activePointerId = null;
    this.brakeBtn.pressed = false;
    this.brakeBtn.activePointerId = null;
    this.onChange?.(this.getState());
  }

  private handlePointerDown(e: PointerEvent): void {
    const target = e.target as Element | null;
    if (!target) return;
    if (this.isInside(this.joystick.root, target)) {
      e.preventDefault();
      this.joystick.activePointerId = e.pointerId;
      this.joystick.root.setPointerCapture(e.pointerId);
      this.updateJoystick(e);
      return;
    }
    if (this.isInside(this.fireBtn.el, target)) {
      e.preventDefault();
      this.fireBtn.activePointerId = e.pointerId;
      this.fireBtn.pressed = true;
      this.fireBtn.el.setPointerCapture(e.pointerId);
      this.state.fire = true;
      this.onChange?.(this.getState());
      return;
    }
    if (this.isInside(this.brakeBtn.el, target)) {
      e.preventDefault();
      this.brakeBtn.activePointerId = e.pointerId;
      this.brakeBtn.pressed = true;
      this.brakeBtn.el.setPointerCapture(e.pointerId);
      this.state.brake = true;
      this.onChange?.(this.getState());
      return;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.joystick.activePointerId === e.pointerId) {
      e.preventDefault();
      this.updateJoystick(e);
      return;
    }
    if (this.fireBtn.activePointerId === e.pointerId) {
      // Pressionado continua até pointerup; nada a fazer.
      return;
    }
    if (this.brakeBtn.activePointerId === e.pointerId) {
      return;
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.joystick.activePointerId === e.pointerId) {
      this.joystick.activePointerId = null;
      this.state.thrust = 0;
      this.state.steer = 0;
      this.joystick.knob.style.transform = 'translate(0px, 0px)';
      this.onChange?.(this.getState());
      return;
    }
    if (this.fireBtn.activePointerId === e.pointerId) {
      this.fireBtn.activePointerId = null;
      this.fireBtn.pressed = false;
      this.state.fire = false;
      this.onChange?.(this.getState());
      return;
    }
    if (this.brakeBtn.activePointerId === e.pointerId) {
      this.brakeBtn.activePointerId = null;
      this.brakeBtn.pressed = false;
      this.state.brake = false;
      this.onChange?.(this.getState());
      return;
    }
  }

  private updateJoystick(e: PointerEvent): void {
    const rect = this.joystick.root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dist = Math.hypot(dx, dy);
    const scale = dist > radius ? radius / dist : 1;
    const cdx = dx * scale;
    const cdy = dy * scale;
    let steer = cdx / radius;
    let thrust = -cdy / radius;
    if (steer > 1) steer = 1;
    else if (steer < -1) steer = -1;
    if (thrust > 1) thrust = 1;
    else if (thrust < -1) thrust = -1;
    this.state.steer = steer;
    this.state.thrust = thrust;
    this.joystick.knob.style.transform = `translate(${cdx}px, ${cdy}px)`;
    this.onChange?.(this.getState());
  }

  private isInside(host: HTMLElement, target: Element): boolean {
    return host === target || host.contains(target);
  }
}

function createJoystick(): JoystickRefs {
  const root = document.createElement('div');
  const knob = document.createElement('div');
  root.style.cssText = [
    'position: fixed',
    'left: 0',
    'bottom: 0',
    'width: 50vw',
    'height: 30vh',
    'max-width: 360px',
    'max-height: 240px',
    'background: rgba(40, 60, 90, 0.25)',
    'border: 2px solid rgba(120, 180, 255, 0.4)',
    'border-radius: 50%',
    'touch-action: none',
    'user-select: none',
    '-webkit-user-select: none',
    'z-index: 900',
    'box-sizing: border-box',
  ].join(';');
  knob.style.cssText = [
    'position: absolute',
    'left: 50%',
    'top: 50%',
    'width: 56px',
    'height: 56px',
    'margin-left: -28px',
    'margin-top: -28px',
    'background: rgba(120, 180, 255, 0.7)',
    'border: 2px solid rgba(255, 255, 255, 0.9)',
    'border-radius: 50%',
    'transform: translate(0px, 0px)',
    'will-change: transform',
    'pointer-events: none',
  ].join(';');
  root.appendChild(knob);
  return { root, knob, radius: 1, centerX: 0, centerY: 0, activePointerId: null };
}

function createButton(label: string, flag: 'fire' | 'brake'): ButtonRefs {
  const el = document.createElement('div');
  const size = flag === 'fire' ? 60 : 50;
  el.style.cssText = [
    'position: fixed',
    flag === 'fire' ? 'right: 20px' : 'left: 20px',
    flag === 'fire' ? 'bottom: 20px' : 'bottom: 90px',
    `width: ${size}px`,
    `height: ${size}px`,
    'background: rgba(180, 40, 40, 0.55)',
    'border: 2px solid rgba(255, 200, 200, 0.85)',
    'border-radius: 50%',
    'color: white',
    'font-family: sans-serif',
    'font-weight: bold',
    'font-size: 12px',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'touch-action: none',
    'user-select: none',
    '-webkit-user-select: none',
    'z-index: 950',
    'box-sizing: border-box',
  ].join(';');
  el.textContent = label;
  return { el, pressed: false, flag, activePointerId: null };
}
