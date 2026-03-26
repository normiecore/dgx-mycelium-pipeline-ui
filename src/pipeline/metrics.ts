export interface MetricsSnapshot {
  processed_total: number;
  blocked_total: number;
  deduplicated_total: number;
  errors_total: number;
  last_poll_at: string | null;
}

export class PipelineMetrics {
  private processed = 0;
  private blocked = 0;
  private deduplicated = 0;
  private errors = 0;
  private lastPollAt: string | null = null;

  recordProcessed(): void {
    this.processed++;
  }

  recordBlocked(): void {
    this.blocked++;
  }

  recordDeduplicated(): void {
    this.deduplicated++;
  }

  recordError(): void {
    this.errors++;
  }

  recordPoll(): void {
    this.lastPollAt = new Date().toISOString();
  }

  snapshot(): MetricsSnapshot {
    return {
      processed_total: this.processed,
      blocked_total: this.blocked,
      deduplicated_total: this.deduplicated,
      errors_total: this.errors,
      last_poll_at: this.lastPollAt,
    };
  }
}
