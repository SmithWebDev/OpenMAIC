/**
 * The time a run gives each provider-calling step: the budget the step's 1.1.x
 * API route declared, so a hung provider fails the step the way a route
 * timeout failed the browser's request, as a retryable failure.
 *
 * AOS patch: each budget can be overridden per deployment. Local models and
 * large interactive scenes need more than the upstream defaults; the defaults
 * are unchanged when the variable is unset.
 */

function deadlineFromEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Per call, in milliseconds. */
export const STEP_DEADLINES_MS = {
  /**
   * One material's extraction, once a worker runs it (1.1.x declared no
   * budget; the platform's default applied).
   */
  materialAnalysis: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_MATERIAL_ANALYSIS_MS', 300_000),
  /** Research (1.1.x declared no budget; the platform's default applied). */
  research: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_RESEARCH_MS', 300_000),
  /** The outline, its own stream retries included. */
  outline: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_OUTLINE_MS', 300_000),
  agentProfiles: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_AGENT_PROFILES_MS', 120_000),
  /** Per attempt. */
  sceneContent: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_SCENE_CONTENT_MS', 300_000),
  /** Per attempt. */
  sceneActions: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_SCENE_ACTIONS_MS', 60_000),
  /** Per clip attempt (POST /api/generate/tts). */
  narrationClip: deadlineFromEnv('OPENMAIC_STEP_DEADLINE_NARRATION_MS', 30_000),
} as const;

/** A step ran out of its budget. A gateway timeout to the retries: retried. */
export class StepTimeoutError extends Error {
  readonly statusCode = 504;

  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${ms / 1000} s`);
    this.name = 'StepTimeoutError';
  }
}

/**
 * Run `call` with a signal that aborts when the run's signal does (a lost
 * lease, a deleted course, shutdown) or when `ms` pass. A timeout rejects
 * with {@link StepTimeoutError} even if the call ignores its signal; the
 * run's own abort rejects as an abort.
 */
export async function withDeadline<T>(
  label: string,
  ms: number,
  runSignal: AbortSignal,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), ms);
  const signal = AbortSignal.any([runSignal, timeout.signal]);
  const failure = () =>
    runSignal.aborted
      ? (runSignal.reason ?? new DOMException('Aborted', 'AbortError'))
      : new StepTimeoutError(label, ms);
  try {
    return await new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(failure());
        return;
      }
      signal.addEventListener('abort', () => reject(failure()), { once: true });
      call(signal).then(resolve, (error) => reject(signal.aborted ? failure() : error));
    });
  } finally {
    clearTimeout(timer);
  }
}
