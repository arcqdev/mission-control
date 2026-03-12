#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/utils.js
var require_utils = __commonJS({
  "src/utils.js"(exports2, module2) {
    var { exec } = require("child_process");
    var path2 = require("path");
    var { promisify } = require("util");
    var execAsync = promisify(exec);
    var pkg = require(path2.join(__dirname, "..", "package.json"));
    function getVersion2() {
      return pkg.version;
    }
    async function runCmd(cmd, options = {}) {
      const systemPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      const envPath = process.env.PATH || "";
      const opts = {
        encoding: "utf8",
        timeout: 1e4,
        env: {
          ...process.env,
          PATH: envPath.includes("/usr/sbin") ? envPath : `${systemPath}:${envPath}`
        },
        ...options
      };
      try {
        const { stdout } = await execAsync(cmd, opts);
        return stdout.trim();
      } catch (e) {
        if (options.fallback !== void 0) return options.fallback;
        throw e;
      }
    }
    function formatBytes(bytes) {
      if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(1) + " TB";
      if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
      return bytes + " B";
    }
    function formatTimeAgo(date) {
      const now = /* @__PURE__ */ new Date();
      const diffMs = now - date;
      const diffMins = Math.round(diffMs / 6e4);
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
      return `${Math.round(diffMins / 1440)}d ago`;
    }
    function formatNumber(n) {
      return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function formatTokens(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return n.toString();
    }
    module2.exports = {
      getVersion: getVersion2,
      runCmd,
      formatBytes,
      formatTimeAgo,
      formatNumber,
      formatTokens
    };
  }
});

// src/config.js
var require_config = __commonJS({
  "src/config.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var os = require("os");
    var HOME = os.homedir();
    function getOpenClawDir2(profile = null) {
      const effectiveProfile = profile || process.env.OPENCLAW_PROFILE || "";
      return effectiveProfile ? path2.join(HOME, `.openclaw-${effectiveProfile}`) : path2.join(HOME, ".openclaw");
    }
    function detectWorkspace() {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const openclawDir = getOpenClawDir2();
      const defaultWorkspace = path2.join(openclawDir, "workspace");
      const profileCandidates = profile ? [
        // Profile-specific workspace in home (e.g., ~/.openclaw-<profile>-workspace)
        path2.join(HOME, `.openclaw-${profile}-workspace`),
        path2.join(HOME, `.${profile}-workspace`)
      ] : [];
      const candidates = [
        // Environment variable (highest priority)
        process.env.OPENCLAW_WORKSPACE,
        // OpenClaw's default workspace location
        process.env.OPENCLAW_HOME,
        // Gateway config workspace (check early - this is where OpenClaw actually runs)
        getWorkspaceFromGatewayConfig(),
        // Profile-specific paths (if profile is set)
        ...profileCandidates,
        // Standard OpenClaw workspace location (profile-aware: ~/.openclaw/workspace or ~/.openclaw-<profile>/workspace)
        defaultWorkspace,
        // Common custom workspace names
        path2.join(HOME, "openclaw-workspace"),
        path2.join(HOME, ".openclaw-workspace"),
        // Legacy/custom names
        path2.join(HOME, "molty"),
        path2.join(HOME, "clawd"),
        path2.join(HOME, "moltbot")
      ].filter(Boolean);
      const foundWorkspace = candidates.find((candidate) => {
        if (!candidate || !fs2.existsSync(candidate)) {
          return false;
        }
        const hasMemory = fs2.existsSync(path2.join(candidate, "memory"));
        const hasState = fs2.existsSync(path2.join(candidate, "state"));
        const hasConfig = fs2.existsSync(path2.join(candidate, ".openclaw"));
        return hasMemory || hasState || hasConfig;
      });
      return foundWorkspace || defaultWorkspace;
    }
    function getWorkspaceFromGatewayConfig() {
      const openclawDir = getOpenClawDir2();
      const configPaths = [
        path2.join(openclawDir, "config.yaml"),
        path2.join(openclawDir, "config.json"),
        path2.join(openclawDir, "openclaw.json"),
        path2.join(openclawDir, "clawdbot.json"),
        // Fallback to standard XDG location
        path2.join(HOME, ".config", "openclaw", "config.yaml")
      ];
      for (const configPath of configPaths) {
        try {
          if (fs2.existsSync(configPath)) {
            const content = fs2.readFileSync(configPath, "utf8");
            const match = content.match(/workspace[:\s]+["']?([^"'\n]+)/i) || content.match(/workdir[:\s]+["']?([^"'\n]+)/i);
            if (match && match[1]) {
              const workspace = match[1].trim().replace(/^~/, HOME);
              if (fs2.existsSync(workspace)) {
                return workspace;
              }
            }
          }
        } catch (e) {
        }
      }
      return null;
    }
    function deepMerge(base, override) {
      const result = { ...base };
      for (const key of Object.keys(override)) {
        if (override[key] && typeof override[key] === "object" && !Array.isArray(override[key]) && base[key] && typeof base[key] === "object") {
          result[key] = deepMerge(base[key], override[key]);
        } else if (override[key] !== null && override[key] !== void 0) {
          result[key] = override[key];
        }
      }
      return result;
    }
    function loadConfigFile() {
      const basePath = path2.join(__dirname, "..", "config", "dashboard.json");
      const localPath = path2.join(__dirname, "..", "config", "dashboard.local.json");
      let config = {};
      try {
        if (fs2.existsSync(basePath)) {
          const content = fs2.readFileSync(basePath, "utf8");
          config = JSON.parse(content);
        }
      } catch (e) {
        console.warn(`[Config] Failed to load ${basePath}:`, e.message);
      }
      try {
        if (fs2.existsSync(localPath)) {
          const content = fs2.readFileSync(localPath, "utf8");
          const localConfig = JSON.parse(content);
          config = deepMerge(config, localConfig);
          console.log(`[Config] Loaded local overrides from ${localPath}`);
        }
      } catch (e) {
        console.warn(`[Config] Failed to load ${localPath}:`, e.message);
      }
      return config;
    }
    function expandPath(p) {
      if (!p) return p;
      return p.replace(/^~/, HOME).replace(/\$HOME/g, HOME).replace(/\$\{HOME\}/g, HOME);
    }
    function envBoolean(value, fallback) {
      if (value === void 0 || value === null || value === "") {
        return fallback;
      }
      if (typeof value === "boolean") {
        return value;
      }
      return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
    }
    function loadConfig() {
      const fileConfig = loadConfigFile();
      const missionControlConfig = fileConfig.integrations?.missionControl || {};
      const missionControlNotifications2 = missionControlConfig.notifications || {};
      const missionControlDiscord = missionControlNotifications2.discord || {};
      const workspace = process.env.OPENCLAW_WORKSPACE || expandPath(fileConfig.paths?.workspace) || detectWorkspace();
      const config = {
        // Server settings
        server: {
          port: parseInt(process.env.PORT || fileConfig.server?.port || "3333", 10),
          host: process.env.HOST || fileConfig.server?.host || "localhost"
        },
        // Paths - all relative to workspace unless absolute
        paths: {
          workspace,
          memory: expandPath(process.env.OPENCLAW_MEMORY_DIR || fileConfig.paths?.memory) || path2.join(workspace, "memory"),
          state: expandPath(process.env.OPENCLAW_STATE_DIR || fileConfig.paths?.state) || path2.join(workspace, "state"),
          cerebro: expandPath(process.env.OPENCLAW_CEREBRO_DIR || fileConfig.paths?.cerebro) || path2.join(workspace, "cerebro"),
          skills: expandPath(process.env.OPENCLAW_SKILLS_DIR || fileConfig.paths?.skills) || path2.join(workspace, "skills"),
          jobs: expandPath(process.env.OPENCLAW_JOBS_DIR || fileConfig.paths?.jobs) || path2.join(workspace, "jobs"),
          logs: expandPath(process.env.OPENCLAW_LOGS_DIR || fileConfig.paths?.logs) || path2.join(HOME, ".openclaw-command-center", "logs")
        },
        // Auth settings
        auth: {
          mode: process.env.DASHBOARD_AUTH_MODE || fileConfig.auth?.mode || "none",
          token: process.env.DASHBOARD_TOKEN || fileConfig.auth?.token,
          allowedUsers: (process.env.DASHBOARD_ALLOWED_USERS || fileConfig.auth?.allowedUsers?.join(",") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
          allowedIPs: (process.env.DASHBOARD_ALLOWED_IPS || fileConfig.auth?.allowedIPs?.join(",") || "127.0.0.1,::1").split(",").map((s) => s.trim()),
          publicPaths: fileConfig.auth?.publicPaths || ["/api/health", "/api/whoami", "/favicon.ico"]
        },
        // Branding
        branding: {
          name: fileConfig.branding?.name || "OpenClaw Command Center",
          theme: fileConfig.branding?.theme || "default"
        },
        // Integrations
        integrations: {
          linear: {
            apiKey: process.env.LINEAR_API_KEY || fileConfig.integrations?.linear?.apiKey,
            teamId: process.env.LINEAR_TEAM_ID || fileConfig.integrations?.linear?.teamId
          },
          missionControl: {
            enabled: envBoolean(
              process.env.MISSION_CONTROL_ENABLED,
              missionControlConfig.enabled ?? false
            ),
            notifications: {
              enabled: envBoolean(
                process.env.MISSION_CONTROL_NOTIFICATIONS_ENABLED,
                missionControlNotifications2.enabled ?? false
              ),
              discord: {
                defaults: {
                  senderKey: process.env.MISSION_CONTROL_DISCORD_DEFAULT_SENDER || missionControlDiscord.defaults?.senderKey || null,
                  destinationKey: process.env.MISSION_CONTROL_DISCORD_DEFAULT_DESTINATION || missionControlDiscord.defaults?.destinationKey || null
                },
                retry: {
                  maxAttempts: parseInt(
                    process.env.MISSION_CONTROL_DISCORD_MAX_ATTEMPTS || missionControlDiscord.retry?.maxAttempts || "3",
                    10
                  ),
                  baseDelayMs: parseInt(
                    process.env.MISSION_CONTROL_DISCORD_RETRY_BASE_MS || missionControlDiscord.retry?.baseDelayMs || "1000",
                    10
                  ),
                  maxDelayMs: parseInt(
                    process.env.MISSION_CONTROL_DISCORD_RETRY_MAX_MS || missionControlDiscord.retry?.maxDelayMs || "30000",
                    10
                  )
                },
                senders: missionControlDiscord.senders || {},
                destinations: missionControlDiscord.destinations || {}
              }
            }
          }
        },
        missionControl: {
          projects: parseJsonArray(
            process.env.MISSION_CONTROL_PROJECTS_JSON,
            fileConfig.missionControl?.projects || []
          ),
          agents: parseJsonArray(
            process.env.MISSION_CONTROL_AGENTS_JSON,
            fileConfig.missionControl?.agents || []
          ),
          discordDestinations: parseJsonArray(
            process.env.MISSION_CONTROL_DISCORD_DESTINATIONS_JSON,
            fileConfig.missionControl?.discordDestinations || []
          ),
          symphonyPollIntervalMs: parseInt(
            process.env.MISSION_CONTROL_SYMPHONY_POLL_INTERVAL_MS || fileConfig.missionControl?.symphonyPollIntervalMs || "30000",
            10
          )
        },
        // Billing - for cost savings calculation
        billing: {
          claudePlanCost: parseFloat(
            process.env.CLAUDE_PLAN_COST || fileConfig.billing?.claudePlanCost || "200"
          ),
          claudePlanName: process.env.CLAUDE_PLAN_NAME || fileConfig.billing?.claudePlanName || "Claude Code Max"
        }
      };
      config.integrations.linear.enabled = Boolean(
        config.integrations.linear.apiKey && config.integrations.linear.projectSlugs.length > 0
      );
      if (config.integrations.linear.webhookSecret && config.integrations.linear.webhookPath) {
        config.auth.publicPaths = [
          .../* @__PURE__ */ new Set([...config.auth.publicPaths, config.integrations.linear.webhookPath])
        ];
      }
      return config;
    }
    var CONFIG2 = loadConfig();
    console.log("[Config] Workspace:", CONFIG2.paths.workspace);
    console.log("[Config] Auth mode:", CONFIG2.auth.mode);
    module2.exports = { CONFIG: CONFIG2, loadConfig, detectWorkspace, expandPath, getOpenClawDir: getOpenClawDir2, parseList };
  }
});

// src/jobs.js
var require_jobs = __commonJS({
  "src/jobs.js"(exports2, module2) {
    var path2 = require("path");
    var { CONFIG: CONFIG2 } = require_config();
    var JOBS_DIR = CONFIG2.paths.jobs;
    var JOBS_STATE_DIR = path2.join(CONFIG2.paths.state, "jobs");
    var apiInstance = null;
    var forceApiUnavailable = false;
    async function getAPI() {
      if (forceApiUnavailable) return null;
      if (apiInstance) return apiInstance;
      try {
        const { createJobsAPI } = await import(path2.join(JOBS_DIR, "lib/api.js"));
        apiInstance = createJobsAPI({
          definitionsDir: path2.join(JOBS_DIR, "definitions"),
          stateDir: JOBS_STATE_DIR
        });
        return apiInstance;
      } catch (e) {
        console.error("Failed to load jobs API:", e.message);
        return null;
      }
    }
    function _resetForTesting(options = {}) {
      apiInstance = null;
      forceApiUnavailable = options.forceUnavailable || false;
    }
    function formatRelativeTime(isoString) {
      if (!isoString) return null;
      const date = new Date(isoString);
      const now = /* @__PURE__ */ new Date();
      const diffMs = now - date;
      const diffMins = Math.round(diffMs / 6e4);
      if (diffMins < 0) {
        const futureMins = Math.abs(diffMins);
        if (futureMins < 60) return `in ${futureMins}m`;
        if (futureMins < 1440) return `in ${Math.round(futureMins / 60)}h`;
        return `in ${Math.round(futureMins / 1440)}d`;
      }
      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffMins < 1440) return `${Math.round(diffMins / 60)}h ago`;
      return `${Math.round(diffMins / 1440)}d ago`;
    }
    async function handleJobsRequest2(req, res, pathname, query, method) {
      const api = await getAPI();
      if (!api) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Jobs API not available" }));
        return;
      }
      try {
        if (pathname === "/api/jobs/scheduler/status" && method === "GET") {
          const status = await api.getSchedulerStatus();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(status, null, 2));
          return;
        }
        if (pathname === "/api/jobs/stats" && method === "GET") {
          const stats = await api.getAggregateStats();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(stats, null, 2));
          return;
        }
        if (pathname === "/api/jobs/cache/clear" && method === "POST") {
          api.clearCache();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Cache cleared" }));
          return;
        }
        if (pathname === "/api/jobs" && method === "GET") {
          const jobs = await api.listJobs();
          const enhanced = jobs.map((job) => ({
            ...job,
            lastRunRelative: formatRelativeTime(job.lastRun),
            nextRunRelative: formatRelativeTime(job.nextRun)
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobs: enhanced, timestamp: Date.now() }, null, 2));
          return;
        }
        const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
        if (jobMatch && method === "GET") {
          const jobId = decodeURIComponent(jobMatch[1]);
          const job = await api.getJob(jobId);
          if (!job) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Job not found" }));
            return;
          }
          job.lastRunRelative = formatRelativeTime(job.lastRun);
          job.nextRunRelative = formatRelativeTime(job.nextRun);
          if (job.recentRuns) {
            job.recentRuns = job.recentRuns.map((run) => ({
              ...run,
              startedAtRelative: formatRelativeTime(run.startedAt),
              completedAtRelative: formatRelativeTime(run.completedAt)
            }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(job, null, 2));
          return;
        }
        const historyMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/history$/);
        if (historyMatch && method === "GET") {
          const jobId = decodeURIComponent(historyMatch[1]);
          const limit = parseInt(query.get("limit") || "50", 10);
          const runs = await api.getJobHistory(jobId, limit);
          const enhanced = runs.map((run) => ({
            ...run,
            startedAtRelative: formatRelativeTime(run.startedAt),
            completedAtRelative: formatRelativeTime(run.completedAt)
          }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ runs: enhanced, timestamp: Date.now() }, null, 2));
          return;
        }
        const runMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/run$/);
        if (runMatch && method === "POST") {
          const jobId = decodeURIComponent(runMatch[1]);
          const result = await api.runJob(jobId);
          res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const pauseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/pause$/);
        if (pauseMatch && method === "POST") {
          const jobId = decodeURIComponent(pauseMatch[1]);
          let body = "";
          await new Promise((resolve) => {
            req.on("data", (chunk) => body += chunk);
            req.on("end", resolve);
          });
          let reason = null;
          try {
            const parsed = JSON.parse(body || "{}");
            reason = parsed.reason;
          } catch (_e) {
          }
          const result = await api.pauseJob(jobId, {
            by: req.authUser?.login || "dashboard",
            reason
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const resumeMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/resume$/);
        if (resumeMatch && method === "POST") {
          const jobId = decodeURIComponent(resumeMatch[1]);
          const result = await api.resumeJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const skipMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/skip$/);
        if (skipMatch && method === "POST") {
          const jobId = decodeURIComponent(skipMatch[1]);
          const result = await api.skipJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        const killMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/kill$/);
        if (killMatch && method === "POST") {
          const jobId = decodeURIComponent(killMatch[1]);
          const result = await api.killJob(jobId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result, null, 2));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (e) {
        console.error("Jobs API error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    function isJobsRoute2(pathname) {
      return pathname.startsWith("/api/jobs");
    }
    module2.exports = { handleJobsRequest: handleJobsRequest2, isJobsRoute: isJobsRoute2, _resetForTesting };
  }
});

// src/openclaw.js
var require_openclaw = __commonJS({
  "src/openclaw.js"(exports2, module2) {
    var { execFileSync, execFile } = require("child_process");
    var { promisify } = require("util");
    var execFileAsync = promisify(execFile);
    function getSafeEnv() {
      return {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
        LANG: process.env.LANG,
        NO_COLOR: "1",
        TERM: "dumb",
        OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE || "",
        OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE || "",
        OPENCLAW_HOME: process.env.OPENCLAW_HOME || ""
      };
    }
    function buildArgs(args2) {
      const profile = process.env.OPENCLAW_PROFILE || "";
      const profileArgs = profile ? ["--profile", profile] : [];
      const cleanArgs = args2.replace(/\s*2>&1\s*/g, " ").replace(/\s*2>\/dev\/null\s*/g, " ").trim();
      return [...profileArgs, ...cleanArgs.split(/\s+/).filter(Boolean)];
    }
    function runOpenClaw2(args2) {
      try {
        const result = execFileSync("openclaw", buildArgs(args2), {
          encoding: "utf8",
          timeout: 3e3,
          env: getSafeEnv(),
          stdio: ["pipe", "pipe", "pipe"]
        });
        return result;
      } catch (e) {
        return null;
      }
    }
    async function runOpenClawAsync2(args2) {
      try {
        const { stdout } = await execFileAsync("openclaw", buildArgs(args2), {
          encoding: "utf8",
          timeout: 2e4,
          env: getSafeEnv()
        });
        return stdout;
      } catch (e) {
        console.error("[OpenClaw Async] Error:", e.message);
        return null;
      }
    }
    function extractJSON2(output) {
      if (!output) return null;
      const jsonStart = output.search(/[[{]/);
      if (jsonStart === -1) return null;
      return output.slice(jsonStart);
    }
    module2.exports = {
      runOpenClaw: runOpenClaw2,
      runOpenClawAsync: runOpenClawAsync2,
      extractJSON: extractJSON2,
      getSafeEnv
    };
  }
});

// src/vitals.js
var require_vitals = __commonJS({
  "src/vitals.js"(exports2, module2) {
    var { runCmd, formatBytes } = require_utils();
    var cachedVitals = null;
    var lastVitalsUpdate = 0;
    var VITALS_CACHE_TTL = 3e4;
    var vitalsRefreshing = false;
    async function refreshVitalsAsync() {
      if (vitalsRefreshing) return;
      vitalsRefreshing = true;
      const vitals = {
        hostname: "",
        uptime: "",
        disk: { used: 0, free: 0, total: 0, percent: 0, kbPerTransfer: 0, iops: 0, throughputMBps: 0 },
        cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
        memory: { used: 0, free: 0, total: 0, percent: 0, pressure: "normal" },
        temperature: null
      };
      const isLinux = process.platform === "linux";
      const isMacOS = process.platform === "darwin";
      try {
        const coresCmd = isLinux ? "nproc" : "sysctl -n hw.ncpu";
        const memCmd = isLinux ? "cat /proc/meminfo | grep MemTotal | awk '{print $2}'" : "sysctl -n hw.memsize";
        const topCmd = isLinux ? "top -bn1 | head -3 | grep -E '^%?Cpu|^  ?CPU' || echo ''" : 'top -l 1 -n 0 2>/dev/null | grep "CPU usage" || echo ""';
        const mpstatCmd = isLinux ? "(command -v mpstat >/dev/null 2>&1 && mpstat 1 1 | tail -1 | sed 's/^Average: *//') || echo ''" : "";
        const [hostname, uptimeRaw, coresRaw, memTotalRaw, memInfoRaw, dfRaw, topOutput, mpstatOutput] = await Promise.all([
          runCmd("hostname", { fallback: "unknown" }),
          runCmd("uptime", { fallback: "" }),
          runCmd(coresCmd, { fallback: "1" }),
          runCmd(memCmd, { fallback: "0" }),
          isLinux ? runCmd("cat /proc/meminfo", { fallback: "" }) : runCmd("vm_stat", { fallback: "" }),
          runCmd("df -k ~ | tail -1", { fallback: "" }),
          runCmd(topCmd, { fallback: "" }),
          isLinux ? runCmd(mpstatCmd, { fallback: "" }) : Promise.resolve("")
        ]);
        vitals.hostname = hostname;
        const uptimeMatch = uptimeRaw.match(/up\s+([^,]+)/);
        if (uptimeMatch) vitals.uptime = uptimeMatch[1].trim();
        const loadMatch = uptimeRaw.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (loadMatch)
          vitals.cpu.loadAvg = [
            parseFloat(loadMatch[1]),
            parseFloat(loadMatch[2]),
            parseFloat(loadMatch[3])
          ];
        vitals.cpu.cores = parseInt(coresRaw, 10) || 1;
        vitals.cpu.usage = Math.min(100, Math.round(vitals.cpu.loadAvg[0] / vitals.cpu.cores * 100));
        if (isLinux) {
          if (mpstatOutput) {
            const parts = mpstatOutput.trim().split(/\s+/);
            const user = parts.length > 1 ? parseFloat(parts[1]) : NaN;
            const sys = parts.length > 3 ? parseFloat(parts[3]) : NaN;
            const idle = parts.length ? parseFloat(parts[parts.length - 1]) : NaN;
            if (!Number.isNaN(user)) vitals.cpu.userPercent = user;
            if (!Number.isNaN(sys)) vitals.cpu.sysPercent = sys;
            if (!Number.isNaN(idle)) {
              vitals.cpu.idlePercent = idle;
              vitals.cpu.usage = Math.max(0, Math.min(100, Math.round(100 - idle)));
            }
          }
          if (topOutput && (vitals.cpu.idlePercent === null || vitals.cpu.idlePercent === void 0)) {
            const userMatch = topOutput.match(/([\d.]+)\s*us/);
            const sysMatch = topOutput.match(/([\d.]+)\s*sy/);
            const idleMatch = topOutput.match(/([\d.]+)\s*id/);
            vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
            vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
            vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
            if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
              vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
            }
          }
        } else if (topOutput) {
          const userMatch = topOutput.match(/([\d.]+)%\s*user/);
          const sysMatch = topOutput.match(/([\d.]+)%\s*sys/);
          const idleMatch = topOutput.match(/([\d.]+)%\s*idle/);
          vitals.cpu.userPercent = userMatch ? parseFloat(userMatch[1]) : null;
          vitals.cpu.sysPercent = sysMatch ? parseFloat(sysMatch[1]) : null;
          vitals.cpu.idlePercent = idleMatch ? parseFloat(idleMatch[1]) : null;
          if (vitals.cpu.userPercent !== null && vitals.cpu.sysPercent !== null) {
            vitals.cpu.usage = Math.round(vitals.cpu.userPercent + vitals.cpu.sysPercent);
          }
        }
        const dfParts = dfRaw.split(/\s+/);
        if (dfParts.length >= 4) {
          vitals.disk.total = parseInt(dfParts[1], 10) * 1024;
          vitals.disk.used = parseInt(dfParts[2], 10) * 1024;
          vitals.disk.free = parseInt(dfParts[3], 10) * 1024;
          vitals.disk.percent = Math.round(parseInt(dfParts[2], 10) / parseInt(dfParts[1], 10) * 100);
        }
        if (isLinux) {
          const memTotalKB = parseInt(memTotalRaw, 10) || 0;
          const memAvailableMatch = memInfoRaw.match(/MemAvailable:\s+(\d+)/);
          const memFreeMatch = memInfoRaw.match(/MemFree:\s+(\d+)/);
          vitals.memory.total = memTotalKB * 1024;
          const memAvailable = parseInt(memAvailableMatch?.[1] || memFreeMatch?.[1] || 0, 10) * 1024;
          vitals.memory.used = vitals.memory.total - memAvailable;
          vitals.memory.free = memAvailable;
          vitals.memory.percent = vitals.memory.total > 0 ? Math.round(vitals.memory.used / vitals.memory.total * 100) : 0;
        } else {
          const pageSizeMatch = memInfoRaw.match(/page size of (\d+) bytes/);
          const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;
          const activePages = parseInt((memInfoRaw.match(/Pages active:\s+(\d+)/) || [])[1] || 0, 10);
          const wiredPages = parseInt(
            (memInfoRaw.match(/Pages wired down:\s+(\d+)/) || [])[1] || 0,
            10
          );
          const compressedPages = parseInt(
            (memInfoRaw.match(/Pages occupied by compressor:\s+(\d+)/) || [])[1] || 0,
            10
          );
          vitals.memory.total = parseInt(memTotalRaw, 10) || 0;
          vitals.memory.used = (activePages + wiredPages + compressedPages) * pageSize;
          vitals.memory.free = vitals.memory.total - vitals.memory.used;
          vitals.memory.percent = vitals.memory.total > 0 ? Math.round(vitals.memory.used / vitals.memory.total * 100) : 0;
        }
        vitals.memory.pressure = vitals.memory.percent > 90 ? "critical" : vitals.memory.percent > 75 ? "warning" : "normal";
        const timeoutPrefix = isLinux ? "timeout 5" : "$(command -v gtimeout >/dev/null 2>&1 && echo gtimeout 5)";
        const iostatArgs = isLinux ? "-d -o JSON 1 2" : "-d -c 2 2";
        const iostatCmd = `${timeoutPrefix} iostat ${iostatArgs} 2>/dev/null || echo ''`;
        const [perfCores, effCores, chip, iostatRaw] = await Promise.all([
          isMacOS ? runCmd("sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo 0", { fallback: "0" }) : Promise.resolve("0"),
          isMacOS ? runCmd("sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo 0", { fallback: "0" }) : Promise.resolve("0"),
          isMacOS ? runCmd(
            'system_profiler SPHardwareDataType 2>/dev/null | grep "Chip:" | cut -d: -f2 || echo ""',
            { fallback: "" }
          ) : Promise.resolve(""),
          runCmd(iostatCmd, { fallback: "", timeout: 5e3 })
        ]);
        if (isLinux) {
          const cpuBrand = await runCmd(
            "cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d: -f2",
            { fallback: "" }
          );
          if (cpuBrand) vitals.cpu.brand = cpuBrand.trim();
        }
        vitals.cpu.pCores = parseInt(perfCores, 10) || null;
        vitals.cpu.eCores = parseInt(effCores, 10) || null;
        if (chip) vitals.cpu.chip = chip;
        if (isLinux) {
          try {
            const iostatJson = JSON.parse(iostatRaw);
            const samples = iostatJson.sysstat.hosts[0].statistics;
            const disks = samples[samples.length - 1].disk;
            const disk = disks.filter((d) => !d.disk_device.startsWith("loop")).sort((a, b) => b.tps - a.tps)[0];
            if (disk) {
              const kbReadPerSec = disk["kB_read/s"] || 0;
              const kbWrtnPerSec = disk["kB_wrtn/s"] || 0;
              vitals.disk.iops = disk.tps || 0;
              vitals.disk.throughputMBps = (kbReadPerSec + kbWrtnPerSec) / 1024;
              vitals.disk.kbPerTransfer = disk.tps > 0 ? (kbReadPerSec + kbWrtnPerSec) / disk.tps : 0;
            }
          } catch {
          }
        } else {
          const iostatLines = iostatRaw.split("\n").filter((l) => l.trim());
          const lastLine = iostatLines.length > 0 ? iostatLines[iostatLines.length - 1] : "";
          const iostatParts = lastLine.split(/\s+/).filter(Boolean);
          if (iostatParts.length >= 3) {
            vitals.disk.kbPerTransfer = parseFloat(iostatParts[0]) || 0;
            vitals.disk.iops = parseFloat(iostatParts[1]) || 0;
            vitals.disk.throughputMBps = parseFloat(iostatParts[2]) || 0;
          }
        }
        vitals.temperature = null;
        vitals.temperatureNote = null;
        const isAppleSilicon = vitals.cpu.chip && /apple/i.test(vitals.cpu.chip);
        if (isAppleSilicon) {
          vitals.temperatureNote = "Apple Silicon (requires elevated access)";
          try {
            const pmOutput = await runCmd(
              'sudo -n powermetrics --samplers smc -i 1 -n 1 2>/dev/null | grep -i "die temp" | head -1',
              { fallback: "", timeout: 5e3 }
            );
            const tempMatch = pmOutput.match(/([\d.]+)/);
            if (tempMatch) {
              vitals.temperature = parseFloat(tempMatch[1]);
              vitals.temperatureNote = null;
            }
          } catch (e) {
          }
        } else if (isMacOS) {
          const home = require("os").homedir();
          try {
            const temp = await runCmd(
              `osx-cpu-temp 2>/dev/null || ${home}/bin/osx-cpu-temp 2>/dev/null`,
              { fallback: "" }
            );
            if (temp && temp.includes("\xB0")) {
              const tempMatch = temp.match(/([\d.]+)/);
              if (tempMatch && parseFloat(tempMatch[1]) > 0) {
                vitals.temperature = parseFloat(tempMatch[1]);
              }
            }
          } catch (e) {
          }
          if (!vitals.temperature) {
            try {
              const ioregRaw = await runCmd(
                "ioreg -r -n AppleSmartBattery 2>/dev/null | grep Temperature",
                { fallback: "" }
              );
              const tempMatch = ioregRaw.match(/"Temperature"\s*=\s*(\d+)/);
              if (tempMatch) {
                vitals.temperature = Math.round(parseInt(tempMatch[1], 10) / 100);
              }
            } catch (e) {
            }
          }
        } else if (isLinux) {
          try {
            const temp = await runCmd("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null", {
              fallback: ""
            });
            if (temp) {
              vitals.temperature = Math.round(parseInt(temp, 10) / 1e3);
            }
          } catch (e) {
          }
        }
      } catch (e) {
        console.error("[Vitals] Async refresh failed:", e.message);
      }
      vitals.memory.usedFormatted = formatBytes(vitals.memory.used);
      vitals.memory.totalFormatted = formatBytes(vitals.memory.total);
      vitals.memory.freeFormatted = formatBytes(vitals.memory.free);
      vitals.disk.usedFormatted = formatBytes(vitals.disk.used);
      vitals.disk.totalFormatted = formatBytes(vitals.disk.total);
      vitals.disk.freeFormatted = formatBytes(vitals.disk.free);
      cachedVitals = vitals;
      lastVitalsUpdate = Date.now();
      vitalsRefreshing = false;
      console.log("[Vitals] Cache refreshed async");
    }
    setTimeout(() => refreshVitalsAsync(), 500);
    setInterval(() => refreshVitalsAsync(), VITALS_CACHE_TTL);
    function getSystemVitals2() {
      const now = Date.now();
      if (!cachedVitals || now - lastVitalsUpdate > VITALS_CACHE_TTL) {
        refreshVitalsAsync();
      }
      if (cachedVitals) return cachedVitals;
      return {
        hostname: "loading...",
        uptime: "",
        disk: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          usedFormatted: "-",
          totalFormatted: "-",
          freeFormatted: "-"
        },
        cpu: { loadAvg: [0, 0, 0], cores: 0, usage: 0 },
        memory: {
          used: 0,
          free: 0,
          total: 0,
          percent: 0,
          pressure: "normal",
          usedFormatted: "-",
          totalFormatted: "-",
          freeFormatted: "-"
        },
        temperature: null
      };
    }
    var cachedDeps = null;
    async function checkOptionalDeps2() {
      const isLinux = process.platform === "linux";
      const isMacOS = process.platform === "darwin";
      const platform = isLinux ? "linux" : isMacOS ? "darwin" : null;
      const results = [];
      if (!platform) {
        cachedDeps = results;
        return results;
      }
      const fs2 = require("fs");
      const path2 = require("path");
      const depsFile = path2.join(__dirname, "..", "config", "system-deps.json");
      let depsConfig;
      try {
        depsConfig = JSON.parse(fs2.readFileSync(depsFile, "utf8"));
      } catch {
        cachedDeps = results;
        return results;
      }
      const deps = depsConfig[platform] || [];
      const home = require("os").homedir();
      let pkgManager = null;
      if (isLinux) {
        for (const pm of ["apt", "dnf", "yum", "pacman", "apk"]) {
          const has = await runCmd(`which ${pm}`, { fallback: "" });
          if (has) {
            pkgManager = pm;
            break;
          }
        }
      } else if (isMacOS) {
        const hasBrew = await runCmd("which brew", { fallback: "" });
        if (hasBrew) pkgManager = "brew";
      }
      let isAppleSilicon = false;
      if (isMacOS) {
        const chip = await runCmd("sysctl -n machdep.cpu.brand_string", { fallback: "" });
        isAppleSilicon = /apple/i.test(chip);
      }
      for (const dep of deps) {
        if (dep.condition === "intel" && isAppleSilicon) continue;
        let installed = false;
        const hasBinary = await runCmd(`which ${dep.binary} 2>/dev/null`, { fallback: "" });
        if (hasBinary) {
          installed = true;
        } else if (isMacOS && dep.binary === "osx-cpu-temp") {
          const homebin = await runCmd(`test -x ${home}/bin/osx-cpu-temp && echo ok`, {
            fallback: ""
          });
          if (homebin) installed = true;
        }
        const installCmd = dep.install[pkgManager] || null;
        results.push({
          id: dep.id,
          name: dep.name,
          purpose: dep.purpose,
          affects: dep.affects,
          installed,
          installCmd,
          url: dep.url || null
        });
      }
      cachedDeps = results;
      const missing = results.filter((d) => !d.installed);
      if (missing.length > 0) {
        console.log("[Startup] Optional dependencies for enhanced vitals:");
        for (const dep of missing) {
          const action = dep.installCmd || dep.url || "see docs";
          console.log(`   \u{1F4A1} ${dep.name} \u2014 ${dep.purpose}: ${action}`);
        }
      }
      return results;
    }
    function getOptionalDeps2() {
      return cachedDeps;
    }
    module2.exports = {
      refreshVitalsAsync,
      getSystemVitals: getSystemVitals2,
      checkOptionalDeps: checkOptionalDeps2,
      getOptionalDeps: getOptionalDeps2,
      VITALS_CACHE_TTL
    };
  }
});

// src/auth.js
var require_auth = __commonJS({
  "src/auth.js"(exports2, module2) {
    var AUTH_HEADERS = {
      tailscale: {
        login: "tailscale-user-login",
        name: "tailscale-user-name",
        pic: "tailscale-user-profile-pic"
      },
      cloudflare: {
        email: "cf-access-authenticated-user-email"
      }
    };
    function checkAuth2(req, authConfig) {
      const mode = authConfig.mode;
      const remoteAddr = req.socket?.remoteAddress || "";
      const isLocalhost = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
      if (isLocalhost) {
        return { authorized: true, user: { type: "localhost", login: "localhost" } };
      }
      if (mode === "none") {
        return { authorized: true, user: null };
      }
      if (mode === "token") {
        const authHeader = req.headers["authorization"] || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (token && token === authConfig.token) {
          return { authorized: true, user: { type: "token" } };
        }
        return { authorized: false, reason: "Invalid or missing token" };
      }
      if (mode === "tailscale") {
        const login = (req.headers[AUTH_HEADERS.tailscale.login] || "").toLowerCase();
        const name = req.headers[AUTH_HEADERS.tailscale.name] || "";
        const pic = req.headers[AUTH_HEADERS.tailscale.pic] || "";
        if (!login) {
          return { authorized: false, reason: "Not accessed via Tailscale Serve" };
        }
        const isAllowed = authConfig.allowedUsers.some((allowed) => {
          if (allowed === "*") return true;
          if (allowed === login) return true;
          if (allowed.startsWith("*@")) {
            const domain = allowed.slice(2);
            return login.endsWith("@" + domain);
          }
          return false;
        });
        if (isAllowed) {
          return { authorized: true, user: { type: "tailscale", login, name, pic } };
        }
        return { authorized: false, reason: `User ${login} not in allowlist`, user: { login } };
      }
      if (mode === "cloudflare") {
        const email = (req.headers[AUTH_HEADERS.cloudflare.email] || "").toLowerCase();
        if (!email) {
          return { authorized: false, reason: "Not accessed via Cloudflare Access" };
        }
        const isAllowed = authConfig.allowedUsers.some((allowed) => {
          if (allowed === "*") return true;
          if (allowed === email) return true;
          if (allowed.startsWith("*@")) {
            const domain = allowed.slice(2);
            return email.endsWith("@" + domain);
          }
          return false;
        });
        if (isAllowed) {
          return { authorized: true, user: { type: "cloudflare", email } };
        }
        return { authorized: false, reason: `User ${email} not in allowlist`, user: { email } };
      }
      if (mode === "allowlist") {
        const clientIP = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
        const isAllowed = authConfig.allowedIPs.some((allowed) => {
          if (allowed === clientIP) return true;
          if (allowed.endsWith("/24")) {
            const prefix = allowed.slice(0, -3).split(".").slice(0, 3).join(".");
            return clientIP.startsWith(prefix + ".");
          }
          return false;
        });
        if (isAllowed) {
          return { authorized: true, user: { type: "ip", ip: clientIP } };
        }
        return { authorized: false, reason: `IP ${clientIP} not in allowlist` };
      }
      return { authorized: false, reason: "Unknown auth mode" };
    }
    function getUnauthorizedPage2(reason, user, authConfig) {
      const userInfo = user ? `<p class="user-info">Detected: ${user.login || user.email || user.ip || "unknown"}</p>` : "";
      return `<!DOCTYPE html>
<html>
<head>
    <title>Access Denied - Command Center</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e8e8e8;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 500px;
        }
        .icon { font-size: 4rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin-bottom: 1rem; color: #ff6b6b; }
        .reason { color: #aaa; margin-bottom: 1.5rem; font-size: 0.95rem; }
        .user-info { color: #ffeb3b; margin: 1rem 0; font-size: 0.9rem; }
        .instructions { color: #ccc; font-size: 0.85rem; line-height: 1.5; }
        .auth-mode { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); color: #888; font-size: 0.75rem; }
        code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">\u{1F510}</div>
        <h1>Access Denied</h1>
        <div class="reason">${reason}</div>
        ${userInfo}
        <div class="instructions">
            <p>This dashboard requires authentication via <strong>${authConfig.mode}</strong>.</p>
            ${authConfig.mode === "tailscale" ? `<p style="margin-top:1rem">Make sure you're accessing via your Tailscale URL and your account is in the allowlist.</p>` : ""}
            ${authConfig.mode === "cloudflare" ? `<p style="margin-top:1rem">Make sure you're accessing via Cloudflare Access and your email is in the allowlist.</p>` : ""}
        </div>
        <div class="auth-mode">Auth mode: <code>${authConfig.mode}</code></div>
    </div>
</body>
</html>`;
    }
    module2.exports = { AUTH_HEADERS, checkAuth: checkAuth2, getUnauthorizedPage: getUnauthorizedPage2 };
  }
});

// src/privacy.js
var require_privacy = __commonJS({
  "src/privacy.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function getPrivacyFilePath(dataDir) {
      return path2.join(dataDir, "privacy-settings.json");
    }
    function loadPrivacySettings2(dataDir) {
      try {
        const privacyFile = getPrivacyFilePath(dataDir);
        if (fs2.existsSync(privacyFile)) {
          return JSON.parse(fs2.readFileSync(privacyFile, "utf8"));
        }
      } catch (e) {
        console.error("Failed to load privacy settings:", e.message);
      }
      return {
        version: 1,
        hiddenTopics: [],
        hiddenSessions: [],
        hiddenCrons: [],
        hideHostname: false,
        updatedAt: null
      };
    }
    function savePrivacySettings2(dataDir, data) {
      try {
        if (!fs2.existsSync(dataDir)) {
          fs2.mkdirSync(dataDir, { recursive: true });
        }
        data.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        fs2.writeFileSync(getPrivacyFilePath(dataDir), JSON.stringify(data, null, 2));
        return true;
      } catch (e) {
        console.error("Failed to save privacy settings:", e.message);
        return false;
      }
    }
    module2.exports = {
      loadPrivacySettings: loadPrivacySettings2,
      savePrivacySettings: savePrivacySettings2
    };
  }
});

// src/operators.js
var require_operators = __commonJS({
  "src/operators.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function loadOperators2(dataDir) {
      const operatorsFile = path2.join(dataDir, "operators.json");
      try {
        if (fs2.existsSync(operatorsFile)) {
          return JSON.parse(fs2.readFileSync(operatorsFile, "utf8"));
        }
      } catch (e) {
        console.error("Failed to load operators:", e.message);
      }
      return { version: 1, operators: [], roles: {} };
    }
    function saveOperators2(dataDir, data) {
      try {
        if (!fs2.existsSync(dataDir)) {
          fs2.mkdirSync(dataDir, { recursive: true });
        }
        const operatorsFile = path2.join(dataDir, "operators.json");
        fs2.writeFileSync(operatorsFile, JSON.stringify(data, null, 2));
        return true;
      } catch (e) {
        console.error("Failed to save operators:", e.message);
        return false;
      }
    }
    function getOperatorBySlackId2(dataDir, slackId) {
      const data = loadOperators2(dataDir);
      return data.operators.find((op) => op.id === slackId || op.metadata?.slackId === slackId);
    }
    var operatorsRefreshing = false;
    async function refreshOperatorsAsync(dataDir, getOpenClawDir2) {
      if (operatorsRefreshing) return;
      operatorsRefreshing = true;
      const toMs = (ts, fallback) => {
        if (typeof ts === "number" && Number.isFinite(ts)) return ts;
        if (typeof ts === "string") {
          const parsed = Date.parse(ts);
          if (Number.isFinite(parsed)) return parsed;
        }
        return fallback;
      };
      try {
        const openclawDir = getOpenClawDir2();
        const sessionsDir = path2.join(openclawDir, "agents", "main", "sessions");
        if (!fs2.existsSync(sessionsDir)) {
          operatorsRefreshing = false;
          return;
        }
        const files = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
        const operatorsMap = /* @__PURE__ */ new Map();
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
        for (const file of files) {
          const filePath = path2.join(sessionsDir, file);
          try {
            const stat = fs2.statSync(filePath);
            if (stat.mtimeMs < sevenDaysAgo) continue;
            const fd = fs2.openSync(filePath, "r");
            const buffer = Buffer.alloc(10240);
            const bytesRead = fs2.readSync(fd, buffer, 0, 10240, 0);
            fs2.closeSync(fd);
            const content = buffer.toString("utf8", 0, bytesRead);
            const lines = content.split("\n").slice(0, 20);
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const entry = JSON.parse(line);
                if (entry.type !== "message" || !entry.message) continue;
                const msg = entry.message;
                if (msg.role !== "user") continue;
                let text = "";
                if (typeof msg.content === "string") {
                  text = msg.content;
                } else if (Array.isArray(msg.content)) {
                  const textPart = msg.content.find((c) => c.type === "text");
                  if (textPart) text = textPart.text || "";
                }
                if (!text) continue;
                const slackMatch = text.match(/\[Slack[^\]]*\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
                if (slackMatch) {
                  const username = slackMatch[1];
                  const userId = slackMatch[2];
                  if (!operatorsMap.has(userId)) {
                    operatorsMap.set(userId, {
                      id: userId,
                      name: username,
                      username,
                      source: "slack",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(userId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
                const telegramMatch = text.match(/\[Telegram[^\]]*\]\s*([\w.-]+):/);
                if (telegramMatch) {
                  const username = telegramMatch[1];
                  const operatorId = `telegram:${username}`;
                  if (!operatorsMap.has(operatorId)) {
                    operatorsMap.set(operatorId, {
                      id: operatorId,
                      name: username,
                      username,
                      source: "telegram",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(operatorId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
                const discordSenderMatch = text.match(/"sender":\s*"(\d+)"/);
                const discordLabelMatch = text.match(/"label":\s*"([^"]+)"/);
                const discordUsernameMatch = text.match(/"username":\s*"([^"]+)"/);
                if (discordSenderMatch) {
                  const userId = discordSenderMatch[1];
                  const label = discordLabelMatch ? discordLabelMatch[1] : userId;
                  const username = discordUsernameMatch ? discordUsernameMatch[1] : label;
                  const opId = `discord:${userId}`;
                  if (!operatorsMap.has(opId)) {
                    operatorsMap.set(opId, {
                      id: opId,
                      discordId: userId,
                      name: label,
                      username,
                      source: "discord",
                      firstSeen: toMs(entry.timestamp, stat.mtimeMs),
                      lastSeen: toMs(entry.timestamp, stat.mtimeMs),
                      sessionCount: 1
                    });
                  } else {
                    const op = operatorsMap.get(opId);
                    op.lastSeen = Math.max(op.lastSeen, toMs(entry.timestamp, stat.mtimeMs));
                    op.sessionCount++;
                  }
                  break;
                }
              } catch (e) {
              }
            }
          } catch (e) {
          }
        }
        const existing = loadOperators2(dataDir);
        const existingMap = new Map(existing.operators.map((op) => [op.id, op]));
        for (const [id, autoOp] of operatorsMap) {
          if (existingMap.has(id)) {
            const manual = existingMap.get(id);
            manual.lastSeen = Math.max(manual.lastSeen || 0, autoOp.lastSeen);
            manual.sessionCount = (manual.sessionCount || 0) + autoOp.sessionCount;
          } else {
            existingMap.set(id, autoOp);
          }
        }
        const merged = {
          version: 1,
          operators: Array.from(existingMap.values()).sort(
            (a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)
          ),
          roles: existing.roles || {},
          lastRefreshed: Date.now()
        };
        saveOperators2(dataDir, merged);
        console.log(`[Operators] Refreshed: ${merged.operators.length} operators detected`);
      } catch (e) {
        console.error("[Operators] Refresh failed:", e.message);
      }
      operatorsRefreshing = false;
    }
    function startOperatorsRefresh2(dataDir, getOpenClawDir2) {
      setTimeout(() => refreshOperatorsAsync(dataDir, getOpenClawDir2), 2e3);
      setInterval(() => refreshOperatorsAsync(dataDir, getOpenClawDir2), 5 * 60 * 1e3);
    }
    module2.exports = {
      loadOperators: loadOperators2,
      saveOperators: saveOperators2,
      getOperatorBySlackId: getOperatorBySlackId2,
      refreshOperatorsAsync,
      startOperatorsRefresh: startOperatorsRefresh2
    };
  }
});

// src/topics.js
var require_topics = __commonJS({
  "src/topics.js"(exports2, module2) {
    var TOPIC_PATTERNS = {
      dashboard: ["dashboard", "command center", "ui", "interface", "status page"],
      scheduling: ["cron", "schedule", "timer", "reminder", "alarm", "periodic", "interval"],
      heartbeat: [
        "heartbeat",
        "heartbeat_ok",
        "poll",
        "health check",
        "ping",
        "keepalive",
        "monitoring"
      ],
      memory: ["memory", "remember", "recall", "notes", "journal", "log", "context"],
      Slack: ["slack", "channel", "#cc-", "thread", "mention", "dm", "workspace"],
      email: ["email", "mail", "inbox", "gmail", "send email", "unread", "compose"],
      calendar: ["calendar", "event", "meeting", "appointment", "schedule", "gcal"],
      coding: [
        "code",
        "script",
        "function",
        "debug",
        "error",
        "bug",
        "implement",
        "refactor",
        "programming"
      ],
      git: [
        "git",
        "commit",
        "branch",
        "merge",
        "push",
        "pull",
        "repository",
        "pr",
        "pull request",
        "github"
      ],
      "file editing": ["file", "edit", "write", "read", "create", "delete", "modify", "save"],
      API: ["api", "endpoint", "request", "response", "webhook", "integration", "rest", "graphql"],
      research: ["search", "research", "lookup", "find", "investigate", "learn", "study"],
      browser: ["browser", "webpage", "website", "url", "click", "navigate", "screenshot", "web_fetch"],
      "Quip export": ["quip", "export", "document", "spreadsheet"],
      finance: ["finance", "investment", "stock", "money", "budget", "bank", "trading", "portfolio"],
      home: ["home", "automation", "lights", "thermostat", "smart home", "iot", "homekit"],
      health: ["health", "fitness", "workout", "exercise", "weight", "sleep", "nutrition"],
      travel: ["travel", "flight", "hotel", "trip", "vacation", "booking", "airport"],
      food: ["food", "recipe", "restaurant", "cooking", "meal", "order", "delivery"],
      subagent: ["subagent", "spawn", "sub-agent", "delegate", "worker", "parallel"],
      tools: ["tool", "exec", "shell", "command", "terminal", "bash", "run"]
    };
    function detectTopics(text) {
      if (!text) return [];
      const lowerText = text.toLowerCase();
      const scores = {};
      for (const [topic, keywords] of Object.entries(TOPIC_PATTERNS)) {
        let score = 0;
        for (const keyword of keywords) {
          if (keyword.length <= 3) {
            const regex = new RegExp(`\\b${keyword}\\b`, "i");
            if (regex.test(lowerText)) score++;
          } else if (lowerText.includes(keyword)) {
            score++;
          }
        }
        if (score > 0) {
          scores[topic] = score;
        }
      }
      if (Object.keys(scores).length === 0) return [];
      const bestScore = Math.max(...Object.values(scores));
      const threshold = Math.max(2, bestScore * 0.5);
      return Object.entries(scores).filter(([_, score]) => score >= threshold || score >= 1 && bestScore <= 2).sort((a, b) => b[1] - a[1]).map(([topic, _]) => topic);
    }
    module2.exports = { TOPIC_PATTERNS, detectTopics };
  }
});

// src/sessions.js
var require_sessions = __commonJS({
  "src/sessions.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { detectTopics } = require_topics();
    var CHANNEL_MAP = {
      c0aax7y80np: "#cc-meta",
      c0ab9f8sdfe: "#cc-research",
      c0aan4rq7v5: "#cc-finance",
      c0abxulk1qq: "#cc-properties",
      c0ab5nz8mkl: "#cc-ai",
      c0aan38tzv5: "#cc-dev",
      c0ab7wwhqvc: "#cc-home",
      c0ab1pjhxef: "#cc-health",
      c0ab7txvcqd: "#cc-legal",
      c0aay2g3n3r: "#cc-social",
      c0aaxrw2wqp: "#cc-business",
      c0ab19f3lae: "#cc-random",
      c0ab0r74y33: "#cc-food",
      c0ab0qrq3r9: "#cc-travel",
      c0ab0sbqqlg: "#cc-family",
      c0ab0slqdba: "#cc-games",
      c0ab1ps7ef2: "#cc-music",
      c0absbnrsbe: "#cc-dashboard"
    };
    function parseSessionLabel(key) {
      const parts = key.split(":");
      if (parts.includes("slack")) {
        const channelIdx = parts.indexOf("channel");
        if (channelIdx >= 0 && parts[channelIdx + 1]) {
          const channelId = parts[channelIdx + 1].toLowerCase();
          const channelName = CHANNEL_MAP[channelId] || `#${channelId}`;
          if (parts.includes("thread")) {
            const threadTs = parts[parts.indexOf("thread") + 1];
            const ts = parseFloat(threadTs);
            const date = new Date(ts * 1e3);
            const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `${channelName} thread @ ${timeStr}`;
          }
          return channelName;
        }
      }
      if (key.includes("telegram")) {
        return "\u{1F4F1} Telegram";
      }
      if (key === "agent:main:main") {
        return "\u{1F3E0} Main Session";
      }
      return key.length > 40 ? key.slice(0, 37) + "..." : key;
    }
    function createSessionsModule2(deps) {
      const { getOpenClawDir: getOpenClawDir2, getOperatorBySlackId: getOperatorBySlackId2, runOpenClaw: runOpenClaw2, runOpenClawAsync: runOpenClawAsync2, extractJSON: extractJSON2 } = deps;
      let sessionsCache = { sessions: [], timestamp: 0, refreshing: false };
      const SESSIONS_CACHE_TTL = 1e4;
      function getSessionOriginator(sessionId) {
        try {
          if (!sessionId) return null;
          const openclawDir = getOpenClawDir2();
          const transcriptPath = path2.join(
            openclawDir,
            "agents",
            "main",
            "sessions",
            `${sessionId}.jsonl`
          );
          if (!fs2.existsSync(transcriptPath)) return null;
          const content = fs2.readFileSync(transcriptPath, "utf8");
          const lines = content.trim().split("\n");
          for (let i = 0; i < Math.min(lines.length, 10); i++) {
            try {
              const entry = JSON.parse(lines[i]);
              if (entry.type !== "message" || !entry.message) continue;
              const msg = entry.message;
              if (msg.role !== "user") continue;
              let text = "";
              if (typeof msg.content === "string") {
                text = msg.content;
              } else if (Array.isArray(msg.content)) {
                const textPart = msg.content.find((c) => c.type === "text");
                if (textPart) text = textPart.text || "";
              }
              if (!text) continue;
              const slackUserMatch = text.match(/\]\s*([\w.-]+)\s*\(([A-Z0-9]+)\):/);
              if (slackUserMatch) {
                const username = slackUserMatch[1];
                const userId = slackUserMatch[2];
                const operator = getOperatorBySlackId2(userId);
                return {
                  userId,
                  username,
                  displayName: operator?.name || username,
                  role: operator?.role || "user",
                  avatar: operator?.avatar || null
                };
              }
            } catch (e) {
            }
          }
          return null;
        } catch (e) {
          return null;
        }
      }
      function getSessionTopic(sessionId) {
        if (!sessionId) return null;
        try {
          const openclawDir = getOpenClawDir2();
          const transcriptPath = path2.join(
            openclawDir,
            "agents",
            "main",
            "sessions",
            `${sessionId}.jsonl`
          );
          if (!fs2.existsSync(transcriptPath)) return null;
          const fd = fs2.openSync(transcriptPath, "r");
          const buffer = Buffer.alloc(5e4);
          const bytesRead = fs2.readSync(fd, buffer, 0, 5e4, 0);
          fs2.closeSync(fd);
          if (bytesRead === 0) return null;
          const content = buffer.toString("utf8", 0, bytesRead);
          const lines = content.split("\n").filter((l) => l.trim());
          let textSamples = [];
          for (const line of lines.slice(0, 30)) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === "message" && entry.message?.content) {
                const msgContent = entry.message.content;
                if (Array.isArray(msgContent)) {
                  msgContent.forEach((c) => {
                    if (c.type === "text" && c.text) {
                      textSamples.push(c.text.slice(0, 500));
                    }
                  });
                } else if (typeof msgContent === "string") {
                  textSamples.push(msgContent.slice(0, 500));
                }
              }
            } catch (e) {
            }
          }
          if (textSamples.length === 0) return null;
          const topics = detectTopics(textSamples.join(" "));
          return topics.length > 0 ? topics.slice(0, 2).join(", ") : null;
        } catch (e) {
          return null;
        }
      }
      function mapSession(s) {
        const minutesAgo = s.ageMs ? s.ageMs / 6e4 : Infinity;
        let channel = "other";
        if (s.key.includes("slack")) channel = "slack";
        else if (s.key.includes("telegram")) channel = "telegram";
        else if (s.key.includes("discord")) channel = "discord";
        else if (s.key.includes("signal")) channel = "signal";
        else if (s.key.includes("whatsapp")) channel = "whatsapp";
        let sessionType = "channel";
        if (s.key.includes(":subagent:")) sessionType = "subagent";
        else if (s.key.includes(":cron:")) sessionType = "cron";
        else if (s.key === "agent:main:main") sessionType = "main";
        const originator = getSessionOriginator(s.sessionId);
        const label = s.groupChannel || s.displayName || parseSessionLabel(s.key);
        const topic = getSessionTopic(s.sessionId);
        const totalTokens = s.totalTokens || 0;
        const sessionAgeMinutes = Math.max(1, Math.min(minutesAgo, 24 * 60));
        const burnRate = Math.round(totalTokens / sessionAgeMinutes);
        return {
          sessionKey: s.key,
          sessionId: s.sessionId,
          label,
          groupChannel: s.groupChannel || null,
          displayName: s.displayName || null,
          kind: s.kind,
          channel,
          sessionType,
          active: minutesAgo < 15,
          recentlyActive: minutesAgo < 60,
          minutesAgo: Math.round(minutesAgo),
          tokens: s.totalTokens || 0,
          model: s.model,
          originator,
          topic,
          metrics: {
            burnRate,
            toolCalls: 0,
            minutesActive: Math.max(1, Math.min(Math.round(minutesAgo), 24 * 60))
          }
        };
      }
      async function refreshSessionsCache() {
        if (sessionsCache.refreshing) return;
        sessionsCache.refreshing = true;
        try {
          const output = await runOpenClawAsync2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const sessions2 = data.sessions || [];
            const mapped = sessions2.map((s) => mapSession(s));
            sessionsCache = {
              sessions: mapped,
              timestamp: Date.now(),
              refreshing: false
            };
            console.log(`[Sessions Cache] Refreshed: ${mapped.length} sessions`);
          }
        } catch (e) {
          console.error("[Sessions Cache] Refresh error:", e.message);
        }
        sessionsCache.refreshing = false;
      }
      function getSessionsCached() {
        const now = Date.now();
        const isStale = now - sessionsCache.timestamp > SESSIONS_CACHE_TTL;
        if (isStale && !sessionsCache.refreshing) {
          refreshSessionsCache();
        }
        return sessionsCache.sessions;
      }
      function getSessions(options = {}) {
        const limit = Object.prototype.hasOwnProperty.call(options, "limit") ? options.limit : 20;
        const returnCount = options.returnCount || false;
        if (limit === null) {
          const cached = getSessionsCached();
          const totalCount = cached.length;
          return returnCount ? { sessions: cached, totalCount } : cached;
        }
        try {
          const output = runOpenClaw2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const totalCount = data.count || data.sessions?.length || 0;
            let sessions2 = data.sessions || [];
            if (limit != null) {
              sessions2 = sessions2.slice(0, limit);
            }
            const mapped = sessions2.map((s) => mapSession(s));
            return returnCount ? { sessions: mapped, totalCount } : mapped;
          }
        } catch (e) {
          console.error("Failed to get sessions:", e.message);
        }
        return returnCount ? { sessions: [], totalCount: 0 } : [];
      }
      function readTranscript(sessionId) {
        const openclawDir = getOpenClawDir2();
        const transcriptPath = path2.join(
          openclawDir,
          "agents",
          "main",
          "sessions",
          `${sessionId}.jsonl`
        );
        try {
          if (!fs2.existsSync(transcriptPath)) return [];
          const content = fs2.readFileSync(transcriptPath, "utf8");
          return content.trim().split("\n").map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          }).filter(Boolean);
        } catch (e) {
          console.error("Failed to read transcript:", e.message);
          return [];
        }
      }
      function getSessionDetail(sessionKey) {
        try {
          const listOutput = runOpenClaw2("sessions --json 2>/dev/null");
          let sessionInfo = null;
          const jsonStr = extractJSON2(listOutput);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            sessionInfo = data.sessions?.find((s) => s.key === sessionKey);
          }
          if (!sessionInfo) {
            return { error: "Session not found" };
          }
          const transcript = readTranscript(sessionInfo.sessionId);
          let messages = [];
          let tools = {};
          let facts = [];
          let needsAttention = [];
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalCost = 0;
          let detectedModel = sessionInfo.model || null;
          transcript.forEach((entry) => {
            if (entry.type !== "message" || !entry.message) return;
            const msg = entry.message;
            if (!msg.role) return;
            if (msg.usage) {
              totalInputTokens += msg.usage.input || msg.usage.inputTokens || 0;
              totalOutputTokens += msg.usage.output || msg.usage.outputTokens || 0;
              totalCacheRead += msg.usage.cacheRead || msg.usage.cacheReadTokens || 0;
              totalCacheWrite += msg.usage.cacheWrite || msg.usage.cacheWriteTokens || 0;
              if (msg.usage.cost?.total) totalCost += msg.usage.cost.total;
            }
            if (msg.role === "assistant" && msg.model && !detectedModel) {
              detectedModel = msg.model;
            }
            let text = "";
            if (typeof msg.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg.content)) {
              const textPart = msg.content.find((c) => c.type === "text");
              if (textPart) text = textPart.text || "";
              msg.content.filter((c) => c.type === "toolCall" || c.type === "tool_use").forEach((tc) => {
                const name = tc.name || tc.tool || "unknown";
                tools[name] = (tools[name] || 0) + 1;
              });
            }
            if (text && msg.role !== "toolResult") {
              messages.push({ role: msg.role, text, timestamp: entry.timestamp });
            }
            if (msg.role === "user" && text) {
              const lowerText = text.toLowerCase();
              if (text.includes("?")) {
                const questions = text.match(/[^.!?\n]*\?/g) || [];
                questions.slice(0, 2).forEach((q) => {
                  if (q.length > 15 && q.length < 200) {
                    needsAttention.push(`\u2753 ${q.trim()}`);
                  }
                });
              }
              if (lowerText.includes("todo") || lowerText.includes("remind") || lowerText.includes("need to")) {
                const match = text.match(/(?:todo|remind|need to)[^.!?\n]*/i);
                if (match) needsAttention.push(`\u{1F4CB} ${match[0].slice(0, 100)}`);
              }
            }
            if (msg.role === "assistant" && text) {
              const lowerText = text.toLowerCase();
              ["\u2705", "done", "created", "updated", "fixed", "deployed"].forEach((keyword) => {
                if (lowerText.includes(keyword)) {
                  const lines = text.split("\n").filter((l) => l.toLowerCase().includes(keyword));
                  lines.slice(0, 2).forEach((line) => {
                    if (line.length > 5 && line.length < 150) {
                      facts.push(line.trim().slice(0, 100));
                    }
                  });
                }
              });
            }
          });
          let summary = "No activity yet.";
          const userMessages = messages.filter((m) => m.role === "user");
          const assistantMessages = messages.filter((m) => m.role === "assistant");
          let topics = [];
          if (messages.length > 0) {
            summary = `${messages.length} messages (${userMessages.length} user, ${assistantMessages.length} assistant). `;
            const allText = messages.map((m) => m.text).join(" ");
            topics = detectTopics(allText);
            if (topics.length > 0) {
              summary += `Topics: ${topics.join(", ")}.`;
            }
          }
          const toolsArray = Object.entries(tools).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
          const ageMs = sessionInfo.ageMs || 0;
          const lastActive = ageMs < 6e4 ? "Just now" : ageMs < 36e5 ? `${Math.round(ageMs / 6e4)} minutes ago` : ageMs < 864e5 ? `${Math.round(ageMs / 36e5)} hours ago` : `${Math.round(ageMs / 864e5)} days ago`;
          let channelDisplay = "Other";
          if (sessionInfo.groupChannel) {
            channelDisplay = sessionInfo.groupChannel;
          } else if (sessionInfo.displayName) {
            channelDisplay = sessionInfo.displayName;
          } else if (sessionKey.includes("slack")) {
            const parts = sessionKey.split(":");
            const channelIdx = parts.indexOf("channel");
            if (channelIdx >= 0 && parts[channelIdx + 1]) {
              const channelId = parts[channelIdx + 1].toLowerCase();
              channelDisplay = CHANNEL_MAP[channelId] || `#${channelId}`;
            } else {
              channelDisplay = "Slack";
            }
          } else if (sessionKey.includes("telegram")) {
            channelDisplay = "Telegram";
          }
          const finalTotalTokens = totalInputTokens + totalOutputTokens || sessionInfo.totalTokens || 0;
          const finalInputTokens = totalInputTokens || sessionInfo.inputTokens || 0;
          const finalOutputTokens = totalOutputTokens || sessionInfo.outputTokens || 0;
          const modelDisplay = (detectedModel || sessionInfo.model || "-").replace("anthropic/", "").replace("openai/", "");
          return {
            key: sessionKey,
            kind: sessionInfo.kind,
            channel: channelDisplay,
            groupChannel: sessionInfo.groupChannel || channelDisplay,
            model: modelDisplay,
            tokens: finalTotalTokens,
            inputTokens: finalInputTokens,
            outputTokens: finalOutputTokens,
            cacheRead: totalCacheRead,
            cacheWrite: totalCacheWrite,
            estCost: totalCost > 0 ? `$${totalCost.toFixed(4)}` : null,
            lastActive,
            summary,
            topics,
            // Array of detected topics
            facts: [...new Set(facts)].slice(0, 8),
            needsAttention: [...new Set(needsAttention)].slice(0, 5),
            tools: toolsArray.slice(0, 10),
            messages: messages.slice(-15).reverse().map((m) => ({
              role: m.role,
              text: m.text.slice(0, 500)
            }))
          };
        } catch (e) {
          console.error("Failed to get session detail:", e.message);
          return { error: e.message };
        }
      }
      return {
        getSessionOriginator,
        getSessionTopic,
        mapSession,
        refreshSessionsCache,
        getSessionsCached,
        getSessions,
        readTranscript,
        getSessionDetail,
        parseSessionLabel
      };
    }
    module2.exports = { createSessionsModule: createSessionsModule2, CHANNEL_MAP };
  }
});

