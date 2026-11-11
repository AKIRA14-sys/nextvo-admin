import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createRefreshQueue } from "../src/lib/refresh-queue";

test("refresh queue collapses a burst of live/mutation events into one task", async () => {
  let calls = 0;
  const queue = createRefreshQueue(async () => { calls += 1; }, 10);
  for (let i = 0; i < 20; i += 1) queue.schedule();
  await sleep(35);
  assert.equal(calls, 1);
  queue.dispose();
});

test("refresh queue runs at most one task concurrently and one trailing refresh", async () => {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const queue = createRefreshQueue(async () => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await sleep(30);
    active -= 1;
  }, 5);
  const first = queue.run();
  await Promise.all([queue.run(), queue.run(), first]);
  await sleep(45);
  assert.equal(calls, 2);
  assert.equal(maximumActive, 1);
  queue.dispose();
});

test("refresh queue cleans up timers and can reactivate after Strict Mode cleanup", async () => {
  let calls = 0;
  const queue = createRefreshQueue(async () => { calls += 1; }, 5);
  queue.schedule();
  queue.dispose();
  await sleep(15);
  assert.equal(calls, 0);
  queue.activate();
  await queue.run();
  assert.equal(calls, 1);
  queue.dispose();
});
