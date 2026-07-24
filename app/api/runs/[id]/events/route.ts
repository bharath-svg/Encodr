import {
  isTerminalStage,
  type EncodeRun,
  type RunEvent,
} from "@/lib/types";
import {
  error,
  withAuth,
} from "@/lib/server/http";
import { getRun } from "@/lib/server/store";

export const dynamic = "force-dynamic";

interface RunEventsRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  req: Request,
  context: RunEventsRouteContext,
): Promise<Response> {
  return withAuth(req, async () => {
    const { id } = await context.params;

    const initialRun = getRun(id);

    if (!initialRun) {
      return error(404, "Run not found");
    }

    const encoder = new TextEncoder();

    let interval: ReturnType<typeof setInterval> | null =
      null;

    let controller:
      | ReadableStreamDefaultController<Uint8Array>
      | null = null;

    let closed = false;

    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;

      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      req.signal.removeEventListener(
        "abort",
        cleanup,
      );

      try {
        controller?.close();
      } catch {
        // The stream may already have been closed by the client.
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;

        req.signal.addEventListener(
          "abort",
          cleanup,
          {
            once: true,
          },
        );

        const sendCurrentState = () => {
          if (closed) {
            return;
          }

          const run = getRun(id);

          if (!run) {
            cleanup();
            return;
          }

          const event = createRunEvent(run);

          streamController.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(event)}\n\n`,
            ),
          );

          if (isTerminalStage(run.stage)) {
            cleanup();
          }
        };

        // Send immediately so the client does not wait one second
        // for its first progress update.
        sendCurrentState();

        if (!closed) {
          interval = setInterval(
            sendCurrentState,
            1_000,
          );
        }
      },

      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type":
          "text/event-stream; charset=utf-8",
        "cache-control":
          "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}

function createRunEvent(run: EncodeRun): RunEvent {
  return {
    stage: run.stage,
    progressPct: run.progressPct,
    message: createProgressMessage(run),
    ...(run.error
      ? {
          error: run.error,
        }
      : {}),
  };
}

function createProgressMessage(
  run: EncodeRun,
): string {
  switch (run.stage) {
    case "QUEUED":
      return "Run queued";

    case "DOWNLOADING":
      return `Downloading source media — ${run.progressPct}%`;

    case "PROBING":
      return `Inspecting media streams — ${run.progressPct}%`;

    case "TRANSCODING":
      return `Transcoding renditions — ${run.progressPct}%`;

    case "PACKAGING":
      return `Packaging output renditions — ${run.progressPct}%`;

    case "COMPLETED":
      return "Encode completed successfully";

    case "FAILED":
      return run.error ?? "Encode run failed";
  }
}