// src/cron.js
var require_cron = __commonJS({
  "src/cron.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function cronToHuman(expr) {
      if (!expr || expr === "\u2014") return null;
      const parts = expr.split(" ");
      if (parts.length < 5) return null;
      const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      function formatTime(h, m) {
        const hNum = parseInt(h, 10);
        const mNum = parseInt(m, 10);
        if (isNaN(hNum)) return null;
        const ampm = hNum >= 12 ? "pm" : "am";
        const h12 = hNum === 0 ? 12 : hNum > 12 ? hNum - 12 : hNum;
        return mNum === 0 ? `${h12}${ampm}` : `${h12}:${mNum.toString().padStart(2, "0")}${ampm}`;
      }
      if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return "Every minute";
      }
      if (minute.startsWith("*/")) {
        const interval = minute.slice(2);
        return `Every ${interval} minutes`;
      }
      if (hour.startsWith("*/")) {
        const interval = hour.slice(2);
        const minStr = minute === "0" ? "" : `:${minute.padStart(2, "0")}`;
        return `Every ${interval} hours${minStr ? " at " + minStr : ""}`;
      }
      if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return `Hourly at :${minute.padStart(2, "0")}`;
      }
      let timeStr = "";
      if (minute !== "*" && hour !== "*" && !hour.startsWith("*/")) {
        timeStr = formatTime(hour, minute);
      }
      if (timeStr && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
        return `Daily at ${timeStr}`;
      }
      if ((dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") && dayOfMonth === "*" && month === "*") {
        return timeStr ? `Weekdays at ${timeStr}` : "Weekdays";
      }
      if ((dayOfWeek === "0,6" || dayOfWeek === "6,0") && dayOfMonth === "*" && month === "*") {
        return timeStr ? `Weekends at ${timeStr}` : "Weekends";
      }
      if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
        const days = dayOfWeek.split(",").map((d) => {
          const num = parseInt(d, 10);
          return dayNames[num] || d;
        });
        const dayStr = days.length === 1 ? days[0] : days.join(", ");
        return timeStr ? `${dayStr} at ${timeStr}` : `Every ${dayStr}`;
      }
      if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
        const day = parseInt(dayOfMonth, 10);
        const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
        return timeStr ? `${day}${suffix} of month at ${timeStr}` : `${day}${suffix} of every month`;
      }
      if (timeStr) {
        return `At ${timeStr}`;
      }
      return expr;
    }
    function getCronJobs2(getOpenClawDir2) {
      try {
        const cronPath = path2.join(getOpenClawDir2(), "cron", "jobs.json");
        if (fs2.existsSync(cronPath)) {
          const data = JSON.parse(fs2.readFileSync(cronPath, "utf8"));
          return (data.jobs || []).map((j) => {
            let scheduleStr = "\u2014";
            let scheduleHuman = null;
            if (j.schedule) {
              if (j.schedule.kind === "cron" && j.schedule.expr) {
                scheduleStr = j.schedule.expr;
                scheduleHuman = cronToHuman(j.schedule.expr);
              } else if (j.schedule.kind === "once") {
                scheduleStr = "once";
                scheduleHuman = "One-time";
              }
            }
            let nextRunStr = "\u2014";
            if (j.state?.nextRunAtMs) {
              const next = new Date(j.state.nextRunAtMs);
              const now = /* @__PURE__ */ new Date();
              const diffMs = next - now;
              const diffMins = Math.round(diffMs / 6e4);
              if (diffMins < 0) {
                nextRunStr = "overdue";
              } else if (diffMins < 60) {
                nextRunStr = `${diffMins}m`;
              } else if (diffMins < 1440) {
                nextRunStr = `${Math.round(diffMins / 60)}h`;
              } else {
                nextRunStr = `${Math.round(diffMins / 1440)}d`;
              }
            }
            return {
              id: j.id,
              name: j.name || j.id.slice(0, 8),
              schedule: scheduleStr,
              scheduleHuman,
              nextRun: nextRunStr,
              enabled: j.enabled !== false,
              lastStatus: j.state?.lastStatus
            };
          });
        }
      } catch (e) {
        console.error("Failed to get cron:", e.message);
      }
      return [];
    }
    module2.exports = {
      cronToHuman,
      getCronJobs: getCronJobs2
    };
  }
});

