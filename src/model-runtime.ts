import { compareStrings } from './order.js';

export interface ModelRequest {
  id: string;
  priority: number;
  issuedAtTick: number;
}

export type ModelCompletion<Request extends ModelRequest, Input> =
  | { status: 'fulfilled'; request: Request; input: Input }
  | { status: 'rejected'; request: Request; error: unknown };

/** Provider-neutral non-blocking request queue; prompt/content policy stays in an Adapter. */
export class ModelRuntime<Request extends ModelRequest, Input> {
  private readonly dispatched = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly completed: ModelCompletion<Request, Input>[] = [];
  private readonly maxInFlight: number;
  private generation = 0;

  constructor(
    private readonly fulfill: (request: Request) => Promise<Input>,
    maxInFlight = 6,
  ) {
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight <= 0) {
      throw new RangeError(`maxInFlight must be a positive integer; received ${maxInFlight}`);
    }
    this.maxInFlight = maxInFlight;
  }

  poll(requests: readonly Request[]): ModelCompletion<Request, Input>[] {
    const out = this.completed
      .sort(
        (a, b) =>
          a.request.issuedAtTick - b.request.issuedAtTick ||
          compareStrings(a.request.id, b.request.id),
      )
      .slice();
    this.completed.length = 0;

    const pending = requests
      .filter((request) => !this.dispatched.has(request.id))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.issuedAtTick - b.issuedAtTick ||
          compareStrings(a.id, b.id),
      );
    for (const request of pending) {
      if (this.inFlight.size >= this.maxInFlight) break;
      if (this.dispatched.has(request.id)) continue;
      this.dispatched.add(request.id);
      const generation = this.generation;
      let fulfillment: Promise<Input>;
      try {
        fulfillment = this.fulfill(request);
      } catch (error) {
        fulfillment = Promise.reject(error);
      }
      const task = fulfillment.then(
        (input) => {
          if (generation === this.generation) {
            this.completed.push({ status: 'fulfilled', request, input });
          }
        },
        (error: unknown) => {
          if (generation === this.generation) {
            this.completed.push({ status: 'rejected', request, error });
          }
        },
      );
      this.inFlight.add(task);
      void task.then(() => this.inFlight.delete(task));
    }
    return out;
  }

  async settled(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  reset(): void {
    this.generation += 1;
    this.dispatched.clear();
    this.completed.length = 0;
  }
}
