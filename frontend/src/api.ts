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

export async function patchEngram(id: string, approvalStatus: string, department = 'Engineering'): Promise<any> {
  return fetchAPI(`/api/engrams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ approval_status: approvalStatus, department }),
  });
}

export async function getStats(): Promise<any> {
  return fetchAPI('/api/stats');
}

export async function getHealth(): Promise<any> {
  const res = await fetch('/api/health');
  return res.json();
}

export function connectWebSocket(onMessage: (data: any) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/engrams`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token: getToken() }));
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      onMessage(data);
    } catch {}
  };

  ws.onclose = () => {
    setTimeout(() => connectWebSocket(onMessage), 3000);
  };

  return ws;
}
