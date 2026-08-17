/** Default unary request budget so a hung host does not hang callers. */
export const DEFAULT_GATEWAY_TIMEOUT_MS = 30_000;

export type GatewayRequestOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export function resolveGatewayTimeoutMs(
  perRequest: number | undefined,
  instance: number | undefined,
  applyDefault: boolean,
): number | undefined {
  const raw = perRequest ?? instance ?? (applyDefault ? DEFAULT_GATEWAY_TIMEOUT_MS : undefined);
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return undefined;
  return raw;
}

export function composeGatewayAbort(
  timeoutMs: number | undefined,
  signals: Array<AbortSignal | undefined>,
): { signal?: AbortSignal; cleanup: () => void } {
  const live = signals.filter((value): value is AbortSignal => value != null);
  if (timeoutMs == null && live.length === 0) return { cleanup() {} };

  const controller = new AbortController();
  const onAbort = (): void => {
    if (!controller.signal.aborted) {
      const source = live.find((value) => value.aborted);
      controller.abort(source?.reason);
    }
  };
  for (const value of live) {
    if (value.aborted) {
      controller.abort(value.reason);
      break;
    }
    value.addEventListener("abort", onAbort, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs != null && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(
        new DOMException(`Gateway request timed out after ${timeoutMs}ms`, "TimeoutError"),
      );
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timer != null) clearTimeout(timer);
      for (const value of live) value.removeEventListener("abort", onAbort);
    },
  };
}

export function isTimeoutAbort(signal: AbortSignal | undefined): boolean {
  const reason = signal?.reason;
  if (reason instanceof DOMException) return reason.name === "TimeoutError";
  return reason instanceof Error && reason.name === "TimeoutError";
}