// src/cerebro.js
var require_cerebro = __commonJS({
  "src/cerebro.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { formatTimeAgo } = require_utils();
    function getCerebroTopics2(cerebroDir, options = {}) {
      const { offset = 0, limit = 20, status: filterStatus = "all" } = options;
      const topicsDir = path2.join(cerebroDir, "topics");
      const orphansDir = path2.join(cerebroDir, "orphans");
      const topics = [];
      const result = {
        initialized: false,
        cerebroPath: cerebroDir,
        topics: { active: 0, resolved: 0, parked: 0, total: 0 },
        threads: 0,
        orphans: 0,
        recentTopics: [],
        lastUpdated: null
      };
      try {
        if (!fs2.existsSync(cerebroDir)) {
          return result;
        }
        result.initialized = true;
        let latestModified = null;
        if (!fs2.existsSync(topicsDir)) {
          return result;
        }
        const topicNames = fs2.readdirSync(topicsDir).filter((name) => {
          const topicPath = path2.join(topicsDir, name);
          return fs2.statSync(topicPath).isDirectory() && !name.startsWith("_");
        });
        topicNames.forEach((name) => {
          const topicMdPath = path2.join(topicsDir, name, "topic.md");
          const topicDirPath = path2.join(topicsDir, name);
          let stat;
          let content = "";
          if (fs2.existsSync(topicMdPath)) {
            stat = fs2.statSync(topicMdPath);
            content = fs2.readFileSync(topicMdPath, "utf8");
          } else {
            stat = fs2.statSync(topicDirPath);
          }
          try {
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            let title = name;
            let topicStatus = "active";
            let category = "general";
            let created = null;
            if (frontmatterMatch) {
              const frontmatter = frontmatterMatch[1];
              const titleMatch = frontmatter.match(/title:\s*(.+)/);
              const statusMatch = frontmatter.match(/status:\s*(.+)/);
              const categoryMatch = frontmatter.match(/category:\s*(.+)/);
              const createdMatch = frontmatter.match(/created:\s*(.+)/);
              if (titleMatch) title = titleMatch[1].trim();
              if (statusMatch) topicStatus = statusMatch[1].trim().toLowerCase();
              if (categoryMatch) category = categoryMatch[1].trim();
              if (createdMatch) created = createdMatch[1].trim();
            }
            const threadsDir = path2.join(topicsDir, name, "threads");
            let threadCount = 0;
            if (fs2.existsSync(threadsDir)) {
              threadCount = fs2.readdirSync(threadsDir).filter((f) => f.endsWith(".md") || f.endsWith(".json")).length;
            }
            result.threads += threadCount;
            if (topicStatus === "active") result.topics.active++;
            else if (topicStatus === "resolved") result.topics.resolved++;
            else if (topicStatus === "parked") result.topics.parked++;
            if (!latestModified || stat.mtime > latestModified) {
              latestModified = stat.mtime;
            }
            topics.push({
              name,
              title,
              status: topicStatus,
              category,
              created,
              threads: threadCount,
              lastModified: stat.mtimeMs
            });
          } catch (e) {
            console.error(`Failed to parse topic ${name}:`, e.message);
          }
        });
        result.topics.total = topics.length;
        const statusPriority = { active: 0, resolved: 1, parked: 2 };
        topics.sort((a, b) => {
          const statusDiff = (statusPriority[a.status] || 3) - (statusPriority[b.status] || 3);
          if (statusDiff !== 0) return statusDiff;
          return b.lastModified - a.lastModified;
        });
        let filtered = topics;
        if (filterStatus !== "all") {
          filtered = topics.filter((t) => t.status === filterStatus);
        }
        const paginated = filtered.slice(offset, offset + limit);
        result.recentTopics = paginated.map((t) => ({
          name: t.name,
          title: t.title,
          status: t.status,
          threads: t.threads,
          age: formatTimeAgo(new Date(t.lastModified))
        }));
        if (fs2.existsSync(orphansDir)) {
          try {
            result.orphans = fs2.readdirSync(orphansDir).filter((f) => f.endsWith(".md")).length;
          } catch (e) {
          }
        }
        result.lastUpdated = latestModified ? latestModified.toISOString() : null;
      } catch (e) {
        console.error("Failed to get Cerebro topics:", e.message);
      }
      return result;
    }
    function updateTopicStatus2(cerebroDir, topicId, newStatus) {
      const topicDir = path2.join(cerebroDir, "topics", topicId);
      const topicFile = path2.join(topicDir, "topic.md");
      if (!fs2.existsSync(topicDir)) {
        return { error: `Topic '${topicId}' not found`, code: 404 };
      }
      if (!fs2.existsSync(topicFile)) {
        const content2 = `---
title: ${topicId}
status: ${newStatus}
category: general
created: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}
---

# ${topicId}

## Overview
*Topic tracking file.*

## Notes
`;
        fs2.writeFileSync(topicFile, content2, "utf8");
        return {
          topic: {
            id: topicId,
            name: topicId,
            title: topicId,
            status: newStatus
          }
        };
      }
      let content = fs2.readFileSync(topicFile, "utf8");
      let title = topicId;
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        let frontmatter = frontmatterMatch[1];
        const titleMatch = frontmatter.match(/title:\s*["']?([^"'\n]+)["']?/i);
        if (titleMatch) title = titleMatch[1];
        if (frontmatter.includes("status:")) {
          frontmatter = frontmatter.replace(
            /status:\s*(active|resolved|parked)/i,
            `status: ${newStatus}`
          );
        } else {
          frontmatter = frontmatter.trim() + `
status: ${newStatus}`;
        }
        content = content.replace(/^---\n[\s\S]*?\n---/, `---
${frontmatter}
---`);
      } else {
        const headerMatch = content.match(/^#\s*(.+)/m);
        if (headerMatch) title = headerMatch[1];
        const frontmatter = `---
title: ${title}
status: ${newStatus}
category: general
created: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}
---

`;
        content = frontmatter + content;
      }
      fs2.writeFileSync(topicFile, content, "utf8");
      return {
        topic: {
          id: topicId,
          name: topicId,
          title,
          status: newStatus
        }
      };
    }
    module2.exports = {
      getCerebroTopics: getCerebroTopics2,
      updateTopicStatus: updateTopicStatus2
    };
  }
});

