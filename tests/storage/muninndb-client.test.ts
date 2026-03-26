import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MuninnDBClient } from '../../src/storage/muninndb-client.js';

describe('MuninnDBClient', () => {
  let client: MuninnDBClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'eng-001', concept: 'Test', content: 'Test content' }),
    });
    global.fetch = mockFetch;
    client = new MuninnDBClient('http://localhost:3030', 'mk_test');
  });

  it('stores an engram with correct vault and headers', async () => {
    await client.remember('test-vault', 'Test concept', 'Test content');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/remember');
    expect(opts.headers['Authorization']).toBe('Bearer mk_test');
    expect(JSON.parse(opts.body)).toMatchObject({ vault: 'test-vault', concept: 'Test concept', content: 'Test content' });
  });

  it('recalls engrams from a vault', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ engrams: [{ id: 'e1', concept: 'Test' }] }) });
    const result = await client.recall('test-vault', 'search query');
    expect(result.engrams).toHaveLength(1);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: () => Promise.resolve('error') });
    await expect(client.remember('v', 'c', 'x')).rejects.toThrow('MuninnDB error: 500');
  });
});
