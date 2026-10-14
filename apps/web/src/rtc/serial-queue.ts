export type SerialQueue = {
  push(task: () => Promise<void>): void;
  close(): void;
  idle(): Promise<void>;
};

// Runs async tasks strictly one after another. A failing task is reported to onError and never
// breaks the chain; after close() new tasks are dropped.
export function createSerialQueue(onError: (error: unknown) => void): SerialQueue {
  let tail = Promise.resolve();
  let closed = false;

  return {
    push(task) {
      if (closed) {
        return;
      }

      tail = tail.then(task).catch(onError);
    },
    close() {
      closed = true;
    },
    idle() {
      return tail;
    },
  };
}