// src/tokens.js
var require_tokens = __commonJS({
  "src/tokens.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { formatNumber, formatTokens } = require_utils();
    var TOKEN_RATES = {
      input: 15,
      // $15/1M input tokens
      output: 75,
      // $75/1M output tokens
      cacheRead: 1.5,
      // $1.50/1M (90% discount from input)
      cacheWrite: 18.75
      // $18.75/1M (25% premium on input)
    };
    var tokenUsageCache = { data: null, timestamp: 0, refreshing: false };
    var TOKEN_USAGE_CACHE_TTL = 3e4;
    var refreshInterval = null;
    function emptyUsageBucket() {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
    }
    async function refreshTokenUsageAsync2(getOpenClawDir2) {
      if (tokenUsageCache.refreshing) return;
      tokenUsageCache.refreshing = true;
      try {
        const sessionsDir = path2.join(getOpenClawDir2(), "agents", "main", "sessions");
        const files = await fs2.promises.readdir(sessionsDir);
        const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1e3;
        const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1e3;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1e3;
        const usage24h = emptyUsageBucket();
        const usage3d = emptyUsageBucket();
        const usage7d = emptyUsageBucket();
        const batchSize = 50;
        for (let i = 0; i < jsonlFiles.length; i += batchSize) {
          const batch = jsonlFiles.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (file) => {
              const filePath = path2.join(sessionsDir, file);
              try {
                const stat = await fs2.promises.stat(filePath);
                if (stat.mtimeMs < sevenDaysAgo) return;
                const content = await fs2.promises.readFile(filePath, "utf8");
                const lines = content.trim().split("\n");
                for (const line of lines) {
                  if (!line) continue;
                  try {
                    const entry = JSON.parse(line);
                    const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
                    if (entryTime < sevenDaysAgo) continue;
                    if (entry.message?.usage) {
                      const u = entry.message.usage;
                      const input = u.input || 0;
                      const output = u.output || 0;
                      const cacheRead = u.cacheRead || 0;
                      const cacheWrite = u.cacheWrite || 0;
                      const cost = u.cost?.total || 0;
                      if (entryTime >= oneDayAgo) {
                        usage24h.input += input;
                        usage24h.output += output;
                        usage24h.cacheRead += cacheRead;
                        usage24h.cacheWrite += cacheWrite;
                        usage24h.cost += cost;
                        usage24h.requests++;
                      }
                      if (entryTime >= threeDaysAgo) {
                        usage3d.input += input;
                        usage3d.output += output;
                        usage3d.cacheRead += cacheRead;
                        usage3d.cacheWrite += cacheWrite;
                        usage3d.cost += cost;
                        usage3d.requests++;
                      }
                      usage7d.input += input;
                      usage7d.output += output;
                      usage7d.cacheRead += cacheRead;
                      usage7d.cacheWrite += cacheWrite;
                      usage7d.cost += cost;
                      usage7d.requests++;
                    }
                  } catch (e) {
                  }
                }
              } catch (e) {
              }
            })
          );
          await new Promise((resolve) => setImmediate(resolve));
        }
        const finalizeBucket = (bucket) => ({
          ...bucket,
          tokensNoCache: bucket.input + bucket.output,
          tokensWithCache: bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite
        });
        const result = {
          // Primary (24h) for backward compatibility
          ...finalizeBucket(usage24h),
          // All three windows
          windows: {
            "24h": finalizeBucket(usage24h),
            "3d": finalizeBucket(usage3d),
            "7d": finalizeBucket(usage7d)
          }
        };
        tokenUsageCache = { data: result, timestamp: Date.now(), refreshing: false };
        console.log(
          `[Token Usage] Cached: 24h=${usage24h.requests} 3d=${usage3d.requests} 7d=${usage7d.requests} requests`
        );
      } catch (e) {
        console.error("[Token Usage] Refresh error:", e.message);
        tokenUsageCache.refreshing = false;
      }
    }
    function getDailyTokenUsage2(getOpenClawDir2) {
      const now = Date.now();
      const isStale = now - tokenUsageCache.timestamp > TOKEN_USAGE_CACHE_TTL;
      if (isStale && !tokenUsageCache.refreshing && getOpenClawDir2) {
        refreshTokenUsageAsync2(getOpenClawDir2);
      }
      const emptyResult = {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        requests: 0,
        tokensNoCache: 0,
        tokensWithCache: 0,
        windows: {
          "24h": {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            requests: 0,
            tokensNoCache: 0,
            tokensWithCache: 0
          },
          "3d": {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            requests: 0,
            tokensNoCache: 0,
            tokensWithCache: 0
          },
          "7d": {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            requests: 0,
            tokensNoCache: 0,
            tokensWithCache: 0
          }
        }
      };
      return tokenUsageCache.data || emptyResult;
    }
    function calculateCostForBucket(bucket, rates = TOKEN_RATES) {
      const inputCost = bucket.input / 1e6 * rates.input;
      const outputCost = bucket.output / 1e6 * rates.output;
      const cacheReadCost = bucket.cacheRead / 1e6 * rates.cacheRead;
      const cacheWriteCost = bucket.cacheWrite / 1e6 * rates.cacheWrite;
      return {
        inputCost,
        outputCost,
        cacheReadCost,
        cacheWriteCost,
        totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost
      };
    }
    function getCostBreakdown2(config, getSessions, getOpenClawDir2) {
      const usage = getDailyTokenUsage2(getOpenClawDir2);
      if (!usage) {
        return { error: "Failed to get usage data" };
      }
      const costs = calculateCostForBucket(usage);
      const planCost = config.billing?.claudePlanCost || 200;
      const planName = config.billing?.claudePlanName || "Claude Code Max";
      const windowConfigs = {
        "24h": { days: 1, label: "24h" },
        "3d": { days: 3, label: "3dma" },
        "7d": { days: 7, label: "7dma" }
      };
      const windows = {};
      for (const [key, windowConfig] of Object.entries(windowConfigs)) {
        const bucket = usage.windows?.[key] || usage;
        const bucketCosts = calculateCostForBucket(bucket);
        const dailyAvg = bucketCosts.totalCost / windowConfig.days;
        const monthlyProjected = dailyAvg * 30;
        const monthlySavings = monthlyProjected - planCost;
        windows[key] = {
          label: windowConfig.label,
          days: windowConfig.days,
          totalCost: bucketCosts.totalCost,
          dailyAvg,
          monthlyProjected,
          monthlySavings,
          savingsPercent: monthlySavings > 0 ? Math.round(monthlySavings / monthlyProjected * 100) : 0,
          requests: bucket.requests,
          tokens: {
            input: bucket.input,
            output: bucket.output,
            cacheRead: bucket.cacheRead,
            cacheWrite: bucket.cacheWrite
          }
        };
      }
      return {
        // Raw token counts (24h for backward compatibility)
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        requests: usage.requests,
        // Pricing rates
        rates: {
          input: TOKEN_RATES.input.toFixed(2),
          output: TOKEN_RATES.output.toFixed(2),
          cacheRead: TOKEN_RATES.cacheRead.toFixed(2),
          cacheWrite: TOKEN_RATES.cacheWrite.toFixed(2)
        },
        // Cost calculation breakdown (24h)
        calculation: {
          inputCost: costs.inputCost,
          outputCost: costs.outputCost,
          cacheReadCost: costs.cacheReadCost,
          cacheWriteCost: costs.cacheWriteCost
        },
        // Totals (24h for backward compatibility)
        totalCost: costs.totalCost,
        planCost,
        planName,
        // Period
        period: "24 hours",
        // Multi-window data for moving averages
        windows,
        // Top sessions by tokens
        topSessions: getTopSessionsByTokens(5, getSessions)
      };
    }
    function getTopSessionsByTokens(limit = 5, getSessions) {
      try {
        const sessions2 = getSessions({ limit: null });
        return sessions2.filter((s) => s.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, limit).map((s) => ({
          label: s.label,
          tokens: s.tokens,
          channel: s.channel,
          active: s.active
        }));
      } catch (e) {
        console.error("[TopSessions] Error:", e.message);
        return [];
      }
    }
    function getTokenStats2(sessions2, capacity, config = {}) {
      let activeMainCount = capacity?.main?.active ?? 0;
      let activeSubagentCount = capacity?.subagent?.active ?? 0;
      let activeCount = activeMainCount + activeSubagentCount;
      let mainLimit = capacity?.main?.max ?? 12;
      let subagentLimit = capacity?.subagent?.max ?? 24;
      if (!capacity && sessions2 && sessions2.length > 0) {
        activeCount = 0;
        activeMainCount = 0;
        activeSubagentCount = 0;
        sessions2.forEach((s) => {
          if (s.active) {
            activeCount++;
            if (s.key && s.key.includes(":subagent:")) {
              activeSubagentCount++;
            } else {
              activeMainCount++;
            }
          }
        });
      }
      const usage = getDailyTokenUsage2();
      const totalInput = usage?.input || 0;
      const totalOutput = usage?.output || 0;
      const total = totalInput + totalOutput;
      const costs = calculateCostForBucket(usage);
      const estCost = costs.totalCost;
      const planCost = config?.billing?.claudePlanCost ?? 200;
      const planName = config?.billing?.claudePlanName ?? "Claude Code Max";
      const monthlyApiCost = estCost * 30;
      const monthlySavings = monthlyApiCost - planCost;
      const savingsPositive = monthlySavings > 0;
      const sessionCount = sessions2?.length || 1;
      const avgTokensPerSession = Math.round(total / sessionCount);
      const avgCostPerSession = estCost / sessionCount;
      const windowConfigs = {
        "24h": { days: 1, label: "24h" },
        "3dma": { days: 3, label: "3dma" },
        "7dma": { days: 7, label: "7dma" }
      };
      const savingsWindows = {};
      for (const [key, windowConfig] of Object.entries(windowConfigs)) {
        const bucketKey = key.replace("dma", "d").replace("24h", "24h");
        const bucket = usage.windows?.[bucketKey === "24h" ? "24h" : bucketKey] || usage;
        const bucketCosts = calculateCostForBucket(bucket);
        const dailyAvg = bucketCosts.totalCost / windowConfig.days;
        const monthlyProjected = dailyAvg * 30;
        const windowSavings = monthlyProjected - planCost;
        const windowSavingsPositive = windowSavings > 0;
        savingsWindows[key] = {
          label: windowConfig.label,
          estCost: `$${formatNumber(dailyAvg)}`,
          estMonthlyCost: `$${Math.round(monthlyProjected).toLocaleString()}`,
          estSavings: windowSavingsPositive ? `$${formatNumber(windowSavings)}/mo` : null,
          savingsPercent: windowSavingsPositive ? Math.round(windowSavings / monthlyProjected * 100) : 0,
          requests: bucket.requests
        };
      }
      return {
        total: formatTokens(total),
        input: formatTokens(totalInput),
        output: formatTokens(totalOutput),
        cacheRead: formatTokens(usage?.cacheRead || 0),
        cacheWrite: formatTokens(usage?.cacheWrite || 0),
        requests: usage?.requests || 0,
        activeCount,
        activeMainCount,
        activeSubagentCount,
        mainLimit,
        subagentLimit,
        estCost: `$${formatNumber(estCost)}`,
        planCost: `$${planCost.toFixed(0)}`,
        planName,
        // 24h savings (backward compatible)
        estSavings: savingsPositive ? `$${formatNumber(monthlySavings)}/mo` : null,
        savingsPercent: savingsPositive ? Math.round(monthlySavings / monthlyApiCost * 100) : 0,
        estMonthlyCost: `$${Math.round(monthlyApiCost).toLocaleString()}`,
        // Multi-window savings (24h, 3da, 7da)
        savingsWindows,
        // Per-session averages
        avgTokensPerSession: formatTokens(avgTokensPerSession),
        avgCostPerSession: `$${avgCostPerSession.toFixed(2)}`,
        sessionCount
      };
    }
    function startTokenUsageRefresh2(getOpenClawDir2) {
      refreshTokenUsageAsync2(getOpenClawDir2);
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      refreshInterval = setInterval(() => {
        refreshTokenUsageAsync2(getOpenClawDir2);
      }, TOKEN_USAGE_CACHE_TTL);
      return refreshInterval;
    }
    module2.exports = {
      TOKEN_RATES,
      emptyUsageBucket,
      refreshTokenUsageAsync: refreshTokenUsageAsync2,
      getDailyTokenUsage: getDailyTokenUsage2,
      calculateCostForBucket,
      getCostBreakdown: getCostBreakdown2,
      getTopSessionsByTokens,
      getTokenStats: getTokenStats2,
      startTokenUsageRefresh: startTokenUsageRefresh2
    };
  }
});

