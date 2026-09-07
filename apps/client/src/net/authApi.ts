/**
 * Endereço padrão da API em desenvolvimento.
 *
 * `127.0.0.1` e não `localhost` de propósito. `localhost` depende da
 * resolução do sistema, que no Windows pode devolver `::1` primeiro — ou
 * pendurar de vez, como aconteceu aqui: o login ficava em "Autenticando…"
 * sem nem uma conexão recusada para diagnosticar, enquanto os dois
 * endereços literais respondiam normalmente. Um IP literal não passa pelo
 * resolvedor.
 */
import { mensagemDeErro, mensagemDeRedeIndisponivel } from './apiErrors';

const API_BASE_URL = 'http://127.0.0.1:8080/auth';

export interface AuthResponse {
  token?: string;
  user?: any;
  message?: string;
  error?: string;
}

export interface AuthCredentials {
  username?: string;
  email?: string;
  password?: string;
  [key: string]: any; // Permite flexibilidade para outros campos (ex: confirmPassword)
}

/**
 * Função auxiliar para tratar as respostas da API e padronizar os erros
 */
async function handleResponse(response: Response, acao: string): Promise<AuthResponse> {
  let data;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(mensagemDeErro(response.status, null, acao));
    }
    return {} as AuthResponse;
  }

  if (!response.ok) {
    // A mensagem crua da API não serve ao jogador: com o banco fora do
    // ar ela é "Internal Server Error", em inglês e sem dizer de quem é
    // o problema nem o que fazer.
    throw new Error(mensagemDeErro(response.status, data, acao));
  }

  return data;
}

/**
 * `fetch` rejeita com `TypeError: Failed to fetch` quando a API está
 * desligada. Repassar isso mostraria ao jogador uma mensagem que não diz
 * a quem pertence o problema.
 */
function traduzFalhaDeRede(erro: unknown, acao: string): Error {
  if (erro instanceof TypeError) return new Error(mensagemDeRedeIndisponivel(acao));
  return erro instanceof Error ? erro : new Error(mensagemDeRedeIndisponivel(acao));
}

/**
 * Registra um novo usuário no backend
 * 
 * @param credentials Dados do usuário para registro (ex: email, username, password)
 * @returns Resposta da API com token e/ou dados do usuário
 */
export async function register(credentials: AuthCredentials): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });
    
    return await handleResponse(response, 'registrar');
  } catch (error) {
    console.error('Erro no registro (authApi):', error);
    throw traduzFalhaDeRede(error, 'registrar');
  }
}

/**
 * Realiza o login de um usuário existente
 * 
 * @param credentials Credenciais do usuário (ex: email, password)
 * @returns Resposta da API com token e/ou dados do usuário
 */
export async function login(credentials: AuthCredentials): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    return await handleResponse(response, 'entrar');
  } catch (error) {
    console.error('Erro no login (authApi):', error);
    throw traduzFalhaDeRede(error, 'entrar');
  }
}
