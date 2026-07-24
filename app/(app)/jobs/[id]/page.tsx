"use client";

import {
  use,
  useCallback,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";

import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";
import {
  jobKeys,
  runKeys,
  useJob,
  useRun,
  useStartRun,
} from "@/lib/client/hooks";
import { useRunStream } from "@/lib/client/use-run-stream";

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const jobQuery = useJob(id);
  const startRun = useStartRun();

  const [runId, setRunId] =
    useState<string | null>(null);

  useEffect(() => {
    const latestRunId =
      jobQuery.data?.latestRunId;

    if (latestRunId) {
      setRunId((current) =>
        current ?? latestRunId,
      );
    }
  }, [jobQuery.data?.latestRunId]);

  const runQuery = useRun(runId);

  const handleTerminal = useCallback(() => {
    const refreshes = [
      queryClient.invalidateQueries({
        queryKey: jobKeys.all,
      }),
      queryClient.invalidateQueries({
        queryKey: jobKeys.detail(id),
      }),
    ];

    if (runId) {
      refreshes.push(
        queryClient.invalidateQueries({
          queryKey: runKeys.detail(runId),
        }),
      );
    }

    void Promise.all(refreshes);
  }, [id, queryClient, runId]);

  const stream = useRunStream(
    runId,
    handleTerminal,
  );

  if (jobQuery.isLoading) {
    return (
      <p className="text-sm text-neutral-500">
        Loading job…
      </p>
    );
  }

  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="text-sm text-red-600">
        Job not found.{" "}
        <Link
          href="/jobs"
          className="underline"
        >
          Back to jobs
        </Link>
      </div>
    );
  }

  const job = jobQuery.data;

  const stage =
    stream.stage ??
    runQuery.data?.stage ??
    null;

  const progressPct =
    stream.stage !== null
      ? stream.progressPct
      : (runQuery.data?.progressPct ?? 0);

  const runError =
    stream.error ??
    runQuery.data?.error ??
    null;

  const result = runQuery.data?.result;

  const failed = stage === "FAILED";
  const completed = stage === "COMPLETED";

  const running =
    stage !== null &&
    stage !== "FAILED" &&
    stage !== "COMPLETED";

  async function startEncode() {
    const response =
      await startRun.mutateAsync(id);

    setRunId(response.runId);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/jobs"
        className="text-sm text-neutral-500 hover:underline"
      >
        ← All jobs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">
            {job.title}
          </h1>

          <p className="truncate text-sm text-neutral-500">
            {job.sourceUrl}
          </p>
        </div>

        <StatusBadge value={job.status} />
      </div>

      {!runId && (
        <section className="rounded-md border border-neutral-200 p-5">
          <h2 className="mb-2 font-semibold">
            Start encoding
          </h2>

          <p className="mb-4 text-sm text-neutral-500">
            Start a new transcode run for this
            media source.
          </p>

          <button
            type="button"
            onClick={() => {
              void startEncode();
            }}
            disabled={startRun.isPending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {startRun.isPending
              ? "Starting…"
              : "Start encode"}
          </button>

          {startRun.isError && (
            <p className="mt-3 text-sm text-red-600">
              {startRun.error instanceof Error
                ? startRun.error.message
                : "Could not start the run"}
            </p>
          )}
        </section>
      )}

      {runId && (
        <section className="space-y-5 rounded-md border border-neutral-200 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Encode progress
              </h2>

              <p className="text-xs text-neutral-500">
                Run ID: {runId}
              </p>
            </div>

            {stage && (
              <StatusBadge value={stage} />
            )}
          </div>

          <div className="space-y-2">
            <ProgressBar
              value={progressPct}
              failed={failed}
            />

            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">
                {stage ?? "Connecting…"}
              </span>

              <span className="font-medium">
                {progressPct}%
              </span>
            </div>
          </div>

          {running && (
            <p className="text-xs text-neutral-500">
              {stream.connected
                ? "Live progress connected"
                : "Connecting to live progress…"}
            </p>
          )}

          {runQuery.isError && (
            <p className="text-sm text-red-600">
              Could not load the run.
            </p>
          )}

          {runError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-4">
              <p className="font-medium text-red-700">
                Run failed
              </p>

              <p className="mt-1 text-sm text-red-600">
                {runError}
              </p>
            </div>
          )}

          {failed && (
            <button
              type="button"
              onClick={() => {
                void startEncode();
              }}
              disabled={startRun.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startRun.isPending
                ? "Retrying…"
                : "Retry encode"}
            </button>
          )}

          {stream.log.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Live log
              </h3>

              <div className="max-h-56 overflow-y-auto rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-100">
                {stream.log.map(
                  (message, index) => (
                    <p
                      key={`${index}-${message}`}
                      className="py-0.5"
                    >
                      {message}
                    </p>
                  ),
                )}
              </div>
            </div>
          )}

          {completed && result && (
            <div className="space-y-5">
              <div className="rounded-md border border-green-200 bg-green-50 p-4">
                <p className="font-medium text-green-700">
                  Encode completed
                </p>

                <p className="mt-1 text-sm text-green-600">
                  Duration: {result.durationSec} seconds
                </p>
              </div>

              <div>
                <h3 className="mb-2 font-semibold">
                  Output renditions
                </h3>

                <div className="overflow-hidden rounded-md border border-neutral-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-neutral-50">
                      <tr>
                        <th className="px-3 py-2">
                          Label
                        </th>
                        <th className="px-3 py-2">
                          Resolution
                        </th>
                        <th className="px-3 py-2">
                          Size
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-neutral-200">
                      {result.renditions.map(
                        (rendition) => (
                          <tr key={rendition.label}>
                            <td className="px-3 py-2 font-medium">
                              {rendition.label}
                            </td>

                            <td className="px-3 py-2">
                              {rendition.width} ×{" "}
                              {rendition.height}
                            </td>

                            <td className="px-3 py-2">
                              {rendition.sizeMb} MB
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {result.warnings.length > 0 && (
                <div>
                  <h3 className="mb-2 font-semibold">
                    Warnings
                  </h3>

                  <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700">
                    {result.warnings.map(
                      (warning) => (
                        <li key={warning}>
                          {warning}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}