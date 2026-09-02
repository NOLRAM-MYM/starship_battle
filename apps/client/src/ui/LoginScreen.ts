import './LoginScreen.css';
import { login, register } from '../net/authApi';

/**
 * Tela de acesso.
 *
 * Mantém a mesma API (`show` / `hide` / `onLoginSuccess`) e corrige o que
 * incomodava: os botões não davam retorno de "processando", erros vinham
 * do `catch` sem tratamento de rede, e o callsign salvo era o e-mail
 * inteiro — que depois aparecia na barra de HP do jogo.
 */
export class LoginScreen {
  private root: HTMLElement;
  private onSuccess?: () => void;
  private busy = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'login-screen';
    this.render();
    document.body.appendChild(this.root);
  }

  onLoginSuccess(cb: () => void): void {
    this.onSuccess = cb;
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="login-box">
        <h1>SPACE<b>·</b>BATLE</h1>
        <div class="login-tagline">Arena orbital · Setor Orion</div>
        <input type="text" id="login-user" placeholder="Callsign (apenas para registro)"
               autocomplete="username" maxlength="18" />
        <input type="email" id="login-email" placeholder="E-mail"
               autocomplete="email" />
        <input type="password" id="login-pass" placeholder="Senha"
               autocomplete="current-password" />
        <div class="login-actions">
          <button class="btn" id="btn-register">Registrar</button>
          <button class="btn btn-primary" id="btn-login">Entrar</button>
        </div>
        <div id="login-error" role="status"></div>
        <p class="login-hint">Enter envia. Seu callsign aparece no HUD e no hangar.</p>
      </div>`;

    const q = <T extends HTMLElement>(sel: string): T =>
      this.root.querySelector<T>(sel) as T;

    const btnLogin = q<HTMLButtonElement>('#btn-login');
    const btnRegister = q<HTMLButtonElement>('#btn-register');
    const userIn = q<HTMLInputElement>('#login-user');
    const emailIn = q<HTMLInputElement>('#login-email');
    const passIn = q<HTMLInputElement>('#login-pass');
    const errDiv = q<HTMLElement>('#login-error');

    const setBusy = (on: boolean, label?: string): void => {
      this.busy = on;
      btnLogin.disabled = on;
      btnRegister.disabled = on;
      if (label) errDiv.textContent = label;
    };

    const showError = (e: unknown, fallback: string): void => {
      errDiv.classList.remove('ok');
      const msg = e instanceof Error ? e.message : '';
      // `fetch` rejeita com TypeError quando a API está fora do ar; a
      // mensagem crua ("Failed to fetch") não ajuda ninguém.
      errDiv.textContent =
        msg && !/fetch/i.test(msg) ? msg : `${fallback} Verifique se a API está no ar.`;
    };

    const doLogin = async (): Promise<void> => {
      if (this.busy) return;
      if (!emailIn.value || !passIn.value) {
        errDiv.classList.remove('ok');
        errDiv.textContent = 'Informe e-mail e senha.';
        return;
      }
      setBusy(true, 'Autenticando…');
      try {
        const res = await login({ email: emailIn.value, password: passIn.value });
        if (res.token) localStorage.setItem('token', res.token);
        // Callsign: usa o nome digitado; senão, a parte local do e-mail.
        const callsign = userIn.value.trim() || emailIn.value.split('@')[0] || 'Piloto';
        localStorage.setItem('username', callsign);
        errDiv.classList.add('ok');
        errDiv.textContent = 'Acesso concedido.';
        this.onSuccess?.();
      } catch (e) {
        showError(e, 'Falha no login.');
      } finally {
        setBusy(false);
      }
    };

    const doRegister = async (): Promise<void> => {
      if (this.busy) return;
      if (!userIn.value || !emailIn.value || !passIn.value) {
        errDiv.classList.remove('ok');
        errDiv.textContent = 'Callsign, e-mail e senha são obrigatórios para registrar.';
        return;
      }
      setBusy(true, 'Registrando…');
      try {
        await register({
          username: userIn.value,
          email: emailIn.value,
          password: passIn.value,
        });
        errDiv.classList.add('ok');
        errDiv.textContent = 'Registrado. Agora é só entrar.';
      } catch (e) {
        showError(e, 'Falha no registro (callsign ou e-mail já em uso).');
      } finally {
        setBusy(false);
      }
    };

    btnLogin.addEventListener('click', () => void doLogin());
    btnRegister.addEventListener('click', () => void doRegister());

    // Enter em qualquer campo entra — o caminho comum não deve exigir mouse.
    for (const input of [userIn, emailIn, passIn]) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void doLogin();
        }
      });
    }
  }
}
