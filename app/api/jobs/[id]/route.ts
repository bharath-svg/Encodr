import { error, json, withAuth } from "@/lib/server/http";
import { getJob } from "@/lib/server/store";

interface JobRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  req: Request,
  context: JobRouteContext,
): Promise<Response> {
  return withAuth(req, async () => {
    const { id } = await context.params;
    const job = getJob(id);

    if (!job) {
      return error(404, "Job not found");
    }

    return json(job);
  });
}