// src/llm-usage.js
var require_llm_usage = __commonJS({
  "src/llm-usage.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var { execFile } = require("child_process");
    var { getSafeEnv } = require_openclaw();
    var llmUsageCache = { data: null, timestamp: 0, refreshing: false };
    var LLM_CACHE_TTL_MS = 6e4;
    function refreshLlmUsageAsync() {
      if (llmUsageCache.refreshing) return;
      llmUsageCache.refreshing = true;
      const profile = process.env.OPENCLAW_PROFILE || "";
      const args2 = profile ? ["--profile", profile, "status", "--usage", "--json"] : ["status", "--usage", "--json"];
      execFile(
        "openclaw",
        args2,
        { encoding: "utf8", timeout: 2e4, env: getSafeEnv() },
        (err, stdout) => {
          llmUsageCache.refreshing = false;
          if (err) {
            console.error("[LLM Usage] Async refresh failed:", err.message);
            return;
          }
          try {
            const jsonStart = stdout.indexOf("{");
            const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
            const parsed = JSON.parse(jsonStr);
            if (parsed.usage) {
              const result = transformLiveUsageData(parsed.usage);
              llmUsageCache.data = result;
              llmUsageCache.timestamp = Date.now();
              console.log("[LLM Usage] Cache refreshed");
            }
          } catch (e) {
            console.error("[LLM Usage] Parse error:", e.message);
          }
        }
      );
    }
    function transformLiveUsageData(usage) {
      const anthropic = usage.providers?.find((p) => p.provider === "anthropic");
      const codexProvider = usage.providers?.find((p) => p.provider === "openai-codex");
      if (anthropic?.error) {
        return {
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          source: "error",
          error: anthropic.error,
          errorType: anthropic.error.includes("403") ? "auth" : "unknown",
          claude: {
            session: { usedPct: null, remainingPct: null, resetsIn: null, error: anthropic.error },
            weekly: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
            sonnet: { usedPct: null, remainingPct: null, resets: null, error: anthropic.error },
            lastSynced: null
          },
          codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
          routing: {
            total: 0,
            claudeTasks: 0,
            codexTasks: 0,
            claudePct: 0,
            codexPct: 0,
            codexFloor: 20
          }
        };
      }
      const session5h = anthropic?.windows?.find((w) => w.label === "5h");
      const weekAll = anthropic?.windows?.find((w) => w.label === "Week");
      const sonnetWeek = anthropic?.windows?.find((w) => w.label === "Sonnet");
      const codex5h = codexProvider?.windows?.find((w) => w.label === "5h");
      const codexDay = codexProvider?.windows?.find((w) => w.label === "Day");
      const formatReset = (resetAt) => {
        if (!resetAt) return "?";
        const diff = resetAt - Date.now();
        if (diff < 0) return "now";
        if (diff < 36e5) return Math.round(diff / 6e4) + "m";
        if (diff < 864e5) return Math.round(diff / 36e5) + "h";
        return Math.round(diff / 864e5) + "d";
      };
      return {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        source: "live",
        claude: {
          session: {
            usedPct: Math.round(session5h?.usedPercent || 0),
            remainingPct: Math.round(100 - (session5h?.usedPercent || 0)),
            resetsIn: formatReset(session5h?.resetAt)
          },
          weekly: {
            usedPct: Math.round(weekAll?.usedPercent || 0),
            remainingPct: Math.round(100 - (weekAll?.usedPercent || 0)),
            resets: formatReset(weekAll?.resetAt)
          },
          sonnet: {
            usedPct: Math.round(sonnetWeek?.usedPercent || 0),
            remainingPct: Math.round(100 - (sonnetWeek?.usedPercent || 0)),
            resets: formatReset(sonnetWeek?.resetAt)
          },
          lastSynced: (/* @__PURE__ */ new Date()).toISOString()
        },
        codex: {
          sessionsToday: 0,
          tasksToday: 0,
          usage5hPct: Math.round(codex5h?.usedPercent || 0),
          usageDayPct: Math.round(codexDay?.usedPercent || 0)
        },
        routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 }
      };
    }
    function getLlmUsage2(statePath) {
      const now = Date.now();
      if (!llmUsageCache.data || now - llmUsageCache.timestamp > LLM_CACHE_TTL_MS) {
        refreshLlmUsageAsync();
      }
      if (llmUsageCache.data && llmUsageCache.data.source !== "error") {
        return llmUsageCache.data;
      }
      const stateFile = path2.join(statePath, "llm-routing.json");
      try {
        if (fs2.existsSync(stateFile)) {
          const data = JSON.parse(fs2.readFileSync(stateFile, "utf8"));
          const sessionValid = data.claude?.session?.resets_in && data.claude.session.resets_in !== "unknown";
          const weeklyValid = data.claude?.weekly_all_models?.resets && data.claude.weekly_all_models.resets !== "unknown";
          if (sessionValid || weeklyValid) {
            return {
              timestamp: (/* @__PURE__ */ new Date()).toISOString(),
              source: "file",
              claude: {
                session: {
                  usedPct: Math.round((data.claude?.session?.used_pct || 0) * 100),
                  remainingPct: Math.round((data.claude?.session?.remaining_pct || 1) * 100),
                  resetsIn: data.claude?.session?.resets_in || "?"
                },
                weekly: {
                  usedPct: Math.round((data.claude?.weekly_all_models?.used_pct || 0) * 100),
                  remainingPct: Math.round((data.claude?.weekly_all_models?.remaining_pct || 1) * 100),
                  resets: data.claude?.weekly_all_models?.resets || "?"
                },
                sonnet: {
                  usedPct: Math.round((data.claude?.weekly_sonnet?.used_pct || 0) * 100),
                  remainingPct: Math.round((data.claude?.weekly_sonnet?.remaining_pct || 1) * 100),
                  resets: data.claude?.weekly_sonnet?.resets || "?"
                },
                lastSynced: data.claude?.last_synced || null
              },
              codex: {
                sessionsToday: data.codex?.sessions_today || 0,
                tasksToday: data.codex?.tasks_today || 0,
                usage5hPct: data.codex?.usage_5h_pct || 0,
                usageDayPct: data.codex?.usage_day_pct || 0
              },
              routing: {
                total: data.routing?.total_tasks || 0,
                claudeTasks: data.routing?.claude_tasks || 0,
                codexTasks: data.routing?.codex_tasks || 0,
                claudePct: data.routing?.total_tasks > 0 ? Math.round(data.routing.claude_tasks / data.routing.total_tasks * 100) : 0,
                codexPct: data.routing?.total_tasks > 0 ? Math.round(data.routing.codex_tasks / data.routing.total_tasks * 100) : 0,
                codexFloor: Math.round((data.routing?.codex_floor_pct || 0.2) * 100)
              }
            };
          }
        }
      } catch (e) {
        console.error("[LLM Usage] File fallback failed:", e.message);
      }
      return {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        source: "error",
        error: "API key lacks user:profile OAuth scope",
        errorType: "auth",
        claude: {
          session: { usedPct: null, remainingPct: null, resetsIn: null, error: "Auth required" },
          weekly: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
          sonnet: { usedPct: null, remainingPct: null, resets: null, error: "Auth required" },
          lastSynced: null
        },
        codex: { sessionsToday: 0, tasksToday: 0, usage5hPct: 0, usageDayPct: 0 },
        routing: { total: 0, claudeTasks: 0, codexTasks: 0, claudePct: 0, codexPct: 0, codexFloor: 20 }
      };
    }
    function getRoutingStats2(skillsPath, statePath, hours = 24) {
      const safeHours = parseInt(hours, 10) || 24;
      try {
        const { execFileSync } = require("child_process");
        const skillDir = path2.join(skillsPath, "llm_routing");
        const output = execFileSync(
          "python",
          ["-m", "llm_routing", "stats", "--hours", String(safeHours), "--json"],
          {
            encoding: "utf8",
            timeout: 1e4,
            cwd: skillDir,
            env: getSafeEnv()
          }
        );
        return JSON.parse(output);
      } catch (e) {
        try {
          const logFile = path2.join(statePath, "routing-log.jsonl");
          if (!fs2.existsSync(logFile)) {
            return { total_requests: 0, by_model: {}, by_task_type: {} };
          }
          const cutoff = Date.now() - hours * 3600 * 1e3;
          const lines = fs2.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
          const stats = {
            total_requests: 0,
            by_model: {},
            by_task_type: {},
            escalations: 0,
            avg_latency_ms: 0,
            success_rate: 0
          };
          let latencies = [];
          let successes = 0;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              const ts = new Date(entry.timestamp).getTime();
              if (ts < cutoff) continue;
              stats.total_requests++;
              const model = entry.selected_model || "unknown";
              stats.by_model[model] = (stats.by_model[model] || 0) + 1;
              const tt = entry.task_type || "unknown";
              stats.by_task_type[tt] = (stats.by_task_type[tt] || 0) + 1;
              if (entry.escalation_reason) stats.escalations++;
              if (entry.latency_ms) latencies.push(entry.latency_ms);
              if (entry.success === true) successes++;
            } catch {
            }
          }
          if (latencies.length > 0) {
            stats.avg_latency_ms = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
          }
          if (stats.total_requests > 0) {
            stats.success_rate = Math.round(successes / stats.total_requests * 100);
          }
          return stats;
        } catch (e2) {
          console.error("Failed to read routing stats:", e2.message);
          return { error: e2.message };
        }
      }
    }
    function startLlmUsageRefresh2() {
      setTimeout(() => refreshLlmUsageAsync(), 1e3);
      setInterval(() => refreshLlmUsageAsync(), LLM_CACHE_TTL_MS);
    }
    module2.exports = {
      refreshLlmUsageAsync,
      transformLiveUsageData,
      getLlmUsage: getLlmUsage2,
      getRoutingStats: getRoutingStats2,
      startLlmUsageRefresh: startLlmUsageRefresh2
    };
  }
});

// src/actions.js
var require_actions = __commonJS({
  "src/actions.js"(exports2, module2) {
    var ALLOWED_ACTIONS = /* @__PURE__ */ new Set([
      "gateway-status",
      "gateway-restart",
      "sessions-list",
      "cron-list",
      "health-check",
      "clear-stale-sessions"
    ]);
    function executeAction2(action, deps) {
      const { runOpenClaw: runOpenClaw2, extractJSON: extractJSON2, PORT: PORT2 } = deps;
      const results = { success: false, action, output: "", error: null };
      if (!ALLOWED_ACTIONS.has(action)) {
        results.error = `Unknown action: ${action}`;
        return results;
      }
      try {
        switch (action) {
          case "gateway-status":
            results.output = runOpenClaw2("gateway status 2>&1") || "Unknown";
            results.success = true;
            break;
          case "gateway-restart":
            results.output = "To restart gateway, run: openclaw gateway restart";
            results.success = true;
            results.note = "Dashboard cannot restart gateway for safety";
            break;
          case "sessions-list":
            results.output = runOpenClaw2("sessions 2>&1") || "No sessions";
            results.success = true;
            break;
          case "cron-list":
            results.output = runOpenClaw2("cron list 2>&1") || "No cron jobs";
            results.success = true;
            break;
          case "health-check": {
            const gateway = runOpenClaw2("gateway status 2>&1");
            const sessions2 = runOpenClaw2("sessions --json 2>&1");
            let sessionCount = 0;
            try {
              const data = JSON.parse(sessions2);
              sessionCount = data.sessions?.length || 0;
            } catch (e) {
            }
            results.output = [
              `Gateway: ${gateway?.includes("running") ? "OK Running" : "NOT Running"}`,
              `Sessions: ${sessionCount}`,
              `Dashboard: OK Running on port ${PORT2}`
            ].join("\n");
            results.success = true;
            break;
          }
          case "clear-stale-sessions": {
            const staleOutput = runOpenClaw2("sessions --json 2>&1");
            let staleCount = 0;
            try {
              const staleJson = extractJSON2(staleOutput);
              if (staleJson) {
                const data = JSON.parse(staleJson);
                staleCount = (data.sessions || []).filter((s) => s.ageMs > 24 * 60 * 60 * 1e3).length;
              }
            } catch (e) {
            }
            results.output = `Found ${staleCount} stale sessions (>24h old).
To clean: openclaw sessions prune`;
            results.success = true;
            break;
          }
        }
      } catch (e) {
        results.error = e.message;
      }
      return results;
    }
    module2.exports = { executeAction: executeAction2, ALLOWED_ACTIONS };
  }
});

// src/data.js
var require_data = __commonJS({
  "src/data.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function migrateDataDir2(dataDir, legacyDataDir) {
      try {
        if (!fs2.existsSync(legacyDataDir)) return;
        if (!fs2.existsSync(dataDir)) {
          fs2.mkdirSync(dataDir, { recursive: true });
        }
        const legacyFiles = fs2.readdirSync(legacyDataDir);
        if (legacyFiles.length === 0) return;
        let migrated = 0;
        for (const file of legacyFiles) {
          const srcPath = path2.join(legacyDataDir, file);
          const destPath = path2.join(dataDir, file);
          if (fs2.existsSync(destPath)) continue;
          const stat = fs2.statSync(srcPath);
          if (stat.isFile()) {
            fs2.copyFileSync(srcPath, destPath);
            migrated++;
            console.log(`[Migration] Copied ${file} to profile-aware data dir`);
          }
        }
        if (migrated > 0) {
          console.log(`[Migration] Migrated ${migrated} file(s) to ${dataDir}`);
          console.log(`[Migration] Legacy data preserved at ${legacyDataDir}`);
        }
      } catch (e) {
        console.error("[Migration] Failed to migrate data:", e.message);
      }
    }
    module2.exports = { migrateDataDir: migrateDataDir2 };
  }
});

// src/acp.js
var require_acp = __commonJS({
  "src/acp.js"(exports2, module2) {
    var fs2 = require("fs");
    var os = require("os");
    var path2 = require("path");
    var ACTIVE_WINDOW_MS = 15 * 60 * 1e3;
    var RECENT_WINDOW_MS = 60 * 60 * 1e3;
    var CACHE_TTL_MS = 15e3;
    var RECENT_SESSION_LIMIT = 18;
    var AGENT_SESSION_PREVIEW_LIMIT = 6;
    function createEmptyTranscriptSummary() {
      return {
        messageCount: 0,
        toolCalls: 0,
        totalTokens: 0,
        preview: ""
      };
    }
    function normalizeArray(value) {
      return Array.isArray(value) ? value : [];
    }
    function normalizeObject(value) {
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }
    function formatHomePath(filePath) {
      const homeDir = os.homedir();
      if (typeof filePath !== "string" || !filePath) {
        return null;
      }
      if (filePath.startsWith(homeDir + path2.sep)) {
        return filePath.replace(homeDir, "~");
      }
      return filePath;
    }
    function toIsoTimestamp(value) {
      const timestamp = typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
      if (Number.isNaN(timestamp)) {
        return null;
      }
      return new Date(timestamp).toISOString();
    }
    function formatRelativeAge(ageMs) {
      if (!Number.isFinite(ageMs) || ageMs < 0) {
        return "never";
      }
      if (ageMs < 60 * 1e3) {
        return "just now";
      }
      const totalMinutes = Math.floor(ageMs / 6e4);
      if (totalMinutes < 60) {
        return `${totalMinutes}m ago`;
      }
      const totalHours = Math.floor(totalMinutes / 60);
      if (totalHours < 24) {
        return `${totalHours}h ago`;
      }
      const totalDays = Math.floor(totalHours / 24);
      return `${totalDays}d ago`;
    }
    function deriveStatus(ageMs) {
      if (ageMs <= ACTIVE_WINDOW_MS) {
        return "active";
      }
      if (ageMs <= RECENT_WINDOW_MS) {
        return "recent";
      }
      return "idle";
    }
    function parseJsonOutput(rawOutput, extractJSON2) {
      if (!rawOutput) {
        return null;
      }
      const jsonPayload = typeof extractJSON2 === "function" ? extractJSON2(rawOutput) : rawOutput;
      if (!jsonPayload) {
        return null;
      }
      try {
        return JSON.parse(jsonPayload);
      } catch (_error) {
        return null;
      }
    }
    function readJsonFile(filePath, fallback) {
      try {
        if (!fs2.existsSync(filePath)) {
          return fallback;
        }
        return JSON.parse(fs2.readFileSync(filePath, "utf8"));
      } catch (_error) {
        return fallback;
      }
    }
    function inferChannel(sessionKey, entry) {
      const deliveryChannel = entry?.channel || entry?.lastChannel || entry?.deliveryContext?.channel || entry?.origin?.surface || entry?.origin?.provider;
      if (deliveryChannel) {
        return deliveryChannel;
      }
      if (sessionKey.includes(":discord:")) return "discord";
      if (sessionKey.includes(":telegram:")) return "telegram";
      if (sessionKey.includes(":slack:")) return "slack";
      if (sessionKey.includes(":signal:")) return "signal";
      if (sessionKey.includes(":whatsapp:")) return "whatsapp";
      if (sessionKey.includes(":cron:")) return "cron";
      if (sessionKey.includes(":subagent:")) return "subagent";
      return "other";
    }
    function sortCountEntries(entries) {
      return entries.sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return String(left.key).localeCompare(String(right.key));
      });
    }
    function addCount(map, key, label, amount = 1) {
      if (!key) {
        return;
      }
      const current = map.get(key) || { key, label: label || key, count: 0 };
      current.count += amount;
      map.set(key, current);
    }
    function resolveModelLabel(agent, entry) {
      if (entry?.providerOverride && entry?.modelOverride) {
        return `${entry.providerOverride}/${entry.modelOverride}`;
      }
      if (entry?.modelOverride) {
        return entry.modelOverride;
      }
      return agent?.model || null;
    }
    function createTranscriptSummary(filePath, transcriptCache) {
      if (!filePath || !fs2.existsSync(filePath)) {
        return createEmptyTranscriptSummary();
      }
      try {
        const stat = fs2.statSync(filePath);
        const cached = transcriptCache.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          return cached.summary;
        }
        const content = fs2.readFileSync(filePath, "utf8");
        const lines = content.split("\n").filter(Boolean);
        const summary = createEmptyTranscriptSummary();
        let lastAssistantText = "";
        let lastUserText = "";
        for (const line of lines) {
          let entry = null;
          try {
            entry = JSON.parse(line);
          } catch (_error) {
            continue;
          }
          if (entry?.type !== "message" || !entry.message) {
            continue;
          }
          const message = entry.message;
          if (message.role) {
            summary.messageCount += 1;
          }
          if (message.usage) {
            const inputTokens = message.usage.input || message.usage.inputTokens || 0;
            const outputTokens = message.usage.output || message.usage.outputTokens || 0;
            const cacheRead = message.usage.cacheRead || message.usage.cacheReadTokens || 0;
            const cacheWrite = message.usage.cacheWrite || message.usage.cacheWriteTokens || 0;
            summary.totalTokens += inputTokens + outputTokens + cacheRead + cacheWrite;
          }
          let text = "";
          if (typeof message.content === "string") {
            text = message.content;
          } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
              if (part?.type === "text" && part.text) {
                text = part.text;
              }
              if (part?.type === "toolCall" || part?.type === "tool_use") {
                summary.toolCalls += 1;
              }
            }
          }
          if (message.role === "assistant" && text) {
            lastAssistantText = text;
          } else if (message.role === "user" && text) {
            lastUserText = text;
          }
        }
        summary.preview = (lastAssistantText || lastUserText || "").split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 180) || "";
        transcriptCache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          summary
        });
        return summary;
      } catch (_error) {
        return createEmptyTranscriptSummary();
      }
    }
    function summarizeAuthProfiles(authProfiles) {
      const profiles = normalizeObject(authProfiles?.profiles);
      const usageStats = normalizeObject(authProfiles?.usageStats);
      const lastGood = normalizeObject(authProfiles?.lastGood);
      const providers = /* @__PURE__ */ new Map();
      let lastUsedAt = null;
      for (const [profileKey, profile] of Object.entries(profiles)) {
        const providerKey = profile?.provider || profileKey.split(":")[0] || "unknown";
        const providerEntry = providers.get(providerKey) || {
          provider: providerKey,
          profileCount: 0,
          types: /* @__PURE__ */ new Set(),
          isLastGood: false,
          lastUsedAt: null
        };
        providerEntry.profileCount += 1;
        if (profile?.type) {
          providerEntry.types.add(profile.type);
        }
        if (lastGood[providerKey] === profileKey) {
          providerEntry.isLastGood = true;
        }
        const usedAt = usageStats[profileKey]?.lastUsed || null;
        if (usedAt && (!providerEntry.lastUsedAt || usedAt > providerEntry.lastUsedAt)) {
          providerEntry.lastUsedAt = usedAt;
        }
        if (usedAt && (!lastUsedAt || usedAt > lastUsedAt)) {
          lastUsedAt = usedAt;
        }
        providers.set(providerKey, providerEntry);
      }
      return {
        profileCount: Object.keys(profiles).length,
        providerCount: providers.size,
        lastUsedAt: toIsoTimestamp(lastUsedAt),
        providers: Array.from(providers.values()).map((provider) => ({
          provider: provider.provider,
          profileCount: provider.profileCount,
          types: Array.from(provider.types).sort(),
          isLastGood: provider.isLastGood,
          lastUsedAt: toIsoTimestamp(provider.lastUsedAt)
        })).sort((left, right) => left.provider.localeCompare(right.provider))
      };
    }
    function summarizeModelCatalog(modelsConfig) {
      const providers = normalizeObject(modelsConfig?.providers);
      const catalogProviders = [];
      const modelMap = /* @__PURE__ */ new Map();
      for (const [providerKey, provider] of Object.entries(providers)) {
        const models = normalizeArray(provider?.models);
        catalogProviders.push({
          provider: providerKey,
          modelCount: models.length
        });
        for (const model of models) {
          if (!model?.id) {
            continue;
          }
          modelMap.set(model.id, {
            id: model.id,
            name: model.name || model.id,
            provider: providerKey,
            contextWindow: model.contextWindow || null
          });
        }
      }
      return {
        providerCount: catalogProviders.length,
        modelCount: modelMap.size,
        providers: catalogProviders.sort((left, right) => left.provider.localeCompare(right.provider)),
        models: Array.from(modelMap.values()).sort((left, right) => left.id.localeCompare(right.id))
      };
    }
    function normalizeSessionEntries(sessionsIndex) {
      if (Array.isArray(sessionsIndex?.sessions)) {
        return sessionsIndex.sessions.map((entry) => [entry.key, entry]);
      }
      if (sessionsIndex && typeof sessionsIndex === "object") {
        return Object.entries(sessionsIndex);
      }
      return [];
    }
    function createAcpModule2(deps) {
      const { getOpenClawDir: getOpenClawDir2, runOpenClaw: runOpenClaw2, extractJSON: extractJSON2, parseSessionLabel } = deps;
      let cachedActivity = null;
      let lastUpdatedAt = 0;
      const transcriptCache = /* @__PURE__ */ new Map();
      function readConfiguredAgents() {
        const payload = parseJsonOutput(runOpenClaw2("agents list --json"), extractJSON2);
        return Array.isArray(payload) ? payload : [];
      }
      function readAgentBindings() {
        const payload = parseJsonOutput(runOpenClaw2("agents bindings --json"), extractJSON2);
        return Array.isArray(payload) ? payload : [];
      }
      function buildAgentActivity(agent, bindingsByAgent, currentTime) {
        const openclawDir = getOpenClawDir2();
        const agentId = agent?.id || "unknown";
        const sessionIndexPath = path2.join(openclawDir, "agents", agentId, "sessions", "sessions.json");
        const authProfilesPath = path2.join(openclawDir, "agents", agentId, "agent", "auth-profiles.json");
        const modelsPath = path2.join(openclawDir, "agents", agentId, "agent", "models.json");
        const sessionEntries = normalizeSessionEntries(readJsonFile(sessionIndexPath, {}));
        const channelCounts = /* @__PURE__ */ new Map();
        const modelCounts = /* @__PURE__ */ new Map();
        const skillCounts = /* @__PURE__ */ new Map();
        const recentSessions = [];
        let activeSessions = 0;
        let recentSessionsCount = 0;
        let idleSessions = 0;
        let totalMessages = 0;
        let totalToolCalls = 0;
        let totalTokens = 0;
        let lastActivityAt = null;
        for (const [sessionKey, rawEntry] of sessionEntries) {
          const entry = normalizeObject(rawEntry);
          const updatedAtMs = Number(entry.updatedAt || 0);
          const ageMs = updatedAtMs > 0 ? Math.max(0, currentTime - updatedAtMs) : Number.POSITIVE_INFINITY;
          const status = deriveStatus(ageMs);
          const sessionFile = entry.sessionFile || null;
          const transcriptSummary = createTranscriptSummary(sessionFile, transcriptCache);
          const sessionLabel = entry.groupChannel || entry.displayName || (typeof parseSessionLabel === "function" ? parseSessionLabel(sessionKey) : sessionKey);
          const channel = inferChannel(sessionKey, entry);
          const model = resolveModelLabel(agent, entry);
          const skills = normalizeArray(entry.skillsSnapshot?.skills).map((skill) => skill?.name).filter(Boolean);
          if (status === "active") {
            activeSessions += 1;
          } else if (status === "recent") {
            recentSessionsCount += 1;
          } else {
            idleSessions += 1;
          }
          if (updatedAtMs && (!lastActivityAt || updatedAtMs > lastActivityAt)) {
            lastActivityAt = updatedAtMs;
          }
          addCount(channelCounts, channel, channel.toUpperCase());
          addCount(modelCounts, model || "unknown", model || "Unknown");
          skills.forEach((skillName) => addCount(skillCounts, skillName, skillName));
          totalMessages += transcriptSummary.messageCount;
          totalToolCalls += transcriptSummary.toolCalls;
          totalTokens += transcriptSummary.totalTokens;
          recentSessions.push({
            agentId,
            sessionKey,
            sessionId: entry.sessionId || null,
            label: sessionLabel,
            channel,
            chatType: entry.chatType || entry.origin?.chatType || "direct",
            accountId: entry.lastAccountId || entry.deliveryContext?.accountId || entry.origin?.accountId || null,
            status,
            ageMs,
            ageLabel: formatRelativeAge(ageMs),
            updatedAt: toIsoTimestamp(updatedAtMs),
            model: model || "unknown",
            messageCount: transcriptSummary.messageCount,
            toolCalls: transcriptSummary.toolCalls,
            totalTokens: transcriptSummary.totalTokens,
            preview: transcriptSummary.preview
          });
        }
        recentSessions.sort((left, right) => left.ageMs - right.ageMs);
        const authProfiles = readJsonFile(authProfilesPath, {});
        const modelsConfig = readJsonFile(modelsPath, {});
        const bindings = normalizeArray(bindingsByAgent.get(agentId)).map((binding) => ({
          description: binding.description || "Unlabeled binding",
          channel: binding.match?.channel || null,
          accountId: binding.match?.accountId || null
        }));
        const stats = {
          totalSessions: sessionEntries.length,
          activeSessions,
          recentSessions: recentSessionsCount,
          idleSessions,
          totalMessages,
          totalToolCalls,
          totalTokens,
          lastActivityAt: toIsoTimestamp(lastActivityAt),
          lastActivityLabel: formatRelativeAge(
            lastActivityAt ? Math.max(0, currentTime - lastActivityAt) : Number.POSITIVE_INFINITY
          )
        };
        return {
          id: agentId,
          name: agent?.name || agentId,
          isDefault: Boolean(agent?.isDefault),
          configuredModel: agent?.model || null,
          workspace: formatHomePath(agent?.workspace || null),
          workspaceLabel: agent?.workspace ? path2.basename(agent.workspace) : null,
          agentDir: formatHomePath(agent?.agentDir || null),
          routes: normalizeArray(agent?.routes),
          bindings,
          auth: summarizeAuthProfiles(authProfiles),
          modelCatalog: summarizeModelCatalog(modelsConfig),
          stats,
          channels: sortCountEntries(Array.from(channelCounts.values())),
          models: sortCountEntries(Array.from(modelCounts.values())),
          skills: sortCountEntries(Array.from(skillCounts.values())),
          recentSessions: recentSessions.slice(0, AGENT_SESSION_PREVIEW_LIMIT),
          activityState: activeSessions > 0 ? "active" : recentSessionsCount > 0 ? "recent" : sessionEntries.length > 0 ? "idle" : "dormant"
        };
      }
      function buildSummary(agents, recentSessions) {
        const channelCounts = /* @__PURE__ */ new Map();
        const modelCounts = /* @__PURE__ */ new Map();
        const skillCounts = /* @__PURE__ */ new Map();
        let activeAgents = 0;
        let recentAgents = 0;
        let idleAgents = 0;
        let totalBindings = 0;
        let totalSessions = 0;
        let activeSessions = 0;
        let recentSessionCount = 0;
        let totalMessages = 0;
        let totalToolCalls = 0;
        let totalTokens = 0;
        let lastActivityAt = null;
        for (const agent of agents) {
          totalBindings += agent.bindings.length;
          totalSessions += agent.stats.totalSessions;
          activeSessions += agent.stats.activeSessions;
          recentSessionCount += agent.stats.recentSessions;
          totalMessages += agent.stats.totalMessages;
          totalToolCalls += agent.stats.totalToolCalls;
          totalTokens += agent.stats.totalTokens;
          if (agent.activityState === "active") {
            activeAgents += 1;
          } else if (agent.activityState === "recent") {
            recentAgents += 1;
          } else {
            idleAgents += 1;
          }
          const activityTimestamp = agent.stats.lastActivityAt ? Date.parse(agent.stats.lastActivityAt) : null;
          if (activityTimestamp && (!lastActivityAt || activityTimestamp > lastActivityAt)) {
            lastActivityAt = activityTimestamp;
          }
          agent.channels.forEach((entry) => addCount(channelCounts, entry.key, entry.label, entry.count));
          agent.models.forEach((entry) => addCount(modelCounts, entry.key, entry.label, entry.count));
          agent.skills.forEach((entry) => addCount(skillCounts, entry.key, entry.label, entry.count));
        }
        return {
          totalAgents: agents.length,
          activeAgents,
          recentAgents,
          idleAgents,
          totalBindings,
          totalSessions,
          activeSessions,
          recentSessions: recentSessionCount,
          totalMessages,
          totalToolCalls,
          totalTokens,
          lastActivityAt: toIsoTimestamp(lastActivityAt),
          channels: sortCountEntries(Array.from(channelCounts.values())).slice(0, 8),
          models: sortCountEntries(Array.from(modelCounts.values())).slice(0, 8),
          skills: sortCountEntries(Array.from(skillCounts.values())).slice(0, 12),
          mostRecentSessions: recentSessions.slice(0, 6)
        };
      }
      function getAgentActivity() {
        const currentTime = Date.now();
        if (cachedActivity && currentTime - lastUpdatedAt < CACHE_TTL_MS) {
          return cachedActivity;
        }
        const configuredAgents = readConfiguredAgents();
        const bindingsByAgent = /* @__PURE__ */ new Map();
        for (const binding of readAgentBindings()) {
          const agentBindings = bindingsByAgent.get(binding.agentId) || [];
          agentBindings.push(binding);
          bindingsByAgent.set(binding.agentId, agentBindings);
        }
        const agents = configuredAgents.map((agent) => buildAgentActivity(agent, bindingsByAgent, currentTime)).sort((left, right) => {
          const stateOrder = { active: 0, recent: 1, idle: 2, dormant: 3 };
          const leftOrder = stateOrder[left.activityState] ?? 99;
          const rightOrder = stateOrder[right.activityState] ?? 99;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }
          const leftActivity = left.stats.lastActivityAt ? Date.parse(left.stats.lastActivityAt) : 0;
          const rightActivity = right.stats.lastActivityAt ? Date.parse(right.stats.lastActivityAt) : 0;
          return rightActivity - leftActivity;
        });
        const recentSessions = agents.flatMap(
          (agent) => agent.recentSessions.map((session) => ({
            ...session,
            agentName: agent.name,
            agentState: agent.activityState
          }))
        ).sort((left, right) => left.ageMs - right.ageMs).slice(0, RECENT_SESSION_LIMIT);
        cachedActivity = {
          generatedAt: new Date(currentTime).toISOString(),
          summary: buildSummary(agents, recentSessions),
          agents,
          recentSessions
        };
        lastUpdatedAt = currentTime;
        return cachedActivity;
      }
      function invalidateCache() {
        lastUpdatedAt = 0;
      }
      return {
        getAgentActivity,
        invalidateCache
      };
    }
    module2.exports = {
      createAcpModule: createAcpModule2
    };
  }
});

