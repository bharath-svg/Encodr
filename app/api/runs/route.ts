import { startRunSchema } from "@/lib/schemas";
import {
  error,
  json,
  withAuth,
} from "@/lib/server/http";
import { startRun } from "@/lib/server/store";

export async function POST(
  req: Request,
): Promise<Response> {
  return withAuth(req, async () => {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return error(
        400,
        "Request body must contain valid JSON",
      );
    }

    const validationResult =
      startRunSchema.safeParse(body);

    if (!validationResult.success) {
      return json(
        {
          detail: "Validation failed",
          fieldErrors:
            validationResult.error.flatten()
              .fieldErrors,
        },
        422,
      );
    }

    const record = startRun(
      validationResult.data.jobId,
    );

    if (!record) {
      return error(404, "Job not found");
    }

    return json(
      {
        runId: record.id,
      },
      201,
    );
  });
}