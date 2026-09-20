// Chronos-Scheduler Comprehensive Verification Suite
// Author: Ali Nurettin Demir (@alinurettin)
const assert = require('assert');
const http = require('http');
const { MinHeap, CronParser, BackoffCalculator, ChronosScheduler } = require('../src/engine');
const { startServer } = require('../src/index');

console.log('====================================================');
console.log('🧪 Running Verification Suite: Chronos-Scheduler (v2.0.0)');
console.log('====================================================');

let passedAssertions = 0;
function check(description, condition) {
  assert.ok(condition, description);
  passedAssertions++;
  console.log(`  ✓ [Assertion ${passedAssertions}] ${description}`);
}

// ----------------------------------------------------
// SECTION 1: MinHeap Priority Queue
// ----------------------------------------------------
console.log('\n[SECTION 1: MinHeap Priority Queue]');

const heap = new MinHeap();
check('MinHeap initial size is 0', heap.size() === 0);
check('MinHeap peek on empty returns null', heap.peek() === null);

// Push items out of order
heap.push({ id: 'job-c', nextRunAt: 300 });
heap.push({ id: 'job-a', nextRunAt: 100 });
heap.push({ id: 'job-d', nextRunAt: 400 });
heap.push({ id: 'job-b', nextRunAt: 200 });

check('MinHeap size is 4 after pushes', heap.size() === 4);
check('MinHeap peek returns lowest nextRunAt (job-a)', heap.peek().id === 'job-a');

// Pop items and verify ascending order
const popped1 = heap.pop();
check('First pop is lowest timestamp (100)', popped1.nextRunAt === 100 && popped1.id === 'job-a');
const popped2 = heap.pop();
check('Second pop is next lowest timestamp (200)', popped2.nextRunAt === 200 && popped2.id === 'job-b');

// Test removeById
check('Remove job-d by ID returns true', heap.removeById('job-d') === true);
check('Heap size is 1 after removal', heap.size() === 1);
const poppedRemaining = heap.pop();
check('Remaining item is job-c', poppedRemaining.id === 'job-c');
check('MinHeap is empty after all pops', heap.size() === 0);
check('Remove non-existent item returns false', heap.removeById('non-existent') === false);

// ----------------------------------------------------
// SECTION 2: 5-Field POSIX Cron Parser
// ----------------------------------------------------
console.log('\n[SECTION 2: 5-Field POSIX Cron Expression Parser]');

// 1. Asterisk expansion
const wild = CronParser.parse('* * * * *');
check('Minutes wildcard expands to 60 values (0-59)', wild.minutes.length === 60 && wild.minutes[0] === 0 && wild.minutes[59] === 59);
check('Hours wildcard expands to 24 values (0-23)', wild.hours.length === 24 && wild.hours[0] === 0 && wild.hours[23] === 23);
check('Days of month wildcard expands to 31 values (1-31)', wild.daysOfMonth.length === 31);
check('Months wildcard expands to 12 values (1-12)', wild.months.length === 12);
check('Days of week wildcard expands to 7 values (0-6)', wild.daysOfWeek.length === 7);

// 2. Step notation
const steps = CronParser.parse('*/15 */6 * * *');
check('Step */15 minutes expands to [0, 15, 30, 45]', JSON.stringify(steps.minutes) === JSON.stringify([0, 15, 30, 45]));
check('Step */6 hours expands to [0, 6, 12, 18]', JSON.stringify(steps.hours) === JSON.stringify([0, 6, 12, 18]));

// 3. Range and List combinations
const rangeList = CronParser.parse('1-5,30,45-47 * * * *');
check('Range & List parses correctly', JSON.stringify(rangeList.minutes) === JSON.stringify([1, 2, 3, 4, 5, 30, 45, 46, 47]));

// 4. Error boundaries
try {
  CronParser.parse('* * * *'); // only 4 fields
  assert.fail('Should fail on 4 fields');
} catch (e) {
  check('Reject cron with fewer than 5 fields', e.message.includes('Invalid cron format'));
}

