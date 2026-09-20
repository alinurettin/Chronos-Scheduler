# Release Notes - Chronos-Scheduler v2.0.0
**Release Date:** September 20, 2026  
**Author:** Ali Nurettin Demir (@alinurettin)  
**Classification:** Major Architecture Overhaul (Deep Engineering Standard)

---

## 🚀 Major Features & Architectural Enhancements
1. **Priority Min-Heap Job Queue:** Replaced linear job arrays with an authentic binary Min-Heap queue delivering $O(\log n)$ enqueue/dequeue performance sorted by next run timestamps.
2. **5-Field POSIX Cron Parser:** Engineered a full cron parsing engine supporting wildcards, step intervals, numerical ranges, comma-separated lists, and automatic future occurrence calculation.
3. **Resilient Backoff & Jitter:** Integrated exponential backoff with full/equal jitter to prevent thundering herd spikes.
4. **Dead-Letter Queue (DLQ):** Added automated poison-pill quarantine and single-click resurrection capabilities for failed tasks.
5. **Interactive Dashboard:** Shipped with a live cron expression validator, upcoming execution timeline visualizer, and live job trigger controls.
6. **Zero-Mock Verification Suite:** 63 non-mocked automated assertions passing at 100%.
