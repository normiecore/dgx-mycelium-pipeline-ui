import { describe, it, expect } from 'vitest';
import { TOPICS, topicForUser } from '../../src/queue/topics.js';

describe('TOPICS', () => {
  it('has the expected topic constants', () => {
    expect(TOPICS.RAW_CAPTURES).toBe('raw.captures');
    expect(TOPICS.DEAD_LETTER).toBe('pipeline.deadletter');
    expect(TOPICS.ENGRAMS_APPROVED).toBe('engrams.approved');
  });
});

describe('topicForUser', () => {
  it('returns a user-scoped topic', () => {
    expect(topicForUser('user-abc')).toBe('engrams.pending.user-abc');
  });

  it('works with different user IDs', () => {
    expect(topicForUser('u123')).toBe('engrams.pending.u123');
    expect(topicForUser('james@example.com')).toBe(
      'engrams.pending.james@example.com',
    );
  });
});
