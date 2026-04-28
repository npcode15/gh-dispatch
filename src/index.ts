/**
 * gh-dispatch — Cloudflare Worker
 *
 * Fires a GitHub workflow_dispatch on a cron schedule.
 * All config lives in environment variables / secrets (wrangler.toml + wrangler secret).
 *
 * Endpoints:
 *   POST /trigger          Manual fire (returns JSON {ok, status})
 *   GET  /health           Returns config summary (token is redacted)
 */

export interface Env {
  /** GitHub PAT with Actions:write scope (set via `wrangler secret put GITHUB_TOKEN`) */
  GITHUB_TOKEN: string;
  /** e.g. "npcode15" */
  GITHUB_OWNER: string;
  /** e.g. "trading-radar" */
  GITHUB_REPO: string;
  /** e.g. "data_update.yml" */
  WORKFLOW_FILE: string;
  /** Branch/tag/SHA to dispatch on, e.g. "main" */
  REF: string;
}

async function dispatchWorkflow(env: Env): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "gh-dispatch-worker/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: env.REF }),
  });

  const body = res.status === 204 ? "" : await res.text();
  return { ok: res.ok, status: res.status, body };
}

export default {
  /** Cron-triggered: fires workflow_dispatch on schedule */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await dispatchWorkflow(env);
    if (result.ok) {
      console.log(`[gh-dispatch] dispatched ${env.WORKFLOW_FILE} on ${env.GITHUB_OWNER}/${env.GITHUB_REPO}@${env.REF}`);
    } else {
      console.error(`[gh-dispatch] failed ${result.status}: ${result.body}`);
    }
  },

  /** HTTP handler: manual trigger + health check */
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "POST" && pathname === "/trigger") {
      const result = await dispatchWorkflow(env);
      return Response.json(
        { ok: result.ok, status: result.status, body: result.body || null },
        { status: result.ok ? 200 : result.status },
      );
    }

    if (pathname === "/health") {
      return Response.json({
        ok: true,
        workflow: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.WORKFLOW_FILE}`,
        ref: env.REF,
        token: env.GITHUB_TOKEN ? "set" : "MISSING",
      });
    }

    return new Response("gh-dispatch worker — POST /trigger to fire manually", { status: 200 });
  },
};
