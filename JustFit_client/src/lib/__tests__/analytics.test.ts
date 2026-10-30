// The app's event queue, the pure part: how a waiting queue is cut into batches the server
// accepts. (The server's own checks are tested in JustFit_server/__tests__/analytics-rules.test.js.)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BATCH_SIZE, queueRules, type QueuedEvent } from "../analyticsRules.ts";

const event = (n: number): QueuedEvent => ({ id: `id-${n}`, name: "meal_logged", at: n, sessionId: "s" });

describe("the event queue", () => {
  it("sends the oldest events first, at most a server batch at a time, and keeps the rest", () => {
    const queue = Array.from({ length: BATCH_SIZE + 7 }, (_, i) => event(i));
    const { batch, rest } = queueRules.nextBatch(queue);
    assert.equal(batch.length, BATCH_SIZE);
    assert.equal(batch[0].id, "id-0");
    assert.equal(rest.length, 7);
    assert.equal(rest[0].id, `id-${BATCH_SIZE}`);
  });

  it("a short queue goes in one batch and leaves nothing behind", () => {
    const { batch, rest } = queueRules.nextBatch([event(1), event(2)]);
    assert.deepEqual(batch.map((e) => e.id), ["id-1", "id-2"]);
    assert.deepEqual(rest, []);
  });

  it("the batch size matches what the server accepts", () => {
    assert.equal(BATCH_SIZE, 50);
  });
});
