const https = require("https");

const LINEAR_HOSTNAME = "api.linear.app";
const LINEAR_PATHNAME = "/graphql";
const DEFAULT_PAGE_SIZE = 50;

const ISSUE_SELECTION = `
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
  parent {
    id
    identifier
    title
    updatedAt
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
    labels {
      nodes {
        id
        name
        color
      }
    }
  }
  children(first: 50) {
    nodes {
      id
      identifier
      title
      updatedAt
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
      labels {
        nodes {
          id
          name
          color
        }
      }
    }
  }
  relations(first: 50) {
    nodes {
      id
      type
      relatedIssue {
        id
        identifier
        title
        updatedAt
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
        labels {
          nodes {
            id
            name
            color
          }
        }
      }
    }
  }
  inverseRelations(first: 50) {
    nodes {
      id
      type
      issue {
        id
        identifier
        title
        updatedAt
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
        labels {
          nodes {
            id
            name
            color
          }
        }
      }
    }
  }
`;

function normalizeState(state) {
  if (!state) {
    return null;
  }

  return {
    id: state.id || null,
    name: state.name || null,
    type: state.type || null,
    color: state.color || null,
  };
}

function normalizeProject(project) {
  if (!project) {
    return null;
  }

  return {
    id: project.id || null,
    name: project.name || null,
    slug: project.slug || project.slugId || null,
    progress: project.progress ?? null,
  };
}

function normalizeTeam(team) {
  if (!team) {
    return null;
  }

  return {
    id: team.id || null,
    key: team.key || null,
    name: team.name || null,
  };
}

function normalizeAssignee(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id || null,
    name: user.name || null,
    email: user.email || null,
  };
}

function normalizeLabels(labelSource) {
  if (Array.isArray(labelSource)) {
    return labelSource.map((label) => ({
      id: label.id || null,
      name: label.name || null,
      color: label.color || null,
    }));
  }

  if (Array.isArray(labelSource?.nodes)) {
    return labelSource.nodes.map((label) => ({
      id: label.id || null,
      name: label.name || null,
      color: label.color || null,
    }));
  }

  return [];
}

function normalizeCycle(cycle) {
  if (!cycle) {
    return null;
  }

  return {
    id: cycle.id || null,
    number: cycle.number ?? null,
    name: cycle.name || null,
    startsAt: cycle.startsAt || null,
    endsAt: cycle.endsAt || null,
  };
}

function extractConnectionNodes(connection) {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

function normalizeLinkedIssueReference(issue, linkRole, relationType = null) {
  if (!issue) {
    return null;
  }

  return {
    id: issue.id || null,
    identifier: issue.identifier || null,
    title: issue.title || "Untitled",
    updatedAt: issue.updatedAt || null,
    completedAt: issue.completedAt || null,
    canceledAt: issue.canceledAt || null,
    archivedAt: issue.archivedAt || null,
    state: normalizeState(issue.state),
    project: normalizeProject(issue.project),
    labels: normalizeLabels(issue.labels),
    linkRole,
    relationType,
  };
}

function dedupeLinkedIssues(items) {
  const byId = new Map();

  for (const item of items) {
    if (!item?.id) {
      continue;
    }

    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }

    const nextRoles = new Set([existing.linkRole, item.linkRole].filter(Boolean));
    byId.set(item.id, {
      ...existing,
      ...item,
      linkRole: nextRoles.has("child")
        ? "child"
        : nextRoles.has("parent")
          ? "parent"
          : existing.linkRole || item.linkRole || "related",
      relationType: existing.relationType || item.relationType || null,
    });
  }

  return [...byId.values()];
}

