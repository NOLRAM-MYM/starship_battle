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
async function handleResponse(response: Response): Promise<AuthResponse> {
  let data;
  try {
    data = await response.json();
  } catch (err) {
    // Caso a resposta não seja um JSON válido e o status seja de erro
    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status} ${response.statusText}`);
    }
    return {} as AuthResponse;
  }

  if (!response.ok) {
    // Lança um erro utilizando a mensagem retornada pela API ou um texto genérico
    const errorMessage = data?.message || data?.error || `Erro HTTP: ${response.status}`;
    throw new Error(errorMessage);
  }

  return data;
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
    
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro no registro (authApi):', error);
    throw error; // Repassa o erro para ser tratado pela UI
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

    return await handleResponse(response);
  } catch (error) {
    console.error('Erro no login (authApi):', error);
    throw error; // Repassa o erro para ser tratado pela UI
  }
}
