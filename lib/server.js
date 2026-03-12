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
    function parseList(value) {
      if (!value) return [];
      if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
      }
      return String(value).split(",").map((item) => item.trim()).filter(Boolean);
    }
    function parseJsonArray(value, fallback = []) {
      if (!value) {
        return fallback;
      }
      if (Array.isArray(value)) {
        return value;
      }
      try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : fallback;
      } catch (error) {
        console.warn("[Config] Failed to parse JSON array:", error.message);
        return fallback;
      }
    }
    function loadConfig() {
      const fileConfig = loadConfigFile();
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
            teamId: process.env.LINEAR_TEAM_ID || fileConfig.integrations?.linear?.teamId,
            projectSlugs: parseList(
              process.env.LINEAR_PROJECT_SLUGS || fileConfig.integrations?.linear?.projectSlugs
            ),
            syncIntervalMs: parseInt(
              process.env.LINEAR_SYNC_INTERVAL_MS || fileConfig.integrations?.linear?.syncIntervalMs || "120000",
              10
            ),
            reconcileOverlapMs: parseInt(
              process.env.LINEAR_RECONCILE_OVERLAP_MS || fileConfig.integrations?.linear?.reconcileOverlapMs || "300000",
              10
            ),
            webhookPath: process.env.LINEAR_WEBHOOK_PATH || fileConfig.integrations?.linear?.webhookPath || "/api/integrations/linear/webhook",
            webhookSecret: process.env.LINEAR_WEBHOOK_SECRET || fileConfig.integrations?.linear?.webhookSecret
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
          acp2 = getAcpActivity();
        } catch (e) {
          console.error("[State] acp:", e.message);
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
          acp: acp2,
          missionControl: getMissionControlState(),
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

// src/mission-control/api.js
var require_api = __commonJS({
  "src/mission-control/api.js"(exports2, module2) {
    function isoNow(now = Date.now) {
      return new Date(now()).toISOString();
    }
    function uniqueCount(values) {
      return new Set(values.filter(Boolean)).size;
    }
    function countBy(items, getKey) {
      const counts = /* @__PURE__ */ new Map();
      for (const item of items) {
        const key = getKey(item);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return counts;
    }
    function normalizeMissionControlState(publicState = {}) {
      const masterCards = Array.isArray(publicState.masterCards) ? publicState.masterCards : [];
      const projects = Array.isArray(publicState.projects) ? publicState.projects : [];
      const lanes = Array.isArray(publicState.lanes) ? publicState.lanes : [];
      const stats = {
        totalCards: Number(publicState.stats?.totalCards || masterCards.length),
        eventCount: Number(publicState.stats?.eventCount || 0),
        staleCards: Number(publicState.stats?.staleCards || 0),
        highRiskCards: Number(publicState.stats?.highRiskCards || 0),
        projectCount: Number(publicState.stats?.projectCount || projects.length),
        laneCount: Number(publicState.stats?.laneCount || lanes.length)
      };
      const sync = {
        status: publicState.sync?.status || "idle",
        mode: publicState.sync?.mode || "hybrid",
        pollIntervalMs: Number(publicState.sync?.pollIntervalMs || 12e4),
        projectSlugs: Array.isArray(publicState.sync?.projectSlugs) ? publicState.sync.projectSlugs : [],
        cursor: publicState.sync?.cursor || { updatedAfter: null },
        lastAttemptedAt: publicState.sync?.lastAttemptedAt || null,
        lastSuccessfulAt: publicState.sync?.lastSuccessfulAt || null,
        lastWebhookAt: publicState.sync?.lastWebhookAt || null,
        lastError: publicState.sync?.lastError || null,
        lastReason: publicState.sync?.lastReason || null,
        lastFetchedCount: Number(publicState.sync?.lastFetchedCount || 0),
        lastChangedCount: Number(publicState.sync?.lastChangedCount || 0),
        lagMs: publicState.sync?.lagMs === null || publicState.sync?.lagMs === void 0 ? null : Number(publicState.sync.lagMs),
        webhook: {
          enabled: Boolean(publicState.sync?.webhook?.enabled),
          path: publicState.sync?.webhook?.path || null,
          lastDeliveryId: publicState.sync?.webhook?.lastDeliveryId || null,
          recentDeliveryIds: Array.isArray(publicState.sync?.webhook?.recentDeliveryIds) ? publicState.sync.webhook.recentDeliveryIds : []
        }
      };
      return {
        updatedAt: publicState.updatedAt || sync.lastSuccessfulAt || null,
        masterCards,
        projects,
        lanes,
        notifications: publicState.notifications || {
          status: "ok",
          stats: { queued: 0, retrying: 0, deadLetters: 0 }
        },
        runtime: publicState.runtime || {
          provider: "symphony",
          updatedAt: null,
          projectCount: projects.length,
          degradedProjectCount: 0
        },
        stats,
        sync
      };
    }
    function getLagSummary(sync) {
      const staleThresholdMs = Math.max(sync.pollIntervalMs * 2, 6e4);
      const lagMs = sync.lagMs;
      const isStale = lagMs !== null && lagMs > staleThresholdMs;
      return {
        milliseconds: lagMs,
        seconds: lagMs === null ? null : Math.round(lagMs / 1e3),
        staleThresholdMs,
        isStale
      };
    }
    function buildBoardPayload2(publicState, now = Date.now) {
      const state2 = normalizeMissionControlState(publicState);
      const cards = state2.masterCards;
      return {
        version: 1,
        generatedAt: isoNow(now),
        updatedAt: state2.updatedAt,
        masterCards: cards,
        projects: state2.projects,
        lanes: state2.lanes,
        runtime: state2.runtime,
        stats: {
          ...state2.stats,
          projectCount: state2.projects.length || uniqueCount(cards.map((card) => card.project?.slug || card.project?.name)),
          teamCount: uniqueCount(cards.map((card) => card.team?.key || card.team?.name)),
          stateCount: uniqueCount(cards.map((card) => card.state?.name)),
          assigneeCount: uniqueCount(cards.map((card) => card.assignee?.email || card.assignee?.name))
        },
        sync: buildSyncPayload2(state2, now).sync,
        notifications: state2.notifications
      };
    }
    function buildFiltersPayload2(publicState, now = Date.now) {
      const state2 = normalizeMissionControlState(publicState);
      const cards = state2.masterCards;
      const projectCounts = countBy(cards, (card) => card.project?.slug || card.project?.name);
      const teamCounts = countBy(cards, (card) => card.team?.key || card.team?.name);
      const stateCounts = countBy(cards, (card) => card.state?.name);
      const laneCounts = countBy(cards, (card) => card.lane);
      const assigneeCounts = countBy(cards, (card) => card.assignee?.email || card.assignee?.name);
      const responsibleAgentCounts = /* @__PURE__ */ new Map();
      const riskCounts = countBy(cards, (card) => card.healthStrip?.risk || card.risk);
      const dispatchCounts = countBy(cards, (card) => card.dispatch || "dispatch:unknown");
      const labelCounts = /* @__PURE__ */ new Map();
      const priorityCounts = countBy(cards, (card) => String(card.priority ?? "unassigned"));
      const estimateCounts = countBy(cards, (card) => String(card.estimate ?? "unestimated"));
      const cycleCounts = countBy(cards, (card) => card.cycle?.id || card.cycle?.name);
      for (const card of cards) {
        for (const agent of card.responsibleAgents || []) {
          if (!agent) continue;
          responsibleAgentCounts.set(agent, {
            key: agent,
            label: agent,
            count: (responsibleAgentCounts.get(agent)?.count || 0) + 1
          });
        }
        for (const label of card.labels || []) {
          const key = label.id || label.name;
          if (!key) continue;
          labelCounts.set(key, {
            key,
            label: label.name || key,
            color: label.color || null,
            count: (labelCounts.get(key)?.count || 0) + 1
          });
        }
      }
      return {
        version: 1,
        generatedAt: isoNow(now),
        updatedAt: state2.updatedAt,
        totalCards: state2.stats.totalCards,
        filters: {
          projects: Array.from(projectCounts.entries()).map(([key, count]) => {
            const card = cards.find((entry) => (entry.project?.slug || entry.project?.name) === key);
            return {
              key,
              label: card?.project?.name || key,
              slug: card?.project?.slug || null,
              count
            };
          }).sort((left, right) => left.label.localeCompare(right.label)),
          teams: Array.from(teamCounts.entries()).map(([key, count]) => {
            const card = cards.find((entry) => (entry.team?.key || entry.team?.name) === key);
            return {
              key,
              label: card?.team?.name || key,
              teamKey: card?.team?.key || null,
              count
            };
          }).sort((left, right) => left.label.localeCompare(right.label)),
          lanes: Array.from(laneCounts.entries()).map(([key, count]) => ({
            key,
            label: key,
            count
          })).sort((left, right) => left.label.localeCompare(right.label)),
          states: Array.from(stateCounts.entries()).map(([key, count]) => {
            const card = cards.find((entry) => entry.state?.name === key);
            return {
              key,
              label: key,
              type: card?.state?.type || null,
              color: card?.state?.color || null,
              count
            };
          }).sort((left, right) => left.label.localeCompare(right.label)),
          assignees: Array.from(assigneeCounts.entries()).map(([key, count]) => {
            const card = cards.find(
              (entry) => (entry.assignee?.email || entry.assignee?.name) === key
            );
            return {
              key,
              label: card?.assignee?.name || key,
              email: card?.assignee?.email || null,
              count
            };
          }).sort((left, right) => left.label.localeCompare(right.label)),
          responsibleAgents: Array.from(responsibleAgentCounts.values()).sort(
            (left, right) => left.label.localeCompare(right.label)
          ),
          risks: Array.from(riskCounts.entries()).map(([key, count]) => ({
            key,
            label: key.replace(/^risk:/, ""),
            count
          })).sort((left, right) => left.label.localeCompare(right.label)),
          dispatch: Array.from(dispatchCounts.entries()).map(([key, count]) => ({
            key,
            label: key === "dispatch:unknown" ? "Unspecified" : key.replace(/^dispatch:/, ""),
            count
          })).sort((left, right) => left.label.localeCompare(right.label)),
          labels: Array.from(labelCounts.values()).sort(
            (left, right) => left.label.localeCompare(right.label)
          ),
          priorities: Array.from(priorityCounts.entries()).map(([value, count]) => ({
            value: value === "unassigned" ? null : Number(value),
            label: value === "unassigned" ? "Unassigned" : `Priority ${value}`,
            count
          })).sort((left, right) => {
            if (left.value === null) return 1;
            if (right.value === null) return -1;
            return left.value - right.value;
          }),
          estimates: Array.from(estimateCounts.entries()).map(([value, count]) => ({
            value: value === "unestimated" ? null : Number(value),
            label: value === "unestimated" ? "Unestimated" : `${value} points`,
            count
          })).sort((left, right) => {
            if (left.value === null) return 1;
            if (right.value === null) return -1;
            return left.value - right.value;
          }),
          cycles: Array.from(cycleCounts.entries()).map(([key, count]) => {
            const card = cards.find((entry) => (entry.cycle?.id || entry.cycle?.name) === key);
            return {
              key,
              label: card?.cycle?.name || key,
              number: card?.cycle?.number || null,
              count
            };
          }).sort((left, right) => left.label.localeCompare(right.label))
        }
      };
    }
    function buildHealthPayload2(publicState, now = Date.now) {
      const state2 = normalizeMissionControlState(publicState);
      const sync = state2.sync;
      const lag = getLagSummary(sync);
      const cards = state2.masterCards;
      const degradedProjects = state2.projects.filter((project) => project.healthStrip?.degraded).length;
      const countsByStateType = cards.reduce((result, card) => {
        const key = card.state?.type || "unknown";
        result[key] = (result[key] || 0) + 1;
        return result;
      }, {});
      let status = "ok";
      let summary = "Mission Control is healthy.";
      if (sync.status === "disabled") {
        status = "disabled";
        summary = sync.lastError || "Mission Control sync is disabled.";
      } else if (sync.status === "error") {
        status = "error";
        summary = sync.lastError || "Mission Control sync is reporting an error.";
      } else if ((state2.notifications?.stats?.deadLetters || 0) > 0) {
        status = "error";
        summary = `Discord delivery dead-lettered ${state2.notifications.stats.deadLetters} notification(s).`;
      } else if ((state2.notifications?.stats?.retrying || 0) > 0 || (state2.notifications?.stats?.queued || 0) > 0) {
        status = "degraded";
        summary = state2.notifications.summary || "Discord delivery is retrying.";
      } else if (degradedProjects > 0) {
        status = "degraded";
        summary = `Symphony runtime is degraded for ${degradedProjects} configured project(s).`;
      } else if (lag.isStale) {
        status = "stale";
        summary = "Mission Control data is older than the configured stale threshold.";
      } else if (sync.status === "syncing" || !sync.lastSuccessfulAt) {
        status = "degraded";
        summary = "Mission Control is still warming up or reconciling.";
      }
      return {
        version: 1,
        generatedAt: isoNow(now),
        updatedAt: state2.updatedAt,
        health: {
          status,
          summary,
          counts: {
            totalCards: state2.stats.totalCards,
            unassignedCards: cards.filter((card) => !card.assignee?.name && !card.assignee?.email).length,
            byStateType: countsByStateType
          },
          sync: {
            status: sync.status,
            lagMs: sync.lagMs,
            staleThresholdMs: lag.staleThresholdMs,
            lastSuccessfulAt: sync.lastSuccessfulAt,
            lastAttemptedAt: sync.lastAttemptedAt,
            lastError: sync.lastError
          },
          runtime: {
            provider: state2.runtime.provider || "symphony",
            updatedAt: state2.runtime.updatedAt || null,
            projectCount: state2.projects.length,
            degradedProjectCount: degradedProjects,
            projects: state2.projects.map((project) => ({
              key: project.key,
              lane: project.lane,
              status: project.healthStrip?.status || "ok",
              risk: project.healthStrip?.risk || "low",
              degraded: Boolean(project.healthStrip?.degraded),
              symphony: project.symphony || null
            }))
          }
        }
      };
    }
    function buildSyncPayload2(publicState, now = Date.now) {
      const state2 = normalizeMissionControlState(publicState);
      const lag = getLagSummary(state2.sync);
      return {
        version: 1,
        generatedAt: isoNow(now),
        updatedAt: state2.updatedAt,
        enabled: state2.sync.status !== "disabled",
        sync: {
          ...state2.sync,
          lag
        },
        notifications: state2.notifications,
        stats: state2.stats
      };
    }
    function buildAdminStatusPayload2(publicState, meta = {}, now = Date.now) {
      const state2 = normalizeMissionControlState(publicState);
      return {
        version: 1,
        generatedAt: isoNow(now),
        updatedAt: state2.updatedAt,
        enabled: state2.sync.status !== "disabled",
        sse: {
          clientCount: Number(meta.sseClientCount || 0),
          lastReplayAt: meta.lastReplayAt || null,
          lastMissionControlEventAt: meta.lastMissionControlEventAt || null
        },
        stats: state2.stats,
        sync: buildSyncPayload2(state2, now).sync,
        notifications: state2.notifications,
        health: buildHealthPayload2(state2, now).health
      };
    }
    function buildMissionControlEventPayload2(change, publicState, now = Date.now) {
      const state2 = normalizeMissionControlState(publicState);
      const payload = {
        version: 1,
        emittedAt: isoNow(now),
        type: change?.type || "state",
        stats: state2.stats,
        sync: buildSyncPayload2(state2, now).sync
      };
      const resolvedCard = change?.card || state2.masterCards.find(
        (card) => card.id === change?.cardId || card.id === change?.issueId || card.primaryLinearIssueId === change?.issueId || card.identifier === change?.identifier || card.primaryLinearIdentifier === change?.identifier
      ) || null;
      if (change?.type === "card-upserted") {
        payload.delta = {
          action: change.action || "updated",
          cardId: resolvedCard?.id || change?.cardId || null,
          identifier: resolvedCard?.identifier || resolvedCard?.primaryLinearIdentifier || change?.identifier || null,
          updatedAt: resolvedCard?.updatedAt || null,
          card: resolvedCard
        };
      } else if (change?.type === "sync-updated") {
        payload.delta = {
          fields: Object.keys(change.partial || {}),
          status: state2.sync.status,
          lastReason: state2.sync.lastReason,
          lastError: state2.sync.lastError
        };
      } else if (change?.type === "webhook-delivery") {
        payload.delta = {
          deliveryId: change.deliveryId || null,
          receivedAt: change.receivedAt || null
        };
      } else if (change?.type === "runtime-updated") {
        payload.delta = {
          runtime: state2.runtime,
          projects: state2.projects.map((project) => ({
            key: project.key,
            lane: project.lane,
            status: project.healthStrip?.status || "ok",
            risk: project.healthStrip?.risk || "low"
          }))
        };
      } else if (change?.type === "replay") {
        payload.board = buildBoardPayload2(state2, now);
      }
      return payload;
    }
    module2.exports = {
      buildAdminStatusPayload: buildAdminStatusPayload2,
      buildBoardPayload: buildBoardPayload2,
      buildFiltersPayload: buildFiltersPayload2,
      buildHealthPayload: buildHealthPayload2,
      buildMissionControlEventPayload: buildMissionControlEventPayload2,
      buildSyncPayload: buildSyncPayload2,
      getLagSummary,
      normalizeMissionControlState
    };
  }
});

// src/mission-control/models.js
var require_models = __commonJS({
  "src/mission-control/models.js"(exports2, module2) {
    var os = require("os");
    var path2 = require("path");
    var HOME = os.homedir();
    var MISSION_CONTROL_SCHEMA_VERSION = 1;
    var VALID_LANES = /* @__PURE__ */ new Set(["lane:jon", "lane:mia", "lane:pepper"]);
    var VALID_RISKS = /* @__PURE__ */ new Set(["risk:low", "risk:high"]);
    var VALID_DISPATCH_STATES = /* @__PURE__ */ new Set(["dispatch:ready", "dispatch:blocked"]);
    var VALID_CARD_STATUSES = /* @__PURE__ */ new Set([
      "new",
      "ready",
      "in_progress",
      "blocked",
      "awaiting_review",
      "completed",
      "cancelled",
      "stale"
    ]);
    var VALID_DEPENDENCY_KINDS = /* @__PURE__ */ new Set(["master-card", "linear-issue", "human-review", "external"]);
    var VALID_DEPENDENCY_STATUSES = /* @__PURE__ */ new Set(["open", "resolved"]);
    var HUMAN_REVIEW_LABELS = /* @__PURE__ */ new Set([
      "human-review",
      "human_review",
      "human review",
      "awaiting-review",
      "awaiting_review",
      "awaiting review",
      "needs-review",
      "needs_review",
      "needs review",
      "blocked-on-human-review",
      "blocked_on_human_review",
      "blocked on human review"
    ]);
    function toIsoTimestamp(value = /* @__PURE__ */ new Date()) {
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (typeof value === "number") {
        return new Date(value).toISOString();
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      }
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    function cleanString(value) {
      if (value === null || value === void 0) {
        return "";
      }
      return String(value).trim();
    }
    function cleanNullableString(value) {
      const cleaned = cleanString(value);
      return cleaned || null;
    }
    function uniqueSortedStrings(values) {
      return [...new Set((values || []).map(cleanString).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right)
      );
    }
    function normalizeLane(value, fallback = null) {
      const candidate = cleanString(value);
      if (VALID_LANES.has(candidate)) {
        return candidate;
      }
      if (fallback !== null) {
        return normalizeLane(fallback, null);
      }
      return null;
    }
    function normalizeRisk(value, fallback = "risk:low") {
      const candidate = cleanString(value);
      if (VALID_RISKS.has(candidate)) {
        return candidate;
      }
      return fallback;
    }
    function normalizeDispatch(value, fallback = null) {
      const candidate = cleanString(value);
      if (!candidate) {
        return fallback;
      }
      if (VALID_DISPATCH_STATES.has(candidate)) {
        return candidate;
      }
      return fallback;
    }
    function normalizeCardStatus(value, fallback = "new") {
      const candidate = cleanString(value);
      if (VALID_CARD_STATUSES.has(candidate)) {
        return candidate;
      }
      return fallback;
    }
    function normalizeDependency(dependency) {
      const kind = VALID_DEPENDENCY_KINDS.has(cleanString(dependency?.kind)) ? cleanString(dependency.kind) : "external";
      const status = VALID_DEPENDENCY_STATUSES.has(cleanString(dependency?.status)) ? cleanString(dependency.status) : "open";
      return {
        kind,
        id: cleanString(dependency?.id),
        label: cleanString(dependency?.label),
        status,
        blocking: dependency?.blocking !== false
      };
    }
    function normalizeSculptedObject(source, fallback = {}) {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        return fallback;
      }
      return source;
    }
    function getLabelNames(labelSource) {
      if (!labelSource) {
        return [];
      }
      const labels = Array.isArray(labelSource) ? labelSource : Array.isArray(labelSource.nodes) ? labelSource.nodes : [];
      return uniqueSortedStrings(
        labels.map((label) => {
          if (typeof label === "string") {
            return label;
          }
          return label?.name || label?.label || "";
        })
      );
    }
    function summarizeDescription(description) {
      const text = cleanString(description).replace(/\s+/g, " ");
      if (!text) {
        return "";
      }
      return text.length > 180 ? `${text.slice(0, 177)}...` : text;
    }
    function extractLaneFromLabels(labelNames, fallback = null) {
      return normalizeLane(
        labelNames.find((label) => label.startsWith("lane:")),
        fallback
      );
    }
    function extractRiskFromLabels(labelNames, fallback = "risk:low") {
      return normalizeRisk(
        labelNames.find((label) => label.startsWith("risk:")),
        fallback
      );
    }
    function extractDispatchFromLabels(labelNames, fallback = null) {
      return normalizeDispatch(
        labelNames.find((label) => label.startsWith("dispatch:")),
        fallback
      );
    }
    function normalizeProjectRegistryEntry(project, options = {}) {
      const now = toIsoTimestamp(options.now);
      const key = cleanString(project?.key);
      const label = cleanString(project?.label) || key;
      const repoPath = cleanString(
        project?.repoPath || project?.path || (key === "mission-control" ? process.cwd() : "")
      );
      const linearProjectSlug = cleanString(project?.linearProjectSlug || project?.linearSlug);
      const lane = normalizeLane(project?.lane);
      if (!key) {
        throw new Error("Mission Control project registry entry is missing key");
      }
      if (!repoPath) {
        throw new Error(`Mission Control project '${key}' is missing repoPath`);
      }
      if (!linearProjectSlug) {
        throw new Error(`Mission Control project '${key}' is missing linearProjectSlug`);
      }
      if (!lane) {
        throw new Error(`Mission Control project '${key}' is missing a valid lane`);
      }
      let symphonyPort = null;
      if (project?.symphonyPort !== null && project?.symphonyPort !== void 0 && project?.symphonyPort !== "") {
        const parsed = Number.parseInt(String(project.symphonyPort), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`Mission Control project '${key}' has invalid symphonyPort`);
        }
        symphonyPort = parsed;
      }
      const symphonyProtocol = cleanString(project?.symphonyProtocol || project?.protocol) || "http";
      const symphonyHost = cleanString(project?.symphonyHost || project?.host) || "127.0.0.1";
      const symphonyHealthPath = cleanString(project?.symphonyHealthPath || project?.healthPath) || "/health";
      const normalizedHealthPath = symphonyHealthPath.startsWith("/") ? symphonyHealthPath : `/${symphonyHealthPath}`;
      const symphony = symphonyPort ? {
        protocol: symphonyProtocol,
        host: symphonyHost,
        healthPath: normalizedHealthPath,
        url: `${symphonyProtocol}://${symphonyHost}:${symphonyPort}${normalizedHealthPath}`
      } : null;
      return {
        key,
        label,
        repoPath: path2.normalize(
          repoPath.replace(/^~/, HOME).replace(/\$HOME/g, HOME).replace(/\$\{HOME\}/g, HOME)
        ),
        linearProjectSlug,
        lane,
        symphonyPort,
        symphony,
        createdAt: toIsoTimestamp(project?.createdAt || now),
        updatedAt: toIsoTimestamp(project?.updatedAt || now)
      };
    }
    function normalizeAgentIdentity(agent, options = {}) {
      const now = toIsoTimestamp(options.now);
      const key = cleanString(agent?.key);
      if (!key) {
        throw new Error("Mission Control agent identity is missing key");
      }
      const defaultLane = normalizeLane(agent?.defaultLane, null);
      if (!defaultLane) {
        throw new Error(`Mission Control agent '${key}' is missing a valid defaultLane`);
      }
      return {
        key,
        displayName: cleanString(agent?.displayName) || key,
        defaultLane,
        defaultNotificationProfile: cleanNullableString(agent?.defaultNotificationProfile),
        avatar: cleanNullableString(agent?.avatar),
        heartbeatSources: uniqueSortedStrings(agent?.heartbeatSources || []),
        createdAt: toIsoTimestamp(agent?.createdAt || now),
        updatedAt: toIsoTimestamp(agent?.updatedAt || now)
      };
    }
    function normalizeDiscordDestination(destination) {
      const key = cleanString(destination?.key);
      if (!key) {
        throw new Error("Mission Control Discord destination is missing key");
      }
      return {
        key,
        channelLabel: cleanString(destination?.channelLabel),
        webhookUrl: cleanNullableString(destination?.webhookUrl),
        allowedSenderIdentities: uniqueSortedStrings(destination?.allowedSenderIdentities || [])
      };
    }
    function normalizeOutcomeLink(link) {
      const url = cleanNullableString(link?.url);
      if (!url) {
        return null;
      }
      return {
        kind: cleanString(link?.kind) || "external",
        label: cleanString(link?.label) || url,
        url,
        projectKey: cleanNullableString(link?.projectKey),
        projectSlug: cleanNullableString(link?.projectSlug),
        issueId: cleanNullableString(link?.issueId),
        identifier: cleanNullableString(link?.identifier)
      };
    }
    function normalizeMissionOutcome(outcome, options = {}) {
      const now = toIsoTimestamp(options.now);
      const key = cleanString(outcome?.key || outcome?.id);
      if (!key) {
        throw new Error("Mission Control outcome is missing key");
      }
      const title = cleanString(outcome?.title);
      if (!title) {
        throw new Error(`Mission Control outcome '${key}' is missing title`);
      }
      const lane = normalizeLane(outcome?.lane, null);
      const missionKey = cleanNullableString(outcome?.missionKey) || key;
      const linkedLinearIdentifiers = uniqueSortedStrings(outcome?.linkedLinearIdentifiers || []);
      const linkedLinearIssueIds = uniqueSortedStrings(outcome?.linkedLinearIssueIds || []);
      if (linkedLinearIdentifiers.length === 0 && linkedLinearIssueIds.length === 0) {
        throw new Error(
          `Mission Control outcome '${key}' must declare linkedLinearIdentifiers or linkedLinearIssueIds`
        );
      }
      return {
        key,
        missionKey,
        title,
        summary: summarizeDescription(outcome?.summary || outcome?.description || ""),
        lane,
        responsibleAgents: uniqueSortedStrings(
          outcome?.responsibleAgents || deriveResponsibleAgents(lane)
        ),
        linkedLinearIdentifiers,
        linkedLinearIssueIds,
        linkedLinearProjectSlugs: uniqueSortedStrings(outcome?.linkedLinearProjectSlugs || []),
        linkedProjectKeys: uniqueSortedStrings(outcome?.linkedProjectKeys || []),
        notificationPolicy: {
          enabled: outcome?.notificationPolicy?.enabled !== false,
          destinationKey: cleanNullableString(outcome?.notificationPolicy?.destinationKey),
          senderIdentity: cleanNullableString(outcome?.notificationPolicy?.senderIdentity)
        },
        links: (outcome?.links || []).map(normalizeOutcomeLink).filter(Boolean),
        createdAt: toIsoTimestamp(outcome?.createdAt || now),
        updatedAt: toIsoTimestamp(outcome?.updatedAt || now)
      };
    }
    function deriveResponsibleAgents(lane) {
      switch (lane) {
        case "lane:jon":
          return ["jon"];
        case "lane:mia":
          return ["mia"];
        case "lane:pepper":
          return ["pepper"];
        default:
          return [];
      }
    }
    function normalizeLinearIssueLifecycle(issueOrState) {
      const rawValue = cleanString(issueOrState).toLowerCase();
      if (["done", "completed", "canceled", "cancelled", "in_progress", "started", "new"].includes(
        rawValue
      )) {
        if (["done", "completed"].includes(rawValue)) {
          return "done";
        }
        if (["canceled", "cancelled"].includes(rawValue)) {
          return "canceled";
        }
        if (["in_progress", "started"].includes(rawValue)) {
          return "in_progress";
        }
        return "new";
      }
      const state2 = normalizeSculptedObject(issueOrState?.state ? issueOrState.state : issueOrState);
      const stateType = cleanString(state2?.type || issueOrState?.stateType).toLowerCase();
      const stateName = cleanString(
        state2?.name || issueOrState?.stateName || issueOrState?.status
      ).toLowerCase();
      if (["canceled", "cancelled"].includes(stateType) || /cancel/.test(stateName)) {
        return "canceled";
      }
      if (["completed", "done"].includes(stateType) || /(done|complete|closed)/.test(stateName)) {
        return "done";
      }
      if (["started", "in_progress"].includes(stateType) || /(progress|active|review|doing)/.test(stateName)) {
        return "in_progress";
      }
      return "new";
    }
    function deriveReviewSignals(input = {}) {
      const labelNames = new Set(
        uniqueSortedStrings(input.labelNames || []).map((label) => label.toLowerCase())
      );
      const stateType = cleanString(input.stateType).toLowerCase();
      const stateName = cleanString(input.stateName || input.status).toLowerCase();
      const explicitRequired = input.humanReviewRequired === true;
      const labelTriggered = [...labelNames].some((label) => HUMAN_REVIEW_LABELS.has(label));
      const awaitingReview = stateType === "review" || /(^|\b)(awaiting|needs|pending|in) review(\b|$)/.test(stateName) || /(^|\b)human review(\b|$)/.test(stateName);
      const blockedOnHumanReview = /blocked/.test(stateName) && /review/.test(stateName) || labelNames.has("blocked-on-human-review") || labelNames.has("blocked_on_human_review") || labelNames.has("blocked on human review");
      const active = explicitRequired || labelTriggered || awaitingReview || blockedOnHumanReview;
      return {
        active,
        awaitingReview,
        blockedOnHumanReview
      };
    }
    function deriveHumanReviewState(input = {}) {
      const labelNames = new Set(uniqueSortedStrings(input.labelNames || []));
      const reasons = [];
      const reviewSignals = deriveReviewSignals(input);
      if (reviewSignals.blockedOnHumanReview) {
        reasons.push("blocked-on-human-review");
      } else if (reviewSignals.awaitingReview) {
        reasons.push("awaiting-review");
      }
      if (normalizeRisk(input.risk) === "risk:high") {
        reasons.push("risk:high");
      }
      if (input.externalFacing || labelNames.has("external-facing")) {
        reasons.push("external-facing");
      }
      if (input.irreversible || labelNames.has("irreversible")) {
        reasons.push("irreversible");
      }
      if (input.lowConfidence || labelNames.has("low-confidence")) {
        reasons.push("low-confidence");
      }
      return {
        humanReviewRequired: reviewSignals.active || reasons.length > 0,
        reviewReason: reviewSignals.active || reasons.length > 0 ? reasons.join(", ") || "human-review" : null,
        awaitingReview: reviewSignals.awaitingReview,
        blockedOnHumanReview: reviewSignals.blockedOnHumanReview
      };
    }
    function deriveCardStatus(input = {}) {
      const issueLifecycles = (input.issueLifecycles || []).map(normalizeLinearIssueLifecycle);
      const hasIssues = issueLifecycles.length > 0;
      const hasDone = issueLifecycles.includes("done");
      const allCanceled = hasIssues && issueLifecycles.every((lifecycle) => lifecycle === "canceled");
      const allTerminal = hasIssues && issueLifecycles.every((lifecycle) => lifecycle === "done" || lifecycle === "canceled");
      const hasBlockingDependency = (input.dependencies || []).some(
        (dependency) => dependency.blocking && dependency.status === "open"
      );
      if (allCanceled) {
        return "cancelled";
      }
      if (allTerminal && hasDone) {
        return "completed";
      }
      if (input.humanReviewRequired) {
        return "awaiting_review";
      }
      if (hasBlockingDependency || input.dispatch === "dispatch:blocked") {
        return "blocked";
      }
      if (issueLifecycles.includes("in_progress")) {
        return "in_progress";
      }
      if (input.dispatch === "dispatch:ready") {
        return "ready";
      }
      return "new";
    }
    function normalizeLatestProof(proof) {
      if (!proof) {
        return null;
      }
      return {
        type: cleanString(proof.type),
        summary: cleanString(proof.summary),
        url: cleanNullableString(proof.url),
        actor: cleanNullableString(proof.actor),
        source: cleanNullableString(proof.source),
        capturedAt: toIsoTimestamp(proof.capturedAt)
      };
    }
    function normalizeLatestUpdate(update) {
      if (!update) {
        return null;
      }
      return {
        summary: cleanString(update.summary),
        actor: cleanNullableString(update.actor),
        source: cleanNullableString(update.source),
        capturedAt: toIsoTimestamp(update.capturedAt)
      };
    }
    function normalizeSymphonyTarget(target) {
      if (!target || typeof target !== "object") {
        return null;
      }
      const projectKey = cleanString(target.projectKey);
      if (!projectKey) {
        return null;
      }
      const port = target.port === null || target.port === void 0 ? null : Number.parseInt(String(target.port), 10);
      return {
        projectKey,
        port: Number.isInteger(port) && port > 0 ? port : null,
        probeState: cleanString(target.probeState) || "unknown"
      };
    }
    function normalizeMasterCard(card, options = {}) {
      const now = toIsoTimestamp(options.now);
      const lane = normalizeLane(card?.lane, null);
      const risk = normalizeRisk(card?.risk);
      const dispatch = normalizeDispatch(card?.dispatch, null);
      const dependencies = (card?.dependencies || []).map(normalizeDependency);
      const humanReviewState = deriveHumanReviewState({
        risk,
        labelNames: card?.source?.labelNames || [],
        externalFacing: card?.humanReviewRequired && cleanString(card?.reviewReason).includes("external-facing"),
        irreversible: card?.humanReviewRequired && cleanString(card?.reviewReason).includes("irreversible"),
        lowConfidence: card?.humanReviewRequired && cleanString(card?.reviewReason).includes("low-confidence")
      });
      const humanReviewRequired = card?.humanReviewRequired ?? humanReviewState.humanReviewRequired;
      const status = normalizeCardStatus(
        card?.status,
        deriveCardStatus({
          issueLifecycles: card?.source?.issueLifecycles || [],
          humanReviewRequired,
          dependencies,
          dispatch
        })
      );
      return {
        id: cleanString(card?.id),
        cardType: cleanString(card?.cardType) || "linear",
        outcomeId: cleanNullableString(card?.outcomeId),
        missionKey: cleanNullableString(card?.missionKey),
        title: cleanString(card?.title),
        summary: cleanString(card?.summary),
        lane,
        responsibleAgents: uniqueSortedStrings(
          card?.responsibleAgents || deriveResponsibleAgents(lane)
        ),
        status,
        risk,
        dispatch,
        originProjects: uniqueSortedStrings(card?.originProjects || []),
        repoTargets: uniqueSortedStrings(card?.repoTargets || []),
        symphonyTargets: (card?.symphonyTargets || []).map(normalizeSymphonyTarget).filter(Boolean).sort((left, right) => left.projectKey.localeCompare(right.projectKey)),
        primaryLinearIssueId: cleanString(card?.primaryLinearIssueId),
        primaryLinearIdentifier: cleanNullableString(card?.primaryLinearIdentifier),
        linkedLinearIssueIds: uniqueSortedStrings(card?.linkedLinearIssueIds || []),
        linkedLinearIdentifiers: uniqueSortedStrings(card?.linkedLinearIdentifiers || []),
        linkedLinearProjectSlugs: uniqueSortedStrings(card?.linkedLinearProjectSlugs || []),
        dependencies,
        latestProof: normalizeLatestProof(card?.latestProof),
        latestUpdate: normalizeLatestUpdate(card?.latestUpdate),
        humanReviewRequired,
        reviewReason: cleanNullableString(card?.reviewReason || humanReviewState.reviewReason),
        alertState: uniqueSortedStrings(card?.alertState || []),
        polling: {
          enabled: Boolean(card?.polling?.enabled),
          intervalMs: card?.polling?.intervalMs === null || card?.polling?.intervalMs === void 0 ? null : Number.parseInt(String(card.polling.intervalMs), 10),
          lastSyncAt: cleanNullableString(card?.polling?.lastSyncAt),
          lastErrorAt: cleanNullableString(card?.polling?.lastErrorAt),
          errorCount: Number.parseInt(String(card?.polling?.errorCount || 0), 10) || 0
        },
        notificationPolicy: {
          enabled: Boolean(card?.notificationPolicy?.enabled),
          destinationKey: cleanNullableString(card?.notificationPolicy?.destinationKey),
          senderIdentity: cleanNullableString(card?.notificationPolicy?.senderIdentity)
        },
        source: {
          type: cleanNullableString(card?.source?.type),
          projectKey: cleanNullableString(card?.source?.projectKey),
          labelNames: uniqueSortedStrings(card?.source?.labelNames || []),
          issueLifecycles: (card?.source?.issueLifecycles || []).map(normalizeLinearIssueLifecycle),
          lastSyncedAt: cleanNullableString(card?.source?.lastSyncedAt),
          linearIssueUpdatedAt: cleanNullableString(card?.source?.linearIssueUpdatedAt)
        },
        createdAt: toIsoTimestamp(card?.createdAt || now),
        updatedAt: toIsoTimestamp(card?.updatedAt || now),
        completedAt: card?.completedAt ? toIsoTimestamp(card.completedAt) : null,
        archivedAt: card?.archivedAt ? toIsoTimestamp(card.archivedAt) : null
      };
    }
    function createMasterCardFromLinearIssue(input, options = {}) {
      const issue = normalizeSculptedObject(input?.issue || {});
      const project = input?.project || null;
      const now = toIsoTimestamp(options.now);
      const labelNames = getLabelNames(issue.labels || issue.labelNames);
      const lane = extractLaneFromLabels(labelNames, project?.lane || null);
      const risk = extractRiskFromLabels(labelNames, "risk:low");
      const dispatch = extractDispatchFromLabels(labelNames, null);
      const dependencies = (issue.dependencies || []).map(normalizeDependency);
      const issueLifecycle = normalizeLinearIssueLifecycle(issue);
      const reviewState = deriveHumanReviewState({
        risk,
        labelNames,
        externalFacing: issue.externalFacing,
        irreversible: issue.irreversible,
        lowConfidence: issue.lowConfidence
      });
      const status = deriveCardStatus({
        issueLifecycles: [issueLifecycle],
        humanReviewRequired: reviewState.humanReviewRequired,
        dependencies,
        dispatch
      });
      const primaryLinearIssueId = cleanString(issue.id);
      const primaryLinearIdentifier = cleanNullableString(issue.identifier);
      const originProjectKey = cleanNullableString(project?.key);
      const linkedIssueIds = uniqueSortedStrings(
        [primaryLinearIssueId].concat(issue.linkedIssueIds || []).filter(Boolean)
      );
      const linkedIssueIdentifiers = uniqueSortedStrings(
        [primaryLinearIdentifier].concat(issue.linkedIssueIdentifiers || []).filter(Boolean)
      );
      const linkedLinearProjectSlugs = uniqueSortedStrings(
        [project?.linearProjectSlug, issue.project?.slug, issue.projectSlug].filter(Boolean)
      );
      const repoTargets = uniqueSortedStrings([project?.repoPath].filter(Boolean));
      const symphonyTargets = project?.symphonyPort ? [
        {
          projectKey: project.key,
          port: project.symphonyPort,
          probeState: "unknown"
        }
      ] : [];
      return normalizeMasterCard(
        {
          id: `mc:${primaryLinearIssueId || cleanString(issue.identifier || issue.title || now)}`,
          missionKey: null,
          title: cleanString(issue.title) || primaryLinearIdentifier || primaryLinearIssueId,
          summary: summarizeDescription(issue.description),
          lane,
          responsibleAgents: deriveResponsibleAgents(lane),
          status,
          risk,
          dispatch,
          originProjects: uniqueSortedStrings([originProjectKey].filter(Boolean)),
          repoTargets,
          symphonyTargets,
          primaryLinearIssueId,
          primaryLinearIdentifier,
          linkedLinearIssueIds: linkedIssueIds,
          linkedLinearIdentifiers: linkedIssueIdentifiers,
          linkedLinearProjectSlugs,
          dependencies,
          latestProof: null,
          latestUpdate: null,
          humanReviewRequired: reviewState.humanReviewRequired,
          reviewReason: reviewState.reviewReason,
          alertState: [],
          polling: {
            enabled: false,
            intervalMs: null,
            lastSyncAt: null,
            lastErrorAt: null,
            errorCount: 0
          },
          notificationPolicy: {
            enabled: false,
            destinationKey: null,
            senderIdentity: null
          },
          source: {
            type: "linear",
            projectKey: originProjectKey,
            labelNames,
            issueLifecycles: [issueLifecycle],
            lastSyncedAt: now,
            linearIssueUpdatedAt: cleanNullableString(issue.updatedAt)
          },
          createdAt: now,
          updatedAt: now,
          completedAt: issue.completedAt ? toIsoTimestamp(issue.completedAt) : status === "completed" ? now : null,
          archivedAt: issue.archivedAt ? toIsoTimestamp(issue.archivedAt) : null
        },
        { now }
      );
    }
    module2.exports = {
      MISSION_CONTROL_SCHEMA_VERSION,
      VALID_CARD_STATUSES,
      VALID_DISPATCH_STATES,
      VALID_LANES,
      VALID_RISKS,
      createMasterCardFromLinearIssue,
      deriveCardStatus,
      deriveHumanReviewState,
      deriveReviewSignals,
      getLabelNames,
      normalizeAgentIdentity,
      normalizeCardStatus,
      normalizeDependency,
      normalizeDispatch,
      normalizeMissionOutcome,
      normalizeLane,
      normalizeLinearIssueLifecycle,
      normalizeDiscordDestination,
      normalizeMasterCard,
      normalizeOutcomeLink,
      normalizeProjectRegistryEntry,
      normalizeRisk,
      toIsoTimestamp,
      uniqueSortedStrings
    };
  }
});

// src/mission-control/registry.js
var require_registry = __commonJS({
  "src/mission-control/registry.js"(exports2, module2) {
    var os = require("os");
    var DEFAULT_PROJECT_REGISTRY = Object.freeze([
      {
        key: "littlebrief",
        repoPath: "~/dev/arcqdev/littlebrief",
        linearProjectSlug: "0c92ed8e2c84",
        lane: "lane:jon",
        symphonyPort: 45123
      },
      {
        key: "lobster-list",
        repoPath: "~/dev/arcqdev/lobster-list",
        linearProjectSlug: "b4deb8dc42ef",
        lane: "lane:jon",
        symphonyPort: 45124
      },
      {
        key: "usecase4claw-execution",
        repoPath: "~/dev/arcqdev/usecase4claw",
        linearProjectSlug: "3237d374634d",
        lane: "lane:jon",
        symphonyPort: 45125
      },
      {
        key: "usecase4claw-growth",
        repoPath: "~/dev/arcqdev/usecase4claw",
        linearProjectSlug: "fce22723ee3a",
        lane: "lane:mia",
        symphonyPort: null
      }
    ]);
    var {
      MISSION_CONTROL_SCHEMA_VERSION,
      normalizeAgentIdentity,
      normalizeDiscordDestination,
      normalizeMissionOutcome,
      normalizeProjectRegistryEntry,
      toIsoTimestamp
    } = require_models();
    var DEFAULT_AGENT_IDENTITIES = Object.freeze([
      {
        key: "jon",
        displayName: "Jon",
        defaultLane: "lane:jon",
        defaultNotificationProfile: "jon",
        heartbeatSources: ["symphony"]
      },
      {
        key: "mia",
        displayName: "Mia",
        defaultLane: "lane:mia",
        defaultNotificationProfile: "mia",
        heartbeatSources: ["proof"]
      },
      {
        key: "pepper",
        displayName: "Pepper",
        defaultLane: "lane:pepper",
        defaultNotificationProfile: "pepper",
        heartbeatSources: ["dispatch"]
      }
    ]);
    function sortByKey(items) {
      return [...items].sort((left, right) => left.key.localeCompare(right.key));
    }
    function ensureUnique(items, fieldName, collectionName) {
      const seen = /* @__PURE__ */ new Set();
      for (const item of items) {
        const value = item[fieldName];
        if (seen.has(value)) {
          throw new Error(`Mission Control ${collectionName} has duplicate ${fieldName}: ${value}`);
        }
        seen.add(value);
      }
    }
    function loadMissionControlRegistry(config = {}, options = {}) {
      const now = toIsoTimestamp(options.now);
      const missionControlConfig = config.missionControl || {};
      const rawProjects = missionControlConfig.projects?.length || missionControlConfig.projectRegistry?.length ? missionControlConfig.projects || missionControlConfig.projectRegistry : DEFAULT_PROJECT_REGISTRY;
      const rawAgents = missionControlConfig.agents && missionControlConfig.agents.length > 0 ? missionControlConfig.agents : DEFAULT_AGENT_IDENTITIES;
      const rawDiscordDestinations = missionControlConfig.discordDestinations || [];
      const rawOutcomes = missionControlConfig.outcomes || missionControlConfig.missions || [];
      const projects = sortByKey(
        rawProjects.map((project) => normalizeProjectRegistryEntry(project, { now }))
      );
      const agents = sortByKey(rawAgents.map((agent) => normalizeAgentIdentity(agent, { now })));
      const discordDestinations = sortByKey(
        rawDiscordDestinations.map((destination) => normalizeDiscordDestination(destination))
      );
      const outcomes = sortByKey(
        rawOutcomes.map((outcome) => normalizeMissionOutcome(outcome, { now }))
      );
      ensureUnique(projects, "key", "project registry");
      ensureUnique(projects, "linearProjectSlug", "project registry");
      ensureUnique(agents, "key", "agent registry");
      ensureUnique(discordDestinations, "key", "Discord destinations");
      ensureUnique(outcomes, "key", "outcomes");
      ensureUnique(outcomes, "missionKey", "outcomes");
      return {
        schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
        projectCount: projects.length,
        outcomeCount: outcomes.length,
        createdAt: now,
        updatedAt: now,
        host: os.hostname(),
        projects,
        agents,
        discordDestinations,
        outcomes
      };
    }
    function buildProjectRegistryIndexes(registry) {
      const projectByKey = /* @__PURE__ */ new Map();
      const projectByLinearSlug = /* @__PURE__ */ new Map();
      for (const project of registry.projects || []) {
        projectByKey.set(project.key, project);
        projectByLinearSlug.set(project.linearProjectSlug, project);
      }
      return { projectByKey, projectByLinearSlug };
    }
    module2.exports = {
      DEFAULT_AGENT_IDENTITIES,
      DEFAULT_PROJECT_REGISTRY,
      buildProjectRegistryIndexes,
      loadMissionControlRegistry
    };
  }
});

// src/mission-control/linear/client.js
var require_client = __commonJS({
  "src/mission-control/linear/client.js"(exports2, module2) {
    var https = require("https");
    var LINEAR_HOSTNAME = "api.linear.app";
    var LINEAR_PATHNAME = "/graphql";
    var DEFAULT_PAGE_SIZE = 50;
    function normalizeIssue(issue) {
      if (!issue) return null;
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title || "Untitled",
        description: issue.description || "",
        url: issue.url || null,
        priority: issue.priority ?? null,
        estimate: issue.estimate ?? null,
        createdAt: issue.createdAt || null,
        updatedAt: issue.updatedAt || null,
        startedAt: issue.startedAt || null,
        completedAt: issue.completedAt || null,
        canceledAt: issue.canceledAt || null,
        archivedAt: issue.archivedAt || null,
        state: issue.state ? {
          id: issue.state.id || null,
          name: issue.state.name || null,
          type: issue.state.type || null,
          color: issue.state.color || null
        } : null,
        project: issue.project ? {
          id: issue.project.id || null,
          name: issue.project.name || null,
          slug: issue.project.slug || null,
          progress: issue.project.progress ?? null
        } : null,
        team: issue.team ? {
          id: issue.team.id || null,
          key: issue.team.key || null,
          name: issue.team.name || null
        } : null,
        assignee: issue.assignee ? {
          id: issue.assignee.id || null,
          name: issue.assignee.name || null,
          email: issue.assignee.email || null
        } : null,
        labels: Array.isArray(issue.labels) ? issue.labels.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null
        })) : Array.isArray(issue.labels?.nodes) ? issue.labels.nodes.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null
        })) : [],
        cycle: issue.cycle ? {
          id: issue.cycle.id || null,
          number: issue.cycle.number ?? null,
          name: issue.cycle.name || null,
          startsAt: issue.cycle.startsAt || null,
          endsAt: issue.cycle.endsAt || null
        } : null
      };
    }
    function defaultTransport({ apiKey, query, variables }) {
      return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ query, variables });
        const req = https.request(
          {
            hostname: LINEAR_HOSTNAME,
            port: 443,
            path: LINEAR_PATHNAME,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: apiKey,
              "Content-Length": Buffer.byteLength(payload)
            }
          },
          (res) => {
            let responseBody = "";
            res.on("data", (chunk) => {
              responseBody += chunk;
            });
            res.on("end", () => {
              try {
                const parsed = JSON.parse(responseBody || "{}");
                if (parsed.errors?.length) {
                  reject(new Error(parsed.errors[0].message || "Linear GraphQL request failed"));
                  return;
                }
                resolve(parsed.data || {});
              } catch (error) {
                reject(new Error(`Unable to parse Linear response: ${error.message}`));
              }
            });
          }
        );
        req.on("error", reject);
        req.write(payload);
        req.end();
      });
    }
    function createLinearClient({ apiKey, transport = defaultTransport }) {
      async function request(query, variables = {}) {
        if (!apiKey) {
          throw new Error("LINEAR_API_KEY not configured");
        }
        return transport({ apiKey, query, variables });
      }
      async function fetchIssuesForProjects({ projectSlugs, updatedAfter = null }) {
        const issues = [];
        let hasNextPage = true;
        let after = null;
        while (hasNextPage) {
          const updatedAtFilter = updatedAfter ? `
          updatedAt: { gte: ${JSON.stringify(updatedAfter)} }` : "";
          const query = `
        query MissionControlProjectIssues($projectSlugs: [String!], $first: Int!, $after: String) {
          issues(
            first: $first,
            after: $after,
            orderBy: updatedAt,
            filter: {
              project: { slug: { in: $projectSlugs } }${updatedAtFilter}
            }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              identifier
              title
              description
              url
              priority
              estimate
              createdAt
              updatedAt
              startedAt
              completedAt
              canceledAt
              archivedAt
              state {
                id
                name
                type
                color
              }
              project {
                id
                name
                slug
                progress
              }
              team {
                id
                key
                name
              }
              assignee {
                id
                name
                email
              }
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
              cycle {
                id
                number
                name
                startsAt
                endsAt
              }
            }
          }
        }
      `;
          const data = await request(query, {
            projectSlugs,
            first: DEFAULT_PAGE_SIZE,
            after
          });
          const connection = data.issues || { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
          issues.push(...connection.nodes.map(normalizeIssue).filter(Boolean));
          hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
          after = connection.pageInfo?.endCursor || null;
        }
        return issues;
      }
      return {
        request,
        fetchIssuesForProjects,
        normalizeIssue
      };
    }
    module2.exports = { createLinearClient, normalizeIssue };
  }
});

