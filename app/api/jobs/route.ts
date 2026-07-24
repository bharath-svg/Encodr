import { createJobSchema } from "@/lib/schemas";
import { error, json, withAuth } from "@/lib/server/http";
import { createJob, listJobs } from "@/lib/server/store";

export async function GET(req: Request): Promise<Response> {
  return withAuth(req, () => {
    return json(listJobs());
  });
}

export async function POST(req: Request): Promise<Response> {
  return withAuth(req, async () => {
    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return error(400, "Request body must contain valid JSON");
    }

    const validationResult = createJobSchema.safeParse(body);

    if (!validationResult.success) {
      return json(
        {
          detail: "Validation failed",
          fieldErrors: validationResult.error.flatten().fieldErrors,
        },
        422,
      );
    }

    const job = createJob(validationResult.data);

    return json(job, 201);
  });
}