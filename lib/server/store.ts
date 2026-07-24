import { randomUUID } from "node:crypto";

import {
  type EncodeResult,
  type EncodeRun,
  type Job,
  type JobStatus,
} from "@/lib/types";

// In-memory store. A single Node process in `next dev`, so module-level Maps are fine.

const jobs = new Map<string, Job>();
const runs = new Map<string, RunRecord>();

interface RunRecord {
  id: string;
  jobId: string;
  sourceUrl: string;
  startedAt: number; // epoch milliseconds
}

/** The "magic" source URL that always fails partway. */
export const FAIL_URL =
  "https://cdn.example.com/videos/corrupt.mp4";

const QUEUED_END_MS = 2_000;
const DOWNLOADING_END_MS = 8_000;
const PROBING_END_MS = 12_000;
const TRANSCODING_END_MS = 26_000;
const PACKAGING_END_MS = 32_000;

/**
 * Derive a run's current state from elapsed time.
 *
 * This function does not create intervals or mutate the record, which makes
 * it deterministic and easy to test by passing a custom `now`.
 */
export function computeRun(
  record: RunRecord,
  now: number = Date.now(),
): EncodeRun {
  const elapsedMs = Math.max(
    0,
    now - record.startedAt,
  );

  const baseRun = {
    id: record.id,
    jobId: record.jobId,
  };

  if (elapsedMs < QUEUED_END_MS) {
    return {
      ...baseRun,
      stage: "QUEUED",
      progressPct: progressBetween(
        elapsedMs,
        0,
        QUEUED_END_MS,
        0,
        5,
      ),
    };
  }

  if (elapsedMs < DOWNLOADING_END_MS) {
    return {
      ...baseRun,
      stage: "DOWNLOADING",
      progressPct: progressBetween(
        elapsedMs,
        QUEUED_END_MS,
        DOWNLOADING_END_MS,
        5,
        25,
      ),
    };
  }

  if (elapsedMs < PROBING_END_MS) {
    return {
      ...baseRun,
      stage: "PROBING",
      progressPct: progressBetween(
        elapsedMs,
        DOWNLOADING_END_MS,
        PROBING_END_MS,
        25,
        35,
      ),
    };
  }

  if (record.sourceUrl === FAIL_URL) {
    return {
      ...baseRun,
      stage: "FAILED",
      progressPct: 35,
      error:
        "Media probing failed because the source file appears to be corrupt.",
    };
  }

  if (elapsedMs < TRANSCODING_END_MS) {
    return {
      ...baseRun,
      stage: "TRANSCODING",
      progressPct: progressBetween(
        elapsedMs,
        PROBING_END_MS,
        TRANSCODING_END_MS,
        35,
        85,
      ),
    };
  }

  if (elapsedMs < PACKAGING_END_MS) {
    return {
      ...baseRun,
      stage: "PACKAGING",
      progressPct: progressBetween(
        elapsedMs,
        TRANSCODING_END_MS,
        PACKAGING_END_MS,
        85,
        99,
      ),
    };
  }

  return {
    ...baseRun,
    stage: "COMPLETED",
    progressPct: 100,
    result: createEncodeResult(),
  };
}

function progressBetween(
  elapsedMs: number,
  startMs: number,
  endMs: number,
  startProgress: number,
  endProgress: number,
): number {
  const durationMs = endMs - startMs;

  const ratio = Math.min(
    1,
    Math.max(
      0,
      (elapsedMs - startMs) / durationMs,
    ),
  );

  return Math.round(
    startProgress +
      (endProgress - startProgress) * ratio,
  );
}

function createEncodeResult(): EncodeResult {
  return {
    durationSec: 124,
    renditions: [
      {
        label: "1080p",
        width: 1920,
        height: 1080,
        sizeMb: 84.2,
      },
      {
        label: "720p",
        width: 1280,
        height: 720,
        sizeMb: 48.5,
      },
      {
        label: "480p",
        width: 854,
        height: 480,
        sizeMb: 24.1,
      },
    ],
    warnings: [
      "Source audio loudness was normalized.",
    ],
  };
}

// --- job/run CRUD ---

export function listJobs(): Job[] {
  const now = Date.now();

  return [...jobs.values()]
    .map((job) => syncJobStatus(job, now))
    .sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
}

export function getJob(id: string): Job | null {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  return syncJobStatus(job, Date.now());
}

export function createJob(input: {
  sourceUrl: string;
  title?: string;
}): Job {
  const id = `j_${randomUUID().slice(0, 8)}`;
  const sourceUrl = input.sourceUrl.trim();

  const job: Job = {
    id,
    title:
      input.title?.trim() ||
      deriveTitle(sourceUrl),
    sourceUrl,
    status: "NEW",
    createdAt: new Date().toISOString(),
  };

  jobs.set(id, job);

  return job;
}

function deriveTitle(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname.replace(
      /\/+$/,
      "",
    );

    const last = path
      .split("/")
      .filter(Boolean)
      .pop();

    return last
      ? decodeURIComponent(last)
      : "Untitled encode";
  } catch {
    return "Untitled encode";
  }
}

export function startRun(
  jobId: string,
): RunRecord | null {
  const job = jobs.get(jobId);

  if (!job) {
    return null;
  }

  const record: RunRecord = {
    id: `r_${randomUUID().slice(0, 8)}`,
    jobId,
    sourceUrl: job.sourceUrl,
    startedAt: Date.now(),
  };

  runs.set(record.id, record);

  job.latestRunId = record.id;
  job.status = "RUNNING";

  return record;
}

export function getRunRecord(
  id: string,
): RunRecord | null {
  return runs.get(id) ?? null;
}

export function getRun(
  id: string,
  now: number = Date.now(),
): EncodeRun | null {
  const record = runs.get(id);

  if (!record) {
    return null;
  }

  const run = computeRun(record, now);

  syncJobStatusFromRun(run);

  return run;
}

function syncJobStatus(
  job: Job,
  now: number,
): Job {
  if (!job.latestRunId) {
    return job;
  }

  const record = runs.get(job.latestRunId);

  if (!record) {
    return job;
  }

  const run = computeRun(record, now);

  job.status = getJobStatus(run);

  return job;
}

function syncJobStatusFromRun(
  run: EncodeRun,
): void {
  const job = jobs.get(run.jobId);

  if (
    !job ||
    job.latestRunId !== run.id
  ) {
    return;
  }

  job.status = getJobStatus(run);
}

function getJobStatus(
  run: EncodeRun,
): JobStatus {
  if (run.stage === "COMPLETED") {
    return "COMPLETED";
  }

  if (run.stage === "FAILED") {
    return "FAILED";
  }

  return "RUNNING";
}

export type { RunRecord };