# Encodr - Fullstack Take-Home

Encodr is a media-transcoding dashboard built with Next.js, React, and TypeScript.

A signed-in user can:

1. create an encode job from a media source URL;
2. start a transcode run;
3. watch live stage, progress, and log updates;
4. view output renditions when the run completes;
5. see a clear failure message and retry a failed run.

The application uses simulated server-side transcoding progress so the complete workflow can be demonstrated without requiring FFmpeg, external storage, a database, or additional infrastructure.

---

## Tech stack

- Next.js App Router
- React
- TypeScript with `strict: true`
- Next.js Route Handlers
- TanStack Query
- React Hook Form
- Zod
- Server-Sent Events
- `@microsoft/fetch-event-source`
- Vitest
- React Testing Library
- Tailwind CSS

---

## Requirements

- Node.js 20 or newer
- npm

The project requires zero manual environment setup.

---

## Running the application

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run the tests:

```bash
npm run test:run
```

Run TypeScript validation:

```bash
npm run typecheck
```

Create a production build:

```bash
npm run build
```

---

## Demo credentials

```text
Email: demo@encodr.dev
Password: password123
```

---

## Main workflow

1. Sign in with the demo account.
2. Create a job using an HTTP or HTTPS media URL.
3. Open the job detail page.
4. Start an encode run.
5. Watch live progress and log events.
6. View the completed rendition results or retry a failed run.

To exercise the failure and retry path, use:

```text
https://cdn.example.com/videos/corrupt.mp4
```

This URL intentionally reaches `FAILED` during the simulated probing stage.

---

## Architecture overview

The application uses Next.js Route Handlers as a backend-for-frontend.

```text
React UI
   |
   | HTTP requests
   v
Next.js Route Handlers
   |
   | Server-side operations
   v
In-memory job and run store
```

Live progress follows a separate SSE connection:

```text
Job detail page
   |
   | Authenticated SSE request
   v
GET /api/runs/:id/events
   |
   | RunEvent every second
   v
React state, progress bar and streaming log
```

The shared API contract is defined in `lib/types.ts` and is used by both the client and server.

This keeps types such as `Job`, `EncodeRun`, `RunEvent`, `Stage`, and `EncodeResult` consistent across the application boundary.

---

## Real-time and asynchronous behavior

The run progress is driven by the SSE stream rather than client-side polling.

The server keeps the HTTP connection open and sends a `RunEvent` approximately once per second:

```ts
{
  stage: "TRANSCODING",
  progressPct: 62,
  message: "Transcoding output renditions."
}
```

The client receives each event and updates:

- the current run stage;
- progress percentage;
- streaming log;
- connection state;
- terminal state;
- failure information.

When the run reaches `COMPLETED` or `FAILED`:

1. the client marks the stream as finished;
2. the SSE connection is aborted;
3. the terminal callback runs;
4. TanStack Query refetches the authoritative run and job data;
5. the final job status and results are reflected throughout the UI.

### Stream cleanup

The SSE hook creates an `AbortController` for each connection.

The connection is closed when:

- the component unmounts;
- the user navigates away;
- the run ID changes;
- the run completes;
- the run fails.

The server also clears its interval when the request is aborted or the stream is cancelled.

This prevents leaked connections, zombie timers, and state updates after unmount.

### Reconnection trade-off

Automatic SSE reconnection and resume support are not implemented.

The current implementation stops on a transport error and displays the error to the user. Reconnection was treated as optional stretch work so the core workflow, cleanup, terminal handling, authentication, and tests could remain reliable.

---

## Run workflow modeling

The run lifecycle is represented with a typed `Stage` union:

```ts
type Stage =
  | "QUEUED"
  | "DOWNLOADING"
  | "PROBING"
  | "TRANSCODING"
  | "PACKAGING"
  | "COMPLETED"
  | "FAILED";
```

A successful run follows:

```text
QUEUED
-> DOWNLOADING
-> PROBING
-> TRANSCODING
-> PACKAGING
-> COMPLETED
```

The intentionally corrupt source follows:

```text
QUEUED
-> DOWNLOADING
-> PROBING
-> FAILED
```

`computeRun()` calculates the current state from:

- the run record;
- its `startedAt` timestamp;
- the current server time;
- whether the source URL is the configured corrupt URL.

The function does not mutate its input and accepts the current time as an argument. This makes the workflow deterministic and allows every stage to be tested instantly without waiting 20-40 real seconds.

