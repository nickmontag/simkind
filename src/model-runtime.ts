export interface ModelRequest {
  id: string;
  priority: number;
  issuedAtTick: number;
}

interface Completed<Input> {
  request: ModelRequest;
  input: Input;
}

/** Provider-neutral non-blocking request queue; prompt/content policy stays in an Adapter. */
export class ModelRuntime<Request extends ModelRequest, Input> {
  private readonly dispatched = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly completed: Completed<Input>[] = [];

  constructor(
    private readonly fulfill: (request: Request) => Promise<Input>,
    private readonly maxInFlight = 6,
  ) {}

  poll(requests: readonly Request[]): Input[] {
    const out = this.completed
      .sort(
        (a, b) =>
          a.request.issuedAtTick - b.request.issuedAtTick ||
          a.request.id.localeCompare(b.request.id),
      )
      .map((entry) => entry.input);
    this.completed.length = 0;

    const pending = requests
      .filter((request) => !this.dispatched.has(request.id))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.issuedAtTick - b.issuedAtTick ||
          a.id.localeCompare(b.id),
      );
    for (const request of pending) {
      if (this.inFlight.size >= this.maxInFlight) break;
      this.dispatched.add(request.id);
      const task = this.fulfill(request).then((input) => {
        this.completed.push({ request, input });
      });
      this.inFlight.add(task);
      void task.finally(() => this.inFlight.delete(task));
    }
    return out;
  }

  async settled(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  reset(): void {
    this.dispatched.clear();
    this.completed.length = 0;
  }
}
