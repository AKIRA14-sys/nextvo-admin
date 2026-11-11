export function createRefreshQueue(task: () => Promise<void>, delayMs = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null;
  let pending = false;
  let disposed = false;

  function schedule() {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void run(); }, delayMs);
  }

  function run(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (running) { pending = true; return running; }
    running = task().finally(() => {
      running = null;
      if (pending && !disposed) { pending = false; schedule(); }
    });
    return running;
  }

  function dispose() {
    disposed = true;
    pending = false;
    if (timer) clearTimeout(timer);
  }

  function activate() { disposed = false; }

  return { run, schedule, dispose, activate };
}
