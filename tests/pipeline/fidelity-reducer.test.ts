import { describe, it, expect } from 'vitest';
import { FidelityReducer } from '../../src/pipeline/fidelity-reducer.js';
import type { EngramWithPriority } from '../../src/pipeline/engram-builder.js';

function makeEngram(): EngramWithPriority {
  return {
    concept: 'Subsea connector passed 500 bar pressure test.',
    content: 'Subsea connector passed 500 bar pressure test.',
    source_type: 'graph_email',
    source_app: 'outlook',
    user_id: 'user-1',
    user_email: 'user@co.com',
    captured_at: '2026-03-26T10:00:00Z',
    approved_at: null,
    approved_by: null,
    approval_status: 'pending',
    confidence: 0.85,
    sensitivity_classification: 'safe',
    tags: ['subsea', 'connector', 'testing'],
    raw_text: '{"subject":"Subsea connector specs","bodyPreview":"Passed 500 bar."}',
    notification_priority: 'notify',
  };
}

describe('FidelityReducer', () => {
  const reducer = new FidelityReducer();

  it('reduces to department layer (strips raw_text, confidence, sensitivity)', () => {
    const dept = reducer.toDepartment(makeEngram());

    expect(dept.concept).toBe('Subsea connector passed 500 bar pressure test.');
    expect(dept.content).toBe('Subsea connector passed 500 bar pressure test.');
    expect(dept.source_app).toBe('outlook');
    expect(dept.user_id).toBe('user-1');
    expect(dept.user_email).toBe('user@co.com');
    expect(dept.tags).toEqual(['subsea', 'connector', 'testing']);

    // Should not have these fields
    expect(dept).not.toHaveProperty('raw_text');
    expect(dept).not.toHaveProperty('confidence');
    expect(dept).not.toHaveProperty('sensitivity_classification');
    expect(dept).not.toHaveProperty('notification_priority');
    expect(dept).not.toHaveProperty('approval_status');
  });

  it('reduces to org layer (strips individual attribution, adds department)', () => {
    const org = reducer.toOrg(makeEngram(), 'Engineering');

    expect(org.concept).toBe('Subsea connector passed 500 bar pressure test.');
    expect(org.tags).toEqual(['subsea', 'connector', 'testing']);
    expect(org.department).toBe('Engineering');

    // Should not have individual fields
    expect(org).not.toHaveProperty('user_id');
    expect(org).not.toHaveProperty('user_email');
    expect(org).not.toHaveProperty('source_app');
    expect(org).not.toHaveProperty('content');
    expect(org).not.toHaveProperty('raw_text');
  });
});
