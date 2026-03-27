export function getToken(): string {
  return localStorage.getItem('mycelium_token') || '';
}

export function setToken(token: string): void {
  localStorage.setItem('mycelium_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('mycelium_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export async function fetchWithAuth(path: string, opts?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
  }
  return res;
}

async function fetchAPI(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getEngrams(status?: string, q?: string): Promise<any> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  return fetchAPI(`/api/engrams?${params}`);
}

export async function patchEngram(id: string, approvalStatus: string, department?: string): Promise<any> {
  const body: Record<string, string> = { approval_status: approvalStatus };
  if (department !== undefined) body.department = department;
  return fetchAPI(`/api/engrams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function getEngramDetail(id: string): Promise<any> {
  return fetchAPI(`/api/engrams/${id}`);
}

export async function getStats(): Promise<any> {
  return fetchAPI('/api/stats');
}

export async function getAnalyticsOverview(): Promise<any> {
  return fetchAPI('/api/analytics/overview');
}

export async function getAnalyticsVolume(period: string = 'day'): Promise<any> {
  return fetchAPI(`/api/analytics/volume?period=${period}`);
}

export async function getAnalyticsSources(): Promise<any> {
  return fetchAPI('/api/analytics/sources');
}

export async function getAnalyticsTopTags(limit: number = 20): Promise<any> {
  return fetchAPI(`/api/analytics/top-tags?limit=${limit}`);
}

export async function getAnalyticsConfidence(): Promise<any> {
  return fetchAPI('/api/analytics/confidence');
}

export async function getHealth(): Promise<any> {
  const res = await fetch('/api/health');
  return res.json();
}

// User management
export async function getUsers(page = 1, limit = 20, department?: string, q?: string): Promise<any> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (department) params.set('department', department);
  if (q) params.set('q', q);
  return fetchAPI(`/api/users?${params}`);
}

export async function getUser(id: string): Promise<any> {
  return fetchAPI(`/api/users/${id}`);
}

export async function updateUser(id: string, data: { department?: string; role?: string; harvestingEnabled?: boolean }): Promise<any> {
  return fetchAPI(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function getDepartments(): Promise<any> {
  return fetchAPI('/api/users/departments');
}

export async function syncUserStats(id: string): Promise<any> {
  return fetchAPI(`/api/users/${id}/sync-stats`, { method: 'POST' });
}

export interface WebSocketHandle {
  close(): void;
}

export function connectWebSocket(onMessage: (data: any) => void): WebSocketHandle {
  let currentWs: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;

    const token = getToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/engrams?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    currentWs = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {}
    };

    ws.onclose = (event) => {
      if (closed) return;
      if (event.code === 4001) {
        clearToken();
        window.location.href = '/login';
        return;
      }
      setTimeout(connect, 3000);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      currentWs?.close();
      currentWs = null;
    },
  };
}
