(function () {
  "use strict";

  const state = {
    data: null,
    eventSource: null,
    refreshTimer: null,
    pollTimer: null,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  function formatCompact(value) {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Number(value || 0));
  }

  function formatTimestamp(value) {
    if (!value) {
      return "Never";
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return "Never";
    }

    return new Date(timestamp).toLocaleString();
  }

  function stateLabel(activityState) {
    const labels = {
      active: "Active",
      recent: "Recent",
      idle: "Idle",
      dormant: "Dormant",
    };

    return labels[activityState] || "Unknown";
  }

  function setConnectionStatus(kind, label) {
    const element = document.getElementById("acp-connection-status");
    if (!element) {
      return;
    }

    element.className = `status-pill ${kind}`;
    element.innerHTML = `<span class="pulse"></span>${escapeHtml(label)}`;
  }

  function fetchJson(url) {
    return fetch(url).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      return response.json();
    });
  }

  function renderSummary(summary) {
    const container = document.getElementById("acp-summary");
    if (!container || !summary) {
      return;
    }

    const cards = [
      {
        label: "Configured agents",
        value: formatNumber(summary.totalAgents),
        footnote: `${summary.activeAgents} active, ${summary.recentAgents} warm`,
      },
      {
        label: "Live sessions",
        value: formatNumber(summary.activeSessions),
        footnote: `${summary.recentSessions} recent, ${summary.totalSessions} total tracked`,
      },
      {
        label: "Bindings",
        value: formatNumber(summary.totalBindings),
        footnote: summary.channels[0]
          ? `Busiest channel: ${summary.channels[0].label}`
          : "No routing observed yet",
      },
      {
        label: "Messages",
        value: formatCompact(summary.totalMessages),
        footnote: `${formatCompact(summary.totalToolCalls)} tool calls stitched from transcripts`,
      },
      {
        label: "Tokens",
        value: formatCompact(summary.totalTokens),
        footnote: summary.models[0]
          ? `Top model: ${summary.models[0].label}`
          : "No token usage captured yet",
      },
      {
        label: "Last heartbeat",
        value: summary.lastActivityAt ? formatTimestamp(summary.lastActivityAt).split(",")[1]?.trim() || "Now" : "Never",
        footnote: summary.lastActivityAt ? formatTimestamp(summary.lastActivityAt) : "No session history",
      },
    ];

    container.innerHTML = cards
      .map(
        (card) => `
          <article class="acp-summary-card">
            <div class="acp-summary-label">${escapeHtml(card.label)}</div>
            <div class="acp-summary-value">${escapeHtml(card.value)}</div>
            <div class="acp-summary-footnote">${escapeHtml(card.footnote)}</div>
          </article>
        `,
      )
      .join("");
  }

  function renderDistribution(targetId, items) {
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }

    if (!items || items.length === 0) {
      element.innerHTML = '<div class="acp-muted">No data yet.</div>';
      return;
    }

    const max = Math.max(...items.map((item) => item.count), 1);
    element.innerHTML = items
      .map(
        (item) => `
          <div class="acp-distribution-item">
            <div class="acp-distribution-label">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(formatNumber(item.count))}</strong>
            </div>
            <div class="acp-bar-track">
              <div class="acp-bar-fill" style="width:${Math.max(8, Math.round((item.count / max) * 100))}%"></div>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function renderSkills(skills) {
    const element = document.getElementById("acp-skills");
    if (!element) {
      return;
    }

    if (!skills || skills.length === 0) {
      element.innerHTML = '<div class="acp-muted">No skill snapshots observed yet.</div>';
      return;
    }

    element.innerHTML = skills
      .map(
        (skill) =>
          `<span class="acp-tag">${escapeHtml(skill.label)}<small>${escapeHtml(formatNumber(skill.count))}</small></span>`,
      )
      .join("");
  }

  function renderAgentCard(agent) {
    const pulseStrip = (agent.recentSessions || [])
      .map(
        (session) =>
          `<span class="acp-pulse-node ${escapeHtml(session.status)}" title="${escapeHtml(`${session.label} • ${session.ageLabel}`)}"></span>`,
      )
      .join("");

    const bindings = agent.bindings.length
      ? agent.bindings
          .map(
            (binding) =>
              `<span class="acp-chip"><strong>route</strong>${escapeHtml(binding.description)}</span>`,
          )
          .join("")
      : '<span class="acp-chip"><strong>route</strong>No explicit bindings</span>';

    const channels = agent.channels.length
      ? agent.channels
          .slice(0, 4)
          .map(
            (channel) =>
              `<span class="acp-chip"><strong>channel</strong>${escapeHtml(channel.label)} · ${escapeHtml(formatNumber(channel.count))}</span>`,
          )
          .join("")
      : '<span class="acp-chip"><strong>channel</strong>No sessions yet</span>';

    const skills = agent.skills.length
      ? agent.skills
          .slice(0, 5)
          .map(
            (skill) =>
              `<span class="acp-chip"><strong>skill</strong>${escapeHtml(skill.label)} · ${escapeHtml(formatNumber(skill.count))}</span>`,
          )
          .join("")
      : '<span class="acp-chip"><strong>skill</strong>No snapshots yet</span>';

    const recentSessions = agent.recentSessions.length
      ? agent.recentSessions
          .map(
            (session) => `
              <article class="acp-session-item">
                <div class="acp-session-item-head">
                  <div class="acp-session-item-title">${escapeHtml(session.label)}</div>
                  <span class="acp-state-pill ${escapeHtml(session.status)}">${escapeHtml(stateLabel(session.status))}</span>
                </div>
                <div class="acp-session-inline-meta">
                  ${escapeHtml(session.channel)} · ${escapeHtml(session.model)} · ${escapeHtml(session.ageLabel)}
                </div>
                <div class="acp-card-note">
                  ${escapeHtml(session.preview || "No transcript preview yet.")}
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="acp-muted">No session history for this agent yet.</div>';

    const authLabel = agent.auth.providerCount
      ? `${agent.auth.providerCount} provider${agent.auth.providerCount === 1 ? "" : "s"}`
      : "No auth profiles";
    const catalogLabel = agent.modelCatalog.modelCount
      ? `${agent.modelCatalog.modelCount} catalog model${agent.modelCatalog.modelCount === 1 ? "" : "s"}`
      : "No model catalog";

    return `
      <article class="acp-agent-card state-${escapeHtml(agent.activityState)}">
        <div class="acp-agent-head">
          <div>
            <div class="acp-agent-name">
              <h3>${escapeHtml(agent.name)}</h3>
              ${agent.isDefault ? '<span class="acp-badge">default</span>' : ""}
            </div>
            <div class="acp-agent-meta">
              ${escapeHtml(agent.configuredModel || "No configured model")} · ${escapeHtml(agent.workspace || "No workspace path")}
            </div>
          </div>
          <span class="acp-state-pill ${escapeHtml(agent.activityState)}">${escapeHtml(stateLabel(agent.activityState))}</span>
        </div>

        <div class="acp-metric-row">
          <div class="acp-metric">
            <div class="acp-metric-label">Sessions</div>
            <div class="acp-metric-value">${escapeHtml(formatNumber(agent.stats.totalSessions))}</div>
          </div>
          <div class="acp-metric">
            <div class="acp-metric-label">Messages</div>
            <div class="acp-metric-value">${escapeHtml(formatCompact(agent.stats.totalMessages))}</div>
          </div>
          <div class="acp-metric">
            <div class="acp-metric-label">Tool Calls</div>
            <div class="acp-metric-value">${escapeHtml(formatCompact(agent.stats.totalToolCalls))}</div>
          </div>
          <div class="acp-metric">
            <div class="acp-metric-label">Last Seen</div>
            <div class="acp-metric-value">${escapeHtml(agent.stats.lastActivityLabel)}</div>
          </div>
        </div>

        <div class="acp-pulse-strip" title="Recent heartbeat">
          ${pulseStrip || '<span class="acp-muted">No pulse yet.</span>'}
        </div>

        <div class="acp-card-block">
          <div class="acp-card-heading">Routes</div>
          <div class="acp-chip-row">${bindings}</div>
        </div>

        <div class="acp-card-block">
          <div class="acp-card-heading">Coverage</div>
          <div class="acp-chip-row">${channels}</div>
        </div>

        <div class="acp-card-block">
          <div class="acp-card-heading">Loadout</div>
          <div class="acp-chip-row">
            <span class="acp-chip"><strong>auth</strong>${escapeHtml(authLabel)}</span>
            <span class="acp-chip"><strong>catalog</strong>${escapeHtml(catalogLabel)}</span>
            ${skills}
          </div>
        </div>

        <div class="acp-card-block">
          <div class="acp-card-heading">Recent sessions</div>
          <div class="acp-session-list">${recentSessions}</div>
        </div>
      </article>
    `;
  }

  function renderAgents(agents) {
    const container = document.getElementById("acp-agent-grid");
    if (!container) {
      return;
    }

    if (!agents || agents.length === 0) {
      container.innerHTML = '<div class="acp-muted">No configured ACP agents found.</div>';
      return;
    }

    container.innerHTML = agents.map((agent) => renderAgentCard(agent)).join("");
  }

  function renderRecentSessions(sessions) {
    const table = document.getElementById("acp-session-table");
    const empty = document.getElementById("acp-empty-state");
    if (!table || !empty) {
      return;
    }

    if (!sessions || sessions.length === 0) {
      table.innerHTML = "";
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    table.innerHTML = sessions
      .map(
        (session) => `
          <tr>
            <td>
              <div class="acp-table-agent">${escapeHtml(session.agentName || session.agentId)}</div>
              <div class="acp-table-note">${escapeHtml(session.agentId)}</div>
            </td>
            <td>
              <div>${escapeHtml(session.label)}</div>
              <div class="acp-table-note">${escapeHtml(session.preview || session.sessionKey)}</div>
            </td>
            <td>${escapeHtml(session.channel)}</td>
            <td><span class="acp-state-pill ${escapeHtml(session.status)}">${escapeHtml(stateLabel(session.status))}</span></td>
            <td>${escapeHtml(session.model)}</td>
            <td>${escapeHtml(formatNumber(session.messageCount))}</td>
            <td>${escapeHtml(formatNumber(session.toolCalls))}</td>
            <td>${escapeHtml(formatCompact(session.totalTokens))}</td>
            <td>
              <div>${escapeHtml(session.ageLabel)}</div>
              <div class="acp-table-note">${escapeHtml(formatTimestamp(session.updatedAt))}</div>
            </td>
          </tr>
        `,
      )
      .join("");
  }

  function render(data) {
    state.data = data;
    renderSummary(data.summary);
    renderAgents(data.agents);
    renderDistribution("acp-channels", data.summary.channels);
    renderDistribution("acp-models", data.summary.models);
    renderSkills(data.summary.skills);
    renderRecentSessions(data.recentSessions);

    const generatedAt = document.getElementById("acp-generated-at");
    if (generatedAt) {
      generatedAt.textContent = `Updated ${formatTimestamp(data.generatedAt)}`;
    }
  }

  async function loadData() {
    try {
      const data = await fetchJson("/api/acp/agents");
      render(data);
      setConnectionStatus("connected", "Live");
    } catch (error) {
      console.error("[ACP] Failed to load data:", error);
      setConnectionStatus("disconnected", "Fetch failed");
    }
  }

  function scheduleRefresh(delay = 250) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      loadData();
    }, delay);
  }

  function startPolling() {
    if (state.pollTimer) {
      return;
    }

    state.pollTimer = setInterval(() => {
      loadData();
    }, 30000);
  }

  function stopPolling() {
    if (!state.pollTimer) {
      return;
    }

    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function connectEvents() {
    if (typeof EventSource === "undefined") {
      setConnectionStatus("connecting", "Polling");
      startPolling();
      return;
    }

    state.eventSource = new EventSource("/api/events");

    state.eventSource.onopen = () => {
      setConnectionStatus("connected", "Live");
      stopPolling();
    };

    state.eventSource.addEventListener("update", () => {
      scheduleRefresh(200);
    });

    state.eventSource.addEventListener("heartbeat", () => {
      scheduleRefresh(300);
    });

    state.eventSource.onerror = () => {
      setConnectionStatus("connecting", "Reconnecting");
      startPolling();
    };
  }

  function init() {
    const refreshButton = document.getElementById("acp-refresh-button");
    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        loadData();
      });
    }

    loadData();
    connectEvents();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh(100);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