// src/mission-control/store.js
var require_store = __commonJS({
  "src/mission-control/store.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var STORE_VERSION = 1;
    var EVENT_VERSION = 1;
    var REGISTRY_SNAPSHOT_FILENAME = "registry.snapshot.json";
    var CARDS_SNAPSHOT_FILENAME = "cards.snapshot.json";
    var SYNC_STATE_FILENAME = "sync-state.json";
    var EVENT_LOG_FILENAME = "card-events.jsonl";
    var RECENT_DELIVERY_LIMIT = 100;
    function isoNow(now = Date.now) {
      return new Date(now()).toISOString();
    }
    function sortObject(value) {
      if (Array.isArray(value)) {
        return value.map(sortObject);
      }
      if (!value || typeof value !== "object") {
        return value;
      }
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = sortObject(value[key]);
        return result;
      }, {});
    }
    function stableStringify(value) {
      return JSON.stringify(sortObject(value));
    }
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function syncDirectory(dirPath) {
      try {
        const fd = fs2.openSync(dirPath, "r");
        try {
          fs2.fsyncSync(fd);
        } finally {
          fs2.closeSync(fd);
        }
      } catch (_error) {
      }
    }
    function atomicWriteJson(filePath, value) {
      ensureDir(path2.dirname(filePath));
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify(sortObject(value), null, 2)}
`;
      let fd = null;
      try {
        fd = fs2.openSync(tempPath, "w");
        fs2.writeSync(fd, payload, void 0, "utf8");
        fs2.fsyncSync(fd);
      } finally {
        if (fd !== null) {
          fs2.closeSync(fd);
        }
      }
      try {
        fs2.renameSync(tempPath, filePath);
        syncDirectory(path2.dirname(filePath));
      } catch (error) {
        try {
          fs2.unlinkSync(tempPath);
        } catch (_unlinkError) {
        }
        throw error;
      }
    }
    function appendJsonl(filePath, value) {
      ensureDir(path2.dirname(filePath));
      const line = `${stableStringify(value)}
