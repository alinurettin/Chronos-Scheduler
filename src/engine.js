/**
 * Chronos-Scheduler - High-Performance Distributed Task Scheduler
 * Author: Ali Nurettin Demir (@alinurettin)
 * 
 * Features:
 * - Priority Min-Heap Job Queue (O(log n) enqueue/dequeue)
 * - 5-Field POSIX Cron Expression Parser (wildcards, step intervals, ranges, lists)
 * - Next Run Timestamp Calculation Engine
 * - Exponential Backoff with Full/Equal Jitter
 * - Dead-Letter Queue (DLQ) with Failure Audit & Resurrect Capabilities
 * - Concurrency-Controlled Execution Worker Pool & Telemetry
 */

class MinHeap {
  constructor() {
    this.heap = [];
  }

  size() {
    return this.heap.length;
  }

  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  push(item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._sinkDown(0);
    }
    return top;
  }

  removeById(jobId) {
    const idx = this.heap.findIndex(j => j.id === jobId);
    if (idx === -1) return false;
    const bottom = this.heap.pop();
    if (idx < this.heap.length) {
      this.heap[idx] = bottom;
      this._bubbleUp(idx);
      this._sinkDown(idx);
    }
    return true;
  }

  _bubbleUp(n) {
    const element = this.heap[n];
    while (n > 0) {
      const parentN = Math.floor((n - 1) / 2);
      const parent = this.heap[parentN];
      if (element.nextRunAt >= parent.nextRunAt) break;
      this.heap[parentN] = element;
      this.heap[n] = parent;
      n = parentN;
    }
  }

  _sinkDown(n) {
    const length = this.heap.length;
    const element = this.heap[n];
    while (true) {
      let leftChildN = 2 * n + 1;
      let rightChildN = 2 * n + 2;
      let swap = null;

      if (leftChildN < length) {
        const leftChild = this.heap[leftChildN];
        if (leftChild.nextRunAt < element.nextRunAt) {
          swap = leftChildN;
        }
      }

      if (rightChildN < length) {
        const rightChild = this.heap[rightChildN];
        if (
          (swap === null && rightChild.nextRunAt < element.nextRunAt) ||
          (swap !== null && rightChild.nextRunAt < this.heap[swap].nextRunAt)
        ) {
          swap = rightChildN;
        }
      }

      if (swap === null) break;
      this.heap[n] = this.heap[swap];
      this.heap[swap] = element;
      n = swap;
    }
  }
}

class CronParser {
  /**
   * Parse a single field: supports *, step intervals, range (a-b), list (a,b,c), and combinations (a-b/c)
   */
  static parseField(fieldStr, min, max) {
    const values = new Set();
    const parts = fieldStr.split(',');

    for (let part of parts) {
      part = part.trim();
      if (!part) continue;

      let step = 1;
      let rangePart = part;

      if (part.includes('/')) {
        const sub = part.split('/');
        rangePart = sub[0];
        step = parseInt(sub[1], 10);
        if (isNaN(step) || step <= 0) throw new Error(`Invalid step in cron field: ${part}`);
      }

      let start = min;
      let end = max;

      if (rangePart === '*') {
        start = min;
        end = max;
      } else if (rangePart.includes('-')) {
        const sub = rangePart.split('-');
        start = parseInt(sub[0], 10);
        end = parseInt(sub[1], 10);
        if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
          throw new Error(`Invalid range in cron field: ${part}`);
        }
      } else {
        const single = parseInt(rangePart, 10);
        if (isNaN(single) || single < min || single > max) {
          throw new Error(`Value ${single} out of bounds [${min}, ${max}] in cron field`);
        }
        start = single;
        end = single;
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
    }

    return Array.from(values).sort((a, b) => a - b);
  }

  /**
   * Parse full 5-field cron expression: (minute, hour, dayOfMonth, month, dayOfWeek)
   */
  static parse(cronStr) {
    const fields = cronStr.trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new Error(`Invalid cron format: expected 5 fields, received ${fields.length} ('${cronStr}')`);
    }

