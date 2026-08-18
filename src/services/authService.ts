import { apiUrl } from './appUrl';

export interface AppUser {
  username: string;
  folder: string;
  role: 'admin' | 'user';
}

interface AuthState {
  authenticated: boolean;
  user: AppUser | null;
}

interface ApiEnvelope<T> {
  code: number | string;
  message?: string;
  data?: T;
}

export const AUTH_REQUIRED_EVENT = 'misty-rain-auth-required';

const readEnvelope = async <T>(response: Response): Promise<ApiEnvelope<T>> => {
  try {
    return await response.json() as ApiEnvelope<T>;
  } catch {
    return { code: 'INVALID_RESPONSE', message: '服务返回了无效响应' };
  }
};

export const authFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined') {
    const envelope = await response.clone().json().catch(() => null) as ApiEnvelope<unknown> | null;
    if (envelope?.code === 'APP_AUTH_REQUIRED') {
      window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
    }
  }
  return response;
};

export class AuthService {
  static async session(): Promise<AuthState> {
    try {
      const response = await fetch(apiUrl('/api/auth/session'), { cache: 'no-store' });
      const envelope = await readEnvelope<AuthState>(response);
      return response.ok && envelope.code === 0 && envelope.data
        ? envelope.data
        : { authenticated: false, user: null };
    } catch {
      return { authenticated: false, user: null };
    }
  }

  static async login(username: string, password: string): Promise<AuthState> {
    const response = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const envelope = await readEnvelope<AuthState>(response);
    if (!response.ok || envelope.code !== 0 || !envelope.data?.authenticated || !envelope.data.user) {
      throw new Error(envelope.message || '登录失败，请稍后重试');
    }
    return envelope.data;
  }

  static async logout(): Promise<void> {
    await fetch(apiUrl('/api/auth/logout'), { method: 'POST' }).catch(() => {});
  }
}
