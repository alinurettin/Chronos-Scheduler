console.log('Chronos-Scheduler UI initialized');
fetch('/api/stats')
  .then(res => res.json())
  .then(data => console.log('Telemetry:', data))
  .catch(err => console.error(err));
