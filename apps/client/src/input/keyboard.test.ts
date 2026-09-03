/**
 * Testes do InputController e do mapa de teclas.
 *
 * O ponto central: os eventos são disparados com `code` (posição física
 * da tecla), não `key`. É isso que faz o jogo funcionar igual em QWERTY,
 * AZERTY e ABNT2 — a versão anterior lia `key` e trocava os controles
 * fora do QWERTY.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInputController, type InputController } from './keyboard';
import {
  ACTIONS,
  buildReverseMap,
  conflictsFor,
  DEFAULT_KEYMAP,
  isBindableCode,
  keyLabel,
  type Keymap,
} from './keybindings';

function down(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code }));
}
function up(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
}

describe('InputController', () => {
  let ctrl: InputController;

  beforeEach(() => {
    ctrl = createInputController();
    ctrl.attach();
  });

  it('começa neutro', () => {
    expect(ctrl.read()).toEqual({
      steer: 0,
      pitch: 0,
      roll: 0,
      thrust: 0,
      fire: false,
      fireCharge: 0,
      defend: false,
      skill: null,
      useConsumable: null,
      launchTorpedo: false,
      deployDecoys: false,
      fineControl: false,
    });
  });

  it('W sobe o nariz e S desce', () => {
    down('KeyW');
    expect(ctrl.read().pitch).toBe(1);
    up('KeyW');
    down('KeyS');
    expect(ctrl.read().pitch).toBe(-1);
  });

  it('A e D produzem guinada oposta', () => {
    down('KeyA');
    expect(ctrl.read().steer).toBe(-1);
    up('KeyA');
    down('KeyD');
    expect(ctrl.read().steer).toBe(1);
  });

  it('Z e C rolam a nave', () => {
    down('KeyZ');
    expect(ctrl.read().roll).toBe(-1);
    up('KeyZ');
    down('KeyC');
    expect(ctrl.read().roll).toBe(1);
  });

  it('eixos opostos simultâneos se cancelam', () => {
    down('KeyA');
    down('KeyD');
    expect(ctrl.read().steer).toBe(0);
  });

  it('Shift acelera enquanto segurado', () => {
    down('ShiftLeft');
    expect(ctrl.read().thrust).toBe(1);
    up('ShiftLeft');
    expect(ctrl.read().thrust).toBe(0);
  });

  it('Q dispara ao SOLTAR, não ao apertar', () => {
    // Mudou com o tiro carregado: segurar acumula carga, e o disparo
    // sai na hora de soltar. Um toque rápido continua atirando na
    // prática, porque a carga fica ~0.
    down('KeyQ');
    expect(ctrl.read().fire, 'apertar sozinho não dispara').toBe(false);
    up('KeyQ');
    const s = ctrl.read();
    expect(s.fire).toBe(true);
    expect(s.fireCharge).toBeGreaterThanOrEqual(0);
    // Consumido: não repete no próximo read.
    expect(ctrl.read().fire).toBe(false);
  });

  it('auto-repeat do teclado não reinicia a carga', () => {
    down('KeyQ');
    const c1 = ctrl.currentCharge();
    down('KeyQ'); // repeat do SO
    const c2 = ctrl.currentCharge();
    expect(c2).toBeGreaterThanOrEqual(c1);
    up('KeyQ');
  });

  it('currentCharge cresce enquanto o gatilho está preso', async () => {
    expect(ctrl.currentCharge()).toBe(0);
    down('KeyQ');
    await new Promise((r) => setTimeout(r, 40));
    const carga = ctrl.currentCharge();
    expect(carga).toBeGreaterThan(0.02);
    up('KeyQ');
    // Depois de soltar, volta a zero (a carga foi para o disparo).
    expect(ctrl.currentCharge()).toBe(0);
    expect(ctrl.read().fireCharge).toBeGreaterThan(0.02);
  });

  it('perder o foco com o gatilho preso não vira tiro fantasma', () => {
    down('KeyQ');
    window.dispatchEvent(new Event('blur'));
    expect(ctrl.currentCharge()).toBe(0);
    up('KeyQ');
    expect(ctrl.read().fire, 'soltar após blur não pode disparar').toBe(false);
  });

  it('E é defesa com edge-trigger', () => {
    down('KeyE');
    expect(ctrl.read().defend).toBe(true);
    expect(ctrl.read().defend).toBe(false);
  });

  it('4 e 5 pedem os consumíveis 1 e 2', () => {
    // A loja vendia consumíveis desde sempre e não havia tecla nenhuma
    // para usá-los dentro do jogo.
    down('Digit4');
    expect(ctrl.read().useConsumable).toBe(0);
    up('Digit4');
    down('Digit5');
    expect(ctrl.read().useConsumable).toBe(1);
  });

  it('o pedido de consumível é consumido uma vez só', () => {
    // Repetir gastaria várias cargas com um toque.
    down('Digit4');
    expect(ctrl.read().useConsumable).toBe(0);
    expect(ctrl.read().useConsumable).toBeNull();
  });

  it('a mira fina é um MODO mantido, não um toque', () => {
    // Ao contrário das outras ações de combate, ela vale enquanto a
    // tecla estiver segurada — é o equivalente aos propulsores vernier.
    expect(ctrl.read().fineControl).toBe(false);
    down('AltLeft');
    expect(ctrl.read().fineControl).toBe(true);
    expect(ctrl.read().fineControl, 'continua valendo sem soltar').toBe(true);
    up('AltLeft');
    expect(ctrl.read().fineControl).toBe(false);
  });

  it('R pede torpedo e F pede iscas', () => {
    // As duas defesas de reação: obrigar a mão a sair da fileira de voo
    // para soltar iscas anularia a defesa.
    down('KeyR');
    expect(ctrl.read().launchTorpedo).toBe(true);
    up('KeyR');
    down('KeyF');
    expect(ctrl.read().deployDecoys).toBe(true);
  });

  it('torpedo e iscas são consumidos uma vez só', () => {
    down('KeyR');
    expect(ctrl.read().launchTorpedo).toBe(true);
    expect(ctrl.read().launchTorpedo).toBe(false);
  });

  it('perder o foco cancela um consumível pedido', () => {
    down('Digit4');
    window.dispatchEvent(new Event('blur'));
    expect(ctrl.read().useConsumable).toBeNull();
  });

  it('1, 2 e 3 disparam as habilidades certas', () => {
    down('Digit1');
    expect(ctrl.read().skill).toBe('Dash');
    up('Digit1');
    down('Digit2');
    expect(ctrl.read().skill).toBe('Emp');
    up('Digit2');
    down('Digit3');
    expect(ctrl.read().skill).toBe('Repair');
  });

  it('perder o foco solta todas as teclas', () => {
    down('KeyW');
    down('ShiftLeft');
    window.dispatchEvent(new Event('blur'));
    const s = ctrl.read();
    expect(s.pitch).toBe(0);
    expect(s.thrust).toBe(0);
  });

  it('ignora teclas enquanto o jogador digita num campo', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    expect(ctrl.read().pitch).toBe(0);
    input.remove();
  });

  it('setKeymap troca os controles em tempo real', () => {
    const custom: Keymap = { ...DEFAULT_KEYMAP, pitchUp: 'ArrowUp' };
    ctrl.setKeymap(custom);
    down('KeyW');
    expect(ctrl.read().pitch).toBe(0);
    up('KeyW');
    down('ArrowUp');
    expect(ctrl.read().pitch).toBe(1);
  });

  it('onAction avisa ações de interface', () => {
    let chamou = 0;
    ctrl.onAction('toHangar', () => {
      chamou += 1;
    });
    down('Escape');
    expect(chamou).toBe(1);
    // Sem soltar, o repeat não deve disparar de novo.
    down('Escape');
    expect(chamou).toBe(1);
  });

  it('detach para de escutar', () => {
    ctrl.detach();
    down('KeyW');
    expect(ctrl.read().pitch).toBe(0);
  });
});

describe('keybindings', () => {
  it('o padrão cobre todas as ações declaradas', () => {
    for (const a of ACTIONS) {
      expect(DEFAULT_KEYMAP[a.action], a.action).toBeTruthy();
    }
  });

  it('o padrão não tem conflito de tecla', () => {
    const usados = new Map<string, string>();
    for (const a of ACTIONS) {
      const code = DEFAULT_KEYMAP[a.action];
      expect(usados.has(code), `${code} duplicado em ${a.action}`).toBe(false);
      usados.set(code, a.action);
    }
  });

  it('o mapa reverso indexa por code', () => {
    const rev = buildReverseMap(DEFAULT_KEYMAP);
    expect(rev.get('KeyW')).toBe('pitchUp');
    expect(rev.get('KeyQ')).toBe('fire');
    expect(rev.get('Digit2')).toBe('skill2');
  });

  it('conflictsFor acha quem já usa a tecla', () => {
    // KeyA é yawLeft por padrão; tentar usá-la em fire acusa conflito.
    expect(conflictsFor(DEFAULT_KEYMAP, 'KeyA', 'fire')).toEqual(['yawLeft']);
    // A própria ação não conflita consigo mesma.
    expect(conflictsFor(DEFAULT_KEYMAP, 'KeyA', 'yawLeft')).toEqual([]);
  });

  it('keyLabel produz rótulos curtos e legíveis', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ShiftLeft')).toBe('Shift esq');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Space')).toBe('Espaço');
    expect(keyLabel('')).toBe('—');
  });

  it('teclas que sequestram o navegador não são vinculáveis', () => {
    expect(isBindableCode('KeyW')).toBe(true);
    expect(isBindableCode('F5')).toBe(false);
    expect(isBindableCode('F12')).toBe(false);
    expect(isBindableCode('MetaLeft')).toBe(false);
    expect(isBindableCode('')).toBe(false);
  });
});
