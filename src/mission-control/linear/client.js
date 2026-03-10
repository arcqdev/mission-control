const https = require("https");

const LINEAR_HOSTNAME = "api.linear.app";
const LINEAR_PATHNAME = "/graphql";
const DEFAULT_PAGE_SIZE = 50;

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
    state: issue.state
      ? {
          id: issue.state.id || null,
          name: issue.state.name || null,
          type: issue.state.type || null,
          color: issue.state.color || null,
        }
      : null,
    project: issue.project
      ? {
          id: issue.project.id || null,
          name: issue.project.name || null,
          slug: issue.project.slug || null,
          progress: issue.project.progress ?? null,
        }
      : null,
    team: issue.team
      ? {
          id: issue.team.id || null,
          key: issue.team.key || null,
          name: issue.team.name || null,
        }
      : null,
    assignee: issue.assignee
      ? {
          id: issue.assignee.id || null,
          name: issue.assignee.name || null,
          email: issue.assignee.email || null,
        }
      : null,
    labels: Array.isArray(issue.labels)
      ? issue.labels.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null,
        }))
      : Array.isArray(issue.labels?.nodes)
        ? issue.labels.nodes.map((label) => ({
            id: label.id || null,
            name: label.name || null,
            color: label.color || null,
          }))
        : [],
    cycle: issue.cycle
      ? {
          id: issue.cycle.id || null,
          number: issue.cycle.number ?? null,
          name: issue.cycle.name || null,
          startsAt: issue.cycle.startsAt || null,
          endsAt: issue.cycle.endsAt || null,
        }
      : null,
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
          "Content-Length": Buffer.byteLength(payload),
        },
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
      },
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
      const updatedAtFilter = updatedAfter
        ? `\n          updatedAt: { gte: ${JSON.stringify(updatedAfter)} }`
        : "";
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
        after,
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
    normalizeIssue,
  };
}

module.exports = { createLinearClient, normalizeIssue };
