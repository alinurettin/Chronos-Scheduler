class ChronosScheduler {
  constructor() {
    this.jobs = new Map();
  }
  calculateBackoff(attempt, baseSec = 1, maxSec = 60) {
    const delay = baseSec * Math.pow(2, attempt);
    return Math.min(delay, maxSec);
  }
  matchesCronField(value, pattern) {
    if (pattern === '*') return true;
    if (pattern.startsWith('*/')) {
      const step = parseInt(pattern.split('/')[1], 10);
      return value % step === 0;
    }
    return parseInt(pattern, 10) === value;
  }
  schedule(id, taskName, cronExp, maxRetries = 3) {
    const job = { id, taskName, cronExp, maxRetries, attempts: 0, status: 'SCHEDULED' };
    this.jobs.set(id, job);
    return job;
  }
  failAndRetry(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.attempts++;
    if (job.attempts >= job.maxRetries) {
      job.status = 'DEAD_LETTER';
      return { status: 'DEAD_LETTER', retryInSec: null };
    }
    const backoff = this.calculateBackoff(job.attempts);
    job.status = 'RETRYING';
    return { status: 'RETRYING', retryInSec: backoff };
  }
}
module.exports = ChronosScheduler;