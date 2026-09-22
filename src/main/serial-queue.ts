/** A failed job never poisons later work. Jobs for one resource cannot overtake. */
export class SerialQueue {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.tails.set(key, result);
    void result.finally(() => { if (this.tails.get(key) === result) this.tails.delete(key); }).catch(() => undefined);
    return result;
  }
  async flush(): Promise<void> { await Promise.all([...this.tails.values()]); }
}
export const documentQueue = new SerialQueue();

export function withDocumentLocks<T>(paths: string[], work: () => Promise<T>): Promise<T> {
  const keys = [...new Set(paths)].sort();
  const lock = (index: number): Promise<T> => index === keys.length ? work() : documentQueue.run(keys[index]!, () => lock(index + 1));
  return lock(0);
}