// src/state.js
var require_state = __commonJS({
  "src/state.js"(exports2, module2) {
    var fs2 = require("fs");
    var os = require("os");
    var path2 = require("path");
    var { execFileSync } = require("child_process");
    var { formatBytes, formatTimeAgo } = require_utils();
    function createStateModule2(deps) {
      const {
        CONFIG: CONFIG2,
        getOpenClawDir: getOpenClawDir2,
        getSessions,
        getSystemVitals: getSystemVitals2,
        getCronJobs: getCronJobs2,
        loadOperators: loadOperators2,
        getLlmUsage: getLlmUsage2,
        getDailyTokenUsage: getDailyTokenUsage2,
        getTokenStats: getTokenStats2,
        getCerebroTopics: getCerebroTopics2,
        getMissionControlState,
        runOpenClaw: runOpenClaw2,
        extractJSON: extractJSON2,
        readTranscript,
        getMissionControlState = () => null,
        getAcpActivity = () => null
      } = deps;
      const PATHS2 = CONFIG2.paths;
      let cachedState = null;
      let lastStateUpdate = 0;
      const STATE_CACHE_TTL = 3e4;
      let stateRefreshInterval = null;
      function getSystemStatus() {
        const hostname = os.hostname();
        let uptime = "\u2014";
        try {
          const uptimeRaw = execFileSync("uptime", [], { encoding: "utf8" });
          const match = uptimeRaw.match(/up\s+([^,]+)/);
          if (match) uptime = match[1].trim();
        } catch (e) {
        }
        let gateway = "Unknown";
        try {
          const status = runOpenClaw2("gateway status 2>/dev/null");
          if (status && status.includes("running")) {
            gateway = "Running";
          } else if (status && status.includes("stopped")) {
            gateway = "Stopped";
          }
        } catch (e) {
        }
        return {
          hostname,
          gateway,
          model: "claude-opus-4-5",
          uptime
        };
      }
      function getRecentActivity() {
        const activities = [];
        const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        const memoryFile = path2.join(PATHS2.memory, `${today}.md`);
        try {
          if (fs2.existsSync(memoryFile)) {
            const content = fs2.readFileSync(memoryFile, "utf8");
            const lines = content.split("\n").filter((l) => l.startsWith("- "));
            lines.slice(-5).forEach((line) => {
              const text = line.replace(/^- /, "").slice(0, 80);
              activities.push({
                icon: text.includes("\u2705") ? "\u2705" : text.includes("\u274C") ? "\u274C" : "\u{1F4DD}",
                text: text.replace(/[\u2705\u274C\uD83D\uDCDD\uD83D\uDD27]/g, "").trim(),
                time: today
              });
            });
          }
        } catch (e) {
          console.error("Failed to read activity:", e.message);
        }
        return activities.reverse();
      }
      function getCapacity() {
        const result = {
          main: { active: 0, max: 12 },
          subagent: { active: 0, max: 24 }
        };
        const openclawDir = getOpenClawDir2();
        try {
          const configPath = path2.join(openclawDir, "openclaw.json");
          if (fs2.existsSync(configPath)) {
            const config = JSON.parse(fs2.readFileSync(configPath, "utf8"));
            if (config?.agents?.defaults?.maxConcurrent) {
              result.main.max = config.agents.defaults.maxConcurrent;
            }
            if (config?.agents?.defaults?.subagents?.maxConcurrent) {
              result.subagent.max = config.agents.defaults.subagents.maxConcurrent;
            }
          }
        } catch (e) {
        }
        try {
          const output = runOpenClaw2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const sessions2 = data.sessions || [];
            const fiveMinMs = 5 * 60 * 1e3;
            for (const s of sessions2) {
              if (s.ageMs > fiveMinMs) continue;
              const key = s.key || "";
              if (key.includes(":subagent:") || key.includes(":cron:")) {
                result.subagent.active++;
              } else {
                result.main.active++;
              }
            }
            return result;
          }
        } catch (e) {
          console.error("Failed to get capacity from sessions, falling back to filesystem:", e.message);
        }
        try {
          const sessionsDir = path2.join(openclawDir, "agents", "main", "sessions");
          if (fs2.existsSync(sessionsDir)) {
            const fiveMinAgo = Date.now() - 5 * 60 * 1e3;
            const files = fs2.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
            let mainActive = 0;
            let subActive = 0;
            for (const file of files) {
              try {
                const filePath = path2.join(sessionsDir, file);
                const stat = fs2.statSync(filePath);
                if (stat.mtimeMs < fiveMinAgo) continue;
                let isSubagent = false;
                try {
                  const fd = fs2.openSync(filePath, "r");
                  const buffer = Buffer.alloc(512);
                  fs2.readSync(fd, buffer, 0, 512, 0);
                  fs2.closeSync(fd);
                  const firstLine = buffer.toString("utf8").split("\n")[0];
                  const parsed = JSON.parse(firstLine);
                  const key = parsed.key || parsed.id || "";
                  isSubagent = key.includes(":subagent:") || key.includes(":cron:");
                } catch (parseErr) {
                  isSubagent = file.includes("subagent");
                }
                if (isSubagent) {
                  subActive++;
                } else {
                  mainActive++;
                }
              } catch (e) {
              }
            }
            result.main.active = mainActive;
            result.subagent.active = subActive;
          }
        } catch (e) {
          console.error("Failed to count active sessions from filesystem:", e.message);
        }
        return result;
      }
      function getMemoryStats() {
        const memoryDir = PATHS2.memory;
        const memoryFile = path2.join(PATHS2.workspace, "MEMORY.md");
        const stats = {
          totalFiles: 0,
          totalSize: 0,
          totalSizeFormatted: "0 B",
          memoryMdSize: 0,
          memoryMdSizeFormatted: "0 B",
          memoryMdLines: 0,
          recentFiles: [],
          oldestFile: null,
          newestFile: null
        };
        try {
          const collectMemoryFiles = (dir, baseDir) => {
            const entries = fs2.readdirSync(dir, { withFileTypes: true });
            const files = [];
            for (const entry of entries) {
              const entryPath = path2.join(dir, entry.name);
              if (entry.isDirectory()) {
                files.push(...collectMemoryFiles(entryPath, baseDir));
              } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
                const stat = fs2.statSync(entryPath);
                const relativePath = path2.relative(baseDir, entryPath);
                files.push({
                  name: relativePath,
                  size: stat.size,
                  sizeFormatted: formatBytes(stat.size),
                  modified: stat.mtime
                });
              }
            }
            return files;
          };
          if (fs2.existsSync(memoryFile)) {
            const memStat = fs2.statSync(memoryFile);
            stats.memoryMdSize = memStat.size;
            stats.memoryMdSizeFormatted = formatBytes(memStat.size);
            const content = fs2.readFileSync(memoryFile, "utf8");
            stats.memoryMdLines = content.split("\n").length;
            stats.totalSize += memStat.size;
            stats.totalFiles++;
          }
          if (fs2.existsSync(memoryDir)) {
            const files = collectMemoryFiles(memoryDir, memoryDir).sort(
              (a, b) => b.modified - a.modified
            );
            stats.totalFiles += files.length;
            files.forEach((f) => stats.totalSize += f.size);
            stats.recentFiles = files.slice(0, 5).map((f) => ({
              name: f.name,
              sizeFormatted: f.sizeFormatted,
              age: formatTimeAgo(f.modified)
            }));
            if (files.length > 0) {
              stats.newestFile = files[0].name;
              stats.oldestFile = files[files.length - 1].name;
            }
          }
          stats.totalSizeFormatted = formatBytes(stats.totalSize);
        } catch (e) {
          console.error("Failed to get memory stats:", e.message);
        }
        return stats;
      }
      function getData() {
        const allSessions = getSessions({ limit: null });
        const pageSize = 20;
        const displaySessions = allSessions.slice(0, pageSize);
        const tokenStats = getTokenStats2(allSessions);
        const capacity = getCapacity();
        const memory = getMemoryStats();
        const statusCounts = {
          all: allSessions.length,
          live: allSessions.filter((s) => s.active).length,
          recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
          idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length
        };
        const totalPages = Math.ceil(allSessions.length / pageSize);
        return {
          sessions: displaySessions,
          tokenStats,
          capacity,
          memory,
          pagination: {
            page: 1,
            pageSize,
            total: allSessions.length,
            totalPages,
            hasPrev: false,
            hasNext: totalPages > 1
          },
          statusCounts
        };
      }
      function getFullState() {
        const now = Date.now();
        if (cachedState && now - lastStateUpdate < STATE_CACHE_TTL) {
          return cachedState;
        }
        let sessions2 = [];
        let tokenStats = {};
        let statusCounts = { all: 0, live: 0, recent: 0, idle: 0 };
        let vitals = {};
        let capacity = {};
        let operators = { operators: [], roles: {} };
        let llmUsage = {};
        let cron = [];
        let memory = {};
        let cerebro = {};
        let missionControl = null;
        let subagents = [];
        let acp2 = null;
        let allSessions = [];
        let totalSessionCount = 0;
        try {
          allSessions = getSessions({ limit: null });
          totalSessionCount = allSessions.length;
          sessions2 = allSessions.slice(0, 20);
        } catch (e) {
          console.error("[State] sessions:", e.message);
        }
        try {
          vitals = getSystemVitals2();
        } catch (e) {
          console.error("[State] vitals:", e.message);
        }
        try {
          capacity = getCapacity();
        } catch (e) {
          console.error("[State] capacity:", e.message);
        }
        try {
          tokenStats = getTokenStats2(allSessions, capacity, CONFIG2);
        } catch (e) {
          console.error("[State] tokenStats:", e.message);
        }
        try {
          const liveSessions = allSessions.filter((s) => s.active);
          const recentSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
          const idleSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
          statusCounts = {
            all: totalSessionCount,
            live: liveSessions.length,
            recent: recentSessions.length,
            idle: idleSessions.length
          };
        } catch (e) {
          console.error("[State] statusCounts:", e.message);
        }
        try {
          const operatorData = loadOperators2();
          const operatorsWithStats = operatorData.operators.map((op) => {
            const userSessions = allSessions.filter(
              (s) => s.originator?.userId === op.id || s.originator?.userId === op.metadata?.slackId
            );
            return {
              ...op,
              stats: {
                activeSessions: userSessions.filter((s) => s.active).length,
                totalSessions: userSessions.length,
                lastSeen: userSessions.length > 0 ? new Date(
                  Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 6e4
                ).toISOString() : op.lastSeen
              }
            };
          });
          operators = { ...operatorData, operators: operatorsWithStats };
        } catch (e) {
          console.error("[State] operators:", e.message);
        }
        try {
          llmUsage = getLlmUsage2();
        } catch (e) {
          console.error("[State] llmUsage:", e.message);
        }
        try {
          cron = getCronJobs2();
        } catch (e) {
          console.error("[State] cron:", e.message);
        }
        try {
          memory = getMemoryStats();
        } catch (e) {
          console.error("[State] memory:", e.message);
        }
        try {
          cerebro = getCerebroTopics2();
        } catch (e) {
          console.error("[State] cerebro:", e.message);
        }
        try {
          if (typeof getMissionControlState === "function") {
            missionControl = getMissionControlState();
          }
        } catch (e) {
          console.error("[State] missionControl:", e.message);
        }
        try {
          const retentionHours = parseInt(process.env.SUBAGENT_RETENTION_HOURS || "12", 10);
          const retentionMs = retentionHours * 60 * 60 * 1e3;
          subagents = allSessions.filter((s) => s.sessionKey && s.sessionKey.includes(":subagent:")).filter((s) => (s.minutesAgo || 0) * 6e4 < retentionMs).map((s) => {
            const match = s.sessionKey.match(/:subagent:([a-f0-9-]+)$/);
            const subagentId = match ? match[1] : s.sessionId;
            return {
              id: subagentId,
              shortId: subagentId.slice(0, 8),
              task: s.label || s.displayName || "Sub-agent task",
              tokens: s.tokens || 0,
              ageMs: (s.minutesAgo || 0) * 6e4,
              active: s.active,
              recentlyActive: s.recentlyActive
            };
          });
        } catch (e) {
          console.error("[State] subagents:", e.message);
        }
        cachedState = {
          vitals,
          sessions: sessions2,
          tokenStats,
          statusCounts,
          capacity,
          operators,
          llmUsage,
          cron,
          memory,
          cerebro,
          missionControl,
          subagents,
          pagination: {
            page: 1,
            pageSize: 20,
            total: totalSessionCount,
            totalPages: Math.max(1, Math.ceil(totalSessionCount / 20)),
            hasPrev: false,
            hasNext: totalSessionCount > 20
          },
          timestamp: now
        };
        lastStateUpdate = now;
        return cachedState;
      }
      function invalidateStateCache() {
        lastStateUpdate = 0;
      }
      function refreshState() {
        invalidateStateCache();
        return getFullState();
      }
      function startStateRefresh(broadcastSSE2, intervalMs = 3e4) {
        if (stateRefreshInterval) return;
        stateRefreshInterval = setInterval(() => {
          try {
            const newState = refreshState();
            broadcastSSE2("update", newState);
          } catch (e) {
            console.error("[State] Refresh error:", e.message);
          }
        }, intervalMs);
        console.log(`[State] Background refresh started (${intervalMs}ms interval)`);
      }
      function stopStateRefresh() {
        if (stateRefreshInterval) {
          clearInterval(stateRefreshInterval);
          stateRefreshInterval = null;
          console.log("[State] Background refresh stopped");
        }
      }
      function getSubagentStatus() {
        const subagents = [];
        try {
          const output = runOpenClaw2("sessions --json 2>/dev/null");
          const jsonStr = extractJSON2(output);
          if (jsonStr) {
            const data = JSON.parse(jsonStr);
            const subagentSessions = (data.sessions || []).filter(
              (s) => s.key && s.key.includes(":subagent:")
            );
            for (const s of subagentSessions) {
              const ageMs = s.ageMs || Infinity;
              const isActive = ageMs < 5 * 60 * 1e3;
              const isRecent = ageMs < 30 * 60 * 1e3;
              const match = s.key.match(/:subagent:([a-f0-9-]+)$/);
              const subagentId = match ? match[1] : s.sessionId;
              const shortId = subagentId.slice(0, 8);
              let taskSummary = "Unknown task";
              let label = null;
              const transcript = readTranscript(s.sessionId);
              for (const entry of transcript.slice(0, 15)) {
                if (entry.type === "message" && entry.message?.role === "user") {
                  const content = entry.message.content;
                  let text = "";
                  if (typeof content === "string") {
                    text = content;
                  } else if (Array.isArray(content)) {
                    const textPart = content.find((c) => c.type === "text");
                    if (textPart) text = textPart.text || "";
                  }
                  if (!text) continue;
                  const labelMatch = text.match(/Label:\s*([^\n]+)/i);
                  if (labelMatch) {
                    label = labelMatch[1].trim();
                  }
                  let taskMatch = text.match(/You were created to handle:\s*\*\*([^*]+)\*\*/i);
                  if (taskMatch) {
                    taskSummary = taskMatch[1].trim();
                    break;
                  }
                  taskMatch = text.match(/\*\*([A-Z]{2,5}-\d+:\s*[^*]+)\*\*/);
                  if (taskMatch) {
                    taskSummary = taskMatch[1].trim();
                    break;
                  }
                  const firstLine = text.split("\n")[0].replace(/^\*\*|\*\*$/g, "").trim();
                  if (firstLine.length > 10 && firstLine.length < 100) {
                    taskSummary = firstLine;
                    break;
                  }
                }
              }
              const messageCount = transcript.filter(
                (e) => e.type === "message" && e.message?.role
              ).length;
              subagents.push({
                id: subagentId,
                shortId,
                sessionId: s.sessionId,
                label: label || shortId,
                task: taskSummary,
                model: s.model?.replace("anthropic/", "") || "unknown",
                status: isActive ? "active" : isRecent ? "idle" : "stale",
                ageMs,
                ageFormatted: ageMs < 6e4 ? "Just now" : ageMs < 36e5 ? `${Math.round(ageMs / 6e4)}m ago` : `${Math.round(ageMs / 36e5)}h ago`,
                messageCount,
                tokens: s.totalTokens || 0
              });
            }
          }
        } catch (e) {
          console.error("Failed to get subagent status:", e.message);
        }
        return subagents.sort((a, b) => a.ageMs - b.ageMs);
      }
      return {
        getSystemStatus,
        getRecentActivity,
        getCapacity,
        getMemoryStats,
        getFullState,
        invalidateStateCache,
        refreshState,
        startStateRefresh,
        stopStateRefresh,
        getData,
        getSubagentStatus
      };
    }
    module2.exports = { createStateModule: createStateModule2 };
  }
});

