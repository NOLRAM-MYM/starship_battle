/**
 * O HUD não pode custar mais que a cena.
 *
 * Perfilado em combate, o `refresh` do HUD consumia ~17% da CPU — quase
 * o mesmo que toda a renderização 3D. Duas causas:
 *
 *  - reescrevia dezenas de textos, estilos e classes com o MESMO valor a
 *    cada quadro, e cada escrita invalida o layout daquele trecho;
 *  - lia `clientWidth`/`clientHeight` logo depois dessas escritas, o que
 *    obriga o navegador a recalcular o layout na hora, todo quadro.
 *
 * Estes testes medem as duas coisas diretamente.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHudState, mountHud, type MountHudHandle } from '../src/hud/Hud.js';

describe('HUD: custo por quadro', () => {
  let container: HTMLElement;
  let hud: MountHudHandle;
  let state: ReturnType<typeof createHudState>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    state = createHudState();
    Object.assign(state, {
      hp: 640,
      hpMax: 800,
      shield: 120,
      shieldMax: 260,
      xp: 90,
      xpNext: 140,
      money: 1500,
      targetName: 'Caçador',
      targetDistance: 420,
      targetHp: 0.5,
      incomingTorpedoes: 1,
      fireCharge: 0.4,
      weaponName: 'Canhão Linear',
      chargeMult: 1.3,
    });
    hud = mountHud({ container, state });
  });

  afterEach(() => {
    hud.destroy();
    container.remove();
    vi.restoreAllMocks();
  });

  /** Mutações de DOM causadas por uma chamada de `refresh`. */
  async function mutacoesDeUmRefresh(): Promise<MutationRecord[]> {
    const registros: MutationRecord[] = [];
    const obs = new MutationObserver((m) => registros.push(...m));
    obs.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    hud.refresh();
    await Promise.resolve();
    registros.push(...obs.takeRecords());
    obs.disconnect();
    return registros;
  }

  /** Deixa assentar o que é animação de verdade (o rastro das barras). */
  const assentar = (): void => {
    for (let i = 0; i < 300; i++) hud.refresh();
  };

  it('sem mudança de estado, um quadro não mexe no DOM', async () => {
    assentar();
    const m = await mutacoesDeUmRefresh();
    const descricao = m.map((r) => `${r.type} ${(r.target as Element).className ?? r.target.nodeName} ${r.attributeName ?? ''}`);
    console.log('MUTACOES', JSON.stringify(descricao));
    expect(descricao).toEqual([]);
  });

  it('não força layout: nenhuma leitura de dimensão dentro do quadro', () => {
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get');
    const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get');
    hud.refresh();
    expect(w).not.toHaveBeenCalled();
    expect(h).not.toHaveBeenCalled();
  });

  it('o que muda continua chegando à tela', async () => {
    // Pular escritas não pode virar pular atualizações.
    state.hp = 200;
    state.targetName = null;
    const m = await mutacoesDeUmRefresh();
    expect(m.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('200 / 800');
    expect(container.querySelector('.hud-target')?.classList.contains('active')).toBe(false);
  });

  it('dentro do poço, o painel só é refeito quando o conteúdo muda', async () => {
    state.gravityWell = { name: 'Kepler', distance: 900, surface: 300 } as typeof state.gravityWell;
    assentar();
    const parado = await mutacoesDeUmRefresh();
    expect(parado).toEqual([]);
    state.gravityWell = { name: 'Kepler', distance: 700, surface: 300 } as typeof state.gravityWell;
    const subiu = await mutacoesDeUmRefresh();
    expect(subiu.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('altitude 400 u');
  });
});
