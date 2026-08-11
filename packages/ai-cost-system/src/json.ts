import { ConfigValidationError } from './errors.js';

const secretPatterns = [
  /\b(?:sk|pk)-(?:live|test)-[A-Za-z0-9_-]{12,}\b/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[A-Z0-9]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{30,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/iu,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s&]{8,}/iu,
] as const;

export function parseJsonStrict(sourceText: string, sourceName: string): unknown {
  new JsonSyntaxScanner(sourceText, sourceName).scan();

  try {
    const value: unknown = JSON.parse(sourceText);
    assertNoSecretLikeValues(value, sourceName);
    return value;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }

    throw new ConfigValidationError(`Invalid JSON in ${sourceName}`, {
      cause: error,
    });
  }
}

export function assertNoSecretLikeValues(
  value: unknown,
  sourceName: string,
): void {
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();

    if (typeof current === 'string') {
      if (secretPatterns.some((pattern) => pattern.test(current))) {
        throw new ConfigValidationError(
          `Rejected secret-like value in ${sourceName}`,
        );
      }
      continue;
    }

    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    if (typeof current === 'object' && current !== null) {
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const [key, child] of Object.entries(current)) {
        if (secretPatterns.some((pattern) => pattern.test(key))) {
          throw new ConfigValidationError(
            `Rejected secret-like value in ${sourceName}`,
          );
        }
        pending.push(child);
      }
    }
  }
}

class JsonSyntaxScanner {
  private position = 0;

  public constructor(
    private readonly source: string,
    private readonly sourceName: string,
  ) {}

  public scan(): void {
    this.skipWhitespace();
    this.scanValue();
    this.skipWhitespace();

    if (this.position !== this.source.length) {
      this.fail();
    }
  }

  private scanValue(): void {
    const character = this.source[this.position];

    if (character === '{') {
      this.scanObject();
      return;
    }
    if (character === '[') {
      this.scanArray();
      return;
    }
    if (character === '"') {
      this.scanString();
      return;
    }
    if (character === '-' || (character !== undefined && /[0-9]/u.test(character))) {
      this.scanNumber();
      return;
    }
    if (this.source.startsWith('true', this.position)) {
      this.position += 4;
      return;
    }
    if (this.source.startsWith('false', this.position)) {
      this.position += 5;
      return;
    }
    if (this.source.startsWith('null', this.position)) {
      this.position += 4;
      return;
    }

    this.fail();
  }

  private scanObject(): void {
    const keys = new Set<string>();
    this.position += 1;
    this.skipWhitespace();

    if (this.consume('}')) {
      return;
    }

    while (true) {
      if (this.source[this.position] !== '"') {
        this.fail();
      }

      const key = this.scanString();
      if (keys.has(key)) {
        throw new ConfigValidationError(
          `Duplicate JSON key in ${this.sourceName}`,
        );
      }
      keys.add(key);

      this.skipWhitespace();
      if (!this.consume(':')) {
        this.fail();
      }
      this.skipWhitespace();
      this.scanValue();
      this.skipWhitespace();

      if (this.consume('}')) {
        return;
      }
      if (!this.consume(',')) {
        this.fail();
      }
      this.skipWhitespace();
    }
  }

  private scanArray(): void {
    this.position += 1;
    this.skipWhitespace();

    if (this.consume(']')) {
      return;
    }

    while (true) {
      this.scanValue();
      this.skipWhitespace();

      if (this.consume(']')) {
        return;
      }
      if (!this.consume(',')) {
        this.fail();
      }
      this.skipWhitespace();
    }
  }

  private scanString(): string {
    const start = this.position;
    this.position += 1;

    while (this.position < this.source.length) {
      const character = this.source[this.position];

      if (character === '"') {
        this.position += 1;
        try {
          return JSON.parse(this.source.slice(start, this.position)) as string;
        } catch {
          this.fail();
        }
      }

      if (character === '\\') {
        this.position += 1;
        const escape = this.source[this.position];
        if (escape === 'u') {
          const unicodeEscape = this.source.slice(
            this.position + 1,
            this.position + 5,
          );
          if (!/^[0-9a-fA-F]{4}$/u.test(unicodeEscape)) {
            this.fail();
          }
          this.position += 5;
          continue;
        }
        if (escape === undefined || !/["\\/bfnrt]/u.test(escape)) {
          this.fail();
        }
        this.position += 1;
        continue;
      }

      if (character === undefined || character.charCodeAt(0) <= 0x1f) {
        this.fail();
      }
      this.position += 1;
    }

    this.fail();
  }

  private scanNumber(): void {
    const remaining = this.source.slice(this.position);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      remaining,
    );

    if (match === null) {
      this.fail();
    }
    this.position += match[0].length;
  }

  private consume(character: string): boolean {
    if (this.source[this.position] !== character) {
      return false;
    }
    this.position += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.source[this.position] ?? 'x')) {
      this.position += 1;
    }
  }

  private fail(): never {
    throw new ConfigValidationError(`Invalid JSON in ${this.sourceName}`);
  }
}