try {
  CronParser.parse('60 * * * *'); // minute 60 is out of bounds
  assert.fail('Should fail on minute 60');
} catch (e) {
  check('Reject cron field exceeding bounds', e.message.includes('out of bounds'));
}

try {
  CronParser.parse('*/0 * * * *'); // step 0 is invalid
  assert.fail('Should fail on step 0');
} catch (e) {
  check('Reject invalid step size', e.message.includes('Invalid step'));
}

// 5. Next Run Date computation
const baseDate = new Date('2026-09-20T12:00:00Z');
const nextRun = CronParser.getNextRunDate('0 14 * * *', baseDate); // Next 14:00
check('getNextRunDate returns future Date', nextRun instanceof Date && nextRun > baseDate);
check('Calculated next run hour matches 14', nextRun.getHours() === 14);
check('Calculated next run minute matches 0', nextRun.getMinutes() === 0);

// ----------------------------------------------------
// SECTION 3: Exponential Backoff & Jitter
// ----------------------------------------------------
console.log('\n[SECTION 3: Exponential Backoff & Jitter Logic]');

const b1 = BackoffCalculator.compute(1, { baseMs: 1000, maxMs: 10000, jitter: 'none' });
const b2 = BackoffCalculator.compute(2, { baseMs: 1000, maxMs: 10000, jitter: 'none' });
const b3 = BackoffCalculator.compute(3, { baseMs: 1000, maxMs: 10000, jitter: 'none' });
const b6 = BackoffCalculator.compute(6, { baseMs: 1000, maxMs: 10000, jitter: 'none' });

check('Attempt 1 delay equals baseMs (1000)', b1 === 1000);
check('Attempt 2 delay equals 2x baseMs (2000)', b2 === 2000);
check('Attempt 3 delay equals 4x baseMs (4000)', b3 === 4000);
check('Attempt 6 delay capped at maxMs (10000)', b6 === 10000);

const jittered = BackoffCalculator.compute(3, { baseMs: 1000, maxMs: 10000, jitter: 'full' });
check('Full jitter output is within [0, 4000]', jittered >= 0 && jittered <= 4000);

// ----------------------------------------------------
// SECTION 4: Execution Engine, Retries & DLQ
// ----------------------------------------------------
console.log('\n[SECTION 4: Scheduler Execution Engine & DLQ Lifecycle]');