    const minutes = this.parseField(fields[0], 0, 59);
    const hours = this.parseField(fields[1], 0, 23);
    const daysOfMonth = this.parseField(fields[2], 1, 31);
    const months = this.parseField(fields[3], 1, 12);
    // Day of week: 0-7 (0 and 7 both represent Sunday, normalized to 0-6)
    const rawDow = this.parseField(fields[4], 0, 7);
    const dowSet = new Set();
    for (const d of rawDow) {
      dowSet.add(d === 7 ? 0 : d);
    }
    const daysOfWeek = Array.from(dowSet).sort((a, b) => a - b);

    return { minutes, hours, daysOfMonth, months, daysOfWeek, raw: cronStr };
  }

  /**
   * Calculate next execution timestamp after given start Date
   */
  static getNextRunDate(cronStr, fromDate = new Date()) {
    const parsed = this.parse(cronStr);
    const date = new Date(fromDate.getTime() + 60000); // start checking next minute
    date.setSeconds(0, 0);

    // Limit forward scan to 5 years (approx 2,628,000 minutes) to prevent infinite loops
    for (let i = 0; i < 525600; i++) {
      const month = date.getMonth() + 1;
      if (!parsed.months.includes(month)) {
        date.setMonth(date.getMonth() + 1, 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }

      const dayOfMonth = date.getDate();
      const dayOfWeek = date.getDay();
      if (!parsed.daysOfMonth.includes(dayOfMonth) || !parsed.daysOfWeek.includes(dayOfWeek)) {
        date.setDate(date.getDate() + 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }

      const hour = date.getHours();
      if (!parsed.hours.includes(hour)) {
        date.setHours(date.getHours() + 1, 0, 0, 0);
        continue;
      }

      const minute = date.getMinutes();
      if (!parsed.minutes.includes(minute)) {
        date.setMinutes(date.getMinutes() + 1, 0, 0);
        continue;
      }

      return date;
    }

    throw new Error(`Unable to find next run date for cron: ${cronStr}`);
  }
}

class BackoffCalculator {
  static compute(attempt, options = {}) {
    const baseMs = options.baseMs || 1000;
    const maxMs = options.maxMs || 60000;
    const jitterType = options.jitter || 'full'; // 'none', 'full', 'equal'

    // Exponential delay: base * 2^(attempt - 1)
    const exponential = baseMs * Math.pow(2, Math.max(0, attempt - 1));
    const capped = Math.min(exponential, maxMs);

    if (jitterType === 'none') {
      return capped;
    } else if (jitterType === 'equal') {
      // half deterministic, half random
      const half = capped / 2;
      return Math.floor(half + Math.random() * half);
    } else {
      // full jitter
      return Math.floor(Math.random() * capped);
    }
  }
}

class ChronosScheduler {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 4;
    this.jobs = new Map(); // id -> job definition
    this.queue = new MinHeap(); // priority queue ordered by nextRunAt
    this.deadLetterQueue = new Map(); // id -> DLQ record
    this.runningJobs = new Set();
    this.history = []; // execution log

    this.metrics = {
      totalScheduled: 0,
      totalExecuted: 0,
      totalRetried: 0,
      totalDeadLettered: 0,
      totalSucceeded: 0,
      uptimeStart: Date.now()
    };
  }

  schedule(id, taskName, cronExp, handler = null, options = {}) {
    if (!id || !cronExp) throw new Error('Job id and cronExp are required');

    CronParser.parse(cronExp); // Validate syntax
    const nextRunDate = CronParser.getNextRunDate(cronExp);

    const job = {
      id,
      taskName: taskName || id,
      cronExp,
      handler: typeof handler === 'function' ? handler : null,
      maxRetries: options.maxRetries !== undefined ? options.maxRetries : 3,
      baseMs: options.baseMs || 1000,
      maxMs: options.maxMs || 30000,
      attempts: 0,
      status: 'SCHEDULED', // SCHEDULED, RUNNING, COMPLETED, RETRYING, DEAD_LETTER
      createdAt: Date.now(),
      nextRunAt: nextRunDate.getTime(),
      lastRunAt: null,
      lastError: null
    };

    // Replace if exists
    if (this.jobs.has(id)) {
      this.queue.removeById(id);
    }

    this.jobs.set(id, job);
    this.queue.push(job);
    this.metrics.totalScheduled++;

    return job;
  }

  getJob(id) {
    return this.jobs.get(id) || null;
  }

  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.queue.removeById(id);
    this.jobs.delete(id);
    job.status = 'CANCELLED';
    return true;
  }

  async executeJob(job) {
    job.status = 'RUNNING';
    job.lastRunAt = Date.now();
    this.runningJobs.add(job.id);
    const start = Date.now();

    try {
      let result = null;
      if (job.handler) {
        result = await job.handler(job);
      }
      const duration = Date.now() - start;
      job.status = 'COMPLETED';
      job.attempts = 0;
      this.metrics.totalExecuted++;
      this.metrics.totalSucceeded++;

      this.history.push({
        jobId: job.id,
        status: 'SUCCESS',
        durationMs: duration,
        timestamp: Date.now()
      });

      // Schedule next cron run
      const nextDate = CronParser.getNextRunDate(job.cronExp);
      job.nextRunAt = nextDate.getTime();
      job.status = 'SCHEDULED';
      this.queue.push(job);

      return { success: true, result, durationMs: duration };
    } catch (err) {
      const duration = Date.now() - start;
      job.lastError = err.message;
      return this._handleJobFailure(job, err, duration);
    } finally {
      this.runningJobs.delete(job.id);
      if (this.history.length > 100) this.history.shift();
    }
  }

  _handleJobFailure(job, error, duration = 0) {
    job.attempts++;
    this.metrics.totalExecuted++;

    this.history.push({
      jobId: job.id,
      status: 'FAILED',
      error: error.message,
      attempt: job.attempts,
      durationMs: duration,
      timestamp: Date.now()
    });

    if (job.attempts > job.maxRetries) {
      // Move to DLQ
      job.status = 'DEAD_LETTER';
      const dlqRecord = {
        jobId: job.id,
        taskName: job.taskName,
        cronExp: job.cronExp,
        failedAt: Date.now(),
        attempts: job.attempts,
        lastError: error.message
      };
      this.deadLetterQueue.set(job.id, dlqRecord);
      this.metrics.totalDeadLettered++;
      return { success: false, status: 'DEAD_LETTER', attempts: job.attempts, error: error.message };
    } else {
      // Calculate exponential backoff retry
      const backoffMs = BackoffCalculator.compute(job.attempts, {
        baseMs: job.baseMs,
        maxMs: job.maxMs,
        jitter: 'equal'
      });
      job.status = 'RETRYING';
      job.nextRunAt = Date.now() + backoffMs;
      this.queue.push(job);
      this.metrics.totalRetried++;
      return { success: false, status: 'RETRYING', retryInMs: backoffMs, attempts: job.attempts, error: error.message };
    }
  }

  resurrectDLQ(jobId) {
    const dlqRecord = this.deadLetterQueue.get(jobId);
    if (!dlqRecord) return null;

    const job = this.jobs.get(jobId);
    if (job) {
      job.attempts = 0;
      job.status = 'SCHEDULED';
      job.nextRunAt = Date.now(); // execute immediately
      this.queue.push(job);
    }

    this.deadLetterQueue.delete(jobId);
    return { resurrected: true, jobId };
  }

  async tick() {
    const now = Date.now();
    const executed = [];

    while (this.queue.size() > 0 && this.runningJobs.size < this.concurrency) {
      const nextJob = this.queue.peek();
      if (!nextJob || nextJob.nextRunAt > now) break;

      const job = this.queue.pop();
      // Skip jobs marked cancelled
      if (job.status === 'CANCELLED' || !this.jobs.has(job.id)) continue;

      executed.push(this.executeJob(job));
    }

    return Promise.all(executed);
  }

  getStats() {
    return {
      activeJobsCount: this.jobs.size,
      queuedJobsCount: this.queue.size(),
      runningJobsCount: this.runningJobs.size,
      dlqCount: this.deadLetterQueue.size,
      totalScheduled: this.metrics.totalScheduled,
      totalExecuted: this.metrics.totalExecuted,
      totalSucceeded: this.metrics.totalSucceeded,
      totalRetried: this.metrics.totalRetried,
      totalDeadLettered: this.metrics.totalDeadLettered,
      uptimeSeconds: Math.floor((Date.now() - this.metrics.uptimeStart) / 1000)
    };
  }
}

module.exports = {
  MinHeap,
  CronParser,
  BackoffCalculator,
  ChronosScheduler
};