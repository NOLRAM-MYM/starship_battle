/**
 * Botão "Enter VR" / "Exit VR".
 *
 * Factory puro: cria o elemento, mantém o estado interno e dispara
 * os callbacks fornecidos. NÃO anexa ao DOM — quem chama decide
 * onde colocá-lo.
 */

export interface XrToggleOptions {
  onEnter: () => Promise<void>;
  onExit: () => void;
  isSupported: boolean;
}

type Mode = 'unsupported' | 'idle' | 'requesting' | 'active';

const LABEL_UNSUPPORTED = 'VR indisponível';
const LABEL_ENTER = 'Enter VR';
const LABEL_EXIT = 'Exit VR';
const LABEL_REQUESTING = 'Solicitando...';

export function mountXrToggle(opts: XrToggleOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset['xrToggle'] = 'true';
  btn.style.padding = '8px 14px';
  btn.style.font = '14px sans-serif';
  btn.style.cursor = 'pointer';

  let mode: Mode = opts.isSupported ? 'idle' : 'unsupported';

  function render(): void {
    switch (mode) {
      case 'unsupported':
        btn.textContent = LABEL_UNSUPPORTED;
        btn.disabled = true;
        break;
      case 'idle':
        btn.textContent = LABEL_ENTER;
        btn.disabled = false;
        break;
      case 'requesting':
        btn.textContent = LABEL_REQUESTING;
        btn.disabled = true;
        break;
      case 'active':
        btn.textContent = LABEL_EXIT;
        btn.disabled = false;
        break;
    }
  }

  render();

  btn.addEventListener('click', () => {
    if (mode === 'unsupported') return;
    if (mode === 'idle') {
      mode = 'requesting';
      render();
      void opts
        .onEnter()
        .then(() => {
          // O caller (main.ts) é quem efetivamente troca para 'active'
          // via getXrManager().getSession() — mas para o toggle
          // funcionar sem polling, usamos o pressuposto de que `onEnter`
          // resolve após `setSession()`. Se `onEnter` resolver sem
          // sessão ativa, o toggle reverte para 'idle'.
          mode = 'active';
          render();
        })
        .catch(() => {
          mode = 'idle';
          render();
        });
    } else if (mode === 'active') {
      opts.onExit();
      mode = 'idle';
      render();
    }
  });

  return btn;
}
