import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  fetchEventSource: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock(
  "@microsoft/fetch-event-source",
  () => ({
    fetchEventSource: mocks.fetchEventSource,
  }),
);

vi.mock(
  "@/lib/client/token-store",
  () => ({
    getAccessToken: mocks.getAccessToken,
  }),
);

import { useRunStream } from "@/lib/client/use-run-stream";

interface TestStreamOptions {
  method?: string;
  signal?: AbortSignal;
  openWhenHidden?: boolean;
  headers?: Record<string, string>;

  onopen?: (
    response: Response,
  ) => void | Promise<void>;

  onmessage?: (message: {
    data: string;
  }) => void;

  onclose?: () => void;
  onerror?: (error: unknown) => void;
}

let streamOptions: TestStreamOptions | null = null;

function getStreamOptions(): TestStreamOptions {
  if (!streamOptions) {
    throw new Error(
      "The SSE connection was not opened.",
    );
  }

  return streamOptions;
}

describe("useRunStream", () => {
  beforeEach(() => {
    streamOptions = null;

    mocks.fetchEventSource.mockReset();
    mocks.getAccessToken.mockReset();

    mocks.getAccessToken.mockReturnValue(
      "test-access-token",
    );

    mocks.fetchEventSource.mockImplementation(
      (
        _url: string,
        options: unknown,
      ) => {
        streamOptions =
          options as TestStreamOptions;

        // Keep the fake stream open until the hook aborts it.
        return new Promise<void>(() => {});
      },
    );
  });

  it("opens an authenticated SSE connection and aborts it on unmount", async () => {
    const { unmount } = renderHook(() =>
      useRunStream("r_test"),
    );

    await waitFor(() => {
      expect(
        mocks.fetchEventSource,
      ).toHaveBeenCalledTimes(1);
    });

    expect(
      mocks.fetchEventSource,
    ).toHaveBeenCalledWith(
      "/api/runs/r_test/events",
      expect.objectContaining({
        method: "GET",
        openWhenHidden: true,
        headers: {
          Authorization:
            "Bearer test-access-token",
        },
      }),
    );

    const options = getStreamOptions();

    expect(
      options.signal?.aborted,
    ).toBe(false);

    unmount();

    expect(
      options.signal?.aborted,
    ).toBe(true);
  });

  it("updates state from progress events and handles completion", async () => {
    const onTerminal = vi.fn();

    const { result, unmount } = renderHook(
      () =>
        useRunStream(
          "r_test",
          onTerminal,
        ),
    );

    await waitFor(() => {
      expect(
        mocks.fetchEventSource,
      ).toHaveBeenCalledTimes(1);
    });

    const options = getStreamOptions();

    await act(async () => {
      await options.onopen?.(
        new Response(null, {
          status: 200,
          headers: {
            "content-type":
              "text/event-stream",
          },
        }),
      );
    });

    expect(result.current.connected).toBe(
      true,
    );

    act(() => {
      options.onmessage?.({
        data: JSON.stringify({
          stage: "TRANSCODING",
          progressPct: 62,
          message: "Encoding video.",
        }),
      });
    });

    expect(result.current.stage).toBe(
      "TRANSCODING",
    );

    expect(result.current.progressPct).toBe(
      62,
    );

    expect(result.current.log).toEqual([
      "Encoding video.",
    ]);

    expect(result.current.done).toBe(false);

    act(() => {
      options.onmessage?.({
        data: JSON.stringify({
          stage: "COMPLETED",
          progressPct: 100,
          message: "Encoding completed.",
        }),
      });
    });

    expect(result.current.stage).toBe(
      "COMPLETED",
    );

    expect(result.current.progressPct).toBe(
      100,
    );

    expect(result.current.log).toEqual([
      "Encoding video.",
      "Encoding completed.",
    ]);

    expect(result.current.connected).toBe(
      false,
    );

    expect(result.current.done).toBe(true);

    expect(onTerminal).toHaveBeenCalledTimes(
      1,
    );

    // Terminal events close the stream.
    expect(
      options.signal?.aborted,
    ).toBe(true);

    unmount();
  });

  it("does not open the stream when no access token exists", async () => {
    mocks.getAccessToken.mockReturnValue(null);

    const { result, unmount } = renderHook(
      () => useRunStream("r_test"),
    );

    await waitFor(() => {
      expect(result.current.error).toBe(
        "You must be signed in to view run progress.",
      );
    });

    expect(
      mocks.fetchEventSource,
    ).not.toHaveBeenCalled();

    expect(result.current.connected).toBe(
      false,
    );

    unmount();
  });
});