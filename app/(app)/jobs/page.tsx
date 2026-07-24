"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { StatusBadge } from "@/components/status-badge";
import { ApiError } from "@/lib/client/api";
import {
  useCreateJob,
  useJobs,
} from "@/lib/client/hooks";
import {
  createJobSchema,
  type CreateJobInput,
} from "@/lib/schemas";

export default function JobsPage() {
  const jobs = useJobs();
  const createJob = useCreateJob();

  const [formError, setFormError] =
    useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: {
      errors,
      isSubmitting,
    },
  } = useForm<CreateJobInput>({
    resolver: zodResolver(createJobSchema),
    defaultValues: {
      sourceUrl: "",
      title: "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    try {
      await createJob.mutateAsync(values);
      reset();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.fieldErrors
      ) {
        const sourceUrlError =
          error.fieldErrors.sourceUrl?.[0];

        const titleError =
          error.fieldErrors.title?.[0];

        if (sourceUrlError) {
          setError("sourceUrl", {
            type: "server",
            message: sourceUrlError,
          });
        }

        if (titleError) {
          setError("title", {
            type: "server",
            message: titleError,
          });
        }

        return;
      }

      setFormError(
        error instanceof Error
          ? error.message
          : "Could not create the job",
      );
    }
  });

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-4 text-xl font-semibold">
          New encode job
        </h1>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-md border border-neutral-200 p-4"
          noValidate
        >
          <div>
            <label
              htmlFor="sourceUrl"
              className="mb-1 block text-sm font-medium"
            >
              Source URL
            </label>

            <input
              id="sourceUrl"
              {...register("sourceUrl")}
              type="url"
              placeholder="https://cdn.example.com/videos/sample.mp4"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />

            {errors.sourceUrl && (
              <p className="mt-1 text-xs text-red-600">
                {errors.sourceUrl.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="title"
              className="mb-1 block text-sm font-medium"
            >
              Title{" "}
              <span className="font-normal text-neutral-400">
                (optional)
              </span>
            </label>

            <input
              id="title"
              {...register("title")}
              type="text"
              placeholder="Homepage promotional video"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />

            {errors.title && (
              <p className="mt-1 text-xs text-red-600">
                {errors.title.message}
              </p>
            )}
          </div>

          {formError && (
            <p className="text-sm text-red-600">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting
              ? "Creating job…"
              : "Create job"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">
          Jobs
        </h2>

        {jobs.isLoading && (
          <p className="text-sm text-neutral-500">
            Loading jobs…
          </p>
        )}

        {jobs.isError && (
          <div className="text-sm text-red-600">
            Couldn’t load jobs.{" "}
            <button
              type="button"
              onClick={() => {
                void jobs.refetch();
              }}
              className="underline"
            >
              Retry
            </button>
          </div>
        )}

        {jobs.data?.length === 0 && (
          <p className="text-sm text-neutral-500">
            No jobs yet.
          </p>
        )}

        {jobs.data && jobs.data.length > 0 && (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
            {jobs.data.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {job.title}
                    </p>

                    <p className="truncate text-xs text-neutral-500">
                      {job.sourceUrl}
                    </p>
                  </div>

                  <StatusBadge value={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}