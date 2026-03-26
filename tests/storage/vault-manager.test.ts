import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultManager } from '../../src/storage/vault-manager.js';
import type { HarvesterEngram } from '../../src/types.js';

describe('VaultManager', () => {
  let vaultManager: VaultManager;
  let mockRemember: ReturnType<typeof vi.fn>;

  const engram: HarvesterEngram = {
    concept: 'Pipe stress method', content: 'Detailed analysis...',
    source_type: 'graph_email', source_app: 'Outlook',
    user_id: 'user-abc', user_email: 'james@example.com',
    captured_at: '2026-03-26T10:00:00Z',
    approved_at: null, approved_by: null,
    approval_status: 'pending', confidence: 0.88,
    sensitivity_classification: 'safe', tags: ['pipe-stress'], raw_text: 'raw...',
  };

  beforeEach(() => {
    mockRemember = vi.fn().mockResolvedValue({ id: 'eng-001' });
    const mockClient = { remember: mockRemember, recall: vi.fn(), read: vi.fn() } as any;
    vaultManager = new VaultManager(mockClient);
  });

  it('stores pending engram in personal vault only', async () => {
    await vaultManager.storePending(engram);
    expect(mockRemember).toHaveBeenCalledTimes(1);
    expect(mockRemember.mock.calls[0][0]).toBe('knowledge-harvester-user-abc');
  });

  it('stores approved engram in all three vaults', async () => {
    const approved = { ...engram, approval_status: 'approved' as const };
    await vaultManager.storeApproved(approved, 'Engineering');
    expect(mockRemember).toHaveBeenCalledTimes(3);
    const vaults = mockRemember.mock.calls.map((c: any[]) => c[0]);
    expect(vaults).toContain('knowledge-harvester-user-abc');
    expect(vaults).toContain('knowledge-harvester-dept-Engineering');
    expect(vaults).toContain('knowledge-harvester-org');
  });

  it('generates correct vault names', () => {
    expect(VaultManager.personalVault('user-abc')).toBe('knowledge-harvester-user-abc');
    expect(VaultManager.deptVault('Engineering')).toBe('knowledge-harvester-dept-Engineering');
    expect(VaultManager.orgVault()).toBe('knowledge-harvester-org');
  });
});
