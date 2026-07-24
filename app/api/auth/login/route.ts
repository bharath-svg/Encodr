import {
  authenticate,
  issueTokens,
} from "@/lib/server/auth";
import { error, json } from "@/lib/server/http";
import { loginSchema } from "@/lib/schemas";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return error(400, "Request body must contain valid JSON");
  }

  const validationResult = loginSchema.safeParse(body);

  if (!validationResult.success) {
    const firstIssue = validationResult.error.issues[0];

    return error(
      400,
      firstIssue?.message ?? "Invalid login request",
    );
  }

  const { email, password } = validationResult.data;

  const user = authenticate(email, password);

  if (!user) {
    return error(401, "Invalid email or password");
  }

  const { accessToken, refreshToken } = issueTokens(user.id);

  return json({
    accessToken,
    refreshToken,
    user,
  });
}