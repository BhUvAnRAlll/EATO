// The pure part of the app's event queue (lib/analytics.ts uses it): how a waiting queue is cut
// into batches the server accepts. No React Native imports, so it is unit-tested on its own.

export type QueuedEvent = {
  id: string;
  name: string;
  at: number;
  sessionId: string;
  screen?: string;
  metadata?: Record<string, string | number | boolean>;
};

// The server takes at most this many events per request (analytics/rules.js)
export const BATCH_SIZE = 50;

export const queueRules = {
  // The next batch to send, oldest first, and what stays behind
  nextBatch(queue: QueuedEvent[], size = BATCH_SIZE): { batch: QueuedEvent[]; rest: QueuedEvent[] } {
    return { batch: queue.slice(0, size), rest: queue.slice(size) };
  },
};
