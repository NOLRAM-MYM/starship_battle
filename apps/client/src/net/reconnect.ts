/**
 * Reconexão com exponential backoff + jitter.
 *
 * O caller injeta a função `connect` (tipicamente `() => connect({...})`
 * de `net/client.ts`). Em caso de falha, agendamos um retry com
 * delay = `min(30000, 1000 * 2^attempt) * (0.5 + Math.random() * 0.5)`.
 *
 * O contador `attempt` é público (para UI/inspeção) e é zerado por
 * `cancel()`.
 */

export interface ReconnectOpts {
  connect: () => Promise<void>;
  maxRetries?: number;
  /** Callback opcional a cada retry (útil para telemetria). */
  onRetry?: (attempt: number, delayMs: number) => void;
  /** Callback quando os retries esgotam. */
  onGiveUp?: (attempts: number) => void;
}

export interface ReconnectHandle {
  trigger(): Promise<void>;
  cancel(): void;
  attempt: number;
}

const DEFAULT_MAX_RETRIES = 8;
const MAX_DELAY_MS = 30_000;
const BASE_DELAY_MS = 1_000;

export function createReconnect(opts: ReconnectOpts): ReconnectHandle {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let triggering = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function nextDelayMs(currentAttempt: number): number {
    const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** currentAttempt);
    return exp * (0.5 + Math.random() * 0.5);
  }

  async function tryConnect(): Promise<void> {
    try {
      await opts.connect();
    } catch (err) {
      if (cancelled) return;
      attempt += 1;
      if (attempt >= maxRetries) {
        opts.onGiveUp?.(attempt);
        return;
      }
      const delay = nextDelayMs(attempt);
      opts.onRetry?.(attempt, delay);
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        // Auto-retry: agenda uma nova tentativa. O resultado é
        // exposto via promise interna.
        void tryConnect();
      }, delay);
    }
  }

  return {
    get attempt(): number {
      return attempt;
    },
    async trigger(): Promise<void> {
      if (cancelled || triggering) {
        return;
      }
      triggering = true;
      try {
        await tryConnect();
      } finally {
        triggering = false;
      }
    },
    cancel(): void {
      cancelled = true;
      clearTimer();
      attempt = 0;
    },
  };
}
