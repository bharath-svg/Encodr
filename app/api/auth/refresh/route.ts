import {
  issueAccessToken,
  verifyRefreshToken,
} from "@/lib/server/auth";
import { error, json } from "@/lib/server/http";
import { refreshTokenSchema } from "@/lib/schemas";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return error(400, "Request body must contain valid JSON");
  }

  const validationResult = refreshTokenSchema.safeParse(body);

  if (!validationResult.success) {
    const firstIssue = validationResult.error.issues[0];

    return error(
      400,
      firstIssue?.message ?? "Invalid refresh request",
    );
  }

  const userId = verifyRefreshToken(
    validationResult.data.refreshToken,
  );

  if (!userId) {
    return error(401, "Invalid or expired refresh token");
  }

  const accessToken = issueAccessToken(userId);

  return json({ accessToken });
}