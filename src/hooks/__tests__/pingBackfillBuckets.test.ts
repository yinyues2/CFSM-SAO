import { afterEach, describe, expect, it } from "vitest";
import {
  getPingHistorySnapshot,
  resetPingLiveStore,
  seedMeasuredHistory,
  seedPingHistory,
} from "@/services/pingLiveStore";
import {
  buildPingBuckets,
  buildPingOverviewItem,
  HOMEPAGE_PING_BUCKET_COUNT,
} from "@/hooks/usePingOverview";
import { EMPTY_CARRIER_PING } from "@/types/cfsm";
import type { PingLiveSample } from "@/services/pingLiveStore";

/**
 * 复现「刷新也不恢复」的那种空格子：
 * `/api/servers` 的 20 格窗口如果整段是同一个样本（后端的最近邻向后填充），
 * `seedPingHistory` 会按「复印件」整段丢掉 —— 此时首页柱子只剩浏览器本地累积，
 * 一刷新就回到 2~3 格。历史回填（`seedMeasuredHistory`）必须把它补满 20 格。
 */

const NOW = 1_800_000_000_000;
const WINDOW_STEP_MS = 6 * 60 * 1000;

function identicalWindow(): PingLiveSample[] {
  const sample = { ...EMPTY_CARRIER_PING, ct: 54, cu: 56, cm: 73 };
  return Array.from({ length: 20 }, (_, index) => ({
    time: NOW - (19 - index) * WINDOW_STEP_MS,
    ping: { ...sample },
  }));
}

function measuredRows(spanMs: number, stepMs = 60_000): PingLiveSample[] {
  const out: PingLiveSample[] = [];
  for (let age = spanMs; age >= 0; age -= stepMs) {
    const value = 50 + (age % 7);
    out.push({
      time: NOW - age,
      ping: { ...EMPTY_CARRIER_PING, ct: value, cu: value + 2, cm: value + 20 },
    });
  }
  return out;
}

function activeBuckets(uuid: string) {
  const samples = getPingHistorySnapshot(uuid);
  const item = buildPingOverviewItem(uuid, 1, samples);
  return buildPingBuckets(item, HOMEPAGE_PING_BUCKET_COUNT, NOW);
}

afterEach(() => {
  resetPingLiveStore();
});

describe("首页延迟条的窗口丢段与历史回填", () => {
  it("整段复印件窗口会被丢掉，只剩浏览器本地累积（复现空格子）", () => {
    seedPingHistory("node-a", identicalWindow());
    expect(getPingHistorySnapshot("node-a")).toHaveLength(0);

    seedMeasuredHistory("node-a", measuredRows(3 * 60_000));
    const buckets = activeBuckets("node-a");
    expect(buckets.filter((bucket) => bucket.value != null).length).toBeLessThan(5);
  });

  it("回填 2.25 小时真采样后，20 格全部有值", () => {
    seedPingHistory("node-b", identicalWindow());
    seedMeasuredHistory("node-b", measuredRows(2.25 * 60 * 60 * 1000));

    const buckets = activeBuckets("node-b");
    expect(buckets).toHaveLength(HOMEPAGE_PING_BUCKET_COUNT);
    expect(buckets.filter((bucket) => bucket.value != null)).toHaveLength(
      HOMEPAGE_PING_BUCKET_COUNT,
    );
  });
});
