// Chronos-Scheduler - Production Distributed Scheduler REST Server
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ChronosScheduler, CronParser, BackoffCalculator } = require('./engine');

const scheduler = new ChronosScheduler({ concurrency: 4 });
const PORT = parseInt(process.env.PORT, 10) || 6010;
const publicDir = path.join(__dirname, '..', 'public');
const startTime = Date.now();

// Register initial sample jobs
scheduler.schedule('db-backup', 'Database Cold Snapshot', '0 2 * * *', async () => ({ sizeBytes: 1048576 }));
scheduler.schedule('cache-prune', 'Prune Expired LRU Entries', '*/15 * * * *', async () => ({ pruned: 42 }));
scheduler.schedule('telemetry-sync', 'Push Prometheus Metrics', '*/5 * * * *', async () => ({ pushed: true }));

function requestHandler(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    // 1. Health
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        status: 'UP',
        service: 'Chronos-Scheduler',
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString()
      }));
    }

    // 2. Stats
    if (pathname === '/api/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        success: true,
        service: 'Chronos-Scheduler',
        stats: scheduler.getStats(),
        history: scheduler.history.slice(-10)
      }));
    }

    // 3. List Scheduled Jobs
    if (req.method === 'GET' && pathname === '/api/jobs') {
      const jobs = Array.from(scheduler.jobs.values()).map(j => ({
        id: j.id,
        taskName: j.taskName,
        cronExp: j.cronExp,
        status: j.status,
        attempts: j.attempts,
        maxRetries: j.maxRetries,
        nextRunAt: j.nextRunAt,
        nextRunIso: new Date(j.nextRunAt).toISOString(),
        lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
        lastError: j.lastError
      }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: true, count: jobs.length, jobs }));
    }

    // 4. Schedule New Job
    if (req.method === 'POST' && pathname === '/api/jobs/schedule') {
      try {
        const data = JSON.parse(body || '{}');
        const job = scheduler.schedule(data.id, data.taskName, data.cronExp, null, {
          maxRetries: data.maxRetries,
          baseMs: data.baseMs
        });
        res.writeHead(201, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: true, job }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 5. Execute Job Now (Force Run)
    if (req.method === 'POST' && pathname === '/api/jobs/run-now') {
      try {
        const data = JSON.parse(body || '{}');
        const job = scheduler.getJob(data.id);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: 'Job not found' }));
        }
        const outcome = await scheduler.executeJob(job);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: true, outcome }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 6. Cancel Job
    if (req.method === 'POST' && pathname === '/api/jobs/cancel') {
      try {
        const data = JSON.parse(body || '{}');
        const cancelled = scheduler.cancelJob(data.id);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: cancelled, id: data.id }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 7. List Dead Letter Queue (DLQ)
    if (req.method === 'GET' && pathname === '/api/dlq') {
      const records = Array.from(scheduler.deadLetterQueue.values());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ success: true, count: records.length, records }));
    }

    // 8. Resurrect DLQ Job
    if (req.method === 'POST' && pathname === '/api/dlq/resurrect') {
      try {
        const data = JSON.parse(body || '{}');
        const result = scheduler.resurrectDLQ(data.id);
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify({ success: false, error: 'DLQ record not found' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: true, result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 9. Validate & Preview Cron Expression
    if (req.method === 'POST' && pathname === '/api/cron/validate') {
      try {
        const data = JSON.parse(body || '{}');
        const parsedCron = CronParser.parse(data.cronExp);
        const nextDates = [];
        let cursor = new Date();
        for (let i = 0; i < 5; i++) {
          const next = CronParser.getNextRunDate(data.cronExp, cursor);
          nextDates.push(next.toISOString());
          cursor = next;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          success: true,
          cronExp: data.cronExp,
          parsed: {
            minutes: parsedCron.minutes,
            hours: parsedCron.hours,
            daysOfMonth: parsedCron.daysOfMonth,
            months: parsedCron.months,
            daysOfWeek: parsedCron.daysOfWeek
          },
          nextFiveOccurrences: nextDates
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // 10. Static Web UI Files
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return res.end(fs.readFileSync(filePath));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint Not Found', path: pathname }));
  });
}

function startServer(portToUse = PORT, callback) {
  const server = http.createServer(requestHandler);
  server.listen(portToUse, () => {
    if (callback) callback(server);
  });
  return server;
}

if (require.main === module) {
  startServer(PORT, () => {
    console.log('⚡ Chronos-Scheduler live on port ' + PORT);
  });
}

module.exports = { startServer, requestHandler, scheduler };
