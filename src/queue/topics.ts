export const TOPICS = {
  RAW_CAPTURES: 'raw.captures',
  DEAD_LETTER: 'pipeline.deadletter',
  ENGRAMS_APPROVED: 'engrams.approved',
} as const;

export function topicForUser(userId: string): string {
  return `engrams.pending.${userId}`;
}
