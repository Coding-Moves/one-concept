import { describe, it, expect, vi } from "vitest";
import { ownerDemoApi, demoOverview } from "./ownerDemo";
import type { ReportPage, OperationalEvent } from "./ownerTypes";
describe("isolated owner demo", () => {
  it("never calls a network provider and refuses mutations", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("No network"));
    try {
      for (const path of ["overview", "reviewers", "operations", "events"])
        await ownerDemoApi.request("/owner/" + path);
      await expect(
        ownerDemoApi.request("/owner/operations", "POST"),
      ).rejects.toThrow("read-only");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("has deterministic totals, filters and non-overlapping pages", async () => {
    expect(demoOverview()).toEqual(demoOverview());
    const report = demoOverview();
    expect(report.metrics.active_day).toBe(report.trend.at(-1)!.active);
    expect(report.trend.every((d) => d.active <= d.lessons + d.reviews)).toBe(
      true,
    );
    const a =
      await ownerDemoApi.request<ReportPage<OperationalEvent>>("/owner/events");
    const b = await ownerDemoApi.request<ReportPage<OperationalEvent>>(
      "/owner/events?cursor=" + a.next_cursor,
    );
    expect(a.items.length).toBe(25);
    expect(b.items.length).toBe(11);
    expect(new Set([...a.items, ...b.items].map((x) => x.key)).size).toBe(36);
    const correlation = a.items[0].correlation_id!;
    for (const value of [correlation, correlation.replaceAll("-", "")]) {
      const matching = await ownerDemoApi.request<ReportPage<OperationalEvent>>(
        "/owner/events?correlation=" + value,
      );
      expect(matching.items).toEqual([a.items[0]]);
    }
    const errors = await ownerDemoApi.request<ReportPage<OperationalEvent>>(
      "/owner/events?severity=error&source=pool_topup",
    );
    expect(errors.items.length).toBeGreaterThan(0);
    expect(
      errors.items.every(
        (e) => e.source === "pool_topup" && e.severity === "error",
      ),
    ).toBe(true);
    const empty = await ownerDemoApi.request<ReportPage<OperationalEvent>>(
      "/owner/events?search=missing",
    );
    expect(empty.items).toEqual([]);
  });
});
