import type { Database } from "@lumorphia-accounts/db";

export type JobName = "character-verify" | "character-sync" | "character-sync-all";
export type EnqueueOptions = {
  startAfterSeconds?: number;
  singletonKey?: string;
  retryLimit?: number;
  /** 要求時刻とジョブを同じトランザクションで確定させる */
  transaction?: Database;
};
export interface JobQueue {
  enqueue(name: JobName, data: object, opts?: EnqueueOptions): Promise<void>;
}

/** 単体テスト用。DB との原子性は pg-boss の結合テストで確認する */
export class MemoryJobQueue implements JobQueue {
  readonly jobs: { name: JobName; data: object; opts: Omit<EnqueueOptions, "transaction"> }[] = [];
  async enqueue(name: JobName, data: object, opts: EnqueueOptions = {}) {
    const { transaction: _transaction, ...view } = opts;
    this.jobs.push({ name, data, opts: view });
  }
}
