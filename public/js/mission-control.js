(function () {
  "use strict";

  const state = {
    missionControl: null,
    selectedCardId: null,
    timeline: [],
    replay: [],
  };

  let eventSource = null;
  let refreshTimer = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return "0m";
    }
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${totalMinutes}m`;
  }

  function syncStatusClass(sync) {
    return sync?.status || "idle";
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function loadMissionControl() {
    state.missionControl = await fetchJson("/api/mission-control");
    const activeCards = state.missionControl.activeCards || [];
    if (!state.selectedCardId || !activeCards.some((card) => card.id === state.selectedCardId)) {
      state.selectedCardId = activeCards[0]?.id || state.missionControl.masterCards?.[0]?.id || null;
    }

    render();

    if (state.selectedCardId) {
      await loadCardDetail(state.selectedCardId);
    }
  }

  async function loadCardDetail(cardId) {
    state.selectedCardId = cardId;
    const [timelineResponse, replayResponse] = await Promise.all([
      fetchJson(`/api/mission-control/cards/${encodeURIComponent(cardId)}/timeline`),
      fetchJson(`/api/mission-control/cards/${encodeURIComponent(cardId)}/replay`),
    ]);
    state.timeline = timelineResponse.timeline || [];
    state.replay = replayResponse.replay || [];
    renderDetail();
    renderTable();
  }

  async function selectView(viewId) {
    await fetchJson("/api/mission-control/views/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewId }),
    });
    await loadMissionControl();
  }

  async function triggerReconcile() {
    const button = document.getElementById("mc-reconcile-button");
    if (button) button.disabled = true;
    try {
      await fetchJson("/api/mission-control/reconcile", { method: "POST" });
      await loadMissionControl();
    } finally {
      if (button) button.disabled = false;
    }
  }

  function render() {
    renderHeader();
    renderStats();
    renderViews();
    renderTable();
    renderRunbooks();
    renderDetail();
  }

  function renderHeader() {
    const sync = state.missionControl?.sync || {};
    const el = document.getElementById("mc-sync-status");
    if (!el) return;
    el.className = `mc-status-pill ${syncStatusClass(sync)}`;
    el.textContent = `${sync.status || "idle"} · lag ${formatDuration(sync.lagMs || 0)}`;
  }

  function renderStats() {
    const container = document.getElementById("mc-stats");
    if (!container || !state.missionControl) return;

    const { stats, activeView, diagnostics, sync } = state.missionControl;
    const cards = [
      { label: "Total cards", value: stats.totalCards, help: `${stats.eventCount} audit events` },
      { label: "Active view", value: activeView?.name || "All", help: `${stats.activeCards} visible cards` },
      { label: "Needs review", value: stats.needsReview, help: "Human review queue" },
      { label: "Stale work", value: diagnostics.staleCards, help: "Aging beyond threshold" },
      {
        label: "Divergence",
        value: Object.values(diagnostics.divergenceBySource || {}).reduce((sum, count) => sum + count, 0),
        help: `poll ${diagnostics.divergenceBySource?.poll || 0} · webhook ${diagnostics.divergenceBySource?.webhook || 0} · state ${diagnostics.divergenceBySource?.state_write || 0}`,
      },
      { label: "Poll lag", value: formatDuration(sync.lagMs || 0), help: sync.lastReason || "steady" },
    ];

    container.innerHTML = cards
      .map(
        (card) => `
          <article class="mc-stat">
            <div class="mc-stat-label">${escapeHtml(card.label)}</div>
            <div class="mc-stat-value">${escapeHtml(card.value)}</div>
            <div class="mc-stat-help">${escapeHtml(card.help)}</div>
          </article>
        `,
      )
      .join("");
  }

  function renderViews() {
    const container = document.getElementById("mc-saved-views");
    if (!container || !state.missionControl) return;

    container.innerHTML = (state.missionControl.savedViews?.views || [])
      .map((view) => {
        const active = view.id === state.missionControl.savedViews.activeViewId;
        return `<button class="mc-view-button ${active ? "active" : ""}" data-view-id="${escapeHtml(view.id)}" type="button">${escapeHtml(view.name)}</button>`;
      })
      .join("");

    container.querySelectorAll("[data-view-id]").forEach((button) => {
      button.addEventListener("click", () => selectView(button.dataset.viewId));
    });
  }

  function renderTable() {
    const body = document.getElementById("mc-card-table");
    const empty = document.getElementById("mc-empty-state");
    if (!body || !state.missionControl) return;

    const cards = state.missionControl.activeCards || [];
    empty.hidden = cards.length > 0;
    body.innerHTML = cards
      .map((card) => {
        const selected = card.id === state.selectedCardId;
        const divergenceClass = card.diagnostics?.divergenceSource
          ? `divergence-${card.diagnostics.divergenceSource}`
          : "";

        return `
          <tr data-card-id="${escapeHtml(card.id)}" class="${selected ? "selected" : ""}">
            <td>
              <div class="mc-issue-title">${escapeHtml(card.primaryLinearIdentifier || card.id)}</div>
              <div>${escapeHtml(card.title)}</div>
              <div class="mc-issue-meta">${escapeHtml((card.originProjects || []).join(", ") || card.source?.projectKey || "Unmapped project")}</div>
            </td>
            <td>${escapeHtml(card.lane || "unassigned")}</td>
            <td><span class="mc-chip status-${escapeHtml(card.status)}">${escapeHtml(card.status)}</span></td>
            <td>
              <div>${escapeHtml(card.diagnostics?.queueAgeLabel || "0m")}</div>
              <div class="mc-issue-meta">threshold ${escapeHtml(card.diagnostics?.staleThresholdLabel || "-")}</div>
            </td>
            <td>
              <span class="mc-chip ${divergenceClass}">${escapeHtml(card.diagnostics?.divergenceSource || (card.diagnostics?.stale ? "stale" : "healthy"))}</span>
            </td>
          </tr>
        `;
      })
      .join("");

    body.querySelectorAll("[data-card-id]").forEach((row) => {
      row.addEventListener("click", () => loadCardDetail(row.dataset.cardId));
    });
  }

  function renderDetail() {
    const container = document.getElementById("mc-card-detail");
    if (!container || !state.missionControl) return;

    const card = (state.missionControl.masterCards || []).find((entry) => entry.id === state.selectedCardId);
    if (!card) {
      container.innerHTML = '<div class="mc-empty">Select a Mission Control card to inspect its audit trail.</div>';
      return;
    }

    const diagnostics = card.diagnostics || {};
    const timelineItems = state.timeline
      .slice()
      .reverse()
      .slice(0, 8)
      .map(
        (event) => `
          <div class="mc-list-item">
            <strong>${escapeHtml(event.type)}</strong>
            <div class="mc-muted">${escapeHtml(event.source || "system")} · ${escapeHtml(new Date(event.occurredAt).toLocaleString())}</div>
          </div>
        `,
      )
      .join("");
    const replayItems = state.replay
      .slice()
      .reverse()
      .slice(0, 6)
      .map(
        (step) => `
          <div class="mc-list-item">
            <strong>${escapeHtml(step.summary)}</strong>
            <div class="mc-muted">#${escapeHtml(step.sequence)} · ${escapeHtml(new Date(step.occurredAt).toLocaleString())}</div>
            <div class="mc-muted">Snapshot: ${escapeHtml(step.snapshot?.state?.name || "unchanged")}</div>
          </div>
        `,
      )
      .join("");
    const signalItems = (diagnostics.signals || [])
      .map((signal) => `<li>${escapeHtml(signal)}</li>`)
      .join("");

    container.innerHTML = `
      <div class="mc-detail-head">
        <h2>${escapeHtml(card.primaryLinearIdentifier || card.id)} · ${escapeHtml(card.title)}</h2>
        <div class="mc-chip-row">
          <span class="mc-chip status-${escapeHtml(card.status)}">${escapeHtml(card.status)}</span>
          <span class="mc-chip">${escapeHtml(card.lane || "unassigned")}</span>
          <span class="mc-chip">queue ${escapeHtml(diagnostics.queueAgeLabel || "0m")}</span>
          <span class="mc-chip ${diagnostics.divergenceSource ? `divergence-${escapeHtml(diagnostics.divergenceSource)}` : ""}">${escapeHtml(diagnostics.divergenceSource || "healthy")}</span>
        </div>
        <div class="mc-muted">${escapeHtml(card.summary || "No summary yet.")}</div>
      </div>
      <div class="mc-list">
        <div class="mc-list-item">
          <strong>Diagnostics</strong>
          <div class="mc-muted">${escapeHtml(diagnostics.recommendedAction || "No immediate operator action required.")}</div>
          <ul>${signalItems || "<li>No active divergence signals.</li>"}</ul>
        </div>
        <div class="mc-list-item">
          <strong>Sync Timeline</strong>
          <div class="mc-list">${timelineItems || '<div class="mc-muted">No timeline events yet.</div>'}</div>
        </div>
        <div class="mc-list-item">
          <strong>Replay Snapshots</strong>
          <div class="mc-list">${replayItems || '<div class="mc-muted">No replay snapshots yet.</div>'}</div>
        </div>
      </div>
    `;
  }

  function renderRunbooks() {
    const container = document.getElementById("mc-runbooks");
    if (!container || !state.missionControl) return;
    container.innerHTML = (state.missionControl.runbooks || [])
      .map(
        (runbook) => `
          <a href="${escapeHtml(runbook.path)}" target="_blank" rel="noreferrer">${escapeHtml(runbook.title)}</a>
        `,
      )
      .join("");
  }

  function connectEvents() {
    if (typeof EventSource === "undefined") {
      return;
    }

    eventSource = new EventSource("/api/events");
    eventSource.addEventListener("update", () => {
      loadMissionControl().catch((error) => console.error("[Mission Control] Refresh failed:", error));
    });
  }

  function setupControls() {
    document
      .getElementById("mc-refresh-button")
      ?.addEventListener("click", () => loadMissionControl().catch((error) => console.error(error)));
    document.getElementById("mc-reconcile-button")?.addEventListener("click", () => {
      triggerReconcile().catch((error) => console.error(error));
    });
  }

  async function init() {
    setupControls();
    connectEvents();
    refreshTimer = setInterval(() => {
      loadMissionControl().catch((error) => console.error(error));
    }, 30000);
    await loadMissionControl();
  }

  window.addEventListener("beforeunload", () => {
    if (eventSource) {
      eventSource.close();
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
