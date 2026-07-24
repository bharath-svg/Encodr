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
    typeof event.progressPct === "number" &&
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

    void fetchEventSource(
      `/api/runs/${runId}/events`,
      {
        method: "GET",
        signal: controller.signal,

        headers: {
          Authorization:
            `Bearer ${getAccessToken() ?? ""}`,
        },

        async onopen(response) {
          if (!response.ok) {
            throw new Error(
              response.status === 401
                ? "Run stream authentication failed"
                : `Could not open run stream (${response.status})`,
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
              "Server did not return an SSE stream",
            );
          }

          if (mounted) {
            setState((current) => ({
              ...current,
              connected: true,
              error: null,
            }));
          }
        },

        onmessage(message) {
          if (
            !mounted ||
            !message.data
          ) {
            return;
          }

          let parsed: unknown;

          try {
            parsed = JSON.parse(message.data);
          } catch {
            setState((current) => ({
              ...current,
              error:
                "Received an invalid progress event",
            }));
            return;
          }

          if (!isRunEvent(parsed)) {
            setState((current) => ({
              ...current,
              error:
                "Received an invalid progress event",
            }));
            return;
          }

          const terminal =
            isTerminalStage(parsed.stage);

          setState((current) => ({
            stage: parsed.stage,
            progressPct: parsed.progressPct,
            log: [
              ...current.log,
              parsed.message,
            ],
            error:
              parsed.error ??
              (
                parsed.stage === "FAILED"
                  ? parsed.message
                  : null
              ),
            connected: !terminal,
            done: terminal,
          }));

          if (terminal) {
            terminalReceived = true;
            controller.abort();
            onTerminalRef.current?.();
          }
        },

        onclose() {
          if (
            mounted &&
            !terminalReceived
          ) {
            setState((current) => ({
              ...current,
              connected: false,
              error:
                current.error ??
                "Run progress stream closed unexpectedly",
            }));
          }
        },

        onerror(error) {
          if (
            controller.signal.aborted ||
            !mounted
          ) {
            return;
          }

          setState((current) => ({
            ...current,
            connected: false,
            error:
              error instanceof Error
                ? error.message
                : "Run progress stream failed",
          }));

          // Throwing prevents automatic reconnection.
          // Reconnection is optional stretch work.
          throw error;
        },
      },
    ).catch((error: unknown) => {
      if (
        controller.signal.aborted ||
        !mounted
      ) {
        return;
      }

      setState((current) => ({
        ...current,
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Run progress stream failed",
      }));
    });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [runId]);

  return state;
}