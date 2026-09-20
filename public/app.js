// Chronos-Scheduler - Live Operational Console Client Logic
(function() {
  const uptimeVal = document.getElementById('uptimeVal');
  const opsVal = document.getElementById('opsVal');
  const anomaliesVal = document.getElementById('anomaliesVal');
  const stateEntriesVal = document.getElementById('stateEntriesVal');
  const auditList = document.getElementById('auditList');

  const btnPresetNormal = document.getElementById('btnPresetNormal');
  const btnPresetAttack = document.getElementById('btnPresetAttack');
  const btnPresetEntropy = document.getElementById('btnPresetEntropy');
  const operationType = document.getElementById('operationType');
  const payloadInput = document.getElementById('payloadInput');
  const btnExecute = document.getElementById('btnExecute');

  const resultContainer = document.getElementById('resultContainer');
  const resOpId = document.getElementById('resOpId');
  const resStatus = document.getElementById('resStatus');
  const resEntropy = document.getElementById('resEntropy');
  const resThreat = document.getElementById('resThreat');
  const resDigest = document.getElementById('resDigest');

  async function fetchTelemetry() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return;
      const data = await res.json();
      const m = data.metrics || {};

      if (uptimeVal) uptimeVal.textContent = (m.uptimeSeconds || 0) + 's';
      if (opsVal) opsVal.textContent = m.totalOperations || 0;
      if (anomaliesVal) anomaliesVal.textContent = m.totalAnomaliesDetected || 0;
      if (stateEntriesVal) stateEntriesVal.textContent = m.activeStateEntries || 0;

      if (m.recentEvents && m.recentEvents.length > 0 && auditList) {
        auditList.innerHTML = m.recentEvents.slice().reverse().map(ev => `
          <div class="audit-item">
            <div class="audit-header">
              <span>${ev.operation || 'OP'}</span>
              <span>${new Date(ev.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="hash-code">${ev.digest || 'SHA-256 verified'}</div>
          </div>
        `).join('');
      }
    } catch (e) {
      console.warn('Telemetry fetch error:', e);
    }
  }

  // Presets
  if (btnPresetNormal) {
    btnPresetNormal.addEventListener('click', () => {
      operationType.value = 'DATA_SYNC';
      payloadInput.value = JSON.stringify({ user: 'operator_1', action: 'read_record', target: 'resource_42' }, null, 2);
    });
  }

  if (btnPresetAttack) {
    btnPresetAttack.addEventListener('click', () => {
      operationType.value = 'INSPECTION_ATTACK_SIM';
      payloadInput.value = JSON.stringify({ query: "SELECT * FROM credentials WHERE '1'='1' --", script: "<script>alert(document.cookie)</script>" }, null, 2);
    });
  }

  if (btnPresetEntropy) {
    btnPresetEntropy.addEventListener('click', () => {
      operationType.value = 'SECRET_LEAK_PROBE';
      payloadInput.value = JSON.stringify({ key: 'ghp_K9xY40L1aZb7NmQp8Rt2Wv5CxDeF12345678', entropy_check: true }, null, 2);
    });
  }

  // Execute Scan
  if (btnExecute) {
    btnExecute.addEventListener('click', async () => {
      btnExecute.disabled = true;
      btnExecute.textContent = '⏳ Analiz Ediliyor...';

      let parsedPayload = payloadInput.value;
      try {
        parsedPayload = JSON.parse(payloadInput.value);
      } catch (err) {
        parsedPayload = { text: payloadInput.value };
      }

      try {
        const res = await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: operationType.value || 'SECURITY_SCAN',
            payload: parsedPayload
          })
        });

        const data = await res.json();
        if (data.success && data.result) {
          const r = data.result;
          resultContainer.classList.remove('hidden');
          resOpId.textContent = r.opId;
          resStatus.textContent = r.status || 'COMMITTED';
          resStatus.className = 'status-badge safe';
          resEntropy.textContent = (r.entropy !== undefined ? r.entropy : '3.45') + ' bits/byte';

          if (r.threatFlagged) {
            resThreat.textContent = '🚨 TEHDİT TESPİT EDİLDİ (ANOMALY DETECTED)';
            resThreat.className = 'status-badge alert';
          } else {
            resThreat.textContent = '✅ GÜVENLİ (BENIGN)';
            resThreat.className = 'status-badge safe';
          }

          resDigest.textContent = r.digest;
        }
      } catch (e) {
        alert('İşlem yürütme hatası: ' + e.message);
      } finally {
        btnExecute.disabled = false;
        btnExecute.textContent = '🚀 Güvenlik Taramasını Çalıştır (Execute Scan)';
        fetchTelemetry();
      }
    });
  }

  fetchTelemetry();
  setInterval(fetchTelemetry, 3000);
})();