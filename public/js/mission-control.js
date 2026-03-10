(function () {
  "use strict";

  const FILTER_DEFAULTS = Object.freeze({
    search: "",
    groupBy: "lane",
    lane: "",
    project: "",
    status: "",
    risk: "",
    dispatch: "",
    agent: "",
  });

  const FILTER_PARAM_KEYS = Object.freeze({
    search: "q",
    groupBy: "group",
    lane: "lane",
    project: "project",
    status: "status",
    risk: "risk",
    dispatch: "dispatch",
    agent: "agent",
  });

  const state = {
    board: null,
    filters: null,
    admin: null,
    view: readQueryState(),
  };

  let eventSource = null;
  let refreshTimer = null;
  let searchDebounce = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
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
    return `${Math.max(0, minutes)}m`;
  }

  function formatRelativeTime(value) {
    if (!value) {
      return "—";
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return "—";
    }

    return formatDuration(Math.max(0, Date.now() - timestamp));
  }

  function formatTimestamp(value) {
    if (!value) {
      return "—";
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return "—";
    }

    return new Date(timestamp).toLocaleString();
  }

  function humanizeToken(value, prefix) {
    const normalized = String(value || "")
      .replace(prefix || "", "")
      .replace(/_/g, " ")
      .replace(/-/g, " ")
      .trim();

    if (!normalized) {
      return "Unspecified";
    }

    return normalized
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function syncStatusClass(sync) {
    if (sync?.lag?.isStale) {
      return "stale";
    }
    return sync?.status || "idle";
  }

  function riskClass(risk) {
    if (risk === "high" || risk === "risk:high") {
      return "risk-high";
    }
    if (risk === "medium" || risk === "risk:medium") {
      return "risk-medium";
    }
    return "risk-low";
  }

  function statusClass(status) {
    return `status-${String(status || "new")
      .replace(/[^a-z0-9_]+/gi, "_")
      .toLowerCase()}`;
  }

  function dispatchClass(dispatch) {
    return dispatch === "dispatch:blocked" ? "dispatch-blocked" : "dispatch-ready";
  }

  function blockerClass(level) {
    if (level === "urgent") return "blocker-urgent";
    if (level === "warning") return "blocker-warning";
    return "blocker-clear";
  }

  function fetchJson(url, options) {
    return fetch(url, options).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return response.json();
    });
  }

  function readQueryState() {
    const params = new URLSearchParams(window.location.search);
    const next = { ...FILTER_DEFAULTS };

    Object.entries(FILTER_PARAM_KEYS).forEach(([key, param]) => {
      const value = params.get(param);
      if (value !== null) {
        next[key] = value;
      }
    });

    if (!["lane", "project", "status", "risk", "agent", "none"].includes(next.groupBy)) {
      next.groupBy = FILTER_DEFAULTS.groupBy;
    }

    return next;
  }

  function writeQueryState() {
    const params = new URLSearchParams();

    Object.entries(FILTER_PARAM_KEYS).forEach(([key, param]) => {
      const value = String(state.view[key] || "").trim();
      if (value) {
        params.set(param, value);
      }
    });

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function resolveLane(card) {
    return card.lane || card.project?.lane || "unassigned";
  }

  function resolveProjectValue(card) {
    return card.project?.slug || card.projectKey || card.project?.name || "unmapped";
  }

  function resolveProjectLabel(card) {
    return card.project?.name || humanizeToken(resolveProjectValue(card));
  }

  function resolveStatusValue(card) {
    return card.status || "new";
  }

  function resolveStatusLabel(card) {
    return humanizeToken(resolveStatusValue(card));
  }

  function resolveRiskValue(card) {
    return card.healthStrip?.risk || card.risk || "low";
  }

  function resolveRiskLabel(card) {
    return humanizeToken(
      resolveRiskValue(card),
      /^risk:/.test(resolveRiskValue(card)) ? "risk:" : "",
    );
  }

  function resolveDispatchValue(card) {
    return card.dispatch || "dispatch:unknown";
  }

  function resolveDispatchLabel(card) {
    return humanizeToken(
      resolveDispatchValue(card),
      resolveDispatchValue(card).startsWith("dispatch:") ? "dispatch:" : "",
    );
  }

  function resolveAgentValue(card) {
    return (card.responsibleAgents || [])[0] || "";
  }

  function resolveAssigneeLabel(card) {
    if (card.assignee?.name) {
      return card.assignee.name;
    }
    if ((card.responsibleAgents || []).length > 0) {
      return card.responsibleAgents.map((agent) => humanizeToken(agent)).join(", ");
    }
    return "Unassigned";
  }

  function getCards() {
    return Array.isArray(state.board?.masterCards) ? state.board.masterCards : [];
  }

  function getFiltersPayload() {
    return state.filters?.filters || {};
  }

  function buildDerivedOptions() {
    const cards = getCards();
    const groupCounts = (keyFn, labelFn) => {
      const map = new Map();
      cards.forEach((card) => {
        const key = keyFn(card);
        if (!key) return;
        map.set(key, {
          key,
          label: labelFn(card, key),
          count: (map.get(key)?.count || 0) + 1,
        });
      });
      return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label));
    };

    return {
      lanes: groupCounts(
        (card) => resolveLane(card),
        (_card, key) => key,
      ),
      projects: groupCounts(
        (card) => resolveProjectValue(card),
        (card) => resolveProjectLabel(card),
      ),
      statuses: groupCounts(
        (card) => resolveStatusValue(card),
        (card) => resolveStatusLabel(card),
      ),
      risks: groupCounts(
        (card) => resolveRiskValue(card),
        (card) => resolveRiskLabel(card),
      ),
      dispatch: groupCounts(
        (card) => resolveDispatchValue(card),
        (card) => resolveDispatchLabel(card),
      ),
      responsibleAgents: groupCounts(
        (card) => resolveAgentValue(card),
        (card) => humanizeToken(resolveAgentValue(card)),
      ),
    };
  }

  function getOptionSet(name) {
    const filters = getFiltersPayload();
    const derived = buildDerivedOptions();
    return filters[name] || derived[name] || [];
  }

  function populateSelect(selectId, options, config) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    const items = [`<option value="">${escapeHtml(config.allLabel)}</option>`]
      .concat(
        options.map((option) => {
          const value = config.valueOf(option);
          const label = config.labelOf(option);
          const count = Number.isFinite(option.count) ? ` (${option.count})` : "";
          return `<option value="${escapeHtml(value)}">${escapeHtml(label + count)}</option>`;
        }),
      )
      .join("");

    select.innerHTML = items;
    select.value = state.view[config.viewKey] || currentValue || "";
  }

  function hydrateControls() {
    populateSelect("mc-filter-lane", getOptionSet("lanes"), {
      allLabel: "All lanes",
      viewKey: "lane",
      valueOf: (option) => option.key,
      labelOf: (option) => option.label,
    });
    populateSelect("mc-filter-project", getOptionSet("projects"), {
      allLabel: "All projects",
      viewKey: "project",
      valueOf: (option) => option.slug || option.key,
      labelOf: (option) => option.label,
    });
    populateSelect("mc-filter-status", getOptionSet("statuses"), {
      allLabel: "All statuses",
      viewKey: "status",
      valueOf: (option) => option.key,
      labelOf: (option) => option.label,
    });
    populateSelect("mc-filter-risk", getOptionSet("risks"), {
      allLabel: "All risks",
      viewKey: "risk",
      valueOf: (option) => option.key,
      labelOf: (option) => option.label,
    });
    populateSelect("mc-filter-dispatch", getOptionSet("dispatch"), {
      allLabel: "All dispatch states",
      viewKey: "dispatch",
      valueOf: (option) => option.key,
      labelOf: (option) => option.label,
    });
    populateSelect("mc-filter-agent", getOptionSet("responsibleAgents"), {
      allLabel: "All agents",
      viewKey: "agent",
      valueOf: (option) => option.key,
      labelOf: (option) => option.label,
    });

    const search = document.getElementById("mc-filter-search");
    const groupBy = document.getElementById("mc-group-by");
    if (search) search.value = state.view.search || "";
    if (groupBy) groupBy.value = state.view.groupBy || FILTER_DEFAULTS.groupBy;
  }

  function syncViewFromControls() {
    state.view = {
      search: document.getElementById("mc-filter-search")?.value.trim() || "",
      groupBy: document.getElementById("mc-group-by")?.value || FILTER_DEFAULTS.groupBy,
      lane: document.getElementById("mc-filter-lane")?.value || "",
      project: document.getElementById("mc-filter-project")?.value || "",
      status: document.getElementById("mc-filter-status")?.value || "",
      risk: document.getElementById("mc-filter-risk")?.value || "",
      dispatch: document.getElementById("mc-filter-dispatch")?.value || "",
      agent: document.getElementById("mc-filter-agent")?.value || "",
    };

    writeQueryState();
    render();
  }

  function matchesSearch(card, search) {
    if (!search) {
      return true;
    }

    const haystack = [
      card.identifier,
      card.primaryLinearIdentifier,
      card.title,
      card.summary,
      resolveLane(card),
      resolveProjectLabel(card),
      resolveStatusLabel(card),
      resolveRiskLabel(card),
      resolveDispatchLabel(card),
      resolveAssigneeLabel(card),
      ...(card.labels || []).map((label) => label.name),
      ...(card.responsibleAgents || []),
      ...(card.dependencies || []).map((dependency) => dependency.label),
      card.latestProof?.summary,
      card.latestUpdate?.summary,
      ...(card.alertState || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search.toLowerCase());
  }

  function filterCards(cards) {
    return cards.filter((card) => {
      if (state.view.lane && resolveLane(card) !== state.view.lane) return false;
      if (state.view.project && resolveProjectValue(card) !== state.view.project) return false;
      if (state.view.status && resolveStatusValue(card) !== state.view.status) return false;
      if (state.view.risk && resolveRiskValue(card) !== state.view.risk) return false;
      if (state.view.dispatch && resolveDispatchValue(card) !== state.view.dispatch) return false;
      if (state.view.agent && !(card.responsibleAgents || []).includes(state.view.agent))
        return false;
      if (!matchesSearch(card, state.view.search)) return false;
      return true;
    });
  }

  function compareCards(left, right) {
    const score = (card) => {
      let value = 0;
      if (resolveRiskValue(card) === "high" || resolveRiskValue(card) === "risk:high") value += 40;
      if (card.healthStrip?.status === "degraded") value += 30;
      if (card.healthStrip?.blocked || resolveStatusValue(card) === "blocked") value += 20;
      if (card.healthStrip?.stale) value += 10;
      if (resolveDispatchValue(card) === "dispatch:blocked") value += 5;
      return value;
    };

    const scoreDiff = score(right) - score(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const timeDiff = Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return String(left.identifier || left.id || "").localeCompare(
      String(right.identifier || right.id || ""),
    );
  }

  function getGroupLabel(card, groupBy) {
    switch (groupBy) {
      case "project":
        return resolveProjectLabel(card);
      case "status":
        return resolveStatusLabel(card);
      case "risk":
        return resolveRiskLabel(card);
      case "agent":
        return resolveAgentValue(card) ? humanizeToken(resolveAgentValue(card)) : "Unassigned";
      case "none":
        return "All cards";
      case "lane":
      default:
        return resolveLane(card);
    }
  }

  function getGroupKey(card, groupBy) {
    switch (groupBy) {
      case "project":
        return `project:${resolveProjectValue(card)}`;
      case "status":
        return `status:${resolveStatusValue(card)}`;
      case "risk":
        return `risk:${resolveRiskValue(card)}`;
      case "agent":
        return `agent:${resolveAgentValue(card) || "unassigned"}`;
      case "none":
        return "group:all";
      case "lane":
      default:
        return `lane:${resolveLane(card)}`;
    }
  }

  function getBlockers(card) {
    const items = [];
    const dependencies = (card.dependencies || []).filter(
      (dependency) => dependency.blocking !== false && dependency.status !== "resolved",
    );

    dependencies.slice(0, 2).forEach((dependency) => {
      items.push({
        label: dependency.label || humanizeToken(dependency.kind),
        level: "urgent",
      });
    });

    if (resolveDispatchValue(card) === "dispatch:blocked") {
      items.push({ label: "Dispatch blocked", level: "urgent" });
    }
    if (card.humanReviewRequired) {
      items.push({ label: "Awaiting review", level: "warning" });
    }
    if (card.healthStrip?.stale) {
      items.push({
        label: `Stale ${card.healthStrip.ageLabel || formatRelativeTime(card.updatedAt)}`,
        level: "warning",
      });
    }

    return items.length > 0 ? items.slice(0, 3) : [{ label: "Clear", level: "clear" }];
  }

  function renderAlerts() {
    const alerts = document.getElementById("mc-alerts");
    if (!alerts || !state.board || !state.admin) return;

    const cards = getCards();
    const runtimeProjects = Array.isArray(state.admin.health?.runtime?.projects)
      ? state.admin.health.runtime.projects
      : [];
    const alertCards = cards.filter(
      (card) => Array.isArray(card.alertState) && card.alertState.length > 0,
    );
    const discordAlert = alertCards.find((card) =>
      card.alertState.some(
        (entry) => /discord/i.test(entry) && /(fail|error|down|blocked)/i.test(entry),
      ),
    );
    const staleCard = cards.find((card) => card.healthStrip?.stale);
    const symphonyDown = runtimeProjects.find(
      (project) =>
        project.symphony?.status === "unreachable" || project.symphony?.status === "degraded",
    );
    const lag = state.admin.sync?.lag || {};

    const entries = [];

    if (lag.isStale || state.admin.sync?.status === "error") {
      entries.push({
        severity: state.admin.sync?.status === "error" ? "critical" : "warning",
        title: "Sync lag detected",
        summary:
          state.admin.sync?.status === "error"
            ? state.admin.sync?.lastError || "Mission Control sync is reporting an error."
            : `Lag is ${formatDuration(lag.milliseconds || 0)} against a stale threshold of ${formatDuration(lag.staleThresholdMs || 0)}.`,
        pill: state.admin.sync?.status || "stale",
      });
    }

    if (symphonyDown) {
      entries.push({
        severity: "critical",
        title: "Symphony runtime degraded",
        summary: `${humanizeToken(symphonyDown.key || symphonyDown.lane || "runtime")} is ${symphonyDown.symphony?.status || symphonyDown.status}.`,
        pill: symphonyDown.symphony?.status || symphonyDown.status,
      });
    }

    if (discordAlert) {
      entries.push({
        severity: "warning",
        title: "Discord delivery failure",
        summary: `${discordAlert.identifier || discordAlert.primaryLinearIdentifier || discordAlert.id} reported ${discordAlert.alertState.join(", ")}.`,
        pill: "discord",
      });
    }

    if (staleCard) {
      entries.push({
        severity: "info",
        title: "Stale work detected",
        summary: `${staleCard.identifier || staleCard.primaryLinearIdentifier || staleCard.id} has been idle for ${
          staleCard.healthStrip?.ageLabel || formatRelativeTime(staleCard.updatedAt)
        }.`,
        pill: "stale",
      });
    }

    alerts.hidden = entries.length === 0;
    alerts.innerHTML = entries
      .map(
        (entry) => `
          <article class="mc-alert" data-severity="${escapeHtml(entry.severity)}">
            <div class="mc-alert-title">
              <span>${escapeHtml(entry.title)}</span>
              <span class="mc-inline-pill ${entry.severity === "critical" ? "error" : entry.severity === "warning" ? "warn" : "neutral"}">${escapeHtml(entry.pill)}</span>
            </div>
            <div>${escapeHtml(entry.summary)}</div>
          </article>
        `,
      )
      .join("");
  }

  function renderHeader() {
    const sync = state.admin?.sync || state.board?.sync || {};
    const el = document.getElementById("mc-sync-status");
    if (!el) return;
    el.className = `mc-status-pill ${syncStatusClass(sync)}`;
    el.textContent = `${sync.status || "idle"} · lag ${formatDuration(sync.lag?.milliseconds ?? sync.lagMs ?? 0)}`;
  }

  function renderStats() {
    const container = document.getElementById("mc-stats");
    if (!container || !state.board) return;

    const cards = filterCards(getCards());
    const blockedCards = cards.filter(
      (card) => card.healthStrip?.blocked || resolveStatusValue(card) === "blocked",
    ).length;
    const staleCards = cards.filter((card) => card.healthStrip?.stale).length;
    const highRiskCards = cards.filter(
      (card) => resolveRiskValue(card) === "high" || resolveRiskValue(card) === "risk:high",
    ).length;
    const degradedProjects = (state.board.projects || []).filter(
      (project) => project.healthStrip?.degraded,
    ).length;
    const lagLabel = formatDuration(
      state.admin?.sync?.lag?.milliseconds ?? state.board.sync?.lagMs ?? 0,
    );
    const cardsData = [
      {
        label: "Visible cards",
        value: cards.length,
        help: `${state.board.stats?.totalCards || 0} total in board`,
      },
      {
        label: "High risk",
        value: highRiskCards,
        help: "Operator escalation candidates",
      },
      {
        label: "Blocked",
        value: blockedCards,
        help: "Dispatch or dependency blockers",
      },
      {
        label: "Stale",
        value: staleCards,
        help: "Idle beyond mission threshold",
      },
      {
        label: "Runtime",
        value: degradedProjects > 0 ? `${degradedProjects} degraded` : "Healthy",
        help: `${state.board.runtime?.projectCount || 0} Symphony projects tracked`,
      },
      {
        label: "Sync lag",
        value: lagLabel,
        help: state.admin?.sync?.lastReason || state.board.sync?.lastReason || "steady",
      },
    ];

    container.innerHTML = cardsData
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

  function renderFilterSummary(cards) {
    const summary = document.getElementById("mc-filter-summary");
    if (!summary || !state.board) return;

    const activeFilters = [];
    ["lane", "project", "status", "risk", "dispatch", "agent"].forEach((key) => {
      if (state.view[key]) {
        activeFilters.push(
          `<span class="mc-group-label">${escapeHtml(key)}: ${escapeHtml(state.view[key])}</span>`,
        );
      }
    });
    if (state.view.search) {
      activeFilters.push(
        `<span class="mc-group-label">search: ${escapeHtml(state.view.search)}</span>`,
      );
    }

    summary.innerHTML = `
      <span>${escapeHtml(String(cards.length))} of ${escapeHtml(String(state.board.stats?.totalCards || 0))} cards visible</span>
      <span>·</span>
      <span>Grouped by ${escapeHtml(humanizeToken(state.view.groupBy === "none" ? "no grouping" : state.view.groupBy))}</span>
      ${activeFilters.length > 0 ? "<span>·</span>" + activeFilters.join("") : ""}
    `;
  }

  function renderTable() {
    const body = document.getElementById("mc-card-table");
    const empty = document.getElementById("mc-empty-state");
    if (!body || !empty || !state.board) return;

    const cards = filterCards(getCards()).sort(compareCards);
    renderFilterSummary(cards);

    empty.hidden = cards.length > 0;
    if (cards.length === 0) {
      body.innerHTML = "";
      return;
    }

    const groups = new Map();
    cards.forEach((card) => {
      const key = getGroupKey(card, state.view.groupBy);
      const label = getGroupLabel(card, state.view.groupBy);
      if (!groups.has(key)) {
        groups.set(key, { label, cards: [] });
      }
      groups.get(key).cards.push(card);
    });

    const rows = [];
    groups.forEach((group) => {
      if (state.view.groupBy !== "none") {
        rows.push(`
          <tr class="mc-group-row">
            <td colspan="9">
              ${escapeHtml(group.label)}
              <small>${escapeHtml(String(group.cards.length))} card${group.cards.length === 1 ? "" : "s"}</small>
            </td>
          </tr>
        `);
      }

      group.cards.forEach((card) => {
        const blockers = getBlockers(card);
        const proofSummary = card.latestProof?.summary || "No proof attached";
        const proofLink = card.latestProof?.url;
        const issueLink = card.url;
        const issueIdentifier = card.identifier || card.primaryLinearIdentifier || card.id;
        const responsibleAgents = (card.responsibleAgents || []).map((agent) =>
          humanizeToken(agent),
        );
        const assigneeSecondary =
          card.assignee?.name && responsibleAgents.length > 0
            ? `<div class="mc-table-note">${escapeHtml(responsibleAgents.join(", "))}</div>`
            : "";
        const linearState = card.state?.name
          ? `<div class="mc-table-note">Linear · ${escapeHtml(card.state.name)}</div>`
          : "";
        const dispatchPill = `
          <span class="mc-chip ${dispatchClass(resolveDispatchValue(card))}">${escapeHtml(resolveDispatchLabel(card))}</span>
        `;

        rows.push(`
          <tr>
            <td>
              <div class="mc-stack">
                <div class="mc-issue-line">
                  ${
                    issueLink
                      ? `<a class="mc-issue-title" href="${escapeHtml(issueLink)}" target="_blank" rel="noreferrer">${escapeHtml(issueIdentifier)}</a>`
                      : `<span class="mc-issue-title">${escapeHtml(issueIdentifier)}</span>`
                  }
                  ${dispatchPill}
                </div>
                <div>${escapeHtml(card.title || "Untitled")}</div>
                <div class="mc-issue-meta">${escapeHtml(card.summary || resolveProjectLabel(card))}</div>
              </div>
            </td>
            <td><span class="mc-group-label">${escapeHtml(resolveLane(card))}</span></td>
            <td>
              <div class="mc-stack">
                <div>${escapeHtml(resolveProjectLabel(card))}</div>
                <div class="mc-table-note">${escapeHtml(card.projectKey || resolveProjectValue(card))}</div>
              </div>
            </td>
            <td>
              <span class="mc-chip ${statusClass(resolveStatusValue(card))}">${escapeHtml(resolveStatusLabel(card))}</span>
              ${linearState}
            </td>
            <td>
              <span class="mc-chip ${riskClass(resolveRiskValue(card))}">${escapeHtml(resolveRiskLabel(card))}</span>
            </td>
            <td>
              <div class="mc-chip-row">
                ${blockers
                  .map(
                    (item) =>
                      `<span class="mc-chip ${blockerClass(item.level)}">${escapeHtml(item.label)}</span>`,
                  )
                  .join("")}
              </div>
            </td>
            <td>
              <div class="mc-stack">
                ${
                  proofLink
                    ? `<a class="mc-proof-link" href="${escapeHtml(proofLink)}" target="_blank" rel="noreferrer">${escapeHtml(proofSummary)}</a>`
                    : `<span class="mc-proof-text">${escapeHtml(proofSummary)}</span>`
                }
                <div class="mc-table-note">${escapeHtml(formatTimestamp(card.latestProof?.capturedAt || card.latestUpdate?.capturedAt))}</div>
              </div>
            </td>
            <td>
              <div class="mc-stack">
                <div>${escapeHtml(resolveAssigneeLabel(card))}</div>
                ${assigneeSecondary}
              </div>
            </td>
            <td>
              <div class="mc-stack">
                <div>${escapeHtml(formatRelativeTime(card.updatedAt))} ago</div>
                <div class="mc-table-note">${escapeHtml(formatTimestamp(card.updatedAt))}</div>
              </div>
            </td>
          </tr>
        `);
      });
    });

    body.innerHTML = rows.join("");
  }

  function render() {
    renderHeader();
    renderAlerts();
    renderStats();
    renderTable();
  }

  function loadMissionControl() {
    return Promise.all([
      fetchJson("/api/mission-control/board"),
      fetchJson("/api/mission-control/filters"),
      fetchJson("/api/mission-control/admin/status"),
    ]).then(([board, filters, admin]) => {
      state.board = board;
      state.filters = filters;
      state.admin = admin;
      hydrateControls();
      render();
    });
  }

  function triggerReconcile() {
    const button = document.getElementById("mc-reconcile-button");
    if (button) button.disabled = true;

    return fetchJson("/api/mission-control/admin/reconcile", { method: "POST" })
      .then(() => loadMissionControl())
      .finally(() => {
        if (button) button.disabled = false;
      });
  }

  function connectEvents() {
    if (typeof EventSource === "undefined") {
      return;
    }

    eventSource = new EventSource("/api/events");
    eventSource.addEventListener("mission-control", () => {
      loadMissionControl().catch((error) =>
        console.error("[Mission Control] Refresh failed:", error),
      );
    });
    eventSource.addEventListener("update", () => {
      loadMissionControl().catch((error) =>
        console.error("[Mission Control] Refresh failed:", error),
      );
    });
  }

  function setupControls() {
    document.getElementById("mc-refresh-button")?.addEventListener("click", () => {
      loadMissionControl().catch((error) => console.error(error));
    });
    document.getElementById("mc-reconcile-button")?.addEventListener("click", () => {
      triggerReconcile().catch((error) => console.error(error));
    });
    document.getElementById("mc-clear-filters")?.addEventListener("click", () => {
      state.view = { ...FILTER_DEFAULTS };
      hydrateControls();
      writeQueryState();
      render();
    });

    [
      "mc-filter-lane",
      "mc-filter-project",
      "mc-filter-status",
      "mc-filter-risk",
      "mc-filter-dispatch",
      "mc-filter-agent",
      "mc-group-by",
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", syncViewFromControls);
    });

    document.getElementById("mc-filter-search")?.addEventListener("input", () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(syncViewFromControls, 120);
    });
  }

  function init() {
    setupControls();
    connectEvents();
    refreshTimer = window.setInterval(() => {
      loadMissionControl().catch((error) => console.error(error));
    }, 30000);
    return loadMissionControl();
  }

  window.addEventListener("beforeunload", () => {
    if (eventSource) {
      eventSource.close();
    }
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
    }
    if (searchDebounce) {
      window.clearTimeout(searchDebounce);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init().catch((error) => console.error(error));
    });
  } else {
    init().catch((error) => console.error(error));
  }
})();
