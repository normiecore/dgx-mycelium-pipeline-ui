import { describe, it, expect } from 'vitest';
import { buildEngram } from '../../src/pipeline/engram-builder.js';
import type { RawCapture, ExtractionResult } from '../../src/types.js';

function makeCapture(): RawCapture {
  return {
    id: 'cap-1',
    userId: 'user-1',
    userEmail: 'user@co.com',
    sourceType: 'graph_email',
    sourceApp: 'outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: JSON.stringify({
      subject: 'Subsea connector specs',
      bodyPreview: 'Connector passed 500 bar test.',
    }),
    metadata: {},
  };
}

function makeExtraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    summary: 'Subsea connector passed 500 bar pressure test.',
    tags: ['subsea', 'connector', 'testing'],
    confidence: 0.85,
    sensitivity: { classification: 'safe', reasoning: 'Technical content.' },
    ...overrides,
  };
}

describe('buildEngram', () => {
  it('builds complete engram from capture + extraction', () => {
    const engram = buildEngram(makeCapture(), makeExtraction());

    expect(engram.concept).toBe('Subsea connector passed 500 bar pressure test.');
    expect(engram.content).toBe('Subsea connector passed 500 bar pressure test.');
    expect(engram.source_type).toBe('graph_email');
    expect(engram.source_app).toBe('outlook');
    expect(engram.user_id).toBe('user-1');
    expect(engram.user_email).toBe('user@co.com');
    expect(engram.captured_at).toBe('2026-03-26T10:00:00Z');
    expect(engram.approval_status).toBe('pending');
    expect(engram.approved_at).toBeNull();
    expect(engram.approved_by).toBeNull();
    expect(engram.confidence).toBe(0.85);
    expect(engram.sensitivity_classification).toBe('safe');
    expect(engram.tags).toEqual(['subsea', 'connector', 'testing']);
    expect(engram.raw_text).toContain('Subsea connector specs');
  });

  it('sets notification_priority based on confidence (>=0.7 = notify)', () => {
    const engram = buildEngram(makeCapture(), makeExtraction({ confidence: 0.7 }));
    expect(engram.notification_priority).toBe('notify');
  });

  it('sets notification_priority based on confidence (<0.7 = silent)', () => {
    const engram = buildEngram(makeCapture(), makeExtraction({ confidence: 0.69 }));
    expect(engram.notification_priority).toBe('silent');
  });
});
