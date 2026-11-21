// The one network call a connector makes, as a type: whoever runs it passes
// `fetch`, a test passes a stand-in, a proxy passes its own.

/** The subset of `fetch` the adapters use, so a test or a proxy can stand in. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
