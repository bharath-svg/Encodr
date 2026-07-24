"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "@/lib/client/api";
import type { CreateJobInput } from "@/lib/schemas";
import type { EncodeRun, Job } from "@/lib/types";

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
};

export const runKeys = {
  detail: (id: string) => ["runs", id] as const,
};

interface StartRunResponse {
  runId: string;
}

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: ({ signal }) =>
      api.get<Job[]>("/api/jobs", signal),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: ({ signal }) =>
      api.get<Job>(`/api/jobs/${id}`, signal),
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateJobInput) =>
      api.post<Job>("/api/jobs", input),

    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: jobKeys.all,
      });
    },
  });
}

export function useStartRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) =>
      api.post<StartRunResponse>("/api/runs", {
        jobId,
      }),

    onSuccess: async (_response, jobId) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: jobKeys.all,
        }),
        queryClient.invalidateQueries({
          queryKey: jobKeys.detail(jobId),
        }),
      ]);
    },
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["runs", runId],

    queryFn: ({ signal }) => {
      if (!runId) {
        throw new Error("runId is required");
      }

      return api.get<EncodeRun>(
        `/api/runs/${runId}`,
        signal,
      );
    },

    enabled: Boolean(runId),
  });
}

/** Imperative one-shot fetch of a run's current state. */
export function fetchRun(runId: string) {
  return api.get<EncodeRun>(
    `/api/runs/${runId}`,
  );
}