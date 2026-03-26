import { describe, it, expect } from 'vitest';
import { PipelineMetrics } from '../../src/pipeline/metrics.js';

describe('PipelineMetrics', () => {
  it('starts at zero', () => {
    const metrics = new PipelineMetrics();
    const snap = metrics.snapshot();
    expect(snap.processed_total).toBe(0);
    expect(snap.blocked_total).toBe(0);
    expect(snap.deduplicated_total).toBe(0);
    expect(snap.errors_total).toBe(0);
    expect(snap.last_poll_at).toBeNull();
  });

  it('increments counters', () => {
    const metrics = new PipelineMetrics();
    metrics.recordProcessed();
    metrics.recordProcessed();
    metrics.recordBlocked();
    metrics.recordDeduplicated();
    metrics.recordError();
    metrics.recordError();
    metrics.recordError();

    const snap = metrics.snapshot();
    expect(snap.processed_total).toBe(2);
    expect(snap.blocked_total).toBe(1);
    expect(snap.deduplicated_total).toBe(1);
    expect(snap.errors_total).toBe(3);
  });

  it('records poll time', () => {
    const metrics = new PipelineMetrics();
    const before = new Date().toISOString();
    metrics.recordPoll();
    const snap = metrics.snapshot();

    expect(snap.last_poll_at).not.toBeNull();
    expect(snap.last_poll_at! >= before).toBe(true);
  });
});
