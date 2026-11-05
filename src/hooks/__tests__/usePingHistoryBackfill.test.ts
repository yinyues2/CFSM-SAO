import { afterEach, describe, expect, it } from "vitest";
import {
  markPingBackfillDone,
  resetPingHistoryBackfill,
  selectStaleBackfillUuids,
} from "@/hooks/usePingHistoryBackfill";

const TTL_MS = 15 * 60 * 1000;

afterEach(() => {
  resetPingHistoryBackfill();
});

describe("selectStaleBackfillUuids", () => {
  it("首轮把全部节点当作需要回填", () => {
    expect(selectStaleBackfillUuids(["a", "b"], 1_000)).toEqual(["a", "b"]);
  });

  it("15 分钟内不重复回填，过期后重新列入", () => {
    const now = 1_000_000;
    markPingBackfillDone("a", now);
    expect(selectStaleBackfillUuids(["a", "b"], now + 60_000)).toEqual(["b"]);
    expect(selectStaleBackfillUuids(["a"], now + TTL_MS + 1)).toEqual(["a"]);
  });

  it("忽略空 uuid", () => {
    expect(selectStaleBackfillUuids(["", "a"], 1_000)).toEqual(["a"]);
  });

  it("一台节点的失败不会影响其他节点的判定", () => {
    const now = 2_000_000;
    markPingBackfillDone("ok", now);
    expect(selectStaleBackfillUuids(["ok", "failed"], now + 1)).toEqual(["failed"]);
  });
});
