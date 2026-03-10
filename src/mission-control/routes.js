function isMissionControlRoute(pathname) {
  return pathname === "/api/mission-control/state" || pathname === "/api/mission-control/events";
}

function handleMissionControlRequest(req, res, pathname, notifications) {
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
          "Content-Type": "application/json",
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

module.exports = {
  handleMissionControlRequest,
  isMissionControlRoute,
};
