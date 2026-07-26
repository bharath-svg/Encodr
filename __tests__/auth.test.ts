import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  authenticate,
  getUserIdFromRequest,
  issueAccessToken,
  issueTokens,
  verifyRefreshToken,
} from "@/lib/server/auth";

function createAuthenticatedRequest(token: string): Request {
  return new Request("http://localhost/api/jobs", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

describe("authentication", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("authenticates the hard-coded user without exposing the password", () => {
    const user = authenticate(
      " DEMO@ENCODR.DEV ",
      "password123",
    );

    expect(user).toEqual({
      id: "u_demo",
      email: "demo@encodr.dev",
      name: "Demo User",
    });

    expect(user).not.toHaveProperty("password");
  });

  it("rejects invalid login credentials", () => {
    expect(
      authenticate(
        "demo@encodr.dev",
        "wrong-password",
      ),
    ).toBeNull();

    expect(
      authenticate(
        "unknown@example.com",
        "password123",
      ),
    ).toBeNull();
  });
});

describe("token verification", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts an access token for protected requests", () => {
    const { accessToken } = issueTokens("u_demo");

    const request =
      createAuthenticatedRequest(accessToken);

    expect(
      getUserIdFromRequest(request),
    ).toBe("u_demo");
  });

  it("keeps access and refresh tokens separate", () => {
    const {
      accessToken,
      refreshToken,
    } = issueTokens("u_demo");

    expect(
      getUserIdFromRequest(
        createAuthenticatedRequest(refreshToken),
      ),
    ).toBeNull();

    expect(
      verifyRefreshToken(refreshToken),
    ).toBe("u_demo");

    expect(
      verifyRefreshToken(accessToken),
    ).toBeNull();
  });

  it("rejects a token whose payload has been modified", () => {
    const { accessToken } = issueTokens("u_demo");

    const [payload, signature] =
      accessToken.split(".");

    const modifiedPayload = `${payload}x`;
    const tamperedToken =
      `${modifiedPayload}.${signature}`;

    expect(
      getUserIdFromRequest(
        createAuthenticatedRequest(tamperedToken),
      ),
    ).toBeNull();
  });

  it("rejects an expired access token", () => {
    vi.useFakeTimers();

    vi.setSystemTime(
      new Date("2026-01-01T00:00:00Z"),
    );

    const accessToken =
      issueAccessToken("u_demo");

    expect(
      getUserIdFromRequest(
        createAuthenticatedRequest(accessToken),
      ),
    ).toBe("u_demo");

    // Access-token lifetime is 60 seconds.
    vi.setSystemTime(
      new Date("2026-01-01T00:01:01Z"),
    );

    expect(
      getUserIdFromRequest(
        createAuthenticatedRequest(accessToken),
      ),
    ).toBeNull();
  });

  it("rejects requests without a valid Bearer header", () => {
    const requestWithoutToken = new Request(
      "http://localhost/api/jobs",
    );

    const requestWithWrongScheme = new Request(
      "http://localhost/api/jobs",
      {
        headers: {
          Authorization: "Basic invalid-token",
        },
      },
    );

    expect(
      getUserIdFromRequest(requestWithoutToken),
    ).toBeNull();

    expect(
      getUserIdFromRequest(requestWithWrongScheme),
    ).toBeNull();
  });

  it("does not issue tokens for an unknown user", () => {
    expect(() => {
      issueTokens("u_missing");
    }).toThrow(
      "Cannot issue a token for unknown user",
    );
  });
});