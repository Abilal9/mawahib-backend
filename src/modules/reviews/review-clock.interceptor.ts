import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { runWithReviewAsOf } from './review-clock';

/**
 * One server instant for every publication read in the request.
 * Later `getReviewAsOf()` calls return this same Date object.
 */
@Injectable()
export class ReviewClockInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const asOf = new Date();
    return new Observable((subscriber) => {
      let subscription: Subscription | undefined;
      runWithReviewAsOf(asOf, () => {
        subscription = next.handle().subscribe(subscriber);
      });
      return () => subscription?.unsubscribe();
    });
  }
}