// src/mission-control/store.js
var require_store = __commonJS({
  "src/mission-control/store.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    function ensureMissionControlDir(dataDir) {
      const missionControlDir = path2.join(dataDir, "mission-control");
      fs2.mkdirSync(missionControlDir, { recursive: true });
      return missionControlDir;
    }
    function readJsonFile(filePath, fallback) {
      try {
        if (!fs2.existsSync(filePath)) {
          return fallback;
        }
        const content = fs2.readFileSync(filePath, "utf8");
        return JSON.parse(content);
      } catch (_error) {
        return fallback;
      }
    }
    function writeJsonFileAtomic(filePath, value) {
      const dir = path2.dirname(filePath);
      fs2.mkdirSync(dir, { recursive: true });
      const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
      fs2.writeFileSync(tempPath, JSON.stringify(value, null, 2));
      fs2.renameSync(tempPath, filePath);
    }
    function createMissionControlStore(dataDir) {
      const missionControlDir = ensureMissionControlDir(dataDir);
      const notificationsPath = path2.join(missionControlDir, "notifications.json");
      return {
        notificationsPath,
        readNotifications(fallback) {
          return readJsonFile(notificationsPath, fallback);
        },
        writeNotifications(value) {
          writeJsonFileAtomic(notificationsPath, value);
        }
      };
    }
    module2.exports = {
      createMissionControlStore,
      ensureMissionControlDir,
      readJsonFile,
      writeJsonFileAtomic
    };
  }
});

// src/mission-control/models.js
var require_models = __commonJS({
  "src/mission-control/models.js"(exports2, module2) {
    var VALID_CATEGORIES = /* @__PURE__ */ new Set(["completion", "exception"]);
    var VALID_SEVERITIES = /* @__PURE__ */ new Set(["info", "warn", "critical"]);
    function normalizeBoolean(value, fallback = false) {
      if (value === void 0 || value === null || value === "") {
        return fallback;
      }
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        return ["1", "true", "yes", "on"].includes(value.toLowerCase());
      }
      return Boolean(value);
    }
    function isIsoDate(value) {
      return Boolean(value) && !Number.isNaN(Date.parse(value));
    }
    function createEmptyNotificationsState() {
      return {
        version: 1,
        updatedAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        records: {}
      };
    }
    function normalizeNotificationsConfig(config = {}) {
      const discordConfig = config.discord || {};
      const retryConfig = discordConfig.retry || {};
      const destinations = Object.fromEntries(
        Object.entries(discordConfig.destinations || {}).map(([key, value]) => [
          key,
          {
            key,
            label: value?.label || key,
            webhookUrl: value?.webhookUrl || value?.url || null,
            allowedSenders: Array.isArray(value?.allowedSenders) ? value.allowedSenders : []
          }
        ])
      );
      const senders = Object.fromEntries(
        Object.entries(discordConfig.senders || {}).map(([key, value]) => [
          key,
          {
            key,
            displayName: value?.displayName || key,
            avatarUrl: value?.avatarUrl || null,
            avatarEmoji: value?.avatarEmoji || null,
            defaultDestinationKey: value?.defaultDestinationKey || value?.defaultDestinationKeys?.[0] || null
          }
        ])
      );
      return {
        enabled: normalizeBoolean(config.enabled, false),
        defaults: {
          senderKey: discordConfig.defaults?.senderKey || Object.keys(senders)[0] || null,
          destinationKey: discordConfig.defaults?.destinationKey || Object.keys(destinations)[0] || null
        },
        retry: {
          maxAttempts: Math.max(1, Number.parseInt(retryConfig.maxAttempts || "3", 10)),
          baseDelayMs: Math.max(0, Number.parseInt(retryConfig.baseDelayMs || "1000", 10)),
          maxDelayMs: Math.max(0, Number.parseInt(retryConfig.maxDelayMs || "30000", 10))
        },
        destinations,
        senders
      };
    }
    function normalizeNotificationEvent(input, config, now = () => Date.now()) {
      if (!input || typeof input !== "object") {
        throw new Error("Mission Control event payload must be an object");
      }
      const eventKey = String(input.eventKey || "").trim();
      if (!eventKey) {
        throw new Error("eventKey is required");
      }
      const category = String(input.category || "").trim().toLowerCase();
      if (!VALID_CATEGORIES.has(category)) {
        throw new Error("category must be 'completion' or 'exception'");
      }
      const severity = VALID_SEVERITIES.has(String(input.severity || "").trim().toLowerCase()) ? String(input.severity).trim().toLowerCase() : category === "exception" ? "critical" : "info";
      const title = String(input.title || "").trim();
      if (!title) {
        throw new Error("title is required");
      }
      const summary = String(input.summary || input.message || "").trim();
      if (!summary) {
        throw new Error("summary is required");
      }
      const senderKey = String(input.senderKey || "").trim() || String(config.defaults.senderKey || "").trim();
      const configuredSender = senderKey ? config.senders[senderKey] : null;
      const destinationKey = String(input.destinationKey || "").trim() || configuredSender?.defaultDestinationKey || String(config.defaults.destinationKey || "").trim();
      return {
        eventKey,
        category,
        severity,
        title,
        summary,
        senderKey,
        destinationKey,
        cardId: input.cardId ? String(input.cardId) : null,
        issueIdentifier: input.issueIdentifier ? String(input.issueIdentifier) : null,
        projectKey: input.projectKey ? String(input.projectKey) : null,
        metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
        occurredAt: isIsoDate(input.occurredAt) ? new Date(input.occurredAt).toISOString() : null,
        createdAt: new Date(now()).toISOString()
      };
    }
    module2.exports = {
      createEmptyNotificationsState,
      normalizeBoolean,
      normalizeNotificationEvent,
      normalizeNotificationsConfig
    };
  }
});

