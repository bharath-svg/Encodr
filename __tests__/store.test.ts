import { describe, expect, it } from "vitest";

import {
  computeRun,
  FAIL_URL,
  type RunRecord,
} from "@/lib/server/store";

const STARTED_AT = 1_000_000;

function createRunRecord(
  sourceUrl = "https://cdn.example.com/videos/sample.mp4",
): RunRecord {
  return {
    id: "r_test",
    jobId: "j_test",
    sourceUrl,
    startedAt: STARTED_AT,
  };
}

describe("computeRun", () => {
  it("moves a normal run through the expected stages", () => {
    const record = createRunRecord();

    expect(
      computeRun(record, STARTED_AT).stage,
    ).toBe("QUEUED");

    expect(
      computeRun(record, STARTED_AT + 3_000).stage,
    ).toBe("DOWNLOADING");

    expect(
      computeRun(record, STARTED_AT + 9_000).stage,
    ).toBe("PROBING");

    expect(
      computeRun(record, STARTED_AT + 15_000).stage,
    ).toBe("TRANSCODING");

    expect(
      computeRun(record, STARTED_AT + 28_000).stage,
    ).toBe("PACKAGING");

    expect(
      computeRun(record, STARTED_AT + 33_000).stage,
    ).toBe("COMPLETED");
  });

  it("returns completed results for a successful run", () => {
    const record = createRunRecord();

    const run = computeRun(
      record,
      STARTED_AT + 33_000,
    );

    expect(run.stage).toBe("COMPLETED");
    expect(run.progressPct).toBe(100);
    expect(run.error).toBeUndefined();

    expect(run.result).toBeDefined();
    expect(run.result?.durationSec).toBe(124);
    expect(run.result?.renditions).toHaveLength(3);

    expect(run.result?.renditions[0]).toEqual({
      label: "1080p",
      width: 1920,
      height: 1080,
      sizeMb: 84.2,
    });
  });

  it("fails the corrupt source URL after probing", () => {
    const record = createRunRecord(FAIL_URL);

    const run = computeRun(
      record,
      STARTED_AT + 13_000,
    );

    expect(run.stage).toBe("FAILED");
    expect(run.progressPct).toBe(35);
    expect(run.error).toContain("corrupt");
    expect(run.result).toBeUndefined();
  });

  it("does not allow negative elapsed time", () => {
    const record = createRunRecord();

    const run = computeRun(
      record,
      STARTED_AT - 5_000,
    );

    expect(run.stage).toBe("QUEUED");
    expect(run.progressPct).toBeGreaterThanOrEqual(0);
  });
});