`;
      let fd = null;
      try {
        fd = fs2.openSync(filePath, "a");
        fs2.writeSync(fd, line, void 0, "utf8");
        fs2.fsyncSync(fd);
      } finally {
        if (fd !== null) {
          fs2.closeSync(fd);
        }
      }
      syncDirectory(path2.dirname(filePath));
    }
    function validateVersionedDocument(document, { filePath, kind, version }) {
      if (!document || typeof document !== "object") {
        throw new Error(`${path2.basename(filePath)} is not a valid JSON object`);
      }
      if (document.kind !== kind) {
        throw new Error(`${path2.basename(filePath)} has kind ${document.kind || "unknown"}, expected ${kind}`);
      }
      if (document.version !== version) {
        throw new Error(
          `${path2.basename(filePath)} has unsupported version ${document.version}; expected ${version}`
        );
      }
      return document;
    }
    function readJsonDocument(filePath, options) {
      if (!fs2.existsSync(filePath)) {
        return null;
      }
      const parsed = JSON.parse(fs2.readFileSync(filePath, "utf8"));
      return validateVersionedDocument(parsed, { filePath, ...options });
    }
    function readJsonlEvents(filePath) {
      if (!fs2.existsSync(filePath)) {
        return [];
      }
      return fs2.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line, index) => {
        const parsed = JSON.parse(line);
        if (parsed.version !== EVENT_VERSION) {
          throw new Error(
            `${path2.basename(filePath)} line ${index + 1} has unsupported version ${parsed.version}`
          );
        }
        return parsed;
      });
    }
    function stripPersistenceMetadata(card) {
      if (!card || typeof card !== "object") return card;
      const clone = { ...card };
      delete clone.firstSeenAt;
      delete clone.lastMaterializedAt;
      delete clone.lastSource;
      delete clone.lastDeliveryId;
      return clone;
    }
    function createInitialSyncState({ pollIntervalMs, projectSlugs, webhook }) {
      return {
        status: "idle",
        mode: "hybrid",
        pollIntervalMs,
        projectSlugs: [...projectSlugs],
        cursor: {
          updatedAfter: null
        },
        lastAttemptedAt: null,
        lastSuccessfulAt: null,
        lastWebhookAt: null,
        lastError: null,
        lastReason: null,
        lastFetchedCount: 0,
        lastChangedCount: 0,
        lagMs: null,
        webhook: {
          enabled: Boolean(webhook?.enabled),
          path: webhook?.path || null,
          lastDeliveryId: null,
          recentDeliveryIds: []
        }
      };
    }
    function mergeSyncState(current, partial) {
      return {
        ...current,
        ...partial,
        webhook: {
          ...current.webhook,
          ...partial.webhook || {}
        }
      };
    }
    function createRegistrySnapshot(registry, now) {
      return {
        kind: "mission-control.registry.snapshot",
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        registry
      };
    }
    function createCardsSnapshot(cards, eventCount, now) {
      return {
        kind: "mission-control.cards.snapshot",
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        eventCount,
        cards
      };
    }
    function createSyncStateSnapshot(sync, now) {
      return {
        kind: "mission-control.sync-state",
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        sync
      };
    }
    function createEvent(kind, payload, now, timestamp) {
      return {
        kind,
        version: EVENT_VERSION,
        timestamp: timestamp || isoNow(now),
        payload
      };
    }
    function replayEventLog({ events, registry, syncDefaults }) {
      const state2 = {
        registry,
        cards: {},
        eventCount: 0,
        sync: createInitialSyncState(syncDefaults)
      };
      for (const event of events) {
        switch (event.kind) {
          case "mission-control.registry.persisted":
            state2.registry = event.payload.registry;
            break;
          case "mission-control.card-upserted":
            state2.cards[event.payload.card.id] = event.payload.card;
            state2.eventCount += 1;
            break;
          case "mission-control.sync-updated":
            state2.sync = mergeSyncState(state2.sync, event.payload.sync);
            break;
          case "mission-control.webhook-delivery":
            state2.sync.lastWebhookAt = event.payload.receivedAt;
            state2.sync.webhook.lastDeliveryId = event.payload.deliveryId || null;
            state2.sync.webhook.recentDeliveryIds = Array.isArray(event.payload.recentDeliveryIds) ? event.payload.recentDeliveryIds : state2.sync.webhook.recentDeliveryIds;
            break;
          default:
            throw new Error(`Unsupported Mission Control event kind: ${event.kind}`);
        }
      }
      return state2;
    }
    function createMissionControlStore({
      dataDir,
      registry,
      syncDefaults,
      now = Date.now,
      onChange = () => {
      }
    }) {
      const storeDir = path2.join(dataDir, "mission-control");
      const registrySnapshotPath = path2.join(storeDir, REGISTRY_SNAPSHOT_FILENAME);
      const cardsSnapshotPath = path2.join(storeDir, CARDS_SNAPSHOT_FILENAME);
      const syncStatePath = path2.join(storeDir, SYNC_STATE_FILENAME);
      const eventLogPath = path2.join(storeDir, EVENT_LOG_FILENAME);
      ensureDir(storeDir);
      let state2 = {
        registry,
        cards: {},
        eventCount: 0,
        sync: createInitialSyncState(syncDefaults)
      };
      const initializationWarnings = [];
      let loadedRegistrySnapshot = null;
      let cardsSnapshot = null;
      let syncStateSnapshot = null;
      try {
        loadedRegistrySnapshot = readJsonDocument(registrySnapshotPath, {
          kind: "mission-control.registry.snapshot",
          version: STORE_VERSION
        });
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      try {
        cardsSnapshot = readJsonDocument(cardsSnapshotPath, {
          kind: "mission-control.cards.snapshot",
          version: STORE_VERSION
        });
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      try {
        syncStateSnapshot = readJsonDocument(syncStatePath, {
          kind: "mission-control.sync-state",
          version: STORE_VERSION
        });
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      try {
        const events = readJsonlEvents(eventLogPath);
        if (events.length > 0) {
          state2 = replayEventLog({ events, registry, syncDefaults });
        } else {
          state2 = {
            registry,
            cards: cardsSnapshot?.cards || {},
            eventCount: Number(cardsSnapshot?.eventCount || 0),
            sync: syncStateSnapshot?.sync ? mergeSyncState(createInitialSyncState(syncDefaults), syncStateSnapshot.sync) : createInitialSyncState(syncDefaults)
          };
        }
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      if (initializationWarnings.length > 0) {
        state2.sync.status = "error";
        state2.sync.lastError = initializationWarnings.join("; ");
      }
      function computeLagMs() {
        if (!state2.sync.lastSuccessfulAt) return null;
        return Math.max(0, now() - Date.parse(state2.sync.lastSuccessfulAt));
      }
      function emitChange(change) {
        try {
          onChange({
            ...change,
            publicState: getPublicState()
          });
        } catch (_error) {
        }
      }
      function persistRegistrySnapshot({ emitEvent = false, reason = "startup" } = {}) {
        atomicWriteJson(registrySnapshotPath, createRegistrySnapshot(state2.registry, now));
        if (emitEvent) {
          appendJsonl(
            eventLogPath,
            createEvent(
              "mission-control.registry.persisted",
              {
                reason,
                registry: state2.registry
              },
              now
            )
          );
          emitChange({ type: "registry-persisted", reason });
        }
      }
      function persistCardsSnapshot() {
        atomicWriteJson(cardsSnapshotPath, createCardsSnapshot(state2.cards, state2.eventCount, now));
      }
      function persistSyncSnapshot() {
        atomicWriteJson(syncStatePath, createSyncStateSnapshot(state2.sync, now));
      }
      function bootstrap() {
        const registryHasChanged = !loadedRegistrySnapshot || stableStringify(loadedRegistrySnapshot.registry) !== stableStringify(state2.registry);
        const eventLogMissing = !fs2.existsSync(eventLogPath);
        persistRegistrySnapshot({ emitEvent: registryHasChanged || eventLogMissing, reason: "startup" });
        persistCardsSnapshot();
        persistSyncSnapshot();
        return getPublicState();
      }
      function notePersistenceError(message) {
        state2.sync.lastError = message;
        state2.sync.status = state2.sync.status === "disabled" ? "disabled" : "error";
      }
      function hasSeenWebhookDelivery(deliveryId) {
        if (!deliveryId) return false;
        return state2.sync.webhook.recentDeliveryIds.includes(deliveryId);
      }
      function noteWebhookDelivery({ deliveryId, receivedAt }) {
        const recentDeliveryIds = deliveryId ? [
          deliveryId,
          ...state2.sync.webhook.recentDeliveryIds.filter((existingId) => existingId !== deliveryId)
        ].slice(0, RECENT_DELIVERY_LIMIT) : state2.sync.webhook.recentDeliveryIds;
        state2.sync = mergeSyncState(state2.sync, {
          lastWebhookAt: receivedAt,
          webhook: {
            lastDeliveryId: deliveryId || null,
            recentDeliveryIds
          }
        });
        try {
          appendJsonl(
            eventLogPath,
            createEvent(
              "mission-control.webhook-delivery",
              {
                deliveryId: deliveryId || null,
                receivedAt,
                recentDeliveryIds
              },
              now,
              receivedAt
            )
          );
          persistSyncSnapshot();
        } catch (error) {
          notePersistenceError(`Failed to append Mission Control webhook event: ${error.message}`);
        }
        emitChange({ type: "webhook-delivery", deliveryId, receivedAt });
      }
      function updateSync(partial) {
        state2.sync = mergeSyncState(state2.sync, partial);
        state2.sync.lagMs = computeLagMs();
        try {
          appendJsonl(
            eventLogPath,
            createEvent(
              "mission-control.sync-updated",
              {
                sync: partial
              },
              now,
              partial.lastSuccessfulAt || partial.lastAttemptedAt || partial.lastWebhookAt || void 0
            )
          );
          persistSyncSnapshot();
        } catch (error) {
          notePersistenceError(`Failed to persist Mission Control sync state: ${error.message}`);
        }
        emitChange({ type: "sync-updated", partial, sync: state2.sync });
      }
      function upsertCard(cardInput, context = {}) {
        const previous = state2.cards[cardInput.id] || null;
        const nextFingerprint = stableStringify(stripPersistenceMetadata(cardInput));
        const previousFingerprint = previous ? stableStringify(stripPersistenceMetadata(previous)) : null;
        if (previousFingerprint === nextFingerprint) {
          return {
            changed: false,
            action: "noop",
            card: previous
          };
        }
        const receivedAt = context.receivedAt || isoNow(now);
        const action = previous ? "updated" : "created";
        const card = {
          ...previous || {},
          ...cardInput,
          firstSeenAt: previous?.firstSeenAt || receivedAt,
          lastMaterializedAt: receivedAt,
          lastSource: context.source || "poller",
          lastDeliveryId: context.deliveryId || null
        };
        state2.cards[card.id] = card;
        state2.eventCount += 1;
        try {
          appendJsonl(
            eventLogPath,
            createEvent(
              "mission-control.card-upserted",
              {
                action,
                card,
                source: context.source || "poller",
                deliveryId: context.deliveryId || null
              },
              now,
              receivedAt
            )
          );
          persistCardsSnapshot();
        } catch (error) {
          notePersistenceError(`Failed to persist Mission Control card state: ${error.message}`);
        }
        emitChange({ type: "card-upserted", action, card, context });
        return {
          changed: true,
          action,
          card
        };
      }
      function getCards() {
        return Object.values(state2.cards).sort((left, right) => {
          const leftTime = Date.parse(left.updatedAt || left.lastMaterializedAt || 0);
          const rightTime = Date.parse(right.updatedAt || right.lastMaterializedAt || 0);
          return rightTime - leftTime;
        });
      }
      function getPublicState() {
        return {
          updatedAt: state2.sync.lastSuccessfulAt || null,
          registry: state2.registry,
          masterCards: getCards(),
          stats: {
            totalCards: getCards().length,
            eventCount: state2.eventCount
          },
          sync: {
            ...state2.sync,
            lagMs: computeLagMs()
          }
        };
      }
      function getSnapshot() {
        return {
          version: STORE_VERSION,
          registry: state2.registry,
          cards: state2.cards,
          eventCount: state2.eventCount,
          sync: state2.sync
        };
      }
      function getRegistry() {
        return state2.registry;
      }
      return {
        bootstrap,
        getPublicState,
        getRegistry,
        getSnapshot,
        hasSeenWebhookDelivery,
        noteWebhookDelivery,
        updateSync,
        upsertCard
      };
    }
    module2.exports = {
      CARDS_SNAPSHOT_FILENAME,
      EVENT_LOG_FILENAME,
      EVENT_VERSION,
      REGISTRY_SNAPSHOT_FILENAME,
      RECENT_DELIVERY_LIMIT,
      STORE_VERSION,
      SYNC_STATE_FILENAME,
      appendJsonl,
      atomicWriteJson,
      createInitialSyncState,
      createMissionControlStore,
      createRegistrySnapshot,
      createCardsSnapshot,
      createSyncStateSnapshot,
      isoNow,
      readJsonDocument,
      readJsonlEvents,
      replayEventLog,
      stableStringify,
      stripPersistenceMetadata,
      validateVersionedDocument
    };
  }
});

// src/mission-control/linear/store.js
var require_store2 = __commonJS({
  "src/mission-control/linear/store.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var {
      CARDS_SNAPSHOT_FILENAME,
      EVENT_LOG_FILENAME,
      EVENT_VERSION,
      REGISTRY_SNAPSHOT_FILENAME,
      STORE_VERSION,
      SYNC_STATE_FILENAME,
      appendJsonl,
      atomicWriteJson,
      readJsonDocument,
      readJsonlEvents,
      stableStringify
    } = require_store();
    var RECENT_DELIVERY_LIMIT = 100;
    function isoNow(now = Date.now) {
      return new Date(now()).toISOString();
    }
    function ensureDir(dirPath) {
      fs2.mkdirSync(dirPath, { recursive: true });
    }
    function normalizeCard(input) {
      return {
        source: "linear",
        id: input.id,
        identifier: input.identifier,
        title: input.title || "Untitled",
        description: input.description || "",
        url: input.url || null,
        priority: input.priority ?? null,
        estimate: input.estimate ?? null,
        createdAt: input.createdAt || null,
        updatedAt: input.updatedAt || null,
        startedAt: input.startedAt || null,
        completedAt: input.completedAt || null,
        canceledAt: input.canceledAt || null,
        archivedAt: input.archivedAt || null,
        state: input.state ? {
          id: input.state.id || null,
          name: input.state.name || null,
          type: input.state.type || null,
          color: input.state.color || null
        } : null,
        project: input.project ? {
          id: input.project.id || null,
          name: input.project.name || null,
          slug: input.project.slug || null,
          progress: input.project.progress ?? null
        } : null,
        team: input.team ? {
          id: input.team.id || null,
          key: input.team.key || null,
          name: input.team.name || null
        } : null,
        assignee: input.assignee ? {
          id: input.assignee.id || null,
          name: input.assignee.name || null,
          email: input.assignee.email || null
        } : null,
        labels: Array.isArray(input.labels) ? input.labels.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null
        })).sort((left, right) => (left.name || "").localeCompare(right.name || "")) : [],
        cycle: input.cycle ? {
          id: input.cycle.id || null,
          number: input.cycle.number ?? null,
          name: input.cycle.name || null,
          startsAt: input.cycle.startsAt || null,
          endsAt: input.cycle.endsAt || null
        } : null
      };
    }
    function createInitialSnapshot({ now, pollIntervalMs, projectSlugs, webhook, registry = null }) {
      return {
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        registry,
        cards: {},
        eventCount: 0,
        sync: {
          status: "idle",
          mode: "hybrid",
          pollIntervalMs,
          projectSlugs: [...projectSlugs],
          cursor: {
            updatedAfter: null
          },
          lastAttemptedAt: null,
          lastSuccessfulAt: null,
          lastWebhookAt: null,
          lastError: null,
          lastReason: null,
          lastFetchedCount: 0,
          lastChangedCount: 0,
          lagMs: null,
          persistence: {
            enabled: true,
            lastWriteAt: null,
            lastWriteError: null
          },
          webhook: {
            enabled: Boolean(webhook?.enabled),
            path: webhook?.path || null,
            lastDeliveryId: null,
            recentDeliveryIds: []
          }
        }
      };
    }
    function mergeSync(current, partial) {
      return {
        ...current,
        ...partial,
        persistence: {
          ...current.persistence,
          ...partial.persistence || {}
        },
        webhook: {
          ...current.webhook,
          ...partial.webhook || {}
        }
      };
    }
    function createRegistrySnapshot(registry, now) {
      return {
        kind: "mission-control.registry.snapshot",
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        registry
      };
    }
    function createCardsSnapshot(snapshot, now) {
      return {
        kind: "mission-control.cards.snapshot",
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        eventCount: snapshot.eventCount,
        cards: snapshot.cards
      };
    }
    function createSyncStateSnapshot(snapshot, now) {
      return {
        kind: "mission-control.sync-state",
        version: STORE_VERSION,
        updatedAt: isoNow(now),
        sync: snapshot.sync
      };
    }
    function applyEvent(snapshot, event) {
      snapshot.eventCount = Math.max(
        snapshot.eventCount,
        Number(event.sequence || snapshot.eventCount + 1)
      );
      switch (event.type) {
        case "mission-control.registry.bootstrapped":
          snapshot.registry = event.payload?.registry || snapshot.registry;
          break;
        case "mission-control.linear.card-upserted":
          if (event.payload?.card?.id) {
            snapshot.cards[event.payload.card.id] = event.payload.card;
          }
          break;
        case "mission-control.linear.webhook.received":
        case "mission-control.linear.webhook.duplicate":
          snapshot.sync.lastWebhookAt = event.payload?.receivedAt || event.occurredAt || null;
          snapshot.sync.webhook.lastDeliveryId = event.deliveryId || null;
          if (Array.isArray(event.payload?.recentDeliveryIds)) {
            snapshot.sync.webhook.recentDeliveryIds = event.payload.recentDeliveryIds;
          }
          break;
        default:
          if (event.payload?.sync) {
            snapshot.sync = mergeSync(snapshot.sync, event.payload.sync);
          }
          break;
      }
    }
    function createLinearSyncStore({
      dataDir,
      now = Date.now,
      pollIntervalMs,
      projectSlugs,
      webhook,
      registry = null,
      onChange = () => {
      }
    }) {
      const syncDir = path2.join(dataDir, "mission-control");
      const registrySnapshotPath = path2.join(syncDir, REGISTRY_SNAPSHOT_FILENAME);
      const cardsSnapshotPath = path2.join(syncDir, CARDS_SNAPSHOT_FILENAME);
      const syncStatePath = path2.join(syncDir, SYNC_STATE_FILENAME);
      const eventLogPath = path2.join(syncDir, EVENT_LOG_FILENAME);
      let persistenceEnabled = true;
      let snapshot = createInitialSnapshot({ now, pollIntervalMs, projectSlugs, webhook, registry });
      let loadedRegistry = null;
      const initializationWarnings = [];
      try {
        ensureDir(syncDir);
      } catch (error) {
        persistenceEnabled = false;
        snapshot.sync.lastError = `Linear snapshot persistence unavailable: ${error.message}`;
        snapshot.sync.persistence.enabled = false;
        snapshot.sync.persistence.lastWriteError = error.message;
      }
      try {
        loadedRegistry = readJsonDocument(registrySnapshotPath, {
          kind: "mission-control.registry.snapshot",
          version: STORE_VERSION
        });
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      try {
        const cardsDoc = readJsonDocument(cardsSnapshotPath, {
          kind: "mission-control.cards.snapshot",
          version: STORE_VERSION
        });
        if (cardsDoc) {
          snapshot.cards = cardsDoc.cards || {};
          snapshot.eventCount = Number(cardsDoc.eventCount || 0);
        }
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      try {
        const syncDoc = readJsonDocument(syncStatePath, {
          kind: "mission-control.sync-state",
          version: STORE_VERSION
        });
        if (syncDoc?.sync) {
          snapshot.sync = mergeSync(snapshot.sync, syncDoc.sync);
        }
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      if (!snapshot.registry && loadedRegistry?.registry) {
        snapshot.registry = loadedRegistry.registry;
      }
      try {
        const events = readJsonlEvents(eventLogPath);
        if (events.length > 0) {
          snapshot = createInitialSnapshot({
            now,
            pollIntervalMs,
            projectSlugs,
            webhook,
            registry: snapshot.registry
          });
          for (const event of events) {
            applyEvent(snapshot, event);
          }
        }
      } catch (error) {
        initializationWarnings.push(error.message);
      }
      if (initializationWarnings.length > 0) {
        snapshot.sync.status = snapshot.sync.status === "disabled" ? "disabled" : "error";
        snapshot.sync.lastError = initializationWarnings.join("; ");
        snapshot.sync.persistence.lastWriteError = initializationWarnings.join("; ");
      }
      function computeLagMs() {
        if (!snapshot.sync.lastSuccessfulAt) return null;
        return Math.max(0, now() - Date.parse(snapshot.sync.lastSuccessfulAt));
      }
      function persistSnapshots() {
        snapshot.updatedAt = isoNow(now);
        snapshot.sync.persistence.enabled = persistenceEnabled;
        if (!persistenceEnabled) {
          return;
        }
        try {
          if (snapshot.registry) {
            atomicWriteJson(registrySnapshotPath, createRegistrySnapshot(snapshot.registry, now));
          }
          atomicWriteJson(cardsSnapshotPath, createCardsSnapshot(snapshot, now));
          atomicWriteJson(syncStatePath, createSyncStateSnapshot(snapshot, now));
          snapshot.sync.persistence.lastWriteAt = isoNow(now);
          snapshot.sync.persistence.lastWriteError = null;
        } catch (error) {
          persistenceEnabled = false;
          snapshot.sync.persistence.enabled = false;
          snapshot.sync.persistence.lastWriteError = error.message;
          snapshot.sync.lastError = `Failed to persist Linear snapshot: ${error.message}`;
        }
      }
      function emitChange(change) {
        try {
          onChange({
            ...change,
            publicState: getPublicState()
          });
        } catch (_error) {
        }
      }
      function appendAuditEvent(type, payload = {}, context = {}) {
        snapshot.eventCount += 1;
        const event = {
          version: EVENT_VERSION,
          sequence: snapshot.eventCount,
          type,
          occurredAt: context.occurredAt || isoNow(now),
          source: context.source || null,
          cardId: context.cardId || null,
          issueId: context.issueId || null,
          identifier: context.identifier || null,
          deliveryId: context.deliveryId || null,
          payload
        };
        if (!persistenceEnabled) {
          return event;
        }
        try {
          appendJsonl(eventLogPath, event);
          snapshot.sync.persistence.lastWriteAt = event.occurredAt;
          snapshot.sync.persistence.lastWriteError = null;
        } catch (error) {
          persistenceEnabled = false;
          snapshot.sync.persistence.enabled = false;
          snapshot.sync.persistence.lastWriteError = error.message;
          snapshot.sync.lastError = `Failed to append Linear event log: ${error.message}`;
        }
        return event;
      }
      function readEventLog() {
        return readJsonlEvents(eventLogPath);
      }
      function bootstrap() {
        const registryChanged = snapshot.registry && stableStringify(snapshot.registry) !== stableStringify(loadedRegistry?.registry || null);
        const logMissing = !fs2.existsSync(eventLogPath);
        if (snapshot.registry && (registryChanged || logMissing)) {
          appendAuditEvent(
            "mission-control.registry.bootstrapped",
            { registry: snapshot.registry },
            { source: "startup" }
          );
        }
        persistSnapshots();
        return getPublicState();
      }
      function noteWebhookDelivery({ deliveryId, receivedAt, issue, duplicate = false }) {
        snapshot.sync.lastWebhookAt = receivedAt;
        snapshot.sync.webhook.lastDeliveryId = deliveryId || null;
        if (deliveryId) {
          snapshot.sync.webhook.recentDeliveryIds = [
            deliveryId,
            ...snapshot.sync.webhook.recentDeliveryIds.filter(
              (existingId) => existingId !== deliveryId
            )
          ].slice(0, RECENT_DELIVERY_LIMIT);
        }
        appendAuditEvent(
          duplicate ? "mission-control.linear.webhook.duplicate" : "mission-control.linear.webhook.received",
          {
            projectSlug: issue?.project?.slug || null,
            receivedAt,
            recentDeliveryIds: snapshot.sync.webhook.recentDeliveryIds
          },
          {
            occurredAt: receivedAt,
            source: "webhook",
            cardId: issue?.id ? `mc:${issue.id}` : null,
            issueId: issue?.id || null,
            identifier: issue?.identifier || null,
            deliveryId
          }
        );
        persistSnapshots();
        emitChange({ type: "webhook-delivery", deliveryId, receivedAt, duplicate });
      }
      function hasSeenWebhookDelivery(deliveryId) {
        if (!deliveryId) return false;
        return snapshot.sync.webhook.recentDeliveryIds.includes(deliveryId);
      }
      function updateSync(partial, audit = {}) {
        snapshot.sync = mergeSync(snapshot.sync, partial);
        snapshot.sync.lagMs = computeLagMs();
        if (audit.type) {
          appendAuditEvent(
            audit.type,
            {
              ...audit.payload || {},
              sync: partial
            },
            {
              occurredAt: audit.occurredAt,
              source: audit.source,
              cardId: audit.cardId,
              issueId: audit.issueId,
              identifier: audit.identifier,
              deliveryId: audit.deliveryId
            }
          );
        }
        persistSnapshots();
        emitChange({
          type: "sync-updated",
          partial,
          sync: snapshot.sync,
          source: audit.source || partial.lastReason || null,
          auditType: audit.type || null,
          occurredAt: audit.occurredAt || isoNow(now)
        });
      }
      function upsertCard(cardInput, context = {}) {
        const normalizedCard = normalizeCard(cardInput);
        const previous = snapshot.cards[normalizedCard.id] || null;
        const nextFingerprint = stableStringify(normalizedCard);
        const previousFingerprint = previous ? stableStringify(normalizeCard(previous)) : null;
        const receivedAt = context.receivedAt || isoNow(now);
        const cardId = `mc:${normalizedCard.id}`;
        if (previousFingerprint === nextFingerprint) {
          appendAuditEvent(
            "mission-control.linear.card-observed",
            {
              action: "noop",
              state: normalizedCard.state?.name || null,
              projectSlug: normalizedCard.project?.slug || null,
              updatedAt: normalizedCard.updatedAt
            },
            {
              occurredAt: receivedAt,
              source: context.source || "poller",
              cardId,
              issueId: normalizedCard.id,
              identifier: normalizedCard.identifier,
              deliveryId: context.deliveryId || null
            }
          );
          persistSnapshots();
          emitChange({
            type: "card-observed",
            source: context.source || null,
            cardId,
            issueId: normalizedCard.id
          });
          return {
            changed: false,
            action: "noop",
            card: previous
          };
        }
        const action = previous ? "updated" : "created";
        const card = {
          ...previous || {},
          ...normalizedCard,
          firstSeenAt: previous?.firstSeenAt || receivedAt,
          lastMaterializedAt: receivedAt,
          lastSource: context.source || "poller",
          lastDeliveryId: context.deliveryId || null
        };
        snapshot.cards[card.id] = card;
        appendAuditEvent(
          "mission-control.linear.card-upserted",
          {
            action,
            card
          },
          {
            occurredAt: receivedAt,
            source: context.source || "poller",
            cardId,
            issueId: card.id,
            identifier: card.identifier,
            deliveryId: context.deliveryId || null
          }
        );
        persistSnapshots();
        emitChange({
          type: "card-upserted",
          card,
          source: context.source || null,
          cardId: card.id,
          issueId: normalizedCard.id,
          action
        });
        return {
          changed: true,
          action,
          card
        };
      }
      function getTimelineForCard(reference = {}) {
        const wantedCardIds = new Set(
          [].concat(reference.cardIds || []).concat([reference.cardId, reference.issueId ? `mc:${reference.issueId}` : null]).filter(Boolean)
        );
        const wantedIssueIds = new Set(
          [].concat(reference.issueIds || []).concat([reference.issueId]).filter(Boolean)
        );
        const wantedIdentifiers = new Set(
          [].concat(reference.identifiers || []).concat([reference.identifier]).filter(Boolean)
        );
        return readEventLog().filter((event) => {
          if (event.type.startsWith("mission-control.linear.reconcile.")) {
            return true;
          }
          if (wantedCardIds.size > 0 && wantedCardIds.has(event.cardId)) {
            return true;
          }
          if (wantedIssueIds.size > 0 && wantedIssueIds.has(event.issueId)) {
            return true;
          }
          if (wantedIdentifiers.size > 0 && wantedIdentifiers.has(event.identifier)) {
            return true;
          }
          return false;
        });
      }
      function getPublicState() {
        const cards = Object.values(snapshot.cards).sort((left, right) => {
          const leftTime = Date.parse(left.updatedAt || left.lastMaterializedAt || 0);
          const rightTime = Date.parse(right.updatedAt || right.lastMaterializedAt || 0);
          return rightTime - leftTime;
        });
        return {
          registry: snapshot.registry,
          masterCards: cards,
          stats: {
            totalCards: cards.length,
            eventCount: snapshot.eventCount
          },
          sync: {
            ...snapshot.sync,
            lagMs: computeLagMs()
          }
        };
      }
      function getSnapshot() {
        return snapshot;
      }
      return {
        appendAuditEvent,
        bootstrap,
        getSnapshot,
        getPublicState,
        getTimelineForCard,
        hasSeenWebhookDelivery,
        noteWebhookDelivery,
        readEventLog,
        updateSync,
        upsertCard
      };
    }
    module2.exports = {
      atomicWriteJson,
      createLinearSyncStore,
      normalizeCard
    };
  }
});

// src/mission-control/linear/sync-engine.js
var require_sync_engine = __commonJS({
  "src/mission-control/linear/sync-engine.js"(exports2, module2) {
    var crypto = require("crypto");
    var { createLinearClient } = require_client();
    var { createLinearSyncStore } = require_store2();
    function isoNow(now = Date.now) {
      return new Date(now()).toISOString();
    }
    function maxTimestamp(left, right) {
      if (!left) return right || null;
      if (!right) return left || null;
      return Date.parse(left) >= Date.parse(right) ? left : right;
    }
    function subtractMilliseconds(timestamp, amountMs) {
      if (!timestamp) return null;
      return new Date(Date.parse(timestamp) - amountMs).toISOString();
    }
    function verifySignature(body, signature, secret) {
      if (!signature || !secret) {
        return false;
      }
      const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
      const expectedBuffer = Buffer.from(expected);
      const actualBuffer = Buffer.from(String(signature));
      if (expectedBuffer.length !== actualBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    }
    function isFreshTimestamp(timestamp, now = Date.now, maxAgeMs = 5 * 60 * 1e3) {
      if (!timestamp) return false;
      const parsed = Date.parse(timestamp);
      if (Number.isNaN(parsed)) return false;
      return Math.abs(now() - parsed) <= maxAgeMs;
    }
    function normalizeWebhookIssue(payload) {
      const issue = payload?.data || payload?.issue || payload;
      if (!issue || typeof issue !== "object") {
        return null;
      }
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title || "Untitled",
        description: issue.description || "",
        url: issue.url || null,
        priority: issue.priority ?? null,
        estimate: issue.estimate ?? null,
        createdAt: issue.createdAt || null,
        updatedAt: issue.updatedAt || payload?.webhookTimestamp || null,
        startedAt: issue.startedAt || null,
        completedAt: issue.completedAt || null,
        canceledAt: issue.canceledAt || null,
        archivedAt: issue.archivedAt || null,
        state: issue.state ? {
          id: issue.state.id || null,
          name: issue.state.name || null,
          type: issue.state.type || null,
          color: issue.state.color || null
        } : null,
        project: issue.project ? {
          id: issue.project.id || null,
          name: issue.project.name || null,
          slug: issue.project.slug || null,
          progress: issue.project.progress ?? null
        } : null,
        team: issue.team ? {
          id: issue.team.id || null,
          key: issue.team.key || null,
          name: issue.team.name || null
        } : null,
        assignee: issue.assignee ? {
          id: issue.assignee.id || null,
          name: issue.assignee.name || null,
          email: issue.assignee.email || null
        } : null,
        labels: Array.isArray(issue.labels) ? issue.labels.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null
        })) : Array.isArray(issue.labels?.nodes) ? issue.labels.nodes.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null
        })) : [],
        cycle: issue.cycle ? {
          id: issue.cycle.id || null,
          number: issue.cycle.number ?? null,
          name: issue.cycle.name || null,
          startsAt: issue.cycle.startsAt || null,
          endsAt: issue.cycle.endsAt || null
        } : null
      };
    }
    function createLinearSyncEngine(options = {}) {
      const config = {
        enabled: Boolean(options.config?.enabled || options.config?.apiKey),
        apiKey: options.config?.apiKey || null,
        projectSlugs: options.config?.projectSlugs || [],
        syncIntervalMs: options.config?.syncIntervalMs || 12e4,
        reconcileOverlapMs: options.config?.reconcileOverlapMs || 3e5,
        webhookPath: options.config?.webhookPath || "/api/integrations/linear/webhook",
        webhookSecret: options.config?.webhookSecret || null
      };
      const now = options.now || Date.now;
      const logger = options.logger || console;
      const setIntervalFn = options.setIntervalFn || setInterval;
      const clearIntervalFn = options.clearIntervalFn || clearInterval;
      const setTimeoutFn = options.setTimeoutFn || setTimeout;
      const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
      const onStateChange = options.onStateChange || (() => {
      });
      const linearClient = options.client || createLinearClient({ apiKey: config.apiKey });
      const store = createLinearSyncStore({
        dataDir: options.dataDir,
        now,
        pollIntervalMs: config.syncIntervalMs,
        projectSlugs: config.projectSlugs,
        webhook: {
          enabled: Boolean(config.webhookSecret),
          path: config.webhookPath
        },
        registry: options.registry || null,
        onChange: onStateChange
      });
      let pollHandle = null;
      let acceleratedHandle = null;
      let reconcilePromise = null;
      function isEnabled() {
        return Boolean(config.enabled && config.apiKey && config.projectSlugs.length > 0);
      }
      function getPublicState() {
        return store.getPublicState();
      }
      async function reconcile({ reason = "poll" } = {}) {
        if (!isEnabled()) {
          store.updateSync(
            {
              status: "disabled",
              lastReason: reason,
              lastError: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled"
            },
            {
              type: "mission-control.linear.reconcile.skipped",
              source: reason,
              payload: {
                reason,
                error: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled"
              }
            }
          );
          return getPublicState();
        }
        if (reconcilePromise) {
          return reconcilePromise;
        }
        reconcilePromise = (async () => {
          const attemptAt = isoNow(now);
          const priorCursor = store.getSnapshot().sync.cursor?.updatedAfter || null;
          const updatedAfter = subtractMilliseconds(priorCursor, config.reconcileOverlapMs || 0);
          store.updateSync(
            {
              status: "syncing",
              lastAttemptedAt: attemptAt,
              lastReason: reason,
              lastError: null
            },
            {
              type: "mission-control.linear.reconcile.started",
              source: reason,
              payload: {
                reason,
                updatedAfter
              },
              occurredAt: attemptAt
            }
          );
          try {
            const remoteIssues = await linearClient.fetchIssuesForProjects({
              projectSlugs: config.projectSlugs,
              updatedAfter
            });
            let changedCount = 0;
            let cursor = priorCursor;
            for (const issue of remoteIssues) {
              const result = store.upsertCard(issue, {
                source: reason === "webhook" ? "webhook-reconcile" : "poller",
                receivedAt: attemptAt
              });
              if (result.changed) {
                changedCount += 1;
              }
              cursor = maxTimestamp(cursor, issue.updatedAt);
            }
            store.updateSync(
              {
                status: "ok",
                cursor: {
                  updatedAfter: cursor || priorCursor || attemptAt
                },
                lastSuccessfulAt: isoNow(now),
                lastError: null,
                lastFetchedCount: remoteIssues.length,
                lastChangedCount: changedCount
              },
              {
                type: "mission-control.linear.reconcile.completed",
                source: reason,
                payload: {
                  reason,
                  updatedAfter: cursor || priorCursor || attemptAt,
                  fetchedCount: remoteIssues.length,
                  changedCount
                }
              }
            );
          } catch (error) {
            store.updateSync(
              {
                status: "error",
                lastError: error.message
              },
              {
                type: "mission-control.linear.reconcile.failed",
                source: reason,
                payload: {
                  reason,
                  error: error.message
                }
              }
            );
            logger.error("[Linear Sync] Reconcile failed:", error.message);
          } finally {
            reconcilePromise = null;
          }
          return getPublicState();
        })();
        return reconcilePromise;
      }
      function scheduleAcceleratedReconcile() {
        if (acceleratedHandle) return;
        acceleratedHandle = setTimeoutFn(() => {
          acceleratedHandle = null;
          reconcile({ reason: "webhook" }).catch((error) => {
            logger.error("[Linear Sync] Accelerated reconcile failed:", error.message);
          });
        }, 250);
      }
      async function handleWebhook({ headers = {}, rawBody = "" }) {
        if (!config.webhookSecret) {
          return {
            statusCode: 404,
            body: { error: "Linear webhook endpoint not configured" }
          };
        }
        const signature = headers["linear-signature"] || headers["Linear-Signature"];
        if (!verifySignature(rawBody, signature, config.webhookSecret)) {
          store.updateSync(
            {
              lastError: "Invalid Linear webhook signature"
            },
            {
              type: "mission-control.linear.webhook.rejected",
              source: "webhook",
              payload: {
                reason: "invalid-signature"
              }
            }
          );
          return {
            statusCode: 401,
            body: { error: "Invalid Linear webhook signature" }
          };
        }
        let payload;
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch (error) {
          store.updateSync(
            {
              lastError: `Invalid JSON body: ${error.message}`
            },
            {
              type: "mission-control.linear.webhook.rejected",
              source: "webhook",
              payload: {
                reason: "invalid-json",
                error: error.message
              }
            }
          );
          return {
            statusCode: 400,
            body: { error: `Invalid JSON body: ${error.message}` }
          };
        }
        if (!isFreshTimestamp(payload.webhookTimestamp, now)) {
          store.updateSync(
            {
              lastError: "Stale Linear webhook payload"
            },
            {
              type: "mission-control.linear.webhook.rejected",
              source: "webhook",
              payload: {
                reason: "stale-payload"
              }
            }
          );
          return {
            statusCode: 401,
            body: { error: "Stale Linear webhook payload" }
          };
        }
        const deliveryId = headers["linear-delivery"] || headers["Linear-Delivery"] || payload.webhookId || payload.id || null;
        const issue = normalizeWebhookIssue(payload);
        if (deliveryId && store.hasSeenWebhookDelivery(deliveryId)) {
          store.noteWebhookDelivery({
            deliveryId,
            receivedAt: isoNow(now),
            issue,
            duplicate: true
          });
          return {
            statusCode: 200,
            body: { ok: true, duplicate: true }
          };
        }
        const belongsToConfiguredProject = !issue?.project?.slug || config.projectSlugs.includes(issue.project.slug);
        store.noteWebhookDelivery({ deliveryId, receivedAt: isoNow(now), issue, duplicate: false });
        let changed = false;
        if (issue && belongsToConfiguredProject) {
          const result = store.upsertCard(issue, {
            source: "webhook",
            deliveryId,
            receivedAt: isoNow(now)
          });
          changed = result.changed;
        } else if (issue) {
          store.appendAuditEvent(
            "mission-control.linear.webhook.ignored",
            {
              reason: "project-not-configured",
              projectSlug: issue.project?.slug || null
            },
            {
              occurredAt: isoNow(now),
              source: "webhook",
              cardId: issue.id ? `mc:${issue.id}` : null,
              issueId: issue.id || null,
              identifier: issue.identifier || null,
              deliveryId
            }
          );
        }
        scheduleAcceleratedReconcile();
        return {
          statusCode: 202,
          body: {
            ok: true,
            duplicate: false,
            changed
          }
        };
      }
      function start() {
        if (pollHandle || !isEnabled()) {
          if (!isEnabled()) {
            store.updateSync(
              {
                status: "disabled",
                lastError: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled"
              },
              {
                type: "mission-control.linear.sync.disabled",
                payload: {
                  error: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled"
                }
              }
            );
          }
          return;
        }
        reconcile({ reason: "startup" }).catch((error) => {
          logger.error("[Linear Sync] Startup reconcile failed:", error.message);
        });
        pollHandle = setIntervalFn(() => {
          reconcile({ reason: "poll" }).catch((error) => {
            logger.error("[Linear Sync] Poll reconcile failed:", error.message);
          });
        }, config.syncIntervalMs);
      }
      function stop() {
        if (pollHandle) {
          clearIntervalFn(pollHandle);
          pollHandle = null;
        }
        if (acceleratedHandle) {
          clearTimeoutFn(acceleratedHandle);
          acceleratedHandle = null;
        }
      }
      return {
        bootstrap: () => store.bootstrap(),
        start,
        stop,
        reconcile,
        handleWebhook,
        getPublicState,
        getTimelineForCard: (reference) => store.getTimelineForCard(reference),
        getEventLog: () => store.readEventLog(),
        getWebhookPath: () => config.webhookPath,
        isEnabled
      };
    }
    module2.exports = {
      createLinearSyncEngine,
      isFreshTimestamp,
      normalizeWebhookIssue,
      verifySignature
    };
  }
});

// src/mission-control/linear/index.js
var require_linear = __commonJS({
  "src/mission-control/linear/index.js"(exports2, module2) {
    var { createLinearClient, normalizeIssue } = require_client();
    var { createLinearSyncStore, normalizeCard } = require_store2();
    var { createLinearSyncEngine, verifySignature } = require_sync_engine();
    module2.exports = {
      createLinearClient,
      createLinearSyncStore,
      createLinearSyncEngine,
      normalizeIssue,
      normalizeCard,
      verifySignature
    };
  }
});

// src/mission-control/health-provider.js
var require_health_provider = __commonJS({
  "src/mission-control/health-provider.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var SNAPSHOT_FILENAME = "symphony-health.json";
    function isoNow(now = Date.now) {
      const value = typeof now === "function" ? now() : now;
      return new Date(value).toISOString();
    }
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function writeSnapshot(filePath, payload) {
      const tempPath = `${filePath}.tmp`;
      fs2.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
      fs2.renameSync(tempPath, filePath);
    }
    function summarizeQueue(queue) {
      if (!queue) {
        return null;
      }
      const depth = Number(queue.depth || 0);
      const active = Number(queue.active || 0);
      const pending = Number(queue.pending || 0);
      if (depth === 0 && active === 0 && pending === 0) {
        return "Queue idle";
      }
      return `Queue active=${active}, pending=${pending}, depth=${depth}`;
    }
    function parseQueue(rawQueue) {
      if (!rawQueue || typeof rawQueue !== "object") {
        return {
          active: 0,
          pending: 0,
          depth: 0
        };
      }
      const active = Number(rawQueue.active ?? rawQueue.running ?? 0) || 0;
      const pending = Number(rawQueue.pending ?? rawQueue.waiting ?? rawQueue.backlog ?? 0) || 0;
      const depth = Number(rawQueue.depth ?? pending + active) || 0;
      return {
        active,
        pending,
        depth
      };
    }
    function normalizeProbePayload(body, response) {
      const runtime = body?.runtime && typeof body.runtime === "object" ? body.runtime : body;
      const queueSource = runtime?.queue || runtime?.queues || body?.queue || body?.queues || body?.activity?.queue || {};
      const queue = parseQueue(queueSource);
      const rawStatus = String(
        body?.status || runtime?.status || body?.health?.status || (response.ok ? "ok" : "error")
      ).toLowerCase();
      let status = "healthy";
      if (!response.ok) {
        status = "unreachable";
      } else if (["error", "down", "unhealthy"].includes(rawStatus)) {
        status = "unreachable";
      } else if (["degraded", "warning", "warn"].includes(rawStatus)) {
        status = "degraded";
      }
      return {
        status,
        reachable: response.ok,
        responseCode: response.status,
        summary: summarizeQueue(queue) || `Runtime status ${rawStatus}`,
        queue,
        rawStatus
      };
    }
    function createEmptyProjectState(project) {
      return {
        projectKey: project.key,
        linearProjectSlug: project.linearProjectSlug,
        lane: project.lane,
        symphony: {
          endpoint: project.symphony?.url || null,
          status: project.symphony ? "unknown" : "unconfigured",
          reachable: false,
          responseCode: null,
          summary: project.symphony ? "Probe pending" : "Symphony runtime not configured",
          checkedAt: null,
          lastHealthyAt: null,
          lastError: null,
          queue: {
            active: 0,
            pending: 0,
            depth: 0
          }
        }
      };
    }
    function createInitialState(registry, now) {
      return {
        version: 1,
        updatedAt: isoNow(now),
        projects: (registry.projects || []).map(createEmptyProjectState)
      };
    }
    function createSymphonyHealthProvider({
      registry,
      dataDir,
      now = Date.now,
      logger = console,
      fetchImpl = globalThis.fetch,
      onChange = () => {
      },
      pollIntervalMs = 3e4,
      setIntervalFn = setInterval,
      clearIntervalFn = clearInterval
    } = {}) {
      const rootDir = path2.join(dataDir, "mission-control");
      const snapshotPath = path2.join(rootDir, SNAPSHOT_FILENAME);
      let pollHandle = null;
      let state2 = createInitialState(registry, now);
      try {
        ensureDir(rootDir);
        if (fs2.existsSync(snapshotPath)) {
          const loaded = JSON.parse(fs2.readFileSync(snapshotPath, "utf8"));
          state2 = {
            ...state2,
            ...loaded,
            projects: Array.isArray(loaded.projects) ? loaded.projects.map((project) => ({
              ...createEmptyProjectState(
                registry.projects.find((entry) => entry.key === project.projectKey) || {
                  key: project.projectKey,
                  linearProjectSlug: project.linearProjectSlug,
                  lane: project.lane,
                  symphony: { url: project.symphony?.endpoint || null }
                }
              ),
              ...project,
              symphony: {
                ...createEmptyProjectState({
                  key: project.projectKey,
                  linearProjectSlug: project.linearProjectSlug,
                  lane: project.lane,
                  symphony: { url: project.symphony?.endpoint || null }
                }).symphony,
                ...project.symphony || {},
                queue: {
                  active: Number(project.symphony?.queue?.active || 0),
                  pending: Number(project.symphony?.queue?.pending || 0),
                  depth: Number(project.symphony?.queue?.depth || 0)
                }
              }
            })) : state2.projects
          };
        }
      } catch (error) {
        logger.warn?.(`[Mission Control] Failed to load Symphony health snapshot: ${error.message}`);
      }
      function persist() {
        state2.updatedAt = isoNow(now);
        writeSnapshot(snapshotPath, state2);
      }
      async function probeProject(project) {
        const existing = state2.projects.find((entry) => entry.projectKey === project.key) || createEmptyProjectState(project);
        if (!project.symphony) {
          return existing;
        }
        try {
          const response = await fetchImpl(project.symphony.url, {
            headers: { accept: "application/json" }
          });
          const body = await response.json().catch(() => ({}));
          const parsed = normalizeProbePayload(body, response);
          const checkedAt = isoNow(now);
          return {
            ...existing,
            projectKey: project.key,
            linearProjectSlug: project.linearProjectSlug,
            lane: project.lane,
            symphony: {
              endpoint: project.symphony.url,
              status: parsed.status,
              reachable: parsed.reachable,
              responseCode: parsed.responseCode,
              summary: parsed.summary,
              checkedAt,
              lastHealthyAt: parsed.status === "healthy" ? checkedAt : existing.symphony?.lastHealthyAt || null,
              lastError: parsed.status === "healthy" ? null : parsed.rawStatus,
              queue: parsed.queue
            }
          };
        } catch (error) {
          return {
            ...existing,
            projectKey: project.key,
            linearProjectSlug: project.linearProjectSlug,
            lane: project.lane,
            symphony: {
              endpoint: project.symphony.url,
              status: "unreachable",
              reachable: false,
              responseCode: null,
              summary: `Runtime unreachable: ${error.message}`,
              checkedAt: isoNow(now),
              lastHealthyAt: existing.symphony?.lastHealthyAt || null,
              lastError: error.message,
              queue: existing.symphony?.queue || { active: 0, pending: 0, depth: 0 }
            }
          };
        }
      }
      async function refresh() {
        const projects = [];
        for (const project of registry.projects || []) {
          projects.push(await probeProject(project));
        }
        state2 = {
          ...state2,
          projects,
          updatedAt: isoNow(now)
        };
        persist();
        onChange({ type: "runtime-updated", runtime: getState() });
        return getState();
      }
      function getState() {
        return {
          ...state2,
          projects: state2.projects.map((project) => ({
            ...project,
            symphony: {
              ...project.symphony,
              queue: { ...project.symphony?.queue || { active: 0, pending: 0, depth: 0 } }
            }
          }))
        };
      }
      function start() {
        if (pollHandle || registry.projectCount === 0) {
          return;
        }
        refresh().catch((error) => {
          logger.warn?.(`[Mission Control] Symphony health refresh failed: ${error.message}`);
        });
        pollHandle = setIntervalFn(() => {
          refresh().catch((error) => {
            logger.warn?.(`[Mission Control] Symphony health refresh failed: ${error.message}`);
          });
        }, pollIntervalMs);
      }
      function stop() {
        if (!pollHandle) {
          return;
        }
        clearIntervalFn(pollHandle);
        pollHandle = null;
      }
      return {
        getState,
        refresh,
        start,
        stop
      };
    }
    module2.exports = {
      createSymphonyHealthProvider,
      normalizeProbePayload
    };
  }
});

// src/mission-control/signals.js
var require_signals = __commonJS({
  "src/mission-control/signals.js"(exports2, module2) {
    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms <= 0) {
        return "0m";
      }
      const totalMinutes = Math.floor(ms / 6e4);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor(totalMinutes % (60 * 24) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) {
        return `${days}d ${hours}h`;
      }
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    }
    function isTerminalCard(card) {
      const stateType = String(card?.state?.type || "").toLowerCase();
      return ["completed", "done", "canceled", "cancelled"].includes(stateType);
    }
    function isBlockedCard(card) {
      const stateName = String(card?.state?.name || "").toLowerCase();
      const stateType = String(card?.state?.type || "").toLowerCase();
      const labels = Array.isArray(card?.labels) ? card.labels : [];
      return stateType === "blocked" || stateName.includes("blocked") || labels.some((label) => {
        const name = String(label?.name || "").toLowerCase();
        return name === "blocked" || name === "blocker" || name === "dispatch:blocked";
      });
    }
    function getStaleThresholdMs(card) {
      if (isBlockedCard(card)) {
        return 8 * 60 * 60 * 1e3;
      }
      const stateType = String(card?.state?.type || "").toLowerCase();
      if (["started", "in_progress"].includes(stateType)) {
        return 6 * 60 * 60 * 1e3;
      }
      if (stateType === "review" || String(card?.state?.name || "").toLowerCase().includes("review")) {
        return 12 * 60 * 60 * 1e3;
      }
      return 24 * 60 * 60 * 1e3;
    }
    function getCardTimestamp(card) {
      return card?.updatedAt || card?.startedAt || card?.createdAt || null;
    }
    function deriveMissionCardSignals({ card, project, runtimeProject, now = Date.now }) {
      const nowMs = typeof now === "function" ? now() : now;
      const updatedAt = getCardTimestamp(card);
      const updatedAtMs = updatedAt ? Date.parse(updatedAt) : nowMs;
      const ageMs = Math.max(0, nowMs - (Number.isNaN(updatedAtMs) ? nowMs : updatedAtMs));
      const terminal = isTerminalCard(card);
      const blocked = isBlockedCard(card);
      const staleThresholdMs = getStaleThresholdMs(card);
      const stale = !terminal && ageMs >= staleThresholdMs;
      const runtimeStatus = runtimeProject?.symphony?.status || "unknown";
      const degraded = runtimeStatus === "degraded" || runtimeStatus === "unreachable";
      const signals = [];
      if (blocked) {
        signals.push("blocked");
      }
      if (stale) {
        signals.push("stale-work");
      }
      if (runtimeStatus === "unreachable") {
        signals.push("symphony-down");
      } else if (runtimeStatus === "degraded") {
        signals.push("symphony-degraded");
      }
      let risk = "low";
      if (!terminal && (runtimeStatus === "unreachable" || blocked && stale)) {
        risk = "high";
      } else if (!terminal && (blocked || stale || runtimeStatus === "degraded")) {
        risk = "medium";
      }
      let status = "ok";
      if (degraded) {
        status = "degraded";
      } else if (blocked) {
        status = "blocked";
      } else if (stale) {
        status = "stale";
      }
      return {
        lane: project?.lane || null,
        projectKey: project?.key || null,
        status,
        degraded,
        blocked,
        risk,
        signals,
        ageMs,
        ageLabel: formatDuration(ageMs),
        stale,
        staleThresholdMs,
        staleThresholdLabel: formatDuration(staleThresholdMs),
        symphony: runtimeProject?.symphony || null
      };
    }
    function deriveProjectSignals({ project, cards, runtimeProject }) {
      const cardList = Array.isArray(cards) ? cards : [];
      const staleCardCount = cardList.filter((card) => card.healthStrip?.stale).length;
      const blockedCardCount = cardList.filter((card) => card.healthStrip?.blocked).length;
      const highRiskCardCount = cardList.filter((card) => card.healthStrip?.risk === "high").length;
      const degraded = ["degraded", "unreachable"].includes(runtimeProject?.symphony?.status);
      const signals = [];
      if (degraded) {
        signals.push("symphony-down");
      }
      if (blockedCardCount > 0) {
        signals.push("blocked-cards");
      }
      if (staleCardCount > 0) {
        signals.push("stale-work");
      }
      let risk = "low";
      if (degraded || highRiskCardCount > 0) {
        risk = "high";
      } else if (blockedCardCount > 0 || staleCardCount > 0) {
        risk = "medium";
      }
      let status = "ok";
      if (degraded) {
        status = "degraded";
      } else if (blockedCardCount > 0) {
        status = "blocked";
      } else if (staleCardCount > 0) {
        status = "stale";
      }
      return {
        lane: project?.lane || null,
        status,
        degraded,
        risk,
        cardCount: cardList.length,
        staleCardCount,
        blockedCardCount,
        highRiskCardCount,
        signals,
        symphony: runtimeProject?.symphony || null
      };
    }
    module2.exports = {
      deriveMissionCardSignals,
      deriveProjectSignals,
      formatDuration,
      getStaleThresholdMs,
      isBlockedCard
    };
  }
});

// src/mission-control/views.js
var require_views = __commonJS({
  "src/mission-control/views.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var VIEWS_FILENAME = "saved-views.json";
    var VIEWS_SCHEMA_VERSION = 1;
    var DEFAULT_SAVED_VIEWS = Object.freeze([
      {
        id: "today",
        name: "Today",
        builtin: true,
        filters: {
          updatedSinceHours: 24,
          excludeStatuses: ["completed", "cancelled"]
        }
      },
      {
        id: "jon-lane",
        name: "Jon lane",
        builtin: true,
        filters: {
          lane: "lane:jon"
        }
      },
      {
        id: "mia-lane",
        name: "Mia lane",
        builtin: true,
        filters: {
          lane: "lane:mia"
        }
      },
      {
        id: "pepper-blockers",
        name: "Pepper blockers",
        builtin: true,
        filters: {
          lane: "lane:pepper",
          blocked: true
        }
      },
      {
        id: "needs-review",
        name: "Needs review",
        builtin: true,
        filters: {
          requiresReview: true
        }
      }
    ]);
    function isoNow(now = Date.now) {
      return new Date(now()).toISOString();
    }
    function ensureDir(dirPath) {
      fs2.mkdirSync(dirPath, { recursive: true });
    }
    function sortValue(value) {
      if (Array.isArray(value)) {
        return value.map(sortValue);
      }
      if (value && typeof value === "object") {
        return Object.keys(value).sort((left, right) => left.localeCompare(right)).reduce((result, key) => {
          result[key] = sortValue(value[key]);
          return result;
        }, {});
      }
      return value;
    }
    function atomicWriteJson(filePath, value) {
      const dirPath = path2.dirname(filePath);
      ensureDir(dirPath);
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      const content = `${JSON.stringify(sortValue(value), null, 2)}
`;
      fs2.writeFileSync(tempPath, content, "utf8");
      fs2.renameSync(tempPath, filePath);
    }
    function normalizeView(view = {}) {
      const id = String(view.id || "").trim();
      if (!id) {
        throw new Error("Mission Control saved view requires an id");
      }
      return {
        id,
        name: String(view.name || id).trim(),
        builtin: view.builtin === true,
        filters: view.filters && typeof view.filters === "object" ? { ...view.filters } : {},
        createdAt: view.createdAt || null,
        updatedAt: view.updatedAt || null
      };
    }
    function mergeViews(defaultViews, existingViews, now) {
      const merged = /* @__PURE__ */ new Map();
      for (const view of defaultViews) {
        const normalized = normalizeView(view);
        merged.set(normalized.id, {
          ...normalized,
          createdAt: normalized.createdAt || now,
          updatedAt: normalized.updatedAt || now
        });
      }
      for (const view of existingViews || []) {
        const normalized = normalizeView(view);
        const existing = merged.get(normalized.id);
        merged.set(normalized.id, {
          ...existing,
          ...normalized,
          builtin: existing?.builtin || normalized.builtin,
          createdAt: normalized.createdAt || existing?.createdAt || now,
          updatedAt: normalized.updatedAt || existing?.updatedAt || now
        });
      }
      return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
    }
    function createInitialState(now) {
      return {
        schemaVersion: VIEWS_SCHEMA_VERSION,
        updatedAt: now,
        activeViewId: DEFAULT_SAVED_VIEWS[0].id,
        views: mergeViews(DEFAULT_SAVED_VIEWS, [], now)
      };
    }
    function createMissionControlViewsStore({ dataDir, now = Date.now } = {}) {
      const missionControlDir = path2.join(dataDir, "mission-control");
      const filePath = path2.join(missionControlDir, VIEWS_FILENAME);
      const currentNow = isoNow(now);
      let state2 = createInitialState(currentNow);
      ensureDir(missionControlDir);
      if (fs2.existsSync(filePath)) {
        try {
          const loaded = JSON.parse(fs2.readFileSync(filePath, "utf8"));
          const mergedViews = mergeViews(DEFAULT_SAVED_VIEWS, loaded.views, currentNow);
          const activeViewId = mergedViews.some((view) => view.id === loaded.activeViewId) ? loaded.activeViewId : mergedViews[0]?.id || DEFAULT_SAVED_VIEWS[0].id;
          state2 = {
            schemaVersion: VIEWS_SCHEMA_VERSION,
            updatedAt: loaded.updatedAt || currentNow,
            activeViewId,
            views: mergedViews
          };
        } catch (_error) {
          state2 = createInitialState(currentNow);
        }
      }
      function persist() {
        state2.updatedAt = isoNow(now);
        atomicWriteJson(filePath, state2);
      }
      if (!fs2.existsSync(filePath)) {
        persist();
      }
      function getState() {
        return {
          schemaVersion: state2.schemaVersion,
          updatedAt: state2.updatedAt,
          activeViewId: state2.activeViewId,
          views: state2.views.map((view) => ({ ...view, filters: { ...view.filters } }))
        };
      }
      function setActiveView(viewId) {
        const normalizedId = String(viewId || "").trim();
        if (!state2.views.some((view) => view.id === normalizedId)) {
          throw new Error(`Unknown Mission Control view: ${normalizedId}`);
        }
        state2.activeViewId = normalizedId;
        persist();
        return getState();
      }
      function upsertView(view) {
        const normalized = normalizeView(view);
        const existingIndex = state2.views.findIndex((entry) => entry.id === normalized.id);
        const timestamp = isoNow(now);
        if (existingIndex >= 0) {
          state2.views[existingIndex] = {
            ...state2.views[existingIndex],
            ...normalized,
            updatedAt: timestamp
          };
        } else {
          state2.views.push({
            ...normalized,
            createdAt: timestamp,
            updatedAt: timestamp
          });
        }
        state2.views.sort((left, right) => left.name.localeCompare(right.name));
        persist();
        return getState();
      }
      return {
        getState,
        setActiveView,
        upsertView
      };
    }
    function cardMatchesSavedView(card, filters = {}, now = Date.now()) {
      if (filters.lane && card.lane !== filters.lane) {
        return false;
      }
      if (filters.requiresReview && !card.humanReviewRequired) {
        return false;
      }
      if (filters.blocked && !["blocked", "awaiting_review"].includes(card.status)) {
        return false;
      }
      if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
        if (!filters.statuses.includes(card.status)) {
          return false;
        }
      }
      if (Array.isArray(filters.excludeStatuses) && filters.excludeStatuses.includes(card.status)) {
        return false;
      }
      if (filters.updatedSinceHours) {
        const updatedAt = Date.parse(card.source?.linearIssueUpdatedAt || card.updatedAt || 0);
        const threshold = now - Number(filters.updatedSinceHours) * 60 * 60 * 1e3;
        if (!updatedAt || updatedAt < threshold) {
          return false;
        }
      }
      if (filters.search) {
        const haystack = [
          card.title,
          card.summary,
          card.primaryLinearIdentifier,
          ...card.source?.labelNames || [],
          ...card.originProjects || []
        ].join(" ").toLowerCase();
        if (!haystack.includes(String(filters.search).toLowerCase())) {
          return false;
        }
      }
      return true;
    }
    module2.exports = {
      DEFAULT_SAVED_VIEWS,
      cardMatchesSavedView,
      createMissionControlViewsStore
    };
  }
});

// src/mission-control/notifications.js
var require_notifications = __commonJS({
  "src/mission-control/notifications.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var SNAPSHOT_FILENAME = "discord-notifications.json";
    var SCHEMA_VERSION = 1;
    var MAX_ATTEMPTS = 4;
    var MAX_RECENT_NOTIFICATIONS = 50;
    var MAX_SETTLED_KEYS = 250;
    var MAX_ACTIVE_REVIEW_KEYS = 500;
    var BASE_BACKOFF_MS = 1e3;
    var MAX_BACKOFF_MS = 5 * 60 * 1e3;
    function isoNow(now = Date.now) {
      const value = typeof now === "function" ? now() : now;
      return new Date(value).toISOString();
    }
    function ensureDir(dirPath) {
      if (!fs2.existsSync(dirPath)) {
        fs2.mkdirSync(dirPath, { recursive: true });
      }
    }
    function writeSnapshot(filePath, payload) {
      const tempPath = `${filePath}.tmp`;
      fs2.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
      fs2.renameSync(tempPath, filePath);
    }
    function cleanString(value) {
      if (value === null || value === void 0) {
        return "";
      }
      return String(value).trim();
    }
    function cleanNullableString(value) {
      const cleaned = cleanString(value);
      return cleaned || null;
    }
    function toStatusLabel(status) {
      return cleanString(status).replace(/_/g, " ") || "unknown";
    }
    function parseRetryAfterMs(retryAfter, now = Date.now) {
      const value = cleanString(retryAfter);
      if (!value) {
        return null;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) {
        return numeric * 1e3;
      }
      const parsedDate = Date.parse(value);
      if (Number.isNaN(parsedDate)) {
        return null;
      }
      return Math.max(0, parsedDate - now());
    }
    function getBackoffMs(attemptCount, retryAfterMs = null) {
      if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
        return Math.min(MAX_BACKOFF_MS, retryAfterMs);
      }
      return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptCount - 1));
    }
    function normalizeSettledEntry(entry) {
      return {
        key: cleanString(entry?.key),
        settledAt: cleanNullableString(entry?.settledAt)
      };
    }
    function normalizeNotificationEntry(entry) {
      return {
        id: cleanString(entry?.id),
        category: cleanString(entry?.category) || "exception",
        eventKey: cleanString(entry?.eventKey),
        destinationKey: cleanString(entry?.destinationKey) || "unroutable",
        destinationLabel: cleanNullableString(entry?.destinationLabel),
        senderIdentity: cleanNullableString(entry?.senderIdentity),
        webhookUrl: cleanNullableString(entry?.webhookUrl),
        title: cleanString(entry?.title) || "Mission Control notification",
        summary: cleanString(entry?.summary),
        identifier: cleanNullableString(entry?.identifier),
        cardId: cleanNullableString(entry?.cardId),
        cardStatus: cleanNullableString(entry?.cardStatus),
        occurredAt: cleanNullableString(entry?.occurredAt),
        createdAt: cleanNullableString(entry?.createdAt),
        lastAttemptAt: cleanNullableString(entry?.lastAttemptAt),
        nextAttemptAt: cleanNullableString(entry?.nextAttemptAt),
        deliveredAt: cleanNullableString(entry?.deliveredAt),
        deadLetteredAt: cleanNullableString(entry?.deadLetteredAt),
        responseStatus: entry?.responseStatus === null || entry?.responseStatus === void 0 ? null : Number(entry.responseStatus),
        error: cleanNullableString(entry?.error),
        status: cleanString(entry?.status) || "queued",
        attemptCount: Number.parseInt(String(entry?.attemptCount || 0), 10) || 0,
        payload: entry?.payload && typeof entry.payload === "object" ? entry.payload : null
      };
    }
    function createInitialState(now = Date.now) {
      return {
        version: SCHEMA_VERSION,
        updatedAt: isoNow(now),
        lastExceptionFingerprint: null,
        notifications: [],
        settledEventDestinations: [],
        activeReviewKeys: []
      };
    }
    function buildEntryKey(eventKey, destinationKey) {
      return `${eventKey}:${destinationKey}`;
    }
    function uniqueDestinations(destinations) {
      const byWebhook = /* @__PURE__ */ new Map();
      for (const destination of destinations || []) {
        const webhookUrl = cleanNullableString(destination?.webhookUrl);
        if (!webhookUrl) {
          continue;
        }
        if (!byWebhook.has(webhookUrl)) {
          byWebhook.set(webhookUrl, destination);
        }
      }
      return [...byWebhook.values()];
    }
    function buildDiscordPayload(notification) {
      const color = notification.category === "completion" ? 4176208 : notification.category === "review" ? 13801762 : 16273737;
      const header = notification.category === "completion" ? "Mission complete" : notification.category === "review" ? "Human review required" : "Mission exception";
      const fields = [];
      if (notification.identifier) {
        fields.push({ name: "Issue", value: notification.identifier, inline: true });
      }
      if (notification.cardStatus) {
        fields.push({ name: "Status", value: toStatusLabel(notification.cardStatus), inline: true });
      }
      if (notification.destinationLabel) {
        fields.push({ name: "Destination", value: notification.destinationLabel, inline: true });
      }
      if (notification.senderIdentity) {
        fields.push({ name: "Sender", value: notification.senderIdentity, inline: true });
      }
      return {
        username: "Mission Control",
        allowed_mentions: { parse: [] },
        content: `${header}: ${notification.title}`,
        embeds: [
          {
            title: notification.title,
            description: notification.summary,
            color,
            fields,
            footer: {
              text: `Mission Control notification v1 \u2022 ${notification.category} \u2022 ${notification.eventKey}`
            },
            timestamp: notification.occurredAt || notification.createdAt || isoNow()
          }
        ]
      };
    }
    function postDiscordWebhook({ webhookUrl, payload, fetchImpl = globalThis.fetch, now = Date.now }) {
      return fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "openclaw-command-center/mission-control"
        },
        body: JSON.stringify(payload)
      }).then(async (response) => {
        if (response.ok) {
          return {
            ok: true,
            status: response.status
          };
        }
        const responseText = await response.text().catch(() => "");
        return {
          ok: false,
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: parseRetryAfterMs(response.headers?.get?.("retry-after"), now),
          error: cleanNullableString(responseText) || `Discord webhook rejected with HTTP ${response.status}`
        };
      }).catch((error) => ({
        ok: false,
        status: null,
        retryable: true,
        retryAfterMs: null,
        error: error.message
      }));
    }
    function deriveCardNotificationPolicy({ card, registry }) {
      const agents = Array.isArray(registry?.agents) ? registry.agents : [];
      const destinations = Array.isArray(registry?.discordDestinations) ? registry.discordDestinations : [];
      const destinationByKey = new Map(
        destinations.map((destination2) => [destination2.key, destination2])
      );
      const explicitDestinationKey = cleanNullableString(card?.notificationPolicy?.destinationKey);
      const explicitSenderIdentity = cleanNullableString(card?.notificationPolicy?.senderIdentity);
      const preferredAgent = agents.find((agent) => (card?.responsibleAgents || []).includes(agent.key)) || agents.find((agent) => agent.defaultLane === card?.lane) || null;
      const senderIdentity = explicitSenderIdentity || preferredAgent?.key || null;
      const destinationKey = explicitDestinationKey || preferredAgent?.defaultNotificationProfile || senderIdentity || null;
      const destination = destinationKey ? destinationByKey.get(destinationKey) : null;
      if (!destination) {
        return {
          enabled: false,
          destinationKey,
          senderIdentity,
          reason: "No matching Discord destination configured"
        };
      }
      if (!destination.webhookUrl) {
        return {
          enabled: false,
          destinationKey: destination.key,
          senderIdentity,
          reason: `Discord destination '${destination.key}' is missing webhookUrl`
        };
      }
      const allowed = Array.isArray(destination.allowedSenderIdentities) ? destination.allowedSenderIdentities : [];
      if (allowed.length > 0 && senderIdentity && !allowed.includes(senderIdentity)) {
        return {
          enabled: false,
          destinationKey: destination.key,
          senderIdentity,
          reason: `Discord destination '${destination.key}' does not allow sender '${senderIdentity}'`
        };
      }
      return {
        enabled: true,
        destinationKey: destination.key,
        senderIdentity,
        reason: null
      };
    }
    function createMissionControlNotificationService({
      registry,
      dataDir,
      now = Date.now,
      logger = console,
      fetchImpl = globalThis.fetch,
      onChange = () => {
      },
      setTimeoutFn = setTimeout,
      clearTimeoutFn = clearTimeout
    } = {}) {
      const rootDir = path2.join(dataDir, "mission-control");
      const snapshotPath = path2.join(rootDir, SNAPSHOT_FILENAME);
      const pendingTimers = /* @__PURE__ */ new Map();
      const inFlight = /* @__PURE__ */ new Set();
      let state2 = createInitialState(now);
      const destinations = Array.isArray(registry?.discordDestinations) ? registry.discordDestinations : [];
      const destinationByKey = new Map(
        destinations.map((destination) => [destination.key, destination])
      );
      try {
        ensureDir(rootDir);
        if (fs2.existsSync(snapshotPath)) {
          const loaded = JSON.parse(fs2.readFileSync(snapshotPath, "utf8"));
          state2 = {
            ...createInitialState(now),
            ...loaded,
            notifications: Array.isArray(loaded.notifications) ? loaded.notifications.map(normalizeNotificationEntry).filter((entry) => entry.id && entry.eventKey) : [],
            settledEventDestinations: Array.isArray(loaded.settledEventDestinations) ? loaded.settledEventDestinations.map(normalizeSettledEntry).filter((entry) => entry.key) : [],
            activeReviewKeys: Array.isArray(loaded.activeReviewKeys) ? loaded.activeReviewKeys.map((key) => cleanString(key)).filter(Boolean) : []
          };
        }
      } catch (error) {
        logger.warn?.(
          `[Mission Control] Failed to load Discord notification snapshot: ${error.message}`
        );
      }
      function compactState() {
        const unsettled = state2.notifications.filter(
          (entry) => ["queued", "retrying", "sending"].includes(entry.status)
        );
        const settled = state2.notifications.filter((entry) => ["delivered", "dead_letter"].includes(entry.status)).sort(
          (left, right) => Date.parse(right.deliveredAt || right.deadLetteredAt || right.createdAt || 0) - Date.parse(left.deliveredAt || left.deadLetteredAt || left.createdAt || 0)
        ).slice(0, MAX_RECENT_NOTIFICATIONS);
        state2.notifications = [...unsettled, ...settled];
        state2.settledEventDestinations = state2.settledEventDestinations.slice(-MAX_SETTLED_KEYS);
        state2.activeReviewKeys = state2.activeReviewKeys.slice(-MAX_ACTIVE_REVIEW_KEYS);
      }
      function persist() {
        compactState();
        state2.updatedAt = isoNow(now);
        writeSnapshot(snapshotPath, state2);
      }
      function emit() {
        try {
          onChange({
            type: "notification-updated",
            notifications: getPublicState()
          });
        } catch (_error) {
        }
      }
      function markSettled(notification) {
        const key = buildEntryKey(notification.eventKey, notification.destinationKey);
        state2.settledEventDestinations = state2.settledEventDestinations.filter((entry) => entry.key !== key).concat({ key, settledAt: isoNow(now) });
      }
      function hasExistingNotification(eventKey, destinationKey) {
        const entryKey = buildEntryKey(eventKey, destinationKey);
        return state2.notifications.some(
          (entry) => entry.eventKey === eventKey && entry.destinationKey === destinationKey
        ) || state2.settledEventDestinations.some((entry) => entry.key === entryKey);
      }
      function scheduleNotification(notification) {
        if (!notification?.id) {
          return;
        }
        if (pendingTimers.has(notification.id)) {
          clearTimeoutFn(pendingTimers.get(notification.id));
          pendingTimers.delete(notification.id);
        }
        const nextAttemptAt = Date.parse(
          notification.nextAttemptAt || notification.createdAt || isoNow(now)
        );
        const delayMs = Math.max(0, nextAttemptAt - now());
        const timer = setTimeoutFn(() => {
          pendingTimers.delete(notification.id);
          attemptDelivery(notification.id).catch((error) => {
            logger.error?.(`[Mission Control] Discord delivery crashed: ${error.message}`);
          });
        }, delayMs);
        pendingTimers.set(notification.id, timer);
      }
      function buildCompletionNotification(card) {
        return {
          category: "completion",
          eventKey: `completion:${card.id}:${card.completedAt || card.updatedAt || isoNow(now)}`,
          occurredAt: card.completedAt || card.updatedAt || isoNow(now),
          title: `${card.identifier || card.primaryLinearIdentifier || card.id} completed`,
          summary: card.title,
          identifier: card.identifier || card.primaryLinearIdentifier || card.id,
          cardId: card.id,
          cardStatus: card.status
        };
      }
      function buildReviewNotification(card, child) {
        return {
          category: "review",
          eventKey: `review:${card.id}:${child.id}:${child.updatedAt || child.completedAt || isoNow(now)}`,
          occurredAt: child.updatedAt || isoNow(now),
          title: `${card.identifier || card.primaryLinearIdentifier || card.id} needs human review`,
          summary: [child.identifier || child.id, child.title, child.reviewReason].filter(Boolean).join(" \xB7 "),
          identifier: child.identifier || card.identifier || card.primaryLinearIdentifier || card.id,
          cardId: card.id,
          cardStatus: card.status
        };
      }
      function buildExceptionNotification({ sync, auditType, occurredAt, source }) {
        const errorMessage = cleanString(sync?.lastError) || "Mission Control reported an exception";
        return {
          category: "exception",
          eventKey: `exception:${auditType || source || "sync"}:${errorMessage}`,
          occurredAt: occurredAt || isoNow(now),
          title: auditType === "mission-control.linear.webhook.rejected" ? "Linear webhook rejected" : "Mission Control exception",
          summary: errorMessage,
          identifier: null,
          cardId: null,
          cardStatus: sync?.status || null
        };
      }
      function createNotificationRecord(baseNotification, route) {
        const createdAt = isoNow(now);
        const payload = buildDiscordPayload({
          ...baseNotification,
          destinationLabel: route.destinationLabel,
          senderIdentity: route.senderIdentity
        });
        return {
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
          category: baseNotification.category,
          eventKey: baseNotification.eventKey,
          destinationKey: route.destinationKey,
          destinationLabel: route.destinationLabel,
          senderIdentity: route.senderIdentity,
          webhookUrl: route.webhookUrl,
          title: baseNotification.title,
          summary: baseNotification.summary,
          identifier: baseNotification.identifier,
          cardId: baseNotification.cardId,
          cardStatus: baseNotification.cardStatus,
          occurredAt: baseNotification.occurredAt,
          createdAt,
          lastAttemptAt: null,
          nextAttemptAt: createdAt,
          deliveredAt: null,
          deadLetteredAt: null,
          responseStatus: null,
          error: null,
          status: "queued",
          attemptCount: 0,
          payload
        };
      }
      function recordConfigFailure(baseNotification, route) {
        const destinationKey = route.destinationKey || "unroutable";
        if (hasExistingNotification(baseNotification.eventKey, destinationKey)) {
          return false;
        }
        const createdAt = isoNow(now);
        state2.notifications.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
          category: baseNotification.category,
          eventKey: baseNotification.eventKey,
          destinationKey,
          destinationLabel: route.destinationLabel || route.destinationKey || "Unroutable",
          senderIdentity: route.senderIdentity || null,
          webhookUrl: route.webhookUrl || null,
          title: baseNotification.title,
          summary: baseNotification.summary,
          identifier: baseNotification.identifier,
          cardId: baseNotification.cardId,
          cardStatus: baseNotification.cardStatus,
          occurredAt: baseNotification.occurredAt,
          createdAt,
          lastAttemptAt: createdAt,
          nextAttemptAt: null,
          deliveredAt: null,
          deadLetteredAt: createdAt,
          responseStatus: null,
          error: route.error || "Discord destination is not deliverable",
          status: "dead_letter",
          attemptCount: 0,
          payload: null
        });
        markSettled({ eventKey: baseNotification.eventKey, destinationKey });
        persist();
        emit();
        return true;
      }
      function enqueueNotification(baseNotification, routes) {
        let queued = false;
        for (const route of routes) {
          const destinationKey = route.destinationKey || "unroutable";
          if (hasExistingNotification(baseNotification.eventKey, destinationKey)) {
            continue;
          }
          if (!route.webhookUrl || route.error) {
            queued = recordConfigFailure(baseNotification, route) || queued;
            continue;
          }
          const record = createNotificationRecord(baseNotification, route);
          state2.notifications.push(record);
          queued = true;
          scheduleNotification(record);
        }
        if (queued) {
          persist();
          emit();
        }
        return queued;
      }
      function getCompletionRoute(card) {
        const policy = deriveCardNotificationPolicy({ card, registry });
        const destination = policy.destinationKey ? destinationByKey.get(policy.destinationKey) : null;
        return {
          destinationKey: policy.destinationKey || "unroutable",
          destinationLabel: destination?.channelLabel || destination?.key || policy.destinationKey || "Unroutable",
          senderIdentity: policy.senderIdentity,
          webhookUrl: destination?.webhookUrl || null,
          error: policy.reason
        };
      }
      function getReviewEntries(card) {
        const children = Array.isArray(card?.linearChildren) ? card.linearChildren : card?.primaryLinearIssueId ? [
          {
            id: card.primaryLinearIssueId,
            identifier: card.primaryLinearIdentifier || card.identifier || card.id,
            title: card.title,
            updatedAt: card.updatedAt,
            humanReviewRequired: card.humanReviewRequired,
            blockedOnHumanReview: String(card.reviewReason || "").includes(
              "blocked-on-human-review"
            ),
            reviewReason: card.reviewReason
          }
        ] : [];
        return children.map((child) => ({
          activeKey: `${card.id}:${child.id}`,
          child,
          active: Boolean(child.humanReviewRequired) || Boolean(child.blockedOnHumanReview) || /review/.test(cleanString(child.state?.name || child.reviewReason).toLowerCase())
        }));
      }
      function syncReviewNotifications(card) {
        const entries = getReviewEntries(card);
        const activeKeysForCard = new Set(
          entries.filter((entry) => entry.active).map((entry) => entry.activeKey)
        );
        const nextActiveKeys = state2.activeReviewKeys.filter(
          (key) => !key.startsWith(`${card.id}:`) || activeKeysForCard.has(key)
        );
        let changed = nextActiveKeys.length !== state2.activeReviewKeys.length;
        for (const entry of entries) {
          if (!entry.active || state2.activeReviewKeys.includes(entry.activeKey)) {
            continue;
          }
          nextActiveKeys.push(entry.activeKey);
          changed = true;
          enqueueNotification(buildReviewNotification(card, entry.child), [getCompletionRoute(card)]);
        }
        if (changed) {
          state2.activeReviewKeys = nextActiveKeys;
          persist();
          emit();
        }
        return changed;
      }
      function getExceptionRoutes() {
        const configured = uniqueDestinations(destinations);
        if (configured.length === 0) {
          return [
            {
              destinationKey: "unroutable",
              destinationLabel: "Unroutable",
              senderIdentity: null,
              webhookUrl: null,
              error: "No Discord destinations are configured for Mission Control exception alerts"
            }
          ];
        }
        return configured.map((destination) => ({
          destinationKey: destination.key,
          destinationLabel: destination.channelLabel || destination.key,
          senderIdentity: null,
          webhookUrl: destination.webhookUrl,
          error: !destination.webhookUrl ? `Discord destination '${destination.key}' is missing webhookUrl` : null
        }));
      }
      async function attemptDelivery(notificationId) {
        const notification = state2.notifications.find((entry) => entry.id === notificationId);
        if (!notification || !["queued", "retrying", "sending"].includes(notification.status)) {
          return null;
        }
        if (inFlight.has(notificationId)) {
          return null;
        }
        inFlight.add(notificationId);
        notification.status = notification.attemptCount > 0 ? "retrying" : "sending";
        notification.attemptCount += 1;
        notification.lastAttemptAt = isoNow(now);
        notification.error = null;
        persist();
        emit();
        try {
          const result = await postDiscordWebhook({
            webhookUrl: notification.webhookUrl,
            payload: notification.payload,
            fetchImpl,
            now
          });
          if (result.ok) {
            notification.status = "delivered";
            notification.responseStatus = result.status;
            notification.deliveredAt = isoNow(now);
            notification.nextAttemptAt = null;
            notification.error = null;
            markSettled(notification);
          } else if (result.retryable && notification.attemptCount < MAX_ATTEMPTS) {
            const delayMs = getBackoffMs(notification.attemptCount, result.retryAfterMs);
            notification.status = "retrying";
            notification.responseStatus = result.status;
            notification.error = result.error;
            notification.nextAttemptAt = new Date(now() + delayMs).toISOString();
            scheduleNotification(notification);
          } else {
            notification.status = "dead_letter";
            notification.responseStatus = result.status;
            notification.error = result.error;
            notification.deadLetteredAt = isoNow(now);
            notification.nextAttemptAt = null;
            markSettled(notification);
          }
          persist();
          emit();
          return result;
        } finally {
          inFlight.delete(notificationId);
        }
      }
      function handleMissionControlChange(change, publicState) {
        if (change?.type === "card-upserted") {
          const cards = (publicState?.masterCards || []).filter(
            (entry) => entry.id === change.cardId || entry.primaryLinearIssueId === change.issueId || entry.primaryLinearIdentifier === change.identifier || (entry.linkedLinearIssueIds || []).includes(change.issueId) || (entry.linkedLinearIdentifiers || []).includes(change.identifier)
          );
          let changed = false;
          for (const card of cards) {
            changed = syncReviewNotifications(card) || changed;
            if (card.status === "completed") {
              changed = enqueueNotification(buildCompletionNotification(card), [getCompletionRoute(card)]) || changed;
            }
          }
          return changed;
        }
        if (change?.type === "sync-updated") {
          const sync = publicState?.sync || change.sync || {};
          const auditType = change.auditType || null;
          const shouldReset = sync.status === "ok" || !cleanString(sync.lastError);
          if (shouldReset) {
            state2.lastExceptionFingerprint = null;
            persist();
            emit();
            return false;
          }
          const isExceptionEvent = auditType === "mission-control.linear.reconcile.failed" || auditType === "mission-control.linear.webhook.rejected" || cleanString(change.partial?.persistence?.lastWriteError) !== "";
          if (!isExceptionEvent) {
            return false;
          }
          const fingerprint = `${auditType || sync.status}:${cleanString(sync.lastError)}`;
          if (state2.lastExceptionFingerprint === fingerprint) {
            return false;
          }
          state2.lastExceptionFingerprint = fingerprint;
          persist();
          return enqueueNotification(
            buildExceptionNotification({
              sync,
              auditType,
              occurredAt: change.occurredAt,
              source: change.source
            }),
            getExceptionRoutes()
          );
        }
        return false;
      }
      function getPublicState() {
        const notifications = [...state2.notifications].sort(
          (left, right) => Date.parse(right.createdAt || right.occurredAt || 0) - Date.parse(left.createdAt || left.occurredAt || 0)
        );
        const retrying = notifications.filter((entry) => entry.status === "retrying");
        const sending = notifications.filter((entry) => entry.status === "sending");
        const queued = notifications.filter((entry) => entry.status === "queued");
        const deadLetters = notifications.filter((entry) => entry.status === "dead_letter");
        const delivered = notifications.filter((entry) => entry.status === "delivered");
        const latestProblem = [...deadLetters, ...retrying, ...sending].sort(
          (left, right) => Date.parse(right.lastAttemptAt || right.createdAt || 0) - Date.parse(left.lastAttemptAt || left.createdAt || 0)
        ).find(Boolean);
        let status = "ok";
        let summary = "Discord notifications are healthy.";
        let alertBanner = null;
        if (deadLetters.length > 0) {
          status = "error";
          summary = `${deadLetters.length} Discord notification(s) moved to dead-letter.`;
          alertBanner = {
            level: "error",
            title: "Discord delivery requires attention",
            message: `${deadLetters.length} notification(s) moved to dead-letter${retrying.length > 0 ? ` \xB7 ${retrying.length} still retrying` : ""}.`,
            detail: latestProblem?.error || null
          };
        } else if (retrying.length > 0 || sending.length > 0 || queued.length > 0) {
          status = "degraded";
          summary = `${retrying.length + sending.length + queued.length} Discord notification(s) are pending delivery.`;
          alertBanner = {
            level: "warning",
            title: "Discord delivery is retrying",
            message: `${retrying.length + sending.length + queued.length} notification(s) are pending delivery.`,
            detail: latestProblem?.error || null
          };
        }
        return {
          version: SCHEMA_VERSION,
          updatedAt: state2.updatedAt,
          status,
          summary,
          destinations: destinations.map((destination) => ({
            key: destination.key,
            channelLabel: destination.channelLabel,
            configured: Boolean(destination.webhookUrl)
          })),
          stats: {
            totalConfigured: destinations.filter((destination) => destination.webhookUrl).length,
            queued: queued.length,
            retrying: retrying.length + sending.length,
            delivered: delivered.length,
            deadLetters: deadLetters.length
          },
          alertBanner,
          recentDeliveries: notifications.slice(0, 10).map((entry) => ({
            id: entry.id,
            category: entry.category,
            eventKey: entry.eventKey,
            destinationKey: entry.destinationKey,
            destinationLabel: entry.destinationLabel,
            title: entry.title,
            summary: entry.summary,
            identifier: entry.identifier,
            status: entry.status,
            attemptCount: entry.attemptCount,
            createdAt: entry.createdAt,
            lastAttemptAt: entry.lastAttemptAt,
            nextAttemptAt: entry.nextAttemptAt,
            deliveredAt: entry.deliveredAt,
            deadLetteredAt: entry.deadLetteredAt,
            responseStatus: entry.responseStatus,
            error: entry.error
          }))
        };
      }
      for (const notification of state2.notifications) {
        if (["queued", "retrying", "sending"].includes(notification.status)) {
          scheduleNotification(notification);
        }
      }
      return {
        getPublicState,
        handleMissionControlChange
      };
    }
    module2.exports = {
      buildDiscordPayload,
      createMissionControlNotificationService,
      deriveCardNotificationPolicy,
      parseRetryAfterMs,
      postDiscordWebhook
    };
  }
});

// src/mission-control/index.js
var require_mission_control = __commonJS({
  "src/mission-control/index.js"(exports2, module2) {
    var {
      createMasterCardFromLinearIssue,
      deriveCardStatus,
      getLabelNames,
      normalizeMasterCard,
      normalizeLane,
      toIsoTimestamp
    } = require_models();
    var { buildProjectRegistryIndexes, loadMissionControlRegistry } = require_registry();
    var { createLinearSyncEngine } = require_linear();
    var { createSymphonyHealthProvider } = require_health_provider();
    var { deriveMissionCardSignals, deriveProjectSignals } = require_signals();
    var { cardMatchesSavedView, createMissionControlViewsStore } = require_views();
    var {
      createMissionControlNotificationService,
      deriveCardNotificationPolicy
    } = require_notifications();
    var RUNBOOKS = Object.freeze([
      {
        id: "sync-lag",
        title: "Sync lag runbook",
        path: "/docs/runbooks/mission-control-sync-lag.md"
      },
      {
        id: "webhook-outage",
        title: "Webhook outage runbook",
        path: "/docs/runbooks/mission-control-webhook-outage.md"
      },
      {
        id: "symphony-outage",
        title: "Symphony outage runbook",
        path: "/docs/runbooks/mission-control-symphony-outage.md"
      }
    ]);
    function formatDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) {
        return "0m";
      }
      const totalMinutes = Math.floor(ms / 6e4);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const days = Math.floor(hours / 24);
      if (days > 0) {
        return `${days}d ${hours % 24}h`;
      }
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${Math.max(0, totalMinutes)}m`;
    }
    function getQueueThresholdMs(status) {
      switch (status) {
        case "in_progress":
          return 6 * 60 * 60 * 1e3;
        case "blocked":
          return 8 * 60 * 60 * 1e3;
        case "awaiting_review":
          return 12 * 60 * 60 * 1e3;
        default:
          return 24 * 60 * 60 * 1e3;
      }
    }
    function createFallbackProject(linearCard) {
      const labelNames = getLabelNames(linearCard.labels);
      const laneFromLabels = normalizeLane(
        labelNames.find((label) => label.startsWith("lane:")),
        null
      );
      return {
        key: linearCard.project?.slug || linearCard.project?.id || "unmapped",
        label: linearCard.project?.name || linearCard.project?.slug || "Unmapped project",
        repoPath: "",
        linearProjectSlug: linearCard.project?.slug || "",
        lane: laneFromLabels,
        symphonyPort: null,
        symphony: null
      };
    }
    function createDefaultRuntimeProject(project) {
      return {
        projectKey: project.key,
        linearProjectSlug: project.linearProjectSlug,
        lane: project.lane,
        symphony: project.symphony ? {
          endpoint: project.symphony.url,
          status: "unknown",
          reachable: false,
          responseCode: null,
          summary: "Probe pending",
          checkedAt: null,
          lastHealthyAt: null,
          lastError: null,
          queue: {
            active: 0,
            pending: 0,
            depth: 0
          }
        } : null
      };
    }
    function buildRuntimeIndexes(runtimeState = {}) {
      const runtimeProjects = Array.isArray(runtimeState.projects) ? runtimeState.projects : [];
      const runtimeByKey = /* @__PURE__ */ new Map();
      const runtimeBySlug = /* @__PURE__ */ new Map();
      for (const project of runtimeProjects) {
        if (project?.projectKey) {
          runtimeByKey.set(project.projectKey, project);
        }
        if (project?.linearProjectSlug) {
          runtimeBySlug.set(project.linearProjectSlug, project);
        }
      }
      return { runtimeByKey, runtimeBySlug };
    }
    function mapLinearCardToMissionCard(linearCard, { project, runtimeProject, now }) {
      const missionCard = createMasterCardFromLinearIssue(
        {
          issue: linearCard,
          project
        },
        { now: linearCard.updatedAt || now() }
      );
      const healthStrip = deriveMissionCardSignals({
        card: linearCard,
        project,
        runtimeProject,
        now
      });
      return {
        ...missionCard,
        identifier: linearCard.identifier || missionCard.primaryLinearIdentifier,
        url: linearCard.url || null,
        priority: linearCard.priority ?? null,
        estimate: linearCard.estimate ?? null,
        createdAt: linearCard.createdAt || missionCard.createdAt,
        updatedAt: linearCard.updatedAt || missionCard.updatedAt,
        startedAt: linearCard.startedAt || null,
        completedAt: linearCard.completedAt || missionCard.completedAt,
        canceledAt: linearCard.canceledAt || null,
        archivedAt: linearCard.archivedAt || missionCard.archivedAt,
        state: linearCard.state || null,
        project: linearCard.project || (project ? {
          id: null,
          name: project.label || project.key,
          slug: project.linearProjectSlug || null,
          progress: null
        } : null),
        team: linearCard.team || null,
        assignee: linearCard.assignee || null,
        labels: Array.isArray(linearCard.labels) ? linearCard.labels : [],
        cycle: linearCard.cycle || null,
        projectKey: project?.key || missionCard.originProjects[0] || null,
        latestUpdate: missionCard.latestUpdate || (linearCard.updatedAt ? {
          summary: linearCard.state?.name ? `Linear updated \xB7 ${linearCard.state.name}` : "Linear updated",
          actor: linearCard.assignee?.name || null,
          source: "linear",
          capturedAt: linearCard.updatedAt
        } : null),
        healthStrip
      };
    }
    function maxDateValue(values = [], fallback = null) {
      let winner = fallback;
      for (const value of values) {
        if (!value) continue;
        if (!winner || Date.parse(value) > Date.parse(winner)) {
          winner = value;
        }
      }
      return winner;
    }
    function minDateValue(values = [], fallback = null) {
      let winner = fallback;
      for (const value of values) {
        if (!value) continue;
        if (!winner || Date.parse(value) < Date.parse(winner)) {
          winner = value;
        }
      }
      return winner;
    }
    function normalizeLinearChildSummary(card) {
      return {
        id: card.primaryLinearIssueId || card.id,
        identifier: card.primaryLinearIdentifier || card.identifier || card.id,
        title: card.title,
        url: card.url || null,
        status: card.status,
        state: card.state || null,
        projectKey: card.projectKey || null,
        project: card.project || null,
        updatedAt: card.updatedAt || null,
        completedAt: card.completedAt || null,
        humanReviewRequired: Boolean(card.humanReviewRequired || card.status === "awaiting_review"),
        blockedOnHumanReview: String(card.reviewReason || "").includes("blocked-on-human-review"),
        reviewReason: card.reviewReason || null
      };
    }
    function createLinkedProjectSummary({ project, runtimeProject, providedLink = null }) {
      return {
        key: project?.key || null,
        label: project?.label || project?.key || project?.linearProjectSlug || "Unmapped project",
        linearProjectSlug: project?.linearProjectSlug || null,
        lane: project?.lane || null,
        url: providedLink?.url || null,
        linkKind: providedLink?.kind || null,
        symphony: runtimeProject?.symphony || null
      };
    }
    function deriveOutcomeHealthStrip({ childCards, runtimeProjects, lane }) {
      const cards = Array.isArray(childCards) ? childCards : [];
      const runtimes = Array.isArray(runtimeProjects) ? runtimeProjects : [];
      const blocked = cards.some((card) => card.healthStrip?.blocked || card.status === "blocked");
      const stale = cards.some((card) => card.healthStrip?.stale);
      const degraded = runtimes.some(
        (project) => ["degraded", "unreachable"].includes(project?.symphony?.status)
      );
      const ageMs = cards.reduce(
        (largest, card) => Math.max(largest, Number(card.healthStrip?.ageMs || 0)),
        0
      );
      const staleThresholdMs = cards.reduce((smallest, card) => {
        const value = Number(card.healthStrip?.staleThresholdMs || 0);
        if (!Number.isFinite(value) || value <= 0) {
          return smallest;
        }
        return smallest === null ? value : Math.min(smallest, value);
      }, null);
      const signals = [...new Set(cards.flatMap((card) => card.healthStrip?.signals || []))];
      if (degraded && !signals.includes("symphony-down")) {
        signals.push("symphony-down");
      }
      let risk = "low";
      if (cards.some((card) => card.healthStrip?.risk === "high") || degraded || blocked && stale) {
        risk = "high";
      } else if (blocked || stale || cards.some((card) => card.healthStrip?.risk === "medium")) {
        risk = "medium";
      }
      let status = "ok";
      if (degraded) {
        status = "degraded";
      } else if (blocked) {
        status = "blocked";
      } else if (stale) {
        status = "stale";
      }
      return {
        lane: lane || null,
        projectKey: null,
        status,
        degraded,
        blocked,
        risk,
        signals,
        ageMs,
        ageLabel: formatDuration(ageMs),
        stale,
        staleThresholdMs,
        staleThresholdLabel: formatDuration(staleThresholdMs || 0),
        symphony: runtimes.find((project) => ["degraded", "unreachable"].includes(project?.symphony?.status))?.symphony || runtimes[0]?.symphony || null
      };
    }
    function createOutcomeMissionCard({
      outcome,
      childCards,
      projectIndexes,
      runtimeByKey,
      runtimeBySlug,
      syncState,
      now
    }) {
      const nowIso = toIsoTimestamp(now());
      const cards = [...childCards].sort(
        (left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
      );
      const childSummaries = cards.map(normalizeLinearChildSummary);
      const linkedIssueTargetCount = (/* @__PURE__ */ new Set([
        ...outcome.linkedLinearIssueIds || [],
        ...outcome.linkedLinearIdentifiers || []
      ])).size;
      const matchedIssueCount = cards.length;
      const terminalChildren = cards.filter((card) => ["completed", "cancelled"].includes(card.status));
      const completedChildren = cards.filter((card) => card.status === "completed");
      const cancelledChildren = cards.filter((card) => card.status === "cancelled");
      const reviewChildren = childSummaries.filter((card) => card.humanReviewRequired);
      const blockedChildren = cards.filter((card) => card.status === "blocked").length;
      const inProgressChildren = cards.filter((card) => card.status === "in_progress").length;
      const readyChildren = cards.filter((card) => ["ready", "new"].includes(card.status)).length;
      const issueLifecycles = cards.map(
        (card) => card.source?.issueLifecycles?.[0] || card.status || "new"
      );
      const dispatch = cards.some((card) => card.dispatch === "dispatch:blocked") ? "dispatch:blocked" : cards.some((card) => card.dispatch === "dispatch:ready") ? "dispatch:ready" : null;
      const reviewReason = [
        ...new Set(reviewChildren.map((card) => card.reviewReason).filter(Boolean))
      ].join(", ");
      const risk = cards.some((card) => card.risk === "risk:high" || card.healthStrip?.risk === "high") ? "risk:high" : "risk:low";
      const status = matchedIssueCount === 0 ? "new" : deriveCardStatus({
        issueLifecycles,
        humanReviewRequired: reviewChildren.length > 0,
        dependencies: [],
        dispatch
      });
      const linkedProjectKeys = new Set(outcome.linkedProjectKeys || []);
      const linkedProjectSlugs = new Set(outcome.linkedLinearProjectSlugs || []);
      for (const card of cards) {
        for (const projectKey of card.originProjects || []) {
          linkedProjectKeys.add(projectKey);
        }
        for (const projectSlug of card.linkedLinearProjectSlugs || []) {
          linkedProjectSlugs.add(projectSlug);
        }
      }
      for (const projectSlug of linkedProjectSlugs) {
        const project = projectIndexes.projectByLinearSlug.get(projectSlug);
        if (project?.key) {
          linkedProjectKeys.add(project.key);
        }
      }
      const linkedProjects = [...linkedProjectKeys].map((projectKey) => {
        const project = projectIndexes.projectByKey.get(projectKey);
        if (!project) {
          return null;
        }
        const providedLink = (outcome.links || []).find(
          (link) => link.projectKey === project.key || link.projectSlug === project.linearProjectSlug
        );
        const runtimeProject = runtimeByKey.get(project.key) || runtimeBySlug.get(project.linearProjectSlug) || createDefaultRuntimeProject(project);
        return createLinkedProjectSummary({ project, runtimeProject, providedLink });
      }).filter(Boolean).sort((left, right) => left.label.localeCompare(right.label));
      const runtimeProjects = linkedProjects.map((project) => runtimeByKey.get(project.key) || runtimeBySlug.get(project.linearProjectSlug)).filter(Boolean);
      const createdAt = minDateValue(
        cards.map((card) => card.createdAt),
        outcome.createdAt || nowIso
      ) || outcome.createdAt || nowIso;
      const updatedAt = maxDateValue(
        cards.map((card) => card.updatedAt),
        outcome.updatedAt || syncState?.lastSuccessfulAt || nowIso
      ) || outcome.updatedAt || syncState?.lastSuccessfulAt || nowIso;
      const completedAt = status === "completed" ? maxDateValue(
        completedChildren.map((card) => card.completedAt || card.updatedAt),
        syncState?.lastSuccessfulAt || updatedAt
      ) : null;
      const healthStrip = deriveOutcomeHealthStrip({
        childCards: cards,
        runtimeProjects,
        lane: outcome.lane || linkedProjects[0]?.lane || null
      });
      const links = [...outcome.links || []];
      for (const child of childSummaries) {
        if (child.url && !links.some((link) => link.url === child.url)) {
          links.push({
            kind: "issue",
            label: child.identifier || child.title,
            url: child.url,
            issueId: child.id,
            identifier: child.identifier,
            projectSlug: child.project?.slug || null
          });
        }
      }
      const baseCard = normalizeMasterCard(
        {
          id: `mc-outcome:${outcome.key}`,
          cardType: "outcome",
          outcomeId: outcome.key,
          missionKey: outcome.missionKey,
          title: outcome.title,
          summary: outcome.summary || `${matchedIssueCount}/${linkedIssueTargetCount} linked Linear issue(s) tracked`,
          lane: outcome.lane || linkedProjects[0]?.lane || null,
          responsibleAgents: outcome.responsibleAgents || [],
          status,
          risk,
          dispatch,
          originProjects: [...linkedProjectKeys],
          repoTargets: linkedProjects.map((project) => projectIndexes.projectByKey.get(project.key)?.repoPath).filter(Boolean),
          symphonyTargets: linkedProjects.map((project) => {
            const registryProject = projectIndexes.projectByKey.get(project.key);
            return registryProject?.symphonyPort ? {
              projectKey: registryProject.key,
              port: registryProject.symphonyPort,
              probeState: runtimeByKey.get(registryProject.key)?.symphony?.status || "unknown"
            } : null;
          }).filter(Boolean),
          primaryLinearIssueId: cards[0]?.primaryLinearIssueId || "",
          primaryLinearIdentifier: null,
          linkedLinearIssueIds: [
            ...new Set(
              cards.map((card) => card.primaryLinearIssueId).filter(Boolean).concat(outcome.linkedLinearIssueIds || [])
            )
          ],
          linkedLinearIdentifiers: [
            ...new Set(
              cards.map((card) => card.primaryLinearIdentifier).filter(Boolean).concat(outcome.linkedLinearIdentifiers || [])
            )
          ],
          linkedLinearProjectSlugs: [...linkedProjectSlugs],
          latestProof: cards[0]?.latestProof || null,
          latestUpdate: cards[0]?.latestUpdate || (cards[0] ? {
            summary: `Latest child update \xB7 ${cards[0].primaryLinearIdentifier || cards[0].id}`,
            actor: cards[0].assignee?.name || null,
            source: "linear",
            capturedAt: cards[0].updatedAt
          } : null),
          humanReviewRequired: reviewChildren.length > 0,
          reviewReason: reviewReason || null,
          alertState: [],
          polling: {
            enabled: matchedIssueCount > 0 && !["completed", "cancelled"].includes(status),
            intervalMs: Number(syncState?.pollIntervalMs || 12e4),
            lastSyncAt: syncState?.lastSuccessfulAt || null,
            lastErrorAt: syncState?.status === "error" ? syncState?.lastAttemptedAt || null : null,
            errorCount: syncState?.status === "error" ? 1 : 0
          },
          notificationPolicy: outcome.notificationPolicy,
          source: {
            type: "outcome-rollup",
            projectKey: linkedProjects[0]?.key || null,
            labelNames: [],
            issueLifecycles,
            lastSyncedAt: syncState?.lastSuccessfulAt || null,
            linearIssueUpdatedAt: updatedAt
          },
          createdAt,
          updatedAt,
          completedAt,
          archivedAt: null
        },
        { now: updatedAt }
      );
      return {
        ...baseCard,
        identifier: outcome.missionKey,
        url: outcome.links?.[0]?.url || childSummaries[0]?.url || null,
        priority: null,
        estimate: null,
        startedAt: cards[0]?.startedAt || null,
        canceledAt: cancelledChildren.length === matchedIssueCount && matchedIssueCount > 0 ? updatedAt : null,
        state: {
          id: null,
          name: matchedIssueCount === 0 ? "Waiting for linked issues" : `${terminalChildren.length}/${matchedIssueCount} terminal`,
          type: status,
          color: null
        },
        project: linkedProjects.length === 1 ? {
          id: null,
          name: linkedProjects[0].label,
          slug: linkedProjects[0].linearProjectSlug,
          progress: null
        } : {
          id: null,
          name: `${linkedProjects.length} linked projects`,
          slug: linkedProjects[0]?.linearProjectSlug || null,
          progress: null
        },
        team: null,
        assignee: null,
        labels: [],
        cycle: null,
        projectKey: linkedProjects[0]?.key || null,
        healthStrip,
        links,
        linkedProjects,
        linearChildren: childSummaries,
        childStats: {
          linkedIssueTargetCount,
          matchedIssueCount,
          unmatchedIssueCount: Math.max(0, linkedIssueTargetCount - matchedIssueCount),
          terminalIssueCount: terminalChildren.length,
          completedIssueCount: completedChildren.length,
          cancelledIssueCount: cancelledChildren.length,
          awaitingReviewIssueCount: reviewChildren.length,
          blockedIssueCount: blockedChildren,
          inProgressIssueCount: inProgressChildren,
          readyIssueCount: readyChildren
        }
      };
    }
    function buildLaneSummaries(projects, cards) {
      const laneMap = /* @__PURE__ */ new Map();
      for (const card of cards) {
        if (!card.lane) {
          continue;
        }
        const entry = laneMap.get(card.lane) || {
          lane: card.lane,
          cardCount: 0,
          projectCount: 0,
          staleCardCount: 0,
          highRiskCardCount: 0,
          blockedCardCount: 0,
          degradedProjectCount: 0,
          status: "ok",
          risk: "low"
        };
        entry.cardCount += 1;
        if (card.healthStrip?.stale) {
          entry.staleCardCount += 1;
        }
        if (card.healthStrip?.blocked) {
          entry.blockedCardCount += 1;
        }
        if (card.healthStrip?.risk === "high") {
          entry.highRiskCardCount += 1;
        }
        laneMap.set(card.lane, entry);
      }
      for (const project of projects) {
        if (!project.lane) {
          continue;
        }
        const entry = laneMap.get(project.lane) || {
          lane: project.lane,
          cardCount: 0,
          projectCount: 0,
          staleCardCount: 0,
          highRiskCardCount: 0,
          blockedCardCount: 0,
          degradedProjectCount: 0,
          status: "ok",
          risk: "low"
        };
        entry.projectCount += 1;
        if (project.healthStrip?.degraded) {
          entry.degradedProjectCount += 1;
        }
        laneMap.set(project.lane, entry);
      }
      return Array.from(laneMap.values()).map((lane) => {
        let status = "ok";
        if (lane.degradedProjectCount > 0) {
          status = "degraded";
        } else if (lane.blockedCardCount > 0) {
          status = "blocked";
        } else if (lane.staleCardCount > 0) {
          status = "stale";
        }
        let risk = "low";
        if (lane.degradedProjectCount > 0 || lane.highRiskCardCount > 0) {
          risk = "high";
        } else if (lane.blockedCardCount > 0 || lane.staleCardCount > 0) {
          risk = "medium";
        }
        return {
          ...lane,
          status,
          risk
        };
      }).sort((left, right) => left.lane.localeCompare(right.lane));
    }
    function buildMissionControlPublicState({
      linearState = {},
      registry = { projects: [], agents: [], discordDestinations: [], outcomes: [] },
      runtimeState = { updatedAt: null, projects: [] },
      now = Date.now
    } = {}) {
      const linearCards = Array.isArray(linearState.masterCards) ? linearState.masterCards : [];
      const projectIndexes = buildProjectRegistryIndexes(registry);
      const { runtimeByKey, runtimeBySlug } = buildRuntimeIndexes(runtimeState);
      const missionCardsByIssueId = /* @__PURE__ */ new Map();
      const missionCardsByIdentifier = /* @__PURE__ */ new Map();
      const mappedLinearCards = linearCards.map((linearCard) => {
        const project = projectIndexes.projectByLinearSlug.get(linearCard.project?.slug) || createFallbackProject(linearCard);
        const runtimeProject = runtimeByKey.get(project.key) || runtimeBySlug.get(project.linearProjectSlug) || createDefaultRuntimeProject(project);
        const card = mapLinearCardToMissionCard(linearCard, {
          project,
          runtimeProject,
          now
        });
        return {
          ...card,
          notificationPolicy: deriveCardNotificationPolicy({ card, registry })
        };
      });
      for (const card of mappedLinearCards) {
        if (card.primaryLinearIssueId) {
          missionCardsByIssueId.set(card.primaryLinearIssueId, card);
        }
        if (card.primaryLinearIdentifier) {
          missionCardsByIdentifier.set(card.primaryLinearIdentifier, card);
        }
      }
      const groupedIssueIds = /* @__PURE__ */ new Set();
      const outcomeCards = (registry.outcomes || []).map((outcome) => {
        const linkedChildren = [];
        const seen = /* @__PURE__ */ new Set();
        for (const issueId of outcome.linkedLinearIssueIds || []) {
          const child = missionCardsByIssueId.get(issueId);
          if (child && !seen.has(child.id)) {
            linkedChildren.push(child);
            seen.add(child.id);
            groupedIssueIds.add(child.primaryLinearIssueId);
          }
        }
        for (const identifier of outcome.linkedLinearIdentifiers || []) {
          const child = missionCardsByIdentifier.get(identifier);
          if (child && !seen.has(child.id)) {
            linkedChildren.push(child);
            seen.add(child.id);
            groupedIssueIds.add(child.primaryLinearIssueId);
          }
        }
        const card = createOutcomeMissionCard({
          outcome,
          childCards: linkedChildren,
          projectIndexes,
          runtimeByKey,
          runtimeBySlug,
          syncState: linearState.sync || {},
          now
        });
        return {
          ...card,
          notificationPolicy: deriveCardNotificationPolicy({ card, registry })
        };
      });
      const standaloneCards = mappedLinearCards.filter(
        (card) => !groupedIssueIds.has(card.primaryLinearIssueId)
      );
      const masterCards = [...outcomeCards, ...standaloneCards].sort(
        (left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
      );
      const projectMap = /* @__PURE__ */ new Map();
      for (const project of registry.projects || []) {
        projectMap.set(project.key, project);
      }
      for (const card of masterCards) {
        if (!card.projectKey || projectMap.has(card.projectKey)) {
          continue;
        }
        projectMap.set(
          card.projectKey,
          createFallbackProject({
            project: card.project,
            labels: card.labels
          })
        );
      }
      const projects = Array.from(projectMap.values()).map((project) => {
        const projectCards = masterCards.filter(
          (card) => card.projectKey === project.key || (card.originProjects || []).includes(project.key)
        );
        const runtimeProject = runtimeByKey.get(project.key) || runtimeBySlug.get(project.linearProjectSlug) || createDefaultRuntimeProject(project);
        const healthStrip = deriveProjectSignals({
          project,
          cards: projectCards,
          runtimeProject
        });
        return {
          key: project.key,
          label: project.label || project.key,
          repoPath: project.repoPath || "",
          linearProjectSlug: project.linearProjectSlug || null,
          lane: project.lane || null,
          cardCount: projectCards.length,
          symphony: runtimeProject?.symphony || null,
          healthStrip
        };
      }).sort((left, right) => (left.label || left.key).localeCompare(right.label || right.key));
      const lanes = buildLaneSummaries(projects, masterCards);
      const updatedAtCandidates = [
        linearState.sync?.lastSuccessfulAt,
        runtimeState.updatedAt,
        masterCards[0]?.updatedAt
      ].filter(Boolean);
      const updatedAt = updatedAtCandidates[0] || null;
      const degradedProjectCount = projects.filter((project) => project.healthStrip?.degraded).length;
      const staleCards = masterCards.filter((card) => card.healthStrip?.stale).length;
      const highRiskCards = masterCards.filter((card) => card.healthStrip?.risk === "high").length;
      return {
        updatedAt,
        masterCards,
        projects,
        lanes,
        runtime: {
          provider: "symphony",
          updatedAt: runtimeState.updatedAt || null,
          projectCount: projects.length,
          degradedProjectCount
        },
        stats: {
          totalCards: masterCards.length,
          eventCount: Number(linearState.stats?.eventCount || 0),
          staleCards,
          highRiskCards,
          projectCount: projects.length,
          laneCount: lanes.length
        },
        sync: linearState.sync || {
          status: "idle",
          mode: "hybrid",
          pollIntervalMs: 12e4,
          projectSlugs: [],
          cursor: { updatedAfter: null },
          lastAttemptedAt: null,
          lastSuccessfulAt: null,
          lastWebhookAt: null,
          lastError: null,
          lastReason: null,
          lastFetchedCount: 0,
          lastChangedCount: 0,
          lagMs: null,
          webhook: {
            enabled: false,
            path: null,
            lastDeliveryId: null,
            recentDeliveryIds: []
          }
        }
      };
    }
    function buildCardReplay(reference, timeline) {
      let latestCard = null;
      return timeline.map((event) => {
        if (event.type === "mission-control.linear.card-upserted" && event.payload?.card) {
          latestCard = event.payload.card;
        }
        return {
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          type: event.type,
          source: event.source,
          identifier: event.identifier || reference.identifier || null,
          summary: summarizeEvent(event),
          snapshot: latestCard
        };
      });
    }
    function summarizeEvent(event) {
      const action = event.payload?.action;
      switch (event.type) {
        case "mission-control.linear.reconcile.started":
          return `Reconcile started via ${event.source || "poll"}`;
        case "mission-control.linear.reconcile.completed":
          return `Reconcile completed (${event.payload?.changedCount || 0} changed)`;
        case "mission-control.linear.reconcile.failed":
          return `Reconcile failed: ${event.payload?.error || "unknown error"}`;
        case "mission-control.linear.webhook.received":
          return "Webhook accepted";
        case "mission-control.linear.webhook.duplicate":
          return "Duplicate webhook ignored";
        case "mission-control.linear.webhook.rejected":
          return `Webhook rejected: ${event.payload?.reason || "unknown"}`;
        case "mission-control.linear.card-observed":
          return `Issue observed (${event.source || "sync"}, no change)`;
        case "mission-control.linear.card-upserted":
          return `Card ${action || "updated"} via ${event.source || "sync"}`;
        default:
          return event.type;
      }
    }
    function buildCardDiagnostics({ card, sync, timeline, nowMs }) {
      const queueAnchor = Date.parse(card.source?.linearIssueUpdatedAt || card.updatedAt || card.createdAt || 0) || nowMs;
      const queueAgeMs = Math.max(0, nowMs - queueAnchor);
      const staleThresholdMs = getQueueThresholdMs(card.status);
      const stale = queueAgeMs >= staleThresholdMs;
      const lastWebhookEvent = [...timeline].reverse().find((event) => event.source === "webhook" || event.type.includes("webhook"));
      const lastPollEvent = [...timeline].reverse().find((event) => ["poller", "webhook-reconcile", "startup", "manual"].includes(event.source));
      let divergenceSource = null;
      const signals = [];
      let recommendedAction = null;
      const lastError = String(sync.lastError || "").toLowerCase();
      if (lastError.includes("persist") || lastError.includes("append") || lastError.includes("snapshot") || sync.persistence?.enabled === false) {
        divergenceSource = "state_write";
        signals.push("State write persistence is degraded.");
        recommendedAction = "Verify disk permissions/space and trigger a manual reconcile.";
      } else if (lastWebhookEvent && (!lastPollEvent || Date.parse(lastPollEvent.occurredAt) < Date.parse(lastWebhookEvent.occurredAt))) {
        divergenceSource = "webhook";
        signals.push("Webhook activity has not been confirmed by a later reconcile.");
        recommendedAction = "Inspect Linear webhook delivery health, then trigger reconcile.";
      } else if (sync.status === "error" || Number.isFinite(sync.lagMs) && Number.isFinite(sync.pollIntervalMs) && sync.lagMs > sync.pollIntervalMs * 2) {
        divergenceSource = "poll";
        signals.push(
          sync.status === "error" ? `Poller error: ${sync.lastError}` : "Poller lag exceeds two sync intervals."
        );
        recommendedAction = "Check Linear API reachability/credentials and trigger reconcile.";
      }
      if (stale) {
        signals.push(
          `Queue age ${formatDuration(queueAgeMs)} exceeds ${formatDuration(staleThresholdMs)}.`
        );
      }
      return {
        queueAgeMs,
        queueAgeLabel: formatDuration(queueAgeMs),
        stale,
        staleThresholdMs,
        staleThresholdLabel: formatDuration(staleThresholdMs),
        divergenceSource,
        signals,
        recommendedAction
      };
    }
    function buildDiagnostics(cards, syncStatus) {
      const bySource = { poll: 0, webhook: 0, state_write: 0 };
      let staleCards = 0;
      for (const card of cards) {
        if (card.diagnostics?.stale || card.healthStrip?.stale) {
          staleCards += 1;
        }
        if (card.diagnostics?.divergenceSource) {
          bySource[card.diagnostics.divergenceSource] += 1;
        }
      }
      return {
        syncStatus,
        staleCards,
        divergenceBySource: bySource,
        affectedCards: cards.filter(
          (card) => card.healthStrip?.stale || card.healthStrip?.status === "degraded" || card.diagnostics?.divergenceSource
        )
      };
    }
    function createMissionControlService2({
      config,
      dataDir,
      logger = console,
      now = Date.now,
      linearClient,
      discordFetchImpl,
      onStateChange,
      setIntervalFn,
      clearIntervalFn,
      setTimeoutFn,
      clearTimeoutFn
    } = {}) {
      let registryError = null;
      let registry;
      try {
        registry = loadMissionControlRegistry(config, { now: toIsoTimestamp(now()) });
      } catch (error) {
        registryError = error;
        logger.error("[Mission Control] Failed to load registry:", error.message);
        registry = {
          schemaVersion: 1,
          projectCount: 0,
          projects: [],
          agents: [],
          discordDestinations: [],
          outcomes: [],
          createdAt: toIsoTimestamp(now()),
          updatedAt: toIsoTimestamp(now()),
          host: null
        };
      }
      let linearSync;
      let symphonyHealth;
      let notificationService;
      function buildBoardState() {
        return buildMissionControlPublicState({
          linearState: linearSync.getPublicState(),
          registry,
          runtimeState: symphonyHealth.getState(),
          now
        });
      }
      function buildCardsWithDiagnostics(boardState) {
        const nowMs = now();
        return boardState.masterCards.map((card) => {
          const timeline = linearSync.getTimelineForCard({
            cardId: card.id,
            issueId: card.primaryLinearIssueId,
            identifier: card.primaryLinearIdentifier,
            issueIds: card.linkedLinearIssueIds,
            identifiers: card.linkedLinearIdentifiers
          });
          return {
            ...card,
            diagnostics: buildCardDiagnostics({
              card,
              sync: boardState.sync,
              timeline,
              nowMs
            })
          };
        });
      }
      function getSavedViews() {
        return viewsStore.getState();
      }
      function getPublicState() {
        const boardState = buildBoardState();
        const masterCards = buildCardsWithDiagnostics(boardState);
        const savedViews = getSavedViews();
        const activeView = savedViews.views.find((view) => view.id === savedViews.activeViewId) || null;
        const activeCards = activeView ? masterCards.filter((card) => cardMatchesSavedView(card, activeView.filters, now())) : masterCards;
        const diagnostics = buildDiagnostics(masterCards, boardState.sync.status);
        return {
          ...boardState,
          ready: registryError === null,
          registryError: registryError ? registryError.message : null,
          registry: {
            projectCount: registry.projectCount,
            projects: registry.projects,
            agents: registry.agents,
            discordDestinations: registry.discordDestinations,
            outcomes: registry.outcomes
          },
          notifications: notificationService?.getPublicState() || {
            status: "ok",
            summary: "Discord notifications are healthy.",
            stats: { queued: 0, retrying: 0, delivered: 0, deadLetters: 0, totalConfigured: 0 },
            destinations: [],
            alertBanner: null,
            recentDeliveries: []
          },
          stats: {
            ...boardState.stats,
            activeCards: activeCards.length,
            needsReview: masterCards.filter((card) => card.humanReviewRequired).length
          },
          savedViews,
          activeView,
          masterCards,
          activeCards,
          diagnostics,
          runbooks: RUNBOOKS
        };
      }
      function emitStateChange(change) {
        const publicState = getPublicState();
        notificationService?.handleMissionControlChange(change, publicState);
        if (typeof onStateChange === "function") {
          onStateChange({
            ...change,
            publicState: getPublicState()
          });
        }
      }
      notificationService = createMissionControlNotificationService({
        registry,
        dataDir,
        now,
        logger,
        fetchImpl: discordFetchImpl,
        onChange: emitStateChange,
        setTimeoutFn,
        clearTimeoutFn
      });
      linearSync = createLinearSyncEngine({
        config: {
          ...config.integrations?.linear || {},
          projectSlugs: [
            ...new Set(
              [].concat(config.integrations?.linear?.projectSlugs || []).concat(
                (registry.outcomes || []).flatMap(
                  (outcome) => outcome.linkedLinearProjectSlugs || []
                )
              )
            )
          ]
        },
        dataDir,
        logger,
        now,
        client: linearClient,
        onStateChange: emitStateChange,
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn
      });
      const viewsStore = createMissionControlViewsStore({ dataDir, now });
      symphonyHealth = createSymphonyHealthProvider({
        registry,
        dataDir,
        now,
        logger,
        pollIntervalMs: config.missionControl?.symphonyPollIntervalMs || 3e4,
        setIntervalFn,
        clearIntervalFn,
        onChange: emitStateChange
      });
      function findCardReference(cardRef) {
        const cards = getPublicState().masterCards;
        const match = cards.find(
          (card) => card.id === cardRef || card.primaryLinearIssueId === cardRef || card.primaryLinearIdentifier === cardRef
        );
        if (!match) {
          return null;
        }
        return {
          cardId: match.id,
          issueId: match.primaryLinearIssueId,
          identifier: match.primaryLinearIdentifier,
          issueIds: match.linkedLinearIssueIds,
          identifiers: match.linkedLinearIdentifiers,
          card: match
        };
      }
      function getCardTimeline(cardRef) {
        const reference = findCardReference(cardRef);
        if (!reference) {
          return null;
        }
        return linearSync.getTimelineForCard(reference);
      }
      function replayCardTimeline(cardRef) {
        const reference = findCardReference(cardRef);
        if (!reference) {
          return null;
        }
        const timeline = linearSync.getTimelineForCard(reference);
        return buildCardReplay(reference, timeline);
      }
      function getDiagnostics() {
        return getPublicState().diagnostics;
      }
      return {
        start: () => {
          linearSync.bootstrap();
          symphonyHealth.start();
          return linearSync.start();
        },
        stop: () => {
          symphonyHealth.stop();
          return linearSync.stop();
        },
        reconcile: async (options) => {
          const result = await linearSync.reconcile(options);
          return result;
        },
        handleWebhook: (input) => linearSync.handleWebhook(input),
        getWebhookPath: () => linearSync.getWebhookPath(),
        getSavedViews,
        getDiagnostics,
        getPublicState,
        getCardTimeline,
        replayCardTimeline,
        setActiveView: (viewId) => viewsStore.setActiveView(viewId)
      };
    }
    module2.exports = {
      RUNBOOKS,
      buildMissionControlPublicState,
      createMissionControlService: createMissionControlService2
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
var {
  buildAdminStatusPayload,
  buildBoardPayload,
  buildFiltersPayload,
  buildHealthPayload,
  buildMissionControlEventPayload,
  buildSyncPayload
} = require_api();
var { createMissionControlService } = require_mission_control();
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
var acp = createAcpModule({
  getOpenClawDir,
  runOpenClaw,
  extractJSON,
  parseSessionLabel: sessions.parseSessionLabel
});
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
  runOpenClaw,
  extractJSON,
  readTranscript: (sessionId) => sessions.readTranscript(sessionId),
  getMissionControlState: () => missionControl.getPublicState(),
  getAcpActivity: () => acp.getAgentActivity()
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
