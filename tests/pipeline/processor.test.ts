import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineProcessor } from '../../src/pipeline/processor.js';
import { PipelineMetrics } from '../../src/pipeline/metrics.js';
import { ConcurrencyLimiter } from '../../src/pipeline/concurrency-limiter.js';
import type { RawCapture } from '../../src/types.js';

describe('PipelineProcessor', () => {
  let processor: PipelineProcessor;
  let mockExtractor: any;
  let mockDeduplicator: any;
  let mockVaultManager: any;
  let mockNatsPublish: ReturnType<typeof vi.fn>;
  let mockEngramIndex: any;
  let metrics: PipelineMetrics;
  let limiter: ConcurrencyLimiter;

  const capture: RawCapture = {
    id: 'cap-1', userId: 'user-abc', userEmail: 'james@example.com',
    sourceType: 'graph_email', sourceApp: 'Outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: JSON.stringify({ subject: 'Pipe report', body: 'FEA analysis...' }),
    metadata: {},
  };

  beforeEach(() => {
    mockExtractor = { extract: vi.fn().mockResolvedValue({ summary: 'Pipe stress method', tags: ['pipe-stress'], confidence: 0.88, sensitivity: { classification: 'safe', reasoning: 'Technical' } }) };
    mockDeduplicator = { isDuplicate: vi.fn().mockReturnValue(false) };
    mockVaultManager = { storePending: vi.fn().mockResolvedValue(undefined) };
    mockNatsPublish = vi.fn();
    mockEngramIndex = { upsert: vi.fn() };
    metrics = new PipelineMetrics();
    limiter = new ConcurrencyLimiter(8);
    processor = new PipelineProcessor(mockExtractor, mockDeduplicator, mockVaultManager, mockNatsPublish, mockEngramIndex, limiter, metrics);
  });

  it('processes safe capture end-to-end', async () => {
    const result = await processor.process(capture);
    expect(result.action).toBe('stored');
    expect(mockVaultManager.storePending).toHaveBeenCalledTimes(1);
    expect(mockNatsPublish).toHaveBeenCalledTimes(1);
    expect(mockEngramIndex.upsert).toHaveBeenCalledTimes(1);
    expect(mockEngramIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cap-1', userId: 'user-abc', approvalStatus: 'pending' }),
    );
  });

  it('blocks sensitive content at pre-filter', async () => {
    const sensitive: RawCapture = { ...capture, rawContent: JSON.stringify({ subject: 'Your Salary Review', body: 'details' }) };
    const result = await processor.process(sensitive);
    expect(result.action).toBe('blocked');
    expect(mockExtractor.extract).not.toHaveBeenCalled();
  });

  it('blocks content the LLM classifies as block', async () => {
    mockExtractor.extract.mockResolvedValue({ summary: 'Personal', tags: [], confidence: 0.5, sensitivity: { classification: 'block', reasoning: 'Personal content' } });
    const result = await processor.process(capture);
    expect(result.action).toBe('blocked');
    expect(mockVaultManager.storePending).not.toHaveBeenCalled();
  });

  it('skips duplicate content', async () => {
    mockDeduplicator.isDuplicate.mockReturnValue(true);
    const result = await processor.process(capture);
    expect(result.action).toBe('deduplicated');
    expect(mockExtractor.extract).not.toHaveBeenCalled();
  });

  it('stores review-classified content as pending', async () => {
    mockExtractor.extract.mockResolvedValue({ summary: 'Mixed content', tags: [], confidence: 0.6, sensitivity: { classification: 'review', reasoning: 'Mixed' } });
    const result = await processor.process(capture);
    expect(result.action).toBe('stored');
  });

  it('increments metrics on stored capture', async () => {
    await processor.process(capture);
    const snap = metrics.snapshot();
    expect(snap.processed_total).toBe(1);
    expect(snap.blocked_total).toBe(0);
    expect(snap.deduplicated_total).toBe(0);
  });

  it('increments blocked metric on pre-filter block', async () => {
    const sensitive: RawCapture = { ...capture, rawContent: JSON.stringify({ subject: 'Your Salary Review', body: 'details' }) };
    await processor.process(sensitive);
    const snap = metrics.snapshot();
    expect(snap.blocked_total).toBe(1);
    expect(snap.processed_total).toBe(0);
  });
});
