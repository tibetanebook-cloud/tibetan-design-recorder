/**
 * Rejects if the promise has not settled in time, so one input that never answers
 * can't hold up the whole take. `late` receives a value that arrives after the
 * deadline, so it can be released (for example, stopping a camera stream).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error(`no answer after ${Math.round(ms / 1000)} s`));
    }, ms);
    promise.then(
      (value) => {
        if (expired) return late?.(value);
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (expired) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