function normalizeIssue(issue) {
  if (!issue) return null;

  const parentIssue = normalizeLinkedIssueReference(issue.parent, "parent");
  const childIssues = extractConnectionNodes(issue.children).map((child) =>
    normalizeLinkedIssueReference(child, "child"),
  );
  const relatedIssues = extractConnectionNodes(issue.relations).map((relation) =>
    normalizeLinkedIssueReference(relation.relatedIssue, "related", relation.type || null),
  );
  const inverseRelatedIssues = extractConnectionNodes(issue.inverseRelations).map((relation) =>
    normalizeLinkedIssueReference(relation.issue, "related", relation.type || null),
  );
  const linkedIssues = dedupeLinkedIssues(
    [parentIssue].concat(childIssues, relatedIssues, inverseRelatedIssues).filter(Boolean),
  );

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
    state: normalizeState(issue.state),
    project: normalizeProject(issue.project),
    team: normalizeTeam(issue.team),
    assignee: normalizeAssignee(issue.assignee),
    labels: normalizeLabels(issue.labels),
    cycle: normalizeCycle(issue.cycle),
    parentIssue,
    linkedIssues,
    linkedIssueIds: linkedIssues.map((entry) => entry.id).filter(Boolean),
    linkedIssueIdentifiers: linkedIssues.map((entry) => entry.identifier).filter(Boolean),
    linkedIssueProjectSlugs: linkedIssues.map((entry) => entry.project?.slug).filter(Boolean),
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
              project: { slugId: { in: $projectSlugs } }${updatedAtFilter}
            }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ${ISSUE_SELECTION}
            }
          }
        }
      `;

      const data = await request(query, {
        projectSlugs,
        first: DEFAULT_PAGE_SIZE,
        after,
      });

      const connection = data.issues || {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      issues.push(...connection.nodes.map(normalizeIssue).filter(Boolean));
      hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
      after = connection.pageInfo?.endCursor || null;
    }

    return issues;
  }

  async function fetchIssuesByIds({ issueIds }) {
    const normalizedIds = [...new Set((issueIds || []).filter(Boolean))];
    if (normalizedIds.length === 0) {
      return [];
    }

    const issues = [];
    let hasNextPage = true;
    let after = null;

    while (hasNextPage) {
      const query = `
        query MissionControlIssuesByIds($issueIds: [String!], $first: Int!, $after: String) {
          issues(
            first: $first,
            after: $after,
            orderBy: updatedAt,
            filter: {
              id: { in: $issueIds }
            }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ${ISSUE_SELECTION}
            }
          }
        }
      `;

      const data = await request(query, {
        issueIds: normalizedIds,
        first: DEFAULT_PAGE_SIZE,
        after,
      });

      const connection = data.issues || {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      issues.push(...connection.nodes.map(normalizeIssue).filter(Boolean));
      hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
      after = connection.pageInfo?.endCursor || null;
    }

    return issues;
  }

  async function resolveProjectBySlug(projectSlug) {
    const slug = String(projectSlug || "").trim();
    if (!slug) {
      throw new Error("targetProjectSlug is required");
    }

    const query = `
      query MissionControlResolveProject($projectSlug: String!) {
        projects(first: 1, filter: { slugId: { eq: $projectSlug } }) {
          nodes {
            id
            name
            slugId
            teams(first: 10) {
              nodes {
                id
                key
                name
              }
            }
          }
        }
      }
    `;

    const data = await request(query, { projectSlug: slug });
    const project = data.projects?.nodes?.[0] || null;
    if (!project?.id) {
      throw new Error(`Linear project not found for slug '${slug}'`);
    }

    const teams = extractConnectionNodes(project.teams).map(normalizeTeam).filter(Boolean);
    if (teams.length === 0 || !teams[0]?.id) {
      throw new Error(`Linear project '${slug}' has no accessible team context`);
    }

    return {
      id: project.id,
      name: project.name || slug,
      slug: project.slugId || slug,
      team: teams[0],
    };
  }

  async function resolveLabelIdsForTeam({ teamId, labelNames }) {
    const wantedNames = [
      ...new Set((labelNames || []).map((name) => String(name || "").trim()).filter(Boolean)),
    ];
    if (!teamId) {
      throw new Error("teamId is required to resolve issue labels");
    }
    if (wantedNames.length === 0) {
      return [];
    }

    const query = `
      query MissionControlResolveLabels($teamId: String!, $labelNames: [String!]) {
        issueLabels(
          first: 100,
          filter: {
            team: { id: { eq: $teamId } }
            name: { in: $labelNames }
          }
        ) {
          nodes {
            id
            name
          }
        }
      }
    `;

    const data = await request(query, { teamId, labelNames: wantedNames });
    const labels = Array.isArray(data.issueLabels?.nodes) ? data.issueLabels.nodes : [];
    const labelIdsByName = new Map(labels.map((label) => [label.name, label.id]));
    const missingLabels = wantedNames.filter((name) => !labelIdsByName.has(name));

    if (missingLabels.length > 0) {
      throw new Error(
        `Missing required Linear labels for team ${teamId}: ${missingLabels.join(", ")}`,
      );
    }

    return wantedNames.map((name) => labelIdsByName.get(name));
  }

  async function createIssue(input) {
    const query = `
      mutation MissionControlCreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            ${ISSUE_SELECTION}
          }
        }
      }
    `;

    const data = await request(query, { input });
    if (!data.issueCreate?.success || !data.issueCreate?.issue) {
      throw new Error("Linear issue creation did not return a created issue");
    }

    return normalizeIssue(data.issueCreate.issue);
  }

  return {
    request,
    createIssue,
    fetchIssuesForProjects,
    fetchIssuesByIds,
    normalizeIssue,
    resolveLabelIdsForTeam,
    resolveProjectBySlug,
  };
}

module.exports = { createLinearClient, normalizeIssue };
