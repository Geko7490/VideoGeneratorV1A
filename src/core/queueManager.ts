import type { Locality, QueueTask, TaskStatus } from '../types';
import { uid } from '../utils/fileUtils';

type Listener = (tasks: QueueTask[]) => void;

/**
 * Serial generation queue. Exactly one heavy task runs at a time —
 * this is what keeps VRAM usage bounded on a ~10 GB card.
 */
class QueueManager {
  tasks: QueueTask[] = [];
  private listeners = new Set<Listener>();
  private running = false;
  private cancelled = false;
  private pending: { task: QueueTask; run: (task: QueueTask) => Promise<void> }[] = [];

  subscribe(l: Listener) {
    this.listeners.add(l);
    l(this.tasks);
    return () => this.listeners.delete(l);
  }
  private emit() {
    const snap = this.tasks.map((t) => ({ ...t }));
    for (const l of this.listeners) l(snap);
  }

  clear() {
    this.tasks = [];
    this.pending = [];
    this.emit();
  }

  cancel() {
    this.cancelled = true;
    for (const p of this.pending) this.update(p.task.id, { status: 'skipped', error: 'Cancelled' });
    this.pending = [];
  }

  isCancelled() {
    return this.cancelled;
  }

  reset() {
    this.cancelled = false;
  }

  update(id: string, patch: Partial<QueueTask>) {
    const t = this.tasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    this.emit();
  }

  /** Enqueue a task; returns a promise that resolves when the task finishes (or rejects on failure). */
  enqueue(def: { label: string; kind: QueueTask['kind']; locality: Locality; sceneId?: number }, run: (task: QueueTask) => Promise<void>): Promise<TaskStatus> {
    const task: QueueTask = { id: uid('t_'), status: 'waiting', ...def };
    this.tasks.push(task);
    this.emit();
    return new Promise((resolve, reject) => {
      this.pending.push({
        task,
        run: async (t) => {
          try {
            await run(t);
            this.update(t.id, { status: 'completed', finishedAt: Date.now(), progress: 1 });
            resolve('completed');
          } catch (e) {
            const msg = (e as Error).message ?? String(e);
            this.update(t.id, { status: 'failed', error: msg, finishedAt: Date.now() });
            reject(e);
          }
        },
      });
      this.pump();
    });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    while (this.pending.length) {
      const next = this.pending.shift()!;
      if (this.cancelled) {
        this.update(next.task.id, { status: 'skipped', error: 'Cancelled' });
        continue;
      }
      this.update(next.task.id, { status: 'generating', startedAt: Date.now(), progress: 0 });
      await next.run(next.task);
    }
    this.running = false;
  }
}

export const queueManager = new QueueManager();
