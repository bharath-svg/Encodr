import {
  error,
  json,
  withAuth,
} from "@/lib/server/http";
import { getRun } from "@/lib/server/store";

interface RunRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  req: Request,
  context: RunRouteContext,
): Promise<Response> {
  return withAuth(req, async () => {
    const { id } = await context.params;

    const run = getRun(id);

    if (!run) {
      return error(404, "Run not found");
    }

    return json(run);
  });
}