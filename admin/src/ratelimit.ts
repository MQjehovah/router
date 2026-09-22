/// 进程内滑动窗口限流(admin 为单实例控制台, 状态重启即清零)
///
/// 每个 key 只保留窗口内的命中时间戳, 访问时惰性清理过期项:
/// key 数量受用户数约束, 单 key 最多 limit 个时间戳, 内存有界。
/// 被拒绝的请求不记账, 不延长窗口; now 可注入, 便于测试覆盖窗口边界。
///
/// 窗口为半开区间 (now - windowMs, now]: t 时刻的命中在 now >= t + windowMs 时滑出。

const windows = new Map<string, number[]>();

/** 判定一次请求是否放行: 放行返回 0; 拒绝返回窗口内最早命中滑出所需毫秒(调用方据此设置 Retry-After) */
export function allow(key: string, limit: number, windowMs: number, now: number = Date.now()): number {
  const cutoff = now - windowMs;
  const hits = (windows.get(key) ?? []).filter((at) => at > cutoff);
  if (hits.length >= limit) {
    // 仍写回裁剪后的数组, 避免过期时间戳长期滞留
    windows.set(key, hits);
    return hits[0] + windowMs - now;
  }
  hits.push(now);
  windows.set(key, hits);
  return 0;
}
