export const TOPICS = {
  RAW_CAPTURES: 'harvester.raw-captures',
  DEAD_LETTER: 'harvester.dead-letter',
  ENGRAMS_APPROVED: 'harvester.engrams-approved',
} as const;

export function topicForUser(userId: string): string {
  return `${TOPICS.RAW_CAPTURES}.${userId}`;
}
