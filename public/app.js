// Chronos-Scheduler Client Application
document.addEventListener('DOMContentLoaded', () => {
  const statActive = document.getElementById('statActive');
  const statExecuted = document.getElementById('statExecuted');
  const statSuccessRate = document.getElementById('statSuccessRate');
  const statRetries = document.getElementById('statRetries');
  const statDlq = document.getElementById('statDlq');
  const dlqBadge = document.getElementById('dlqBadge');

  const cronInput = document.getElementById('cronInput');
  const validateCronBtn = document.getElementById('validateCronBtn');
  const timelineList = document.getElementById('timelineList');
  const chipMin = document.getElementById('chipMin');
  const chipHour = document.getElementById('chipHour');
  const chipDom = document.getElementById('chipDom');
  const chipMonth = document.getElementById('chipMonth');
  const chipDow = document.getElementById('chipDow');

  const scheduleForm = document.getElementById('scheduleForm');
  const jobIdInput = document.getElementById('jobIdInput');
  const jobNameInput = document.getElementById('jobNameInput');
  const jobCronInput = document.getElementById('jobCronInput');
  const jobRetriesInput = document.getElementById('jobRetriesInput');
  const jobBaseMsInput = document.getElementById('jobBaseMsInput');

  const jobsTableBody = document.getElementById('jobsTableBody');
  const dlqList = document.getElementById('dlqList');
  const refreshBtn = document.getElementById('refreshBtn');

  // Load telemetry stats
  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success && data.stats) {
        const s = data.stats;
        statActive.textContent = s.activeJobsCount;
        statExecuted.textContent = s.totalExecuted.toLocaleString();
        const rate = s.totalExecuted > 0 ? ((s.totalSucceeded / s.totalExecuted) * 100).toFixed(1) : 100;
        statSuccessRate.textContent = `${rate}% success rate (${s.totalSucceeded} succeeded)`;
        statRetries.textContent = s.totalRetried.toLocaleString();
        statDlq.textContent = s.dlqCount;
        dlqBadge.textContent = `${s.dlqCount} Poison Pills`;
      }
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }

  // Load scheduled jobs
  async function loadJobs() {
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      if (data.success && data.jobs) {
        renderJobs(data.jobs);
      }
    } catch (e) {
      console.error('Failed to load jobs', e);
    }
  }

  function renderJobs(jobs) {
    if (jobs.length === 0) {
      jobsTableBody.innerHTML = '<tr><td colspan="6" class="text-center">No scheduled jobs in queue. Add one above.</td></tr>';
      return;
    }

    jobsTableBody.innerHTML = '';
    jobs.forEach(j => {
      const tr = document.createElement('tr');
      const nextDate = new Date(j.nextRunAt).toLocaleTimeString();

      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; color: #f8fafc;">${j.taskName}</div>
          <div style="font-size: 0.75rem; color: #64748b; font-family: monospace;">${j.id}</div>
        </td>
        <td><span class="cron-badge">${j.cronExp}</span></td>
        <td><span class="status-tag ${j.status}">${j.status}</span></td>
        <td><span style="font-family: monospace; color: #38bdf8;">${nextDate}</span></td>
        <td><span style="color: #94a3b8;">${j.attempts} / ${j.maxRetries}</span></td>
        <td>
          <button class="btn-sm-run" data-id="${j.id}">Run Now</button>
          <button class="btn-sm-cancel" data-id="${j.id}">Cancel</button>
        </td>
      `;

      tr.querySelector('.btn-sm-run').addEventListener('click', () => runJobNow(j.id));
      tr.querySelector('.btn-sm-cancel').addEventListener('click', () => cancelJob(j.id));

      jobsTableBody.appendChild(tr);
    });
  }

  // Load Dead Letter Queue
  async function loadDLQ() {
    try {
      const res = await fetch('/api/dlq');
      const data = await res.json();
      if (data.success && data.records) {
        renderDLQ(data.records);
      }
    } catch (e) {
      console.error('Failed to load DLQ', e);
    }
  }

  function renderDLQ(records) {
    if (records.length === 0) {
      dlqList.innerHTML = '<div class="empty-state">No failed jobs in DLQ. All executions healthy.</div>';
      return;
    }

    dlqList.innerHTML = '';
    records.forEach(r => {
      const card = document.createElement('div');
      card.className = 'dlq-card';
      card.innerHTML = `
        <div class="dlq-info">
          <div class="dlq-id">${r.jobId} (${r.taskName})</div>
          <div class="dlq-err">${r.lastError || 'Max retries exhausted'}</div>
          <div style="font-size: 0.7rem; color: #94a3b8;">Attempts: ${r.attempts} &bull; Cron: ${r.cronExp}</div>
        </div>
        <button class="btn-sm-resurrect" data-id="${r.jobId}">Resurrect</button>
      `;

      card.querySelector('.btn-sm-resurrect').addEventListener('click', () => resurrectJob(r.jobId));
      dlqList.appendChild(card);
    });
  }

  // Evaluate Cron Expression
  async function evaluateCron(cronExp) {
    try {
      const res = await fetch('/api/cron/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cronExp })
      });
      const data = await res.json();
      if (data.success) {
        const p = data.parsed;
        chipMin.textContent = p.minutes.length === 60 ? 'Every (0-59)' : p.minutes.join(', ');
        chipHour.textContent = p.hours.length === 24 ? 'Every (0-23)' : p.hours.join(', ');
        chipDom.textContent = p.daysOfMonth.length === 31 ? 'Every (1-31)' : p.daysOfMonth.join(', ');
        chipMonth.textContent = p.months.length === 12 ? 'Every (1-12)' : p.months.join(', ');
        chipDow.textContent = p.daysOfWeek.length === 7 ? 'Every (0-6)' : p.daysOfWeek.join(', ');

        timelineList.innerHTML = '';
        data.nextFiveOccurrences.forEach((dateStr, idx) => {
          const li = document.createElement('li');
          const d = new Date(dateStr);
          li.textContent = `#${idx + 1}: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
          timelineList.appendChild(li);
        });
      } else {
        alert('Invalid cron expression: ' + data.error);
      }
    } catch (err) {
      console.error('Error evaluating cron', err);
    }
  }

  // Schedule Job Form
  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = jobIdInput.value.trim();
    const taskName = jobNameInput.value.trim();
    const cronExp = jobCronInput.value.trim();
    const maxRetries = parseInt(jobRetriesInput.value, 10);
    const baseMs = parseInt(jobBaseMsInput.value, 10);

    try {
      const res = await fetch('/api/jobs/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, taskName, cronExp, maxRetries, baseMs })
      });
      const data = await res.json();
      if (data.success) {
        jobIdInput.value = '';
        jobNameInput.value = '';
        await loadJobs();
        await loadStats();
      } else {
        alert('Failed to schedule job: ' + data.error);
      }
    } catch (err) {
      alert('Error scheduling job: ' + err.message);
    }
  });

  // Run Job Now
  async function runJobNow(id) {
    try {
      const res = await fetch('/api/jobs/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        await loadJobs();
        await loadStats();
      } else {
        alert('Execution failed: ' + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Cancel Job
  async function cancelJob(id) {
    try {
      const res = await fetch('/api/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        await loadJobs();
        await loadStats();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Resurrect DLQ Job
  async function resurrectJob(id) {
    try {
      const res = await fetch('/api/dlq/resurrect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await res.json();
      if (data.success) {
        await loadDLQ();
        await loadJobs();
        await loadStats();
      }
    } catch (err) {
      console.error(err);
    }
  }

  validateCronBtn.addEventListener('click', () => {
    evaluateCron(cronInput.value.trim());
  });

  refreshBtn.addEventListener('click', () => {
    loadJobs();
    loadDLQ();
    loadStats();
  });

  // Initial evaluation & load
  evaluateCron(cronInput.value.trim());
  loadJobs();
  loadDLQ();
  loadStats();
  setInterval(loadStats, 5000);
});
