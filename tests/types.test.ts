import { describe, it, expect } from 'vitest';
import { RawCaptureSchema, ExtractionResultSchema, type RawCapture, type HarvesterEngram, type ExtractionResult, type SourceType, type ApprovalStatus, type SensitivityClassification } from '../src/types.js';

describe('RawCaptureSchema', () => {
  it('validates a well-formed raw capture', () => {
    const capture: RawCapture = {
      id: 'cap-001',
      userId: 'user-abc',
      userEmail: 'james@example.com',
      sourceType: 'graph_email',
      sourceApp: 'Outlook',
      capturedAt: '2026-03-26T10:00:00Z',
      rawContent: 'Meeting notes about pipe stress...',
      metadata: { threadId: 'thread-1', from: 'alice@example.com' },
    };
    expect(RawCaptureSchema.parse(capture)).toEqual(capture);
  });

  it('rejects missing required fields', () => {
    expect(() => RawCaptureSchema.parse({ id: 'cap-001' })).toThrow();
  });

  it('rejects invalid sourceType', () => {
    expect(() =>
      RawCaptureSchema.parse({
        id: 'cap-001',
        userId: 'user-abc',
        userEmail: 'j@e.com',
        sourceType: 'invalid_source',
        sourceApp: 'X',
        capturedAt: '2026-03-26T10:00:00Z',
        rawContent: 'text',
        metadata: {},
      }),
    ).toThrow();
  });
});

describe('ExtractionResultSchema', () => {
  it('validates a well-formed extraction result', () => {
    const result: ExtractionResult = {
      summary: 'Pipe stress calculation method for 6-inch subsea risers',
      tags: ['pipe-stress', 'subsea', 'engineering'],
      confidence: 0.85,
      sensitivity: {
        classification: 'safe',
        reasoning: 'Technical engineering content, no personal data',
      },
    };
    expect(ExtractionResultSchema.parse(result)).toEqual(result);
  });

  it('rejects confidence outside 0-1 range', () => {
    expect(() =>
      ExtractionResultSchema.parse({
        summary: 'test',
        tags: [],
        confidence: 1.5,
        sensitivity: { classification: 'safe', reasoning: 'ok' },
      }),
    ).toThrow();
  });
});
