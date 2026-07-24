"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";

import { getAccessToken } from "@/lib/client/token-store";
import {
  isTerminalStage,
  type RunEvent,
  type Stage,
} from "@/lib/types";

export interface RunStreamState {
  stage: Stage | null;
  progressPct: number;
  log: string[];
  error: string | null;
  connected: boolean;
  done: boolean;
}

const initialState: RunStreamState = {
  stage: null,
  progressPct: 0,
  log: [],
  error: null,
  connected: false,
  done: false,
};

const VALID_STAGES: Stage[] = [
  "QUEUED",
  "DOWNLOADING",
  "PROBING",
  "TRANSCODING",
  "PACKAGING",
  "COMPLETED",
  "FAILED",
];

function isRunEvent(value: unknown): value is RunEvent {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.stage === "string" &&
    VALID_STAGES.includes(event.stage as Stage) &&
    typeof event.progressPct === "number" &&
    Number.isFinite(event.progressPct) &&
    typeof event.message === "string" &&
    (
      event.error === undefined ||
      typeof event.error === "string"
    )
  );
}

export function useRunStream(
  runId: string | null,
  onTerminal?: () => void,
): RunStreamState {
  const [state, setState] =
    useState<RunStreamState>(initialState);

  /*
   * Keep the latest callback without reconnecting the SSE stream whenever
   * the parent component creates a new callback reference.
   */
  const onTerminalRef = useRef(onTerminal);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    if (!runId) {
      setState(initialState);
      return;
    }

    const controller = new AbortController();

    let mounted = true;
    let terminalReceived = false;

    setState(initialState);

    const accessToken = getAccessToken();

    if (!accessToken) {
      setState({
        ...initialState,
        error: "You must be signed in to view run progress.",
      });

      return;
    }

    void fetchEventSource(
      `/api/runs/${runId}/events`,
      {
        method: "GET",
        signal: controller.signal,
        openWhenHidden: true,

        headers: {
          Authorization: `Bearer ${accessToken}`,
        },

        async onopen(response) {
          if (!response.ok) {
            if (response.status === 401) {
              throw new Error(
                "Run stream authentication failed. Please sign in again.",
              );
            }

            throw new Error(
              `Could not open the run stream (${response.status}).`,
            );
          }

          const contentType =
            response.headers.get("content-type");

          if (
            !contentType?.includes(
              "text/event-stream",
            )
          ) {
            throw new Error(
              "The server did not return an SSE stream.",
            );
          }

          if (!mounted) {
            return;
          }

          setState((current) => ({
            ...current,
            connected: true,
            error: null,
          }));
        },

        onmessage(message) {
          if (
            !mounted ||
            !message.data
          ) {
            return;
          }

          let parsedEvent: unknown;

          try {
            parsedEvent = JSON.parse(message.data);
          } catch {
            setState((current) => ({
              ...current,
              error:
                "Received an invalid progress event.",
            }));

            return;
          }

          if (!isRunEvent(parsedEvent)) {
            setState((current) => ({
              ...current,
              error:
                "Received an invalid progress event.",
            }));

            return;
          }

          const terminal =
            isTerminalStage(parsedEvent.stage);

          setState((current) => ({
            stage: parsedEvent.stage,
            progressPct: parsedEvent.progressPct,
            log: [
              ...current.log,
              parsedEvent.message,
            ],
            error:
              parsedEvent.error ??
              (
                parsedEvent.stage === "FAILED"
                  ? parsedEvent.message
                  : null
              ),
            connected: !terminal,
            done: terminal,
          }));

          if (terminal) {
            terminalReceived = true;

            /*
             * Close the browser-side connection after COMPLETED or FAILED.
             */
            controller.abort();

            /*
             * Allows the job-detail page to refetch the authoritative run and
             * job data, including completed results and final job status.
             */
            onTerminalRef.current?.();
          }
        },

        onclose() {
          if (
            !mounted ||
            terminalReceived ||
            controller.signal.aborted
          ) {
            return;
          }

          setState((current) => ({
            ...current,
            connected: false,
            error:
              current.error ??
              "The run progress stream closed unexpectedly.",
          }));
        },

        onerror(error) {
          if (
            !mounted ||
            controller.signal.aborted
          ) {
            return;
          }

          setState((current) => ({
            ...current,
            connected: false,
            error:
              error instanceof Error
                ? error.message
                : "The run progress stream failed.",
          }));

          /*
           * fetch-event-source reconnects when onerror returns normally.
           * Throwing stops automatic reconnection. Reconnection is optional
           * stretch work in this assignment.
           */
          throw error;
        },
      },
    ).catch((error: unknown) => {
      if (
        !mounted ||
        controller.signal.aborted
      ) {
        return;
      }

      setState((current) => ({
        ...current,
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "The run progress stream failed.",
      }));
    });

    /*
     * Cleanup runs when:
     * - the component unmounts;
     * - the user navigates away;
     * - runId changes.
     */
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [runId]);

  return state;
}