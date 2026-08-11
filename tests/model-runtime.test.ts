import { describe, expect, it } from 'vitest';
import { ModelRuntime, type ModelRequest } from '../src/index.js';

interface Request extends ModelRequest {
  prompt: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('model runtime', () => {
  it('dispatches by priority and polls completed results deterministically', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<string>>>();
    const started: string[] = [];
    const runtime = new ModelRuntime<Request, string>((request) => {
      started.push(request.id);
      const result = deferred<string>();
      pending.set(request.id, result);
      return result.promise;
    }, 2);
    const requests: Request[] = [
      { id: 'low', priority: 1, issuedAtTick: 1, prompt: 'low' },
      { id: 'later', priority: 2, issuedAtTick: 2, prompt: 'later' },
      { id: 'earlier', priority: 2, issuedAtTick: 1, prompt: 'earlier' },
    ];

    expect(runtime.poll(requests)).toEqual([]);
    expect(started).toEqual(['earlier', 'later']);
    pending.get('later')!.resolve('later-result');
    pending.get('earlier')!.resolve('earlier-result');
    await runtime.settled();

    expect(runtime.poll([])).toEqual([
      { status: 'fulfilled', request: requests[2], input: 'earlier-result' },
      { status: 'fulfilled', request: requests[1], input: 'later-result' },
    ]);
  });

  it('reports provider failures without rejecting settled or redispatching implicitly', async () => {
    const failure = new Error('provider down');
    let calls = 0;
    const request: Request = { id: 'failed', priority: 1, issuedAtTick: 1, prompt: 'test' };
    const runtime = new ModelRuntime<Request, string>(async () => {
      calls += 1;
      throw failure;
    });

    runtime.poll([request]);
    await expect(runtime.settled()).resolves.toBeUndefined();
    expect(runtime.poll([request])).toEqual([
      { status: 'rejected', request, error: failure },
    ]);
    await runtime.settled();
    expect(calls).toBe(1);
  });

  it('invalidates stale completions across reset', async () => {
    const attempts: ReturnType<typeof deferred<string>>[] = [];
    const request: Request = { id: 'same', priority: 1, issuedAtTick: 1, prompt: 'test' };
    const runtime = new ModelRuntime<Request, string>(() => {
      const result = deferred<string>();
      attempts.push(result);
      return result.promise;
    });

    runtime.poll([request]);
    runtime.reset();
    runtime.poll([request]);
    attempts[0].resolve('stale');
    attempts[1].resolve('current');
    await runtime.settled();

    expect(runtime.poll([])).toEqual([
      { status: 'fulfilled', request, input: 'current' },
    ]);
  });

  it('dispatches duplicate request IDs only once per generation', async () => {
    let calls = 0;
    const runtime = new ModelRuntime<Request, string>(async () => {
      calls += 1;
      return 'done';
    });
    const request: Request = { id: 'one', priority: 1, issuedAtTick: 1, prompt: 'test' };

    runtime.poll([request, { ...request }]);
    await runtime.settled();
    expect(calls).toBe(1);
  });

  it('requires a positive integer concurrency limit', () => {
    const fulfill = async (_request: Request) => 'done';
    expect(() => new ModelRuntime(fulfill, 0)).toThrow(/maxInFlight/);
    expect(() => new ModelRuntime(fulfill, 1.5)).toThrow(/maxInFlight/);
  });
});
