import { useEffect, useState } from "react";
import { backfillPingHistory } from "@/services/api";

/**
 * 首页延迟条的历史回填。
 *
 * 柱子只由「`/api/servers` 的 20 格窗口」+「浏览器本地累积」拼出来，而窗口会被后端的
 * 最近邻填充污染（连续多格逐字节相同 → 前端整段丢掉），本地累积又只覆盖标签页开着的那段。
 * 结果就是卡片上一格一格的空洞，刷新也不一定恢复（窗口本身已经脏了）。
 *
 * 这里给每台可见节点补一次真实历史：页面加载时、标签页重新可见时、以及每 15 分钟各一次。
 * 同一台节点 15 分钟内不重复请求；页面不可见时完全不发请求。一次会话十几条请求，不是轮询。
 */

/** 与后端首页窗口（约 2 小时）对齐，多给一点余量。 */
const BACKFILL_HOURS = 2.25;
/** 同一台节点的最短重查间隔。 */
const BACKFILL_TTL_MS = 15 * 60 * 1000;
/** 列表里的相邻两条请求之间的间隔，避免一次打十几个并发。 */
const BACKFILL_GAP_MS = 150;
/** 定时检查间隔：只补过期的，不是每次都全量重查。 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const lastBackfillAt = new Map<string, number>();

/** 记录一次回填时间（hook 与测试共用）。 */
export function markPingBackfillDone(uuid: string, at = Date.now()): void {
  lastBackfillAt.set(uuid, at);
}

/** 测试用。 */
export function resetPingHistoryBackfill(): void {
  lastBackfillAt.clear();
}

/** 纯函数：从节点列表里挑出该补历史的那些（供测试与 hook 共用）。 */
export function selectStaleBackfillUuids(
  uuids: readonly string[],
  now = Date.now(),
): string[] {
  const out: string[] = [];
  for (const uuid of uuids) {
    if (!uuid) continue;
    const last = lastBackfillAt.get(uuid);
    // 没记录过 = 这一轮该补；记录过就看是否超过 TTL。
    if (last != null && now - last < BACKFILL_TTL_MS) continue;
    out.push(uuid);
  }
  return out;
}

export function usePingHistoryBackfill(uuids: readonly string[]): void {
  // 依赖用字符串签名：调用方每次渲染都会新建数组，按引用比较会无限触发。
  const key = uuids.join(",");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setTick((value) => value + 1);
    };
    const timer = window.setInterval(bump, SWEEP_INTERVAL_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", bump);
    }
    return () => {
      window.clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", bump);
      }
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    const stale = selectStaleBackfillUuids(key.split(","));
    if (stale.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const uuid of stale) {
        if (cancelled) return;
        // 先记时间再请求：失败也不要立刻重试，下一轮扫描再说。
        markPingBackfillDone(uuid);
        try {
          await backfillPingHistory(uuid, BACKFILL_HOURS);
        } catch {
          // 私有面板未登录、节点已删、网络抖动：静默跳过，条子退回窗口+本地累积。
        }
        await new Promise((resolve) => setTimeout(resolve, BACKFILL_GAP_MS));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, tick]);
}
