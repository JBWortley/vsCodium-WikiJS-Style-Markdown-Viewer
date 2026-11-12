import { Worker } from "node:worker_threads";
import path from "node:path";
import type { RenderedPage } from "../render/page";
import type { WorkerRequest, WorkerResponse } from "../render/protocol";

type RenderRequest = Omit<Extract<WorkerRequest, { type: "render" }>, "type" | "id">;

interface Pending {
  resolve(page: RenderedPage): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

export const RENDER_TIMEOUT_MS = 5000;

/** Owns the render worker: one request at a time per id, hard timeout, restart after a kill. */
export class RenderService {
  private worker?: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private indexKey?: string;
  private indexPages: string[] = [];

  constructor(
    private readonly extensionPath: string,
    private readonly log: (line: string) => void,
  ) {}

  /** Sends the page index for `key` (a wiki root) unless the worker already has it. */
  setIndex(key: string, pages: string[]): void {
    if (this.indexKey === key && this.indexPages === pages && this.worker) return;
    this.indexKey = key;
    this.indexPages = pages;
    this.ensureWorker().postMessage({ type: "index", pages } satisfies WorkerRequest);
  }

  /** Renders one page at a time, so the timeout measures rendering, not waiting in line. */
  render(request: RenderRequest): Promise<RenderedPage> {
    const result = this.queue.then(() => this.renderOne(request));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private queue: Promise<unknown> = Promise.resolve();

  private renderOne(request: RenderRequest): Promise<RenderedPage> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<RenderedPage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.log(`render ${request.pagePath}: timed out after ${RENDER_TIMEOUT_MS} ms, restarting worker`);
        this.restart();
        reject(new Error(`Rendering took longer than ${RENDER_TIMEOUT_MS / 1000} s and was stopped.`));
      }, RENDER_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ type: "render", id, ...request } satisfies WorkerRequest);
    });
  }

  dispose(): void {
    this.failAll(new Error("Renderer disposed"));
    void this.worker?.terminate();
    this.worker = undefined;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(this.extensionPath, "dist", "renderWorker.js"));
    worker.on("message", (msg: WorkerResponse) => {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.type === "rendered") entry.resolve(msg.page);
      else entry.reject(new Error(msg.message));
    });
    worker.on("error", (err) => {
      this.log(`render worker error: ${err.message}`);
      this.restart();
    });
    worker.on("exit", (code) => {
      if (this.worker === worker) {
        this.worker = undefined;
        this.failAll(new Error(`Render worker exited (${code})`));
      }
    });
    this.worker = worker;
    if (this.indexKey !== undefined) worker.postMessage({ type: "index", pages: this.indexPages } satisfies WorkerRequest);
    return worker;
  }

  private restart(): void {
    const old = this.worker;
    this.worker = undefined;
    this.failAll(new Error("Render worker restarted"));
    void old?.terminate();
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}
