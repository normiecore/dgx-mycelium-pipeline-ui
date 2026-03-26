import { describe, it, expect } from 'vitest';
import { TOPICS, topicForUser } from '../../src/queue/topics.js';

describe('TOPICS', () => {
  it('has the expected topic constants', () => {
    expect(TOPICS.RAW_CAPTURES).toBe('harvester.raw-captures');
    expect(TOPICS.DEAD_LETTER).toBe('harvester.dead-letter');
    expect(TOPICS.ENGRAMS_APPROVED).toBe('harvester.engrams-approved');
  });
});

describe('topicForUser', () => {
  it('returns a user-scoped topic', () => {
    expect(topicForUser('user-abc')).toBe('harvester.raw-captures.user-abc');
  });

  it('works with different user IDs', () => {
    expect(topicForUser('u123')).toBe('harvester.raw-captures.u123');
    expect(topicForUser('james@example.com')).toBe(
      'harvester.raw-captures.james@example.com',
    );
  });
});
