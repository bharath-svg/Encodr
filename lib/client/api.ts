import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/client/token-store";

export class ApiError extends Error {
  status: number;

  /** Field-level errors from a 422, keyed by form field name. */
  fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** Fired when auth is unrecoverable. The auth provider listens and logs the user out. */
export const AUTH_LOGOUT_EVENT = "encodr:logout";

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;

  /**
   * Public requests such as login do not attach an access token and must not
   * attempt silent refresh when the server returns 401.
   */
  useAuth?: boolean;
}

interface RefreshResponse {
  accessToken: string;
}

/**
 * Shared by all requests that receive 401 at the same time.
 *
 * Without this, five failed requests could produce five refresh requests.
 */
let refreshPromise: Promise<string | null> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFieldErrors(
  value: unknown,
): value is Record<string, string[]> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(
    (messages) =>
      Array.isArray(messages) &&
      messages.every((message) => typeof message === "string"),
  );
}

function isRefreshResponse(value: unknown): value is RefreshResponse {
  return (
    isRecord(value) &&
    typeof value.accessToken === "string" &&
    value.accessToken.length > 0
  );
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = res.statusText || "Request failed";
  let fieldErrors: Record<string, string[]> | undefined;

  try {
    const body: unknown = await res.json();

    if (isRecord(body)) {
      if (typeof body.detail === "string") {
        detail = body.detail;
      }

      if (isFieldErrors(body.fieldErrors)) {
        fieldErrors = body.fieldErrors;
        detail = "Validation failed";
      }
    }
  } catch {
    // The response did not contain JSON.
  }

  return new ApiError(res.status, detail, fieldErrors);
}

async function refreshAccessToken(): Promise<string | null> {
  /*
   * If another request has already started refreshing, reuse the same promise
   * instead of sending another refresh request.
   */
  if (refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return null;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        return null;
      }

      const body: unknown = await res.json();

      if (!isRefreshResponse(body)) {
        return null;
      }

      /*
       * Only replace the access token.
       * setTokens() preserves the existing refresh token when refreshToken is
       * not included.
       */
      setTokens({
        accessToken: body.accessToken,
      });

      return body.accessToken;
    } catch {
      /*
       * Network errors and malformed responses mean the session cannot
       * currently be recovered.
       */
      return null;
    }
  })().finally(() => {
    /*
     * Once this attempt finishes, a future expired access token may start a
     * new refresh operation.
     */
    refreshPromise = null;
  });

  return refreshPromise;
}

function clearAuthAndNotify(): void {
  clearTokens();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
  }
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  canRefresh = true,
): Promise<T> {
  const headers: Record<string, string> = {};

  if (options.useAuth !== false) {
    const accessToken = getAccessToken();

    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }
  }

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
    signal: options.signal,
  });

  if (res.status === 401 && options.useAuth !== false) {
    /*
     * The original protected request is allowed exactly one refresh attempt.
     */
    if (canRefresh) {
      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        /*
         * Retry the same request once.
         *
         * request() reads the newly stored token from token-store, and
         * canRefresh=false prevents an infinite 401-refresh loop.
         */
        return request<T>(path, options, false);
      }
    }

    /*
     * Either refresh failed, no refresh token existed, or the retried request
     * also returned 401.
     */
    clearAuthAndNotify();

    throw new ApiError(
      401,
      "Your session has expired. Please sign in again.",
    );
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, { signal }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body,
    }),

  /**
   * Used by login. A wrong password legitimately returns 401, but login must
   * not attempt to refresh an older session.
   */
  postPublic: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body,
      useAuth: false,
    }),
};