// src/mission-control/notifications.js
var require_notifications = __commonJS({
  "src/mission-control/notifications.js"(exports2, module2) {
    var { createMissionControlStore } = require_store();
    var {
      createEmptyNotificationsState,
      normalizeNotificationEvent,
      normalizeNotificationsConfig
    } = require_models();
    function defaultSleep(delayMs) {
      return new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    function parseRetryAfterMs(headerValue) {
      if (!headerValue) {
        return null;
      }
      const seconds = Number.parseFloat(headerValue);
      if (!Number.isNaN(seconds)) {
        return Math.max(0, Math.round(seconds * 1e3));
      }
      const parsedDate = Date.parse(headerValue);
      if (Number.isNaN(parsedDate)) {
        return null;
      }
      return Math.max(0, parsedDate - Date.now());
    }
    function getCategoryLabel(category) {
      return category === "exception" ? "Exception" : "Completion";
    }
    function getSeverityColor(severity) {
      switch (severity) {
        case "critical":
          return 16273737;
        case "warn":
          return 13801762;
        default:
          return 4176208;
      }
    }
    function truncate(text, maxLength = 512) {
      if (!text || text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength - 1)}\u2026`;
    }
    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }
    function createNotificationsModule2(options) {
      const {
        config = {},
        dataDir,
        fetchImpl = global.fetch,
        now = () => Date.now(),
        sleep = defaultSleep,
        logger = console,
        onStateChange = () => {
        }
      } = options;
      if (!dataDir) {
        throw new Error("dataDir is required for Mission Control notifications");
      }
      if (typeof fetchImpl !== "function") {
        throw new Error("fetchImpl is required for Mission Control notifications");
      }
      const normalizedConfig = normalizeNotificationsConfig(config);
      const store = createMissionControlStore(dataDir);
      const persistedState = store.readNotifications(createEmptyNotificationsState());
      const state2 = {
        ...createEmptyNotificationsState(),
        ...persistedState,
        records: { ...persistedState.records || {} }
      };
      const inFlightDeliveries = /* @__PURE__ */ new Map();
      function isoNow() {
        return new Date(now()).toISOString();
      }
      function saveState() {
        state2.updatedAt = isoNow();
        store.writeNotifications(state2);
        onStateChange(getState());
      }
      function redactRecord(record) {
        const destination = normalizedConfig.destinations[record.destinationKey];
        const sender = normalizedConfig.senders[record.senderKey];
        return {
          eventKey: record.eventKey,
          category: record.category,
          severity: record.severity,
          title: record.title,
          summary: record.summary,
          senderKey: record.senderKey,
          senderName: sender?.displayName || record.senderKey || null,
          destinationKey: record.destinationKey,
          destinationLabel: destination?.label || record.destinationKey || null,
          status: record.status,
          attempts: record.attempts,
          maxAttempts: record.maxAttempts,
          dedupeHits: record.dedupeHits || 0,
          deadLetter: Boolean(record.deadLetter),
          cardId: record.cardId,
          issueIdentifier: record.issueIdentifier,
          projectKey: record.projectKey,
          createdAt: record.createdAt,
          occurredAt: record.occurredAt,
          lastAttemptAt: record.lastAttemptAt || null,
          deliveredAt: record.deliveredAt || null,
          failedAt: record.failedAt || null,
          nextAttemptAt: record.nextAttemptAt || null,
          lastError: record.lastError || null
        };
      }
      function listRecentRecords(limit = 10) {
        return Object.values(state2.records).sort((left, right) => {
          const leftTime = Date.parse(left.lastAttemptAt || left.createdAt || 0);
          const rightTime = Date.parse(right.lastAttemptAt || right.createdAt || 0);
          return rightTime - leftTime;
        }).slice(0, limit).map((record) => redactRecord(record));
      }
      function buildAlertBanner(summary) {
        const { deadLetterCount, retryingCount, recentFailures } = summary;
        if (deadLetterCount > 0) {
          return {
            visible: true,
            severity: "critical",
            title: "Mission Control Discord delivery failures",
            message: deadLetterCount === 1 ? "1 notification moved to dead-letter after exhausting retries." : `${deadLetterCount} notifications moved to dead-letter after exhausting retries.`,
            items: recentFailures.slice(0, 3).map((record) => ({
              title: record.title,
              message: record.lastError?.message || "Discord delivery failed"
            }))
          };
        }
        if (retryingCount > 0) {
          return {
            visible: true,
            severity: "warn",
            title: "Mission Control Discord retries in progress",
            message: retryingCount === 1 ? "1 notification is retrying after a Discord delivery error." : `${retryingCount} notifications are retrying after Discord delivery errors.`,
            items: recentFailures.slice(0, 3).map((record) => ({
              title: record.title,
              message: record.lastError?.message || "Retry pending"
            }))
          };
        }
        return {
          visible: false,
          severity: null,
          title: null,
          message: null,
          items: []
        };
      }
      function getState() {
        const records = Object.values(state2.records);
        const summary = {
          queuedCount: records.filter((record) => record.status === "queued").length,
          retryingCount: records.filter((record) => record.status === "retrying").length,
          deliveredCount: records.filter((record) => record.status === "delivered").length,
          failedCount: records.filter((record) => record.status === "failed").length,
          deadLetterCount: records.filter((record) => record.deadLetter).length,
          recentFailures: records.filter((record) => record.status === "failed" || record.status === "retrying").sort((left, right) => {
            const leftTime = Date.parse(left.lastAttemptAt || left.createdAt || 0);
            const rightTime = Date.parse(right.lastAttemptAt || right.createdAt || 0);
            return rightTime - leftTime;
          })
        };
        return {
          enabled: normalizedConfig.enabled,
          configSummary: {
            destinationCount: Object.keys(normalizedConfig.destinations).length,
            senderCount: Object.keys(normalizedConfig.senders).length,
            destinations: Object.values(normalizedConfig.destinations).map((destination) => ({
              key: destination.key,
              label: destination.label,
              allowedSenders: destination.allowedSenders
            })),
            senders: Object.values(normalizedConfig.senders).map((sender) => ({
              key: sender.key,
              displayName: sender.displayName,
              defaultDestinationKey: sender.defaultDestinationKey
            }))
          },
          delivery: {
            queuedCount: summary.queuedCount,
            retryingCount: summary.retryingCount,
            deliveredCount: summary.deliveredCount,
            failedCount: summary.failedCount,
            deadLetterCount: summary.deadLetterCount,
            lastSuccessAt: state2.lastSuccessAt,
            lastErrorAt: state2.lastErrorAt,
            recent: listRecentRecords()
          },
          alertBanner: buildAlertBanner(summary),
          updatedAt: state2.updatedAt
        };
      }
      function computeDelayMs(record, retryAfterMs) {
        if (retryAfterMs !== null && retryAfterMs !== void 0) {
          return Math.min(normalizedConfig.retry.maxDelayMs, Math.max(0, retryAfterMs));
        }
        const attemptIndex = Math.max(0, record.attempts - 1);
        const exponent = 2 ** attemptIndex;
        return Math.min(normalizedConfig.retry.maxDelayMs, normalizedConfig.retry.baseDelayMs * exponent);
      }
      function buildDiscordPayload(record) {
        const sender = normalizedConfig.senders[record.senderKey];
        const destination = normalizedConfig.destinations[record.destinationKey];
        const fields = [
          { name: "Category", value: getCategoryLabel(record.category), inline: true },
          {
            name: "Severity",
            value: record.severity.charAt(0).toUpperCase() + record.severity.slice(1),
            inline: true
          }
        ];
        if (record.cardId) {
          fields.push({ name: "Card", value: record.cardId, inline: true });
        }
        if (record.issueIdentifier) {
          fields.push({ name: "Issue", value: record.issueIdentifier, inline: true });
        }
        if (record.projectKey) {
          fields.push({ name: "Project", value: record.projectKey, inline: true });
        }
        if (destination?.label) {
          fields.push({ name: "Destination", value: destination.label, inline: true });
        }
        const payload = {
          username: sender?.displayName || "Mission Control",
          content: `[Mission Control] ${record.title}`,
          embeds: [
            {
              title: record.title,
              description: truncate(record.summary, 2048),
              color: getSeverityColor(record.severity),
              fields,
              footer: {
                text: `Mission Control \u2022 ${record.eventKey}`
              },
              timestamp: record.occurredAt || record.createdAt
            }
          ]
        };
        if (sender?.avatarUrl) {
          payload.avatar_url = sender.avatarUrl;
        }
        if (sender?.avatarEmoji) {
          payload.content = `${sender.avatarEmoji} ${payload.content}`;
        }
        return payload;
      }
      async function sendDiscordWebhook(record) {
        const destination = normalizedConfig.destinations[record.destinationKey];
        const sender = normalizedConfig.senders[record.senderKey];
        if (!destination || !destination.webhookUrl) {
          return {
            ok: false,
            retryable: false,
            statusCode: null,
            message: `Unknown Discord destination '${record.destinationKey}'`
          };
        }
        if (!sender) {
          return {
            ok: false,
            retryable: false,
            statusCode: null,
            message: `Unknown Discord sender '${record.senderKey}'`
          };
        }
        if (destination.allowedSenders.length > 0 && !destination.allowedSenders.includes(record.senderKey)) {
          return {
            ok: false,
            retryable: false,
            statusCode: null,
            message: `Sender '${record.senderKey}' is not allowed for destination '${record.destinationKey}'`
          };
        }
        const payload = buildDiscordPayload(record);
        try {
          const response = await fetchImpl(destination.webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "openclaw-command-center/mission-control"
            },
            body: JSON.stringify(payload)
          });
          if (response.ok) {
            return {
              ok: true,
              statusCode: response.status,
              payload
            };
          }
          const message = truncate(await response.text(), 512) || `Discord returned ${response.status}`;
          return {
            ok: false,
            retryable: response.status === 429 || response.status >= 500,
            statusCode: response.status,
            retryAfterMs: parseRetryAfterMs(response.headers?.get?.("retry-after")),
            message
          };
        } catch (error) {
          return {
            ok: false,
            retryable: true,
            statusCode: null,
            message: error.message
          };
        }
      }
      async function runDelivery(record) {
        while (record.attempts < record.maxAttempts) {
          record.attempts += 1;
          record.status = record.attempts === 1 ? "queued" : "retrying";
          record.lastAttemptAt = isoNow();
          record.nextAttemptAt = null;
          saveState();
          const result = await sendDiscordWebhook(record);
          if (result.ok) {
            record.status = "delivered";
            record.deadLetter = false;
            record.deliveredAt = isoNow();
            record.failedAt = null;
            record.lastError = null;
            record.nextAttemptAt = null;
            state2.lastSuccessAt = record.deliveredAt;
            saveState();
            return {
              delivered: true,
              deduped: false,
              record: redactRecord(record)
            };
          }
          const failureTime = isoNow();
          record.lastError = {
            message: result.message,
            statusCode: result.statusCode,
            retryAfterMs: result.retryAfterMs || null,
            at: failureTime
          };
          state2.lastErrorAt = failureTime;
          const canRetry = result.retryable && record.attempts < record.maxAttempts;
          if (canRetry) {
            const delayMs = computeDelayMs(record, result.retryAfterMs);
            record.status = "retrying";
            record.nextAttemptAt = new Date(now() + delayMs).toISOString();
            saveState();
            await sleep(delayMs);
            continue;
          }
          record.status = "failed";
          record.deadLetter = true;
          record.failedAt = failureTime;
          record.nextAttemptAt = null;
          saveState();
          return {
            delivered: false,
            deduped: false,
            record: redactRecord(record),
            error: clone(record.lastError)
          };
        }
        record.status = "failed";
        record.deadLetter = true;
        record.failedAt = isoNow();
        saveState();
        return {
          delivered: false,
          deduped: false,
          record: redactRecord(record),
          error: clone(record.lastError)
        };
      }
      function beginDelivery(record) {
        const deliveryPromise = runDelivery(record).catch((error) => {
          logger.error("[Mission Control] Discord delivery failed:", error.message);
          record.status = "failed";
          record.deadLetter = true;
          record.failedAt = isoNow();
          record.lastError = {
            message: error.message,
            statusCode: null,
            retryAfterMs: null,
            at: record.failedAt
          };
          state2.lastErrorAt = record.failedAt;
          saveState();
          return {
            delivered: false,
            deduped: false,
            record: redactRecord(record),
            error: clone(record.lastError)
          };
        }).finally(() => {
          inFlightDeliveries.delete(record.eventKey);
        });
        inFlightDeliveries.set(record.eventKey, deliveryPromise);
        return deliveryPromise;
      }
      async function deliverEvent(input, options2 = {}) {
        const waitForCompletion = options2.wait !== false;
        if (!normalizedConfig.enabled) {
          return { delivered: false, skipped: true, reason: "Mission Control notifications disabled" };
        }
        const normalizedEvent = normalizeNotificationEvent(input, normalizedConfig, now);
        const existingRecord = state2.records[normalizedEvent.eventKey];
        if (existingRecord) {
          existingRecord.dedupeHits = (existingRecord.dedupeHits || 0) + 1;
          saveState();
          const inFlight = inFlightDeliveries.get(normalizedEvent.eventKey);
          if (waitForCompletion && inFlight) {
            return inFlight;
          }
          return {
            delivered: existingRecord.status === "delivered",
            deduped: true,
            record: redactRecord(existingRecord)
          };
        }
        const record = {
          ...normalizedEvent,
          status: "queued",
          attempts: 0,
          maxAttempts: normalizedConfig.retry.maxAttempts,
          dedupeHits: 0,
          deadLetter: false,
          deliveredAt: null,
          failedAt: null,
          nextAttemptAt: null,
          lastAttemptAt: null,
          lastError: null
        };
        state2.records[record.eventKey] = record;
        saveState();
        const deliveryPromise = beginDelivery(record);
        if (!waitForCompletion) {
          return {
            delivered: false,
            queued: true,
            deduped: false,
            record: redactRecord(record)
          };
        }
        return deliveryPromise;
      }
      async function waitForIdle() {
        await Promise.allSettled(Array.from(inFlightDeliveries.values()));
      }
      function resumePendingDeliveries() {
        const pendingRecords = Object.values(state2.records).filter(
          (record) => (record.status === "queued" || record.status === "retrying") && record.attempts < record.maxAttempts && !inFlightDeliveries.has(record.eventKey)
        );
        for (const record of pendingRecords) {
          const waitMs = record.nextAttemptAt ? Math.max(0, Date.parse(record.nextAttemptAt) - now()) : 0;
          const promise = (async () => {
            if (waitMs > 0) {
              await sleep(waitMs);
            }
            return runDelivery(record);
          })().finally(() => {
            inFlightDeliveries.delete(record.eventKey);
          });
          inFlightDeliveries.set(record.eventKey, promise);
        }
      }
      resumePendingDeliveries();
      return {
        buildDiscordPayload,
        deliverEvent,
        getState,
        waitForIdle
      };
    }
    module2.exports = {
      createNotificationsModule: createNotificationsModule2,
      parseRetryAfterMs
    };
  }
});

// src/mission-control/routes.js
var require_routes = __commonJS({
  "src/mission-control/routes.js"(exports2, module2) {
    function isMissionControlRoute2(pathname) {
      return pathname === "/api/mission-control/state" || pathname === "/api/mission-control/events";
    }
    function handleMissionControlRequest2(req, res, pathname, notifications) {
      if (pathname === "/api/mission-control/state" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ notifications: notifications.getState() }, null, 2));
        return true;
      }
      if (pathname === "/api/mission-control/events" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const result = await notifications.deliverEvent(payload, { wait: false });
            res.writeHead(result.skipped ? 202 : result.deduped ? 200 : 202, {
              "Content-Type": "application/json"
            });
            res.end(JSON.stringify(result, null, 2));
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return true;
      }
      if (pathname.startsWith("/api/mission-control/")) {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
      }
      return false;
    }
    module2.exports = {
      handleMissionControlRequest: handleMissionControlRequest2,
      isMissionControlRoute: isMissionControlRoute2
    };
  }
});

// src/index.js
var http = require("http");
var fs = require("fs");
var path = require("path");
var args = process.argv.slice(2);
var cliProfile = null;
var cliPort = null;
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--profile":
    case "-p":
      cliProfile = args[++i];
      break;
    case "--port":
      cliPort = parseInt(args[++i], 10);
      break;
    case "--help":
    case "-h":
      console.log(`
OpenClaw Command Center

Usage: node lib/server.js [options]

Options:
  --profile, -p <name>  OpenClaw profile (uses ~/.openclaw-<name>)
  --port <port>         Server port (default: 3333)
  --help, -h            Show this help

Environment:
  OPENCLAW_PROFILE      Same as --profile
  PORT                  Same as --port

Examples:
  node lib/server.js --profile production
  node lib/server.js -p dev --port 3334
`);
      process.exit(0);
  }
}
if (cliProfile) {
  process.env.OPENCLAW_PROFILE = cliProfile;
}
if (cliPort) {
  process.env.PORT = cliPort.toString();
}
var { getVersion } = require_utils();
var { CONFIG, getOpenClawDir } = require_config();
var { handleJobsRequest, isJobsRoute } = require_jobs();
var { runOpenClaw, runOpenClawAsync, extractJSON } = require_openclaw();
var { getSystemVitals, checkOptionalDeps, getOptionalDeps } = require_vitals();
var { checkAuth, getUnauthorizedPage } = require_auth();
var { loadPrivacySettings, savePrivacySettings } = require_privacy();
var {
  loadOperators,
  saveOperators,
  getOperatorBySlackId,
  startOperatorsRefresh
} = require_operators();
var { createSessionsModule } = require_sessions();
var { getCronJobs } = require_cron();
var { getCerebroTopics, updateTopicStatus } = require_cerebro();
var {
  getDailyTokenUsage,
  getTokenStats,
  getCostBreakdown,
  startTokenUsageRefresh,
  refreshTokenUsageAsync
} = require_tokens();
var { getLlmUsage, getRoutingStats, startLlmUsageRefresh } = require_llm_usage();
var { executeAction } = require_actions();
var { migrateDataDir } = require_data();
var { createAcpModule } = require_acp();
var { createStateModule } = require_state();
var { createNotificationsModule } = require_notifications();
var { handleMissionControlRequest, isMissionControlRoute } = require_routes();
var PORT = CONFIG.server.port;
var HOST = CONFIG.server.host;
var DASHBOARD_DIR = path.join(__dirname, "../public");
var DOCS_DIR = path.join(__dirname, "../docs");
var PATHS = CONFIG.paths;
var AUTH_CONFIG = {
  mode: CONFIG.auth.mode,
  token: CONFIG.auth.token,
  allowedUsers: CONFIG.auth.allowedUsers,
  allowedIPs: CONFIG.auth.allowedIPs,
  publicPaths: CONFIG.auth.publicPaths
};
var DATA_DIR = path.join(getOpenClawDir(), "command-center", "data");
var LEGACY_DATA_DIR = path.join(DASHBOARD_DIR, "data");
var lastMissionControlEventAt = null;
var lastMissionControlReplayAt = null;
var missionControl = createMissionControlService({
  config: CONFIG,
  dataDir: DATA_DIR,
  logger: console,
  onStateChange: (change) => {
    if (typeof state?.invalidateStateCache === "function") {
      state.invalidateStateCache();
    }
    if (sseClients.size === 0) {
      return;
    }
    lastMissionControlEventAt = (/* @__PURE__ */ new Date()).toISOString();
    const publicState = change?.publicState || missionControl.getPublicState();
    broadcastSSE("mission-control", buildMissionControlEventPayload(change, publicState));
  }
});
var sseClients = /* @__PURE__ */ new Set();
function sendSSE(res, event, data) {
  try {
    res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
  } catch (e) {
  }
}
function broadcastSSE(event, data) {
  for (const client of sseClients) {
    sendSSE(client, event, data);
  }
}
function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
function getMissionControlAdminMeta() {
  return {
    sseClientCount: sseClients.size,
    lastReplayAt: lastMissionControlReplayAt,
    lastMissionControlEventAt
  };
}
function replayMissionControlState(reason = "manual-replay") {
  if (typeof state.invalidateStateCache === "function") {
    state.invalidateStateCache();
  }
  const publicState = missionControl.getPublicState();
  const replayedAt = (/* @__PURE__ */ new Date()).toISOString();
  lastMissionControlEventAt = replayedAt;
  lastMissionControlReplayAt = replayedAt;
  if (sseClients.size > 0) {
    broadcastSSE(
      "mission-control",
      buildMissionControlEventPayload({ type: "replay", reason }, publicState)
    );
    broadcastSSE("update", state.refreshState());
  }
  return {
    replayedAt,
    sseClientCount: sseClients.size,
    board: buildBoardPayload(publicState),
    sync: buildSyncPayload(publicState).sync
  };
}
function handleMissionControlApi(req, res, pathname) {
  const publicState = missionControl.getPublicState();
  if (pathname === "/api/mission-control") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, publicState);
    return true;
  }
  if (pathname === "/api/mission-control/board") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, buildBoardPayload(publicState));
    return true;
  }
  if (pathname === "/api/mission-control/filters") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, buildFiltersPayload(publicState));
    return true;
  }
  if (pathname === "/api/mission-control/health") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, buildHealthPayload(publicState));
    return true;
  }
  if (pathname === "/api/mission-control/sync") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, buildSyncPayload(publicState));
    return true;
  }
  if (pathname === "/api/mission-control/diagnostics") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, missionControl.getDiagnostics());
    return true;
  }
  if (pathname === "/api/mission-control/views") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, missionControl.getSavedViews());
    return true;
  }
  if (pathname === "/api/mission-control/views/active") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    readJsonBody(req).then((body) => writeJson(res, 200, missionControl.setActiveView(body.viewId))).catch((error) => writeJson(res, 400, { error: `Invalid JSON: ${error.message}` }));
    return true;
  }
  if (pathname === "/api/mission-control/reconcile") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    missionControl.reconcile({ reason: "manual" }).then(() => {
      writeJson(res, 200, missionControl.getPublicState());
    }).catch((error) => {
      writeJson(res, 500, { error: error.message });
    });
    return true;
  }
  if (pathname.startsWith("/api/mission-control/cards/") && pathname.endsWith("/cross-lane-child")) {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const cardRef = decodeURIComponent(
      pathname.replace("/api/mission-control/cards/", "").replace("/cross-lane-child", "")
    );
    readJsonBody(req).catch((error) => {
      error.code = "validation";
      error.message = `Invalid JSON: ${error.message}`;
      throw error;
    }).then((body) => missionControl.createCrossLaneChildTask(cardRef, body)).then((result) => {
      writeJson(res, 201, result);
    }).catch((error) => {
      const statusCode = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : error.code === "validation" || error.code === "invalid_parent" || error.code === "invalid_target" ? 400 : 500;
      writeJson(res, statusCode, { error: error.message });
    });
    return true;
  }
  if (pathname.startsWith("/api/mission-control/cards/") && pathname.endsWith("/timeline")) {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const cardRef = decodeURIComponent(
      pathname.replace("/api/mission-control/cards/", "").replace("/timeline", "")
    );
    const timeline = missionControl.getCardTimeline(cardRef);
    if (!timeline) {
      writeJson(res, 404, { error: "Mission Control card not found" });
    } else {
      writeJson(res, 200, { timeline });
    }
    return true;
  }
  if (pathname.startsWith("/api/mission-control/cards/") && pathname.endsWith("/replay")) {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const cardRef = decodeURIComponent(
      pathname.replace("/api/mission-control/cards/", "").replace("/replay", "")
    );
    const replay = missionControl.replayCardTimeline(cardRef);
    if (!replay) {
      writeJson(res, 404, { error: "Mission Control card not found" });
    } else {
      writeJson(res, 200, { replay });
    }
    return true;
  }
  if (pathname === "/api/mission-control/admin/status") {
    if (req.method !== "GET") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, buildAdminStatusPayload(publicState, getMissionControlAdminMeta()));
    return true;
  }
  if (pathname === "/api/mission-control/admin/reconcile") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    missionControl.reconcile({ reason: "manual-admin" }).then(() => {
      if (typeof state.invalidateStateCache === "function") {
        state.invalidateStateCache();
      }
      const refreshedState = missionControl.getPublicState();
      writeJson(res, 200, {
        ok: true,
        triggeredAt: (/* @__PURE__ */ new Date()).toISOString(),
        board: buildBoardPayload(refreshedState),
        sync: buildSyncPayload(refreshedState).sync
      });
    }).catch((error) => {
      writeJson(res, 500, { error: error.message });
    });
    return true;
  }
  if (pathname === "/api/mission-control/admin/replay") {
    if (req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    writeJson(res, 200, {
      ok: true,
      ...replayMissionControlState("manual-admin")
    });
    return true;
  }
  if (pathname.startsWith("/api/mission-control/")) {
    writeJson(res, 404, { error: "Not found" });
    return true;
  }
  return false;
}
var sessions = createSessionsModule({
  getOpenClawDir,
  getOperatorBySlackId: (slackId) => getOperatorBySlackId(DATA_DIR, slackId),
  runOpenClaw,
  runOpenClawAsync,
  extractJSON
});
var missionControlNotifications;
var state = createStateModule({
  CONFIG,
  getOpenClawDir,
  getSessions: (opts) => sessions.getSessions(opts),
  getSystemVitals,
  getCronJobs: () => getCronJobs(getOpenClawDir),
  loadOperators: () => loadOperators(DATA_DIR),
  getLlmUsage: () => getLlmUsage(PATHS.state),
  getDailyTokenUsage: () => getDailyTokenUsage(getOpenClawDir),
  getTokenStats,
  getCerebroTopics: (opts) => getCerebroTopics(PATHS.cerebro, opts),
  getMissionControlState: () => missionControlNotifications ? {
    notifications: missionControlNotifications.getState()
  } : null,
  runOpenClaw,
  extractJSON,
  readTranscript: (sessionId) => sessions.readTranscript(sessionId),
  getMissionControlState: () => missionControl.getPublicState(),
  getAcpActivity: () => acp.getAgentActivity()
});
missionControlNotifications = createNotificationsModule({
  config: CONFIG.integrations.missionControl.notifications,
  dataDir: DATA_DIR,
  onStateChange: () => {
    if (sseClients.size === 0) {
      return;
    }
    try {
      const fullState = state.refreshState();
      broadcastSSE("update", fullState);
    } catch (error) {
      console.error("[Mission Control] Failed to broadcast notification state:", error.message);
    }
  }
});
process.nextTick(() => migrateDataDir(DATA_DIR, LEGACY_DATA_DIR));
startOperatorsRefresh(DATA_DIR, getOpenClawDir);
startLlmUsageRefresh();
startTokenUsageRefresh(getOpenClawDir);
missionControl.start();
function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  if (pathname.includes("..")) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const normalizedPath = path.normalize(pathname).replace(/^[/\\]+/, "");
  const baseDir = pathname.startsWith("/docs/") ? DOCS_DIR : DASHBOARD_DIR;
  const filePath = path.join(baseDir, normalizedPath);
  const resolvedDashboardDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(resolvedDashboardDir + path.sep) && resolvedFilePath !== resolvedDashboardDir) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const headers = { "Content-Type": contentTypes[ext] || "text/plain" };
    if ([".html", ".css", ".js", ".json"].includes(ext)) {
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}
function handleApi(req, res) {
  const sessionsList = sessions.getSessions();
  const capacity = state.getCapacity();
  const tokenStats = getTokenStats(sessionsList, capacity, CONFIG);
  const data = {
    sessions: sessionsList,
    cron: getCronJobs(getOpenClawDir),
    system: state.getSystemStatus(),
    activity: state.getRecentActivity(),
    tokenStats,
    capacity,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}
var server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const urlParts = req.url.split("?");
  const pathname = urlParts[0];
  const query = new URLSearchParams(urlParts[1] || "");
  if (pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", port: PORT, timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
    return;
  }
  const isPublicPath = AUTH_CONFIG.publicPaths.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (!isPublicPath && AUTH_CONFIG.mode !== "none") {
    const authResult = checkAuth(req, AUTH_CONFIG);
    if (!authResult.authorized) {
      console.log(`[AUTH] Denied: ${authResult.reason} (path: ${pathname})`);
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end(getUnauthorizedPage(authResult.reason, authResult.user, AUTH_CONFIG));
      return;
    }
    req.authUser = authResult.user;
    if (authResult.user?.login || authResult.user?.email) {
      console.log(
        `[AUTH] Allowed: ${authResult.user.login || authResult.user.email} (path: ${pathname})`
      );
    } else {
      console.log(`[AUTH] Allowed: ${req.socket?.remoteAddress} (path: ${pathname})`);
    }
  }
  if (pathname === "/api/status") {
    handleApi(req, res);
  } else if (pathname === "/api/session") {
    const sessionKey = query.get("key");
    if (!sessionKey) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing session key" }));
      return;
    }
    const detail = sessions.getSessionDetail(sessionKey);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(detail, null, 2));
  } else if (pathname === "/api/cerebro") {
    const offset = parseInt(query.get("offset") || "0", 10);
    const limit = parseInt(query.get("limit") || "20", 10);
    const statusFilter = query.get("status") || "all";
    const data = getCerebroTopics(PATHS.cerebro, { offset, limit, status: statusFilter });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname.startsWith("/api/cerebro/topic/") && pathname.endsWith("/status") && req.method === "POST") {
    const topicId = decodeURIComponent(
      pathname.replace("/api/cerebro/topic/", "").replace("/status", "")
    );
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { status: newStatus } = JSON.parse(body);
        if (!newStatus || !["active", "resolved", "parked"].includes(newStatus)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Invalid status. Must be: active, resolved, or parked" })
          );
          return;
        }
        const result = updateTopicStatus(PATHS.cerebro, topicId, newStatus);
        if (result.error) {
          res.writeHead(result.code || 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  } else if (pathname === "/api/llm-quota") {
    const data = getLlmUsage(PATHS.state);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/cost-breakdown") {
    const data = getCostBreakdown(CONFIG, (opts) => sessions.getSessions(opts), getOpenClawDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/subagents") {
    const data = state.getSubagentStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ subagents: data }, null, 2));
  } else if (pathname === "/api/acp/agents") {
    const data = acp.getAgentActivity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  } else if (pathname === "/api/action") {
    const action = query.get("action");
    if (!action) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing action parameter" }));
      return;
    }
    const result = executeAction(action, { runOpenClaw, extractJSON, PORT });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result, null, 2));
  } else if (pathname === missionControl.getWebhookPath() && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      const result = await missionControl.handleWebhook({ headers: req.headers, rawBody: body });
      res.writeHead(result.statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body, null, 2));
    });
    return;
  } else if (pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    sseClients.add(res);
    console.log(`[SSE] Client connected (total: ${sseClients.size})`);
    sendSSE(res, "connected", { message: "Connected to Command Center", timestamp: Date.now() });
    const cachedState = state.getFullState();
    if (cachedState) {
      sendSSE(res, "update", cachedState);
    } else {
      sendSSE(res, "update", { sessions: [], loading: true });
    }
    req.on("close", () => {
      sseClients.delete(res);
      console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
    });
    return;
  } else if (pathname === "/api/whoami") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          authMode: AUTH_CONFIG.mode,
          user: req.authUser || null
        },
        null,
        2
      )
    );
  } else if (handleMissionControlApi(req, res, pathname)) {
    return;
  } else if (pathname === "/api/about") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          name: "OpenClaw Command Center",
          version: getVersion(),
          description: "A Starcraft-inspired dashboard for AI agent orchestration",
          license: "MIT",
          repository: "https://github.com/jontsai/openclaw-command-center",
          builtWith: ["OpenClaw", "Node.js", "Vanilla JS"],
          inspirations: ["Starcraft", "Inside Out", "iStatMenus", "DaisyDisk", "Gmail"]
        },
        null,
        2
      )
    );
  } else if (pathname === "/api/state") {
    const fullState = state.getFullState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(fullState, null, 2));
  } else if (pathname === "/api/vitals") {
    const vitals = getSystemVitals();
    const optionalDeps = getOptionalDeps();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ vitals, optionalDeps }, null, 2));
  } else if (pathname === "/api/capacity") {
    const capacity = state.getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(capacity, null, 2));
  } else if (pathname === "/api/sessions") {
    const page = parseInt(query.get("page")) || 1;
    const pageSize = parseInt(query.get("pageSize")) || 20;
    const statusFilter = query.get("status");
    const allSessions = sessions.getSessions({ limit: null });
    const statusCounts = {
      all: allSessions.length,
      live: allSessions.filter((s) => s.active).length,
      recent: allSessions.filter((s) => !s.active && s.recentlyActive).length,
      idle: allSessions.filter((s) => !s.active && !s.recentlyActive).length
    };
    let filteredSessions = allSessions;
    if (statusFilter === "live") {
      filteredSessions = allSessions.filter((s) => s.active);
    } else if (statusFilter === "recent") {
      filteredSessions = allSessions.filter((s) => !s.active && s.recentlyActive);
    } else if (statusFilter === "idle") {
      filteredSessions = allSessions.filter((s) => !s.active && !s.recentlyActive);
    }
    const total = filteredSessions.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const displaySessions = filteredSessions.slice(offset, offset + pageSize);
    const tokenStats = getTokenStats(allSessions, state.getCapacity(), CONFIG);
    const capacity = state.getCapacity();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          sessions: displaySessions,
          pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasPrev: page > 1,
            hasNext: page < totalPages
          },
          statusCounts,
          tokenStats,
          capacity
        },
        null,
        2
      )
    );
  } else if (pathname === "/api/cron") {
    const cron = getCronJobs(getOpenClawDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cron }, null, 2));
  } else if (pathname === "/api/operators") {
    const method = req.method;
    const data = loadOperators(DATA_DIR);
    if (method === "GET") {
      const allSessions = sessions.getSessions({ limit: null });
      const operatorsWithStats = data.operators.map((op) => {
        const userSessions = allSessions.filter(
          (s) => s.originator?.userId === op.id || s.originator?.userId === op.metadata?.slackId
        );
        return {
          ...op,
          stats: {
            activeSessions: userSessions.filter((s) => s.active).length,
            totalSessions: userSessions.length,
            lastSeen: userSessions.length > 0 ? new Date(
              Date.now() - Math.min(...userSessions.map((s) => s.minutesAgo)) * 6e4
            ).toISOString() : op.lastSeen
          }
        };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            operators: operatorsWithStats,
            roles: data.roles,
            timestamp: Date.now()
          },
          null,
          2
        )
      );
    } else if (method === "POST") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const newOp = JSON.parse(body);
          const existingIdx = data.operators.findIndex((op) => op.id === newOp.id);
          if (existingIdx >= 0) {
            data.operators[existingIdx] = { ...data.operators[existingIdx], ...newOp };
          } else {
            data.operators.push({
              ...newOp,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          if (saveOperators(DATA_DIR, data)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, operator: newOp }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (pathname === "/api/llm-usage") {
    const usage = getLlmUsage(PATHS.state);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(usage, null, 2));
  } else if (pathname === "/api/routing-stats") {
    const hours = parseInt(query.get("hours") || "24", 10);
    const stats = getRoutingStats(PATHS.skills, PATHS.state, hours);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats, null, 2));
  } else if (pathname === "/api/memory") {
    const memory = state.getMemoryStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ memory }, null, 2));
  } else if (pathname === "/api/privacy") {
    if (req.method === "GET") {
      const settings = loadPrivacySettings(DATA_DIR);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(settings, null, 2));
    } else if (req.method === "POST" || req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const updates = JSON.parse(body);
          const current = loadPrivacySettings(DATA_DIR);
          const merged = {
            version: current.version || 1,
            hiddenTopics: updates.hiddenTopics ?? current.hiddenTopics ?? [],
            hiddenSessions: updates.hiddenSessions ?? current.hiddenSessions ?? [],
            hiddenCrons: updates.hiddenCrons ?? current.hiddenCrons ?? [],
            hideHostname: updates.hideHostname ?? current.hideHostname ?? false
          };
          if (savePrivacySettings(DATA_DIR, merged)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, settings: merged }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to save privacy settings" }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
      });
      return;
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
    return;
  } else if (isMissionControlRoute(pathname)) {
    const handled = handleMissionControlRequest(req, res, pathname, missionControlNotifications);
    if (handled) {
      return;
    }
  } else if (isJobsRoute(pathname)) {
    handleJobsRequest(req, res, pathname, query, req.method);
  } else {
    serveStatic(req, res);
  }
});
var shuttingDown = false;
function shutdownServer() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  missionControl.stop();
  const forceExitTimer = setTimeout(() => process.exit(0), 5e3);
  forceExitTimer.unref?.();
  server.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(0);
  });
}
process.on("SIGTERM", shutdownServer);
process.on("SIGINT", shutdownServer);
server.listen(PORT, HOST, () => {
  const profile = process.env.OPENCLAW_PROFILE;
  const displayHost = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
  console.log(`\u{1F99E} OpenClaw Command Center running at http://${displayHost}:${PORT}`);
  if (profile) {
    console.log(`   Profile: ${profile} (~/.openclaw-${profile})`);
  }
  console.log(`   Press Ctrl+C to stop`);
  setTimeout(async () => {
    console.log("[Startup] Pre-warming caches in background...");
    try {
      await Promise.all([sessions.refreshSessionsCache(), refreshTokenUsageAsync(getOpenClawDir)]);
      getSystemVitals();
      console.log("[Startup] Caches warmed.");
    } catch (e) {
      console.log("[Startup] Cache warming error:", e.message);
    }
    checkOptionalDeps();
  }, 100);
  const SESSIONS_CACHE_TTL = 1e4;
  setInterval(() => sessions.refreshSessionsCache(), SESSIONS_CACHE_TTL);
});
var sseRefreshing = false;
setInterval(() => {
  if (sseClients.size > 0 && !sseRefreshing) {
    sseRefreshing = true;
    try {
      const fullState = state.refreshState();
      broadcastSSE("update", fullState);
      broadcastSSE("heartbeat", { clients: sseClients.size, timestamp: Date.now() });
    } catch (e) {
      console.error("[SSE] Broadcast error:", e.message);
    }
    sseRefreshing = false;
  }
}, 15e3);
