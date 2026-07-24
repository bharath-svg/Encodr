import type { User } from "@/lib/types";

// Mock auth for the exercise — no real identity provider, no database.
//
// TODO(candidate): implement token issuance + verification.
//  - issueTokens(): mint a SHORT-LIVED access token (~60s, so the client's refresh path is
//    observable) and a longer-lived refresh token. A signed JWT or an opaque token you verify
//    server-side both work.
//  - verify the access token in getUserIdFromRequest(), and the refresh token in the refresh route.
//  - Remember: native EventSource can't send an Authorization header — decide how the SSE route
//    will authenticate (header via fetch-event-source? short-lived query token? cookie?).

// The one hard-coded user. Documented in the README.
import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";



// The project must run without manual environment setup, so we provide a
// development fallback. A production deployment should always provide
// ENCODR_AUTH_SECRET.
const TOKEN_SECRET =
  process.env.ENCODR_AUTH_SECRET?.trim() ||
  "encodr-take-home-development-secret-v1";

const ACCESS_TOKEN_TTL_SECONDS = 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

type TokenKind = "access" | "refresh";

interface TokenPayload {
  sub: string;
  kind: TokenKind;
  iat: number;
  exp: number;
  jti: string;
}

// Mock auth for the exercise — no real identity provider or database.
const USERS: (User & { password: string })[] = [
  {
    id: "u_demo",
    email: "demo@encodr.dev",
    name: "Demo User",
    password: "password123",
  },
];

export function authenticate(
  email: string,
  password: string,
): User | null {
  const normalizedEmail = email.trim().toLowerCase();

  const user = USERS.find(
    (candidate) => candidate.email.toLowerCase() === normalizedEmail,
  );

  if (!user || user.password !== password) {
    return null;
  }

  const { password: _password, ...safeUser } = user;

  return safeUser;
}

export function findUser(id: string): User | null {
  const user = USERS.find((candidate) => candidate.id === id);

  if (!user) {
    return null;
  }

  const { password: _password, ...safeUser } = user;

  return safeUser;
}

export function issueTokens(
  userId: string,
): {
  accessToken: string;
  refreshToken: string;
} {
  return {
    accessToken: issueToken(
      userId,
      "access",
      ACCESS_TOKEN_TTL_SECONDS,
    ),
    refreshToken: issueToken(
      userId,
      "refresh",
      REFRESH_TOKEN_TTL_SECONDS,
    ),
  };
}

export function issueAccessToken(userId: string): string {
  return issueToken(
    userId,
    "access",
    ACCESS_TOKEN_TTL_SECONDS,
  );
}

/** Return the authenticated userId from the request, or null. */
export function getUserIdFromRequest(req: Request): string | null {
  const token = readBearerToken(req);

  if (!token) {
    return null;
  }

  return verifyToken(token, "access");
}

/** Verify a refresh token and return its subject (userId), or null. */
export function verifyRefreshToken(token: string): string | null {
  return verifyToken(token, "refresh");
}

function issueToken(
  userId: string,
  kind: TokenKind,
  ttlSeconds: number,
): string {
  if (!findUser(userId)) {
    throw new Error(
      `Cannot issue a token for unknown user: ${userId}`,
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);

  const payload: TokenPayload = {
    sub: userId,
    kind,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: randomUUID(),
  };

  const payloadSegment = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");

  const signatureSegment = createSignature(
    payloadSegment,
  ).toString("base64url");

  return `${payloadSegment}.${signatureSegment}`;
}

function verifyToken(
  token: string,
  expectedKind: TokenKind,
): string | null {
  const segments = token.split(".");

  if (segments.length !== 2) {
    return null;
  }

  const [payloadSegment, signatureSegment] = segments;

  if (!payloadSegment || !signatureSegment) {
    return null;
  }

  const expectedSignature = createSignature(payloadSegment);

  let receivedSignature: Buffer;

  try {
    receivedSignature = Buffer.from(
      signatureSegment,
      "base64url",
    );
  } catch {
    return null;
  }

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(
      receivedSignature,
      expectedSignature,
    )
  ) {
    return null;
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(
      Buffer.from(
        payloadSegment,
        "base64url",
      ).toString("utf8"),
    );
  } catch {
    return null;
  }

  if (!isTokenPayload(parsedPayload)) {
    return null;
  }

  const currentTime = Math.floor(Date.now() / 1000);

  if (parsedPayload.kind !== expectedKind) {
    return null;
  }

  if (parsedPayload.exp <= currentTime) {
    return null;
  }

  if (parsedPayload.iat > currentTime) {
    return null;
  }

  if (parsedPayload.exp <= parsedPayload.iat) {
    return null;
  }

  if (!findUser(parsedPayload.sub)) {
    return null;
  }

  return parsedPayload.sub;
}

function createSignature(payloadSegment: string): Buffer {
  return createHmac("sha256", TOKEN_SECRET)
    .update(payloadSegment, "utf8")
    .digest();
}

function readBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const parts = authorization.trim().split(/\s+/);

  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;

  if (
    scheme.toLowerCase() !== "bearer" ||
    !token
  ) {
    return null;
  }

  return token;
}

function isTokenPayload(
  value: unknown,
): value is TokenPayload {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.sub === "string" &&
    (payload.kind === "access" ||
      payload.kind === "refresh") &&
    typeof payload.iat === "number" &&
    Number.isInteger(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp) &&
    typeof payload.jti === "string"
  );
}
