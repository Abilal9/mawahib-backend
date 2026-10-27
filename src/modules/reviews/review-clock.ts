import { AsyncLocalStorage } from 'async_hooks';
import { Injectable } from '@nestjs/common';

const storage = new AsyncLocalStorage<Date>();

/** The request clock. Outside a bound request this allocates a fresh instant. */
export function getReviewAsOf(): Date {
  return storage.getStore() ?? new Date();
}

export function runWithReviewAsOf<T>(asOf: Date, fn: () => T): T {
  return storage.run(asOf, fn);
}

@Injectable()
export class ReviewClock {
  /** Stable for the current request once ReviewClockInterceptor has bound it. */
  now(): Date {
    return getReviewAsOf();
  }
}