Terminal state data is kept consistent:

- `COMPLETED` includes result data;
- `FAILED` includes an error;
- active stages do not include completed results;
- progress remains within the expected range;
- only the latest run updates the parent job status.

---

## Authentication design

Authentication is mocked for the exercise but follows a realistic access-token and refresh-token flow.

The application contains one hard-coded user.

After successful login, the server returns:

- a short-lived access token;
- a longer-lived refresh token;
- the authenticated user.

The access token lifetime is approximately 60 seconds so the refresh flow can be exercised during normal use.

### Token structure

Each token contains:

- user ID;
- token kind: `access` or `refresh`;
- issued-at time;
- expiration time;
- unique token ID.

The payload is signed using HMAC SHA-256.

During verification, the server checks:

- token structure;
- signature integrity;
- expected token kind;
- issued-at time;
- expiration time;
- user existence.

Signature comparison uses `timingSafeEqual`.

Access and refresh tokens are not interchangeable:

- protected API routes require an access token;
- `/api/auth/refresh` requires a refresh token.

All `/api/jobs*` and `/api/runs*` routes reject unauthenticated requests with `401`.

---

## Silent refresh and single retry

The shared API wrapper attaches the access token to protected requests.

When a protected request returns `401`:

1. the client reads the refresh token;
2. it calls `POST /api/auth/refresh`;
3. the server validates the refresh token;
4. the client stores the new access token;
5. the original request is retried exactly once.

The retried request receives `canRefresh = false`, which prevents an infinite refresh loop if it also returns `401`.

When refresh fails:

- access and refresh tokens are cleared;
- stored user information is removed;
- an authentication logout event is dispatched;
- the auth provider redirects the user to `/signin`.

Public login requests use a separate `postPublic()` method. Therefore, invalid login credentials return a normal login error and do not incorrectly trigger refresh logic.

### Concurrent refresh protection

Concurrent requests that receive `401` reuse one shared in-flight `refreshPromise`.

```text
Request A -> 401 ─┐
Request B -> 401 ─┼-> one refresh request
Request C -> 401 ─┘
                      |
                      v
               new access token
                      |
          all original requests retry
```

This prevents a refresh stampede and completes one of the optional stretch requirements.

---

## SSE authentication

Native `EventSource` cannot attach an `Authorization` header.

The client therefore uses `@microsoft/fetch-event-source` and sends:

```text
Authorization: Bearer <access-token>
```

The SSE route uses the same access-token verification as the other protected API routes.

This approach was selected instead of placing the token in a query parameter because query parameters can appear in browser history, proxy logs, and server logs.

A cookie-based approach would also be appropriate in production, particularly with secure HTTP-only cookies.

### Current SSE authentication limitation

The normal API wrapper supports silent refresh, but the SSE hook opens its connection separately.

If the access token has already expired when a new SSE connection is opened, the stream returns an authentication error rather than refreshing and reconnecting automatically.

Adding refresh-aware SSE reconnection is listed as future work.

---

## Forms and validation

Job creation uses React Hook Form with a Zod resolver.

The source URL is validated with the same schema on both the client and server.

Validation checks that the source:

- is a syntactically valid URL;
- uses HTTP or HTTPS;
- has a supported media-file extension.

The server returns validation failures using structured field errors.

Example:

```ts
{
  detail: "Validation failed",
  fieldErrors: {
    sourceUrl: ["Enter a valid HTTP(S) media URL."]
  }
}
```

The client API wrapper preserves these errors in `ApiError.fieldErrors`, and the form maps each message back to the correct React Hook Form field.

This ensures that client validation improves responsiveness while server validation remains authoritative.

### URL-validation trade-off

The implementation requires a recognized media-file extension.

This is stricter than accepting every possible media URL. For example, a signed download URL without an extension could still represent valid media.

For this exercise, extension validation provides clear and predictable behavior. A production system could validate content type after securely inspecting the remote resource.

---

## Data storage

Jobs and runs are stored in module-level `Map` objects.

This was selected because the brief explicitly allows in-memory state.

Consequences:

- no database setup is required;
- restarting the development server clears all jobs and runs;
- state is local to one Node.js process;
- the implementation is not intended for multiple server instances.

A production implementation would use persistent storage and background processing.

---

## Simulated transcoding and results

The exercise simulates run progression using elapsed server time.

The application does not:

