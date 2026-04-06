/** 브라우저 콘솔 필터: `[compare]` */

const PREFIX = "[compare]";

export function logCompare(phase: string, detail?: string): void {
  if (detail) console.info(`${PREFIX} ${phase}:`, detail);
  else console.info(`${PREFIX} ${phase}`);
}

export function logCompareError(phase: string, err: unknown): void {
  const msg = formatCompareError(err);
  if (err instanceof Error && err.stack) {
    console.error(`${PREFIX} ${phase}:`, msg, "\n", err.stack);
  } else {
    console.error(`${PREFIX} ${phase}:`, msg, err);
  }
}

export function formatCompareError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label}: ${ms}ms 초과 (네트워크·API 지연 또는 무응답)`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
