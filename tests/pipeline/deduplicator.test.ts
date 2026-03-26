import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Deduplicator } from '../../src/pipeline/deduplicator.js';
import { unlinkSync } from 'fs';

const TEST_DB = 'test-dedup.db';

describe('Deduplicator', () => {
  let dedup: Deduplicator;

  beforeEach(() => {
    dedup = new Deduplicator(TEST_DB);
  });

  afterEach(() => {
    dedup.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('returns false for first occurrence', () => {
    expect(dedup.isDuplicate('user-1', 'some content')).toBe(false);
  });

  it('returns true for duplicate from same user', () => {
    dedup.isDuplicate('user-1', 'some content');
    expect(dedup.isDuplicate('user-1', 'some content')).toBe(true);
  });

  it('allows same content from different users', () => {
    dedup.isDuplicate('user-1', 'some content');
    expect(dedup.isDuplicate('user-2', 'some content')).toBe(false);
  });

  it('expires old entries', () => {
    dedup.isDuplicate('user-1', 'old content');
    // Manually backdate the entry
    dedup['db'].prepare(
      "UPDATE content_hashes SET seen_at = datetime('now', '-10 days')",
    ).run();
    dedup.expireOlderThan(7);
    expect(dedup.isDuplicate('user-1', 'old content')).toBe(false);
  });
});