- download the submitted source URL;
- run FFprobe;
- run FFmpeg;
- create physical output files;
- upload results to object storage.

Completed rendition metadata is deterministic server-provided mock data.

This still exercises the required API, state machine, SSE, terminal status, result rendering, error handling, and retry workflow.

In a production implementation:

- FFprobe would inspect the source media;
- a queue would dispatch work to transcoding workers;
- FFmpeg would generate the renditions;
- object storage would contain the output files;
- final sizes and URLs would come from storage metadata.

---

## API routes

```text
POST   /api/auth/login
POST   /api/auth/refresh

GET    /api/jobs
POST   /api/jobs
GET    /api/jobs/:id

POST   /api/runs
GET    /api/runs/:id
GET    /api/runs/:id/events
```

All job and run routes require authentication.

---

## Testing strategy

The test suite uses Vitest and React Testing Library.

The strategy is to test important behavior and failure paths rather than testing styling or implementation details.

Run:

```bash
npm run test:run
```

Current result:

```text
Test Files: 4 passed
Tests:      19 passed
```

### Run-state tests

The state-machine tests verify:

- expected stage progression;
- successful completion;
- completed result data;
- corrupt-source failure;
- negative elapsed-time handling.

Because `computeRun()` accepts the current time as an argument, the tests can evaluate every stage without real waiting.

### Authentication tests

The authentication tests verify:

- valid credentials;
- invalid credentials;
- password exclusion from returned user data;
- access-token verification;
- access and refresh token separation;
- modified-token rejection;
- expired-token rejection;
- missing or invalid Bearer headers;
- rejection of unknown users.

### API refresh tests

The API tests mock `fetch()` and verify:

- initial protected request returning `401`;
- refresh endpoint invocation;
- replacement access-token storage;
- original request retry;
- exactly one retry;
- failed refresh clearing authentication;
- retried `401` not causing another refresh;
- concurrent `401` responses sharing one refresh promise.

### SSE hook tests

React Testing Library's `renderHook()` is used to verify:

- authenticated SSE connection creation;
- Authorization header attachment;
- progress event handling;
- log updates;
- terminal event handling;
- terminal callback execution;
- connection abortion after completion;
- connection cleanup on component unmount;
- missing-token behavior.

The tests focus on the areas with the highest risk: asynchronous state, authentication, token expiry, concurrency, terminal workflow behavior, and cleanup.

---

## Key assumptions and trade-offs

- In-memory state is sufficient for the exercise.
- Restarting the server may clear all jobs and runs.
- Transcoding progress is simulated from server time.
- Rendition metadata is deterministic mock server data.
- The application does not fetch or process remote media.
- Media URLs require a supported file extension.
- HMAC tokens are used instead of an external authentication provider.
- A development token secret is provided so no environment setup is required.
- Access tokens are short-lived to exercise refresh behavior.
- SSE is authenticated with an Authorization header.
- Concurrent `401` responses share one refresh request.
- Automatic SSE reconnection and resume are not implemented.
- Refresh tokens currently use the provided client token-storage approach.
- The implementation prioritizes a reliable core workflow over optional UI polish.

---

## Optional stretch work

Completed:

- concurrent `401` responses share a single in-flight refresh request.

Not implemented:

- SSE reconnect and resume after a transient disconnect;
- optimistic job creation with rollback;
- Playwright end-to-end testing.

These were intentionally left out to prioritize correctness, state handling, cleanup, validation, and meaningful unit and integration-level tests.

---

## What I would do next

With more time, I would:

1. add refresh-aware SSE reconnection and resume support;
2. move refresh tokens to secure HTTP-only cookies;
3. use a database for persistent jobs and runs;
4. add a queue and dedicated transcoding workers;
5. integrate FFprobe and FFmpeg;
6. store generated renditions in object storage;
7. add token rotation and revocation;
8. add request rate limiting;
9. add structured logging, metrics, and tracing;
10. add Playwright end-to-end coverage;
11. add pagination for large job lists;
12. validate remote media content type and download limits securely.

---

## Production considerations

This implementation is intentionally scoped for the take-home exercise.

A production system would need to address:

- persistent storage;
- distributed workers;
- job leasing and idempotency;
- retry and dead-letter behavior;
- rate limiting;
- remote URL security and SSRF protection;
- file-size and download limits;
- malware scanning;
- token rotation and revocation;
- secure cookie-based refresh tokens;
- resumable real-time event delivery;
- observability;
- horizontal scaling.