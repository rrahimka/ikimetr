export interface SingleFlightResult<T> {
  readonly disposition: 'leader' | 'reused';
  readonly value: T;
}

export class SingleFlight<T> {
  private readonly active = new Map<string, Promise<T>>();

  public run(
    key: string,
    operation: () => Promise<T>,
  ): Promise<SingleFlightResult<T>> {
    if (!/^[a-f0-9]{64}$/u.test(key)) {
      return Promise.reject(new TypeError('Single-flight key must be SHA-256'));
    }

    const existing = this.active.get(key);
    if (existing !== undefined) {
      return existing.then((value) =>
        Object.freeze({ disposition: 'reused' as const, value }),
      );
    }

    const pending = Promise.resolve().then(operation);
    this.active.set(key, pending);
    return pending
      .then((value) =>
        Object.freeze({ disposition: 'leader' as const, value }),
      )
      .finally(() => {
        if (this.active.get(key) === pending) {
          this.active.delete(key);
        }
      });
  }
}
