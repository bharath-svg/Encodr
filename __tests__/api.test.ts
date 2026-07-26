import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  api,
  ApiError,
  AUTH_LOGOUT_EVENT,
} from "@/lib/client/api";

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/client/token-store";

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("API silent refresh", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearTokens();
    window.localStorage.clear();

    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearTokens();
    window.localStorage.clear();

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes the access token and retries the original request once", async () => {
    setTokens({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });

    fetchMock
      // First protected request fails.
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: "Unauthorized",
          },
          401,
        ),
      )

      // Refresh request succeeds.
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: "new-access-token",
        }),
      )

      // Retried protected request succeeds.
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "j_test",
            title: "Test video",
          },
        ]),
      );

    const jobs = await api.get<
      Array<{
        id: string;
        title: string;
      }>
    >("/api/jobs");

    expect(jobs).toEqual([
      {
        id: "j_test",
        title: "Test video",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/jobs",
      expect.objectContaining({
        headers: {
          authorization:
            "Bearer expired-access-token",
        },
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/refresh",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          refreshToken: "valid-refresh-token",
        }),
      }),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/jobs",
      expect.objectContaining({
        headers: {
          authorization: "Bearer new-access-token",
        },
      }),
    );

    expect(getAccessToken()).toBe(
      "new-access-token",
    );

    expect(getRefreshToken()).toBe(
      "valid-refresh-token",
    );
  });

  it("shares one refresh request between concurrent 401 responses", async () => {
    setTokens({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });

    let refreshCalls = 0;

    let resolveRefresh!: (
      response: Response,
    ) => void;

    const pendingRefresh =
      new Promise<Response>((resolve) => {
        resolveRefresh = resolve;
      });

    fetchMock.mockImplementation(
      (
        input: RequestInfo | URL,
        options?: RequestInit,
      ): Promise<Response> => {
        const path = String(input);

        if (path === "/api/auth/refresh") {
          refreshCalls += 1;
          return pendingRefresh;
        }

        const headers = options?.headers as
          | Record<string, string>
          | undefined;

        if (
          headers?.authorization ===
          "Bearer expired-access-token"
        ) {
          return Promise.resolve(
            jsonResponse(
              {
                detail: "Unauthorized",
              },
              401,
            ),
          );
        }

        return Promise.resolve(
          jsonResponse({
            success: true,
          }),
        );
      },
    );

    const firstRequest = api.get<{
      success: boolean;
    }>("/api/jobs");

    const secondRequest = api.get<{
      success: boolean;
    }>("/api/jobs/j_test");

    await vi.waitFor(() => {
      expect(refreshCalls).toBe(1);
    });

    resolveRefresh(
      jsonResponse({
        accessToken: "shared-new-access-token",
      }),
    );

    const [firstResult, secondResult] =
      await Promise.all([
        firstRequest,
        secondRequest,
      ]);

    expect(firstResult).toEqual({
      success: true,
    });

    expect(secondResult).toEqual({
      success: true,
    });

    expect(refreshCalls).toBe(1);

    expect(getAccessToken()).toBe(
      "shared-new-access-token",
    );
  });

  it("clears authentication when refresh fails", async () => {
    setTokens({
      accessToken: "expired-access-token",
      refreshToken: "invalid-refresh-token",
    });

    const logoutListener = vi.fn();

    window.addEventListener(
      AUTH_LOGOUT_EVENT,
      logoutListener,
    );

    fetchMock
      // Protected request fails.
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: "Unauthorized",
          },
          401,
        ),
      )

      // Refresh also fails.
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: "Invalid refresh token",
          },
          401,
        ),
      );

    await expect(
      api.get("/api/jobs"),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message:
        "Your session has expired. Please sign in again.",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();

    expect(logoutListener).toHaveBeenCalledTimes(
      1,
    );

    window.removeEventListener(
      AUTH_LOGOUT_EVENT,
      logoutListener,
    );
  });

  it("does not refresh repeatedly when the retried request also returns 401", async () => {
    setTokens({
      accessToken: "expired-access-token",
      refreshToken: "valid-refresh-token",
    });

    fetchMock
      // Original request.
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: "Unauthorized",
          },
          401,
        ),
      )

      // Refresh succeeds.
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: "new-access-token",
        }),
      )

      // Retried request still returns 401.
      .mockResolvedValueOnce(
        jsonResponse(
          {
            detail: "Unauthorized",
          },
          401,
        ),
      );

    await expect(
      api.get("/api/jobs"),
    ).rejects.toBeInstanceOf(ApiError);

    // One original request, one refresh and one retry.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const refreshRequests =
      fetchMock.mock.calls.filter(
        ([path]) =>
          String(path) === "/api/auth/refresh",
      );

    expect(refreshRequests).toHaveLength(1);

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});