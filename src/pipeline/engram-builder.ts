import type { RawCapture, ExtractionResult, HarvesterEngram } from '../types.js';

export interface EngramWithPriority extends HarvesterEngram {
  notification_priority: 'notify' | 'silent';
}

export function buildEngram(
  capture: RawCapture,
  extraction: ExtractionResult,
): EngramWithPriority {
  return {
    concept: extraction.summary,
    content: extraction.summary,
    source_type: capture.sourceType,
    source_app: capture.sourceApp,
    user_id: capture.userId,
    user_email: capture.userEmail,
    captured_at: capture.capturedAt,
    approved_at: null,
    approved_by: null,
    approval_status: 'pending',
    confidence: extraction.confidence,
    sensitivity_classification: extraction.sensitivity.classification,
    tags: extraction.tags,
    raw_text: capture.rawContent,
    source_metadata: capture.metadata,
    notification_priority: extraction.confidence >= 0.7 ? 'notify' : 'silent',
  };
}