(async () => {
  const sched = new ChronosScheduler({ concurrency: 2 });

  // 1. Success execution
  let executionCount = 0;
  const successJob = sched.schedule('test-success', 'Task Success', '*/5 * * * *', async () => {
    executionCount++;
    return { ok: true };
  });

  check('Job scheduled with status SCHEDULED', successJob.status === 'SCHEDULED');
  check('Scheduler active jobs count is 1', sched.jobs.size === 1);

  const execResult = await sched.executeJob(successJob);
  check('Execution returns success true', execResult.success === true);
  check('Handler executed successfully', executionCount === 1);
  check('Job attempts reset to 0 after success', successJob.attempts === 0);

  // 2. Failure and Retry
  const failJob = sched.schedule('test-fail', 'Failing Task', '*/10 * * * *', async () => {
    throw new Error('Database connection timeout');
  }, { maxRetries: 2, baseMs: 100 });

  const fail1 = await sched.executeJob(failJob);
  check('First failure returns status RETRYING', fail1.status === 'RETRYING');
  check('First failure attempt is 1', fail1.attempts === 1);
  check('Next run timestamp scheduled in future', failJob.nextRunAt > Date.now());

  const fail2 = await sched.executeJob(failJob);
  check('Second failure returns status RETRYING', fail2.status === 'RETRYING');
  check('Second failure attempt is 2', fail2.attempts === 2);

  const fail3 = await sched.executeJob(failJob);
  check('Exceeding maxRetries moves job to DEAD_LETTER', fail3.status === 'DEAD_LETTER');
  check('Job present in Dead Letter Queue (DLQ)', sched.deadLetterQueue.has('test-fail'));

  // 3. DLQ Resurrect
  const res = sched.resurrectDLQ('test-fail');
  check('Resurrect DLQ job returns true', res.resurrected === true);
  check('Job removed from DLQ', !sched.deadLetterQueue.has('test-fail'));
  check('Resurrected job status is SCHEDULED', failJob.status === 'SCHEDULED');

  // 4. Job Cancellation
  const cancelled = sched.cancelJob('test-fail');
  check('cancelJob returns true', cancelled === true);
  check('Cancelled job removed from active map', !sched.jobs.has('test-fail'));

  // ----------------------------------------------------
  // SECTION 5: Ephemeral HTTP Integration & REST Protocol
  // ----------------------------------------------------
  console.log('\n[SECTION 5: Ephemeral HTTP Server & REST Protocol]');

  const server = startServer(0, () => {
    const port = server.address().port;
    console.log(`  [HTTP] Ephemeral server running on port ${port}`);

    function api(method, path, body, cb) {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            cb(res.statusCode, JSON.parse(raw));
          } catch (e) {
            cb(res.statusCode, raw);
          }
        });
      });
      if (payload) req.write(payload);
      req.end();
    }

    // 1. GET /api/health
    api('GET', '/api/health', null, (status, resHealth) => {
      check('GET /api/health returns HTTP 200', status === 200);
      check('Health response reports service as Chronos-Scheduler', resHealth.service === 'Chronos-Scheduler');
      check('Health response status is UP', resHealth.status === 'UP');

      // 2. GET /api/stats
      api('GET', '/api/stats', null, (status, resStats) => {
        check('GET /api/stats returns HTTP 200', status === 200);
        check('Stats includes activeJobsCount', typeof resStats.stats.activeJobsCount === 'number');

        // 3. POST /api/cron/validate
        api('POST', '/api/cron/validate', { cronExp: '*/10 9-17 * * 1-5' }, (status, resCron) => {
          check('POST /api/cron/validate returns HTTP 200', status === 200);
          check('Returns 5 future occurrences', resCron.nextFiveOccurrences.length === 5);

          // 4. POST /api/jobs/schedule
          api('POST', '/api/jobs/schedule', {
            id: 'nightly-report',
            taskName: 'Generate Nightly PDF Report',
            cronExp: '0 3 * * *'
          }, (status, resSched) => {
            check('POST /api/jobs/schedule returns HTTP 201', status === 201);
            check('Created job id matches nightly-report', resSched.job.id === 'nightly-report');

            // 5. POST /api/jobs/run-now
            api('POST', '/api/jobs/run-now', { id: 'nightly-report' }, (status, resRun) => {
              check('POST /api/jobs/run-now returns HTTP 200', status === 200);
              check('Run-now returns success true', resRun.outcome.success === true);

              // 6. GET /api/jobs
              api('GET', '/api/jobs', null, (status, resJobs) => {
                check('GET /api/jobs returns job list', Array.isArray(resJobs.jobs));
                check('Job list contains nightly-report', resJobs.jobs.some(j => j.id === 'nightly-report'));

                // 7. POST /api/jobs/cancel
                api('POST', '/api/jobs/cancel', { id: 'nightly-report' }, (status, resCancel) => {
                  check('POST /api/jobs/cancel returns HTTP 200', status === 200);
                  check('Cancellation confirmed', resCancel.success === true);

                  // 8. 404 Route
                  api('GET', '/api/non-existent-route', null, (status) => {
                    check('Unmapped endpoint returns 404', status === 404);

                    server.close(() => {
                      console.log('\n====================================================');
                      console.log(`🎉 ALL ${passedAssertions} ASSERTIONS PASSED (100% Non-Mocked Coverage)`);
                      console.log('====================================================');
                      process.exit(0);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
})();
