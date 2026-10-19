#!/usr/bin/env node
// Customer-facing intake for feature requests.
//
//   POST /v1/requests              { "text": "...", "slug"?: "existing-extension" }  -> 202 { id, slug, issue }
//   GET  /v1/requests/:id          -> { id, slug, status, questions? }   status: in-progress | needs-info | preview |
//                                     live | merged | rejected | needs-human
//   POST /v1/requests/:id/answers  { "answers": "..." }  -> 202 { id, slug, issue }  (a new request with the answers)
//   POST /v1/requests/:id/approve  tenant admins only: puts the previewed extension live
// Every lookup is limited to the tenant that made the request.
//
// The tenant and user come from authentication, never from the request body.
// Requests become GitHub issues opened by the intake's GitHub App, signed with
// OPENPEARL_INTAKE_KEY so the pipeline can verify them.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequest, encodeRequest, signApproval, MAX_TEXT } from '../framework/core/request.js';

const STATUS_LABELS = [
  ['openpearl-live', 'live'], ['openpearl-preview', 'preview'], ['openpearl-needs-info', 'needs-info'],
  ['openpearl-merged', 'merged'], ['openpearl-rejected', 'rejected'], ['openpearl-needs-human', 'needs-human'],
];
const QUESTIONS = /<!-- openpearl-questions ([A-Za-z0-9_-]+) -->/;

// Default authentication: OPENPEARL_INTAKE_TOKENS = {"<sha256 of bearer token>": {"tenant": "...", "user": "..."}}.
// Replace with your session/JWT check in production.
export function tokenAuthenticator(tokens) {
  return (headers) => {
    const m = /^Bearer ([\x21-\x7e]{16,512})$/.exec(headers.authorization ?? '');
    if (!m) return null;
    const hit = tokens[createHash('sha256').update(m[1]).digest('hex')];
    return hit ? { tenant: hit.tenant, user: hit.user, roles: hit.roles ?? [] } : null;
  };
}

// github: { createIssue({ title, body, labels }) -> { number, url }, getLabels(number) -> string[],
//          getComments(number) -> string[], dispatch(workflow, inputs) }
export function createIntake({ authenticate, github, key, perHour = 10, now = () => Date.now() }) {
  // In memory: back this with your database so requests survive restarts
  const requests = new Map(); // id -> { tenant, slug, issue, text }
  const recent = new Map(); // tenant -> timestamps
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_TEXT * 4) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('body must be JSON')); }
      });
      req.on('error', reject);
    });

  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { status: 'ok' });
    const who = authenticate(req.headers);
    if (!who) return send(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url, 'http://intake');
    try {
      const file = async (text, slug) => {
        const t = now();
        const times = (recent.get(who.tenant) ?? []).filter((x) => t - x < 3_600_000);
        if (times.length >= perHour) return send(res, 429, { error: 'too many requests; try again later' });
        let request;
        try {
          request = createRequest({ tenant: who.tenant, user: who.user, text, slug, now: t });
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
        recent.set(who.tenant, [...times, t]);
        const issue = await github.createIssue({
          title: `[openpearl:${request.tenant}] ${request.slug}`,
          body: encodeRequest(request, key),
          labels: ['openpearl-request'],
        });
        requests.set(request.id, { tenant: request.tenant, slug: request.slug, issue: issue.number, text: request.text });
        return send(res, 202, { id: request.id, slug: request.slug, issue: issue.number });
      };
      const status = async (r) => {
        const labels = await github.getLabels(r.issue);
        return STATUS_LABELS.find(([l]) => labels.includes(l))?.[1] ?? 'in-progress';
      };
      const questions = async (r) => {
        for (const body of await github.getComments(r.issue)) {
          const q = QUESTIONS.exec(body);
          if (q) return JSON.parse(Buffer.from(q[1], 'base64url').toString('utf8')).slice(0, 5).map((x) => String(x).slice(0, 300));
        }
        return [];
      };

      if (req.method === 'POST' && url.pathname === '/v1/requests') {
        const body = await readJson(req);
        return file(body?.text, body?.slug);
      }
      const m = /^\/v1\/requests\/([0-9a-f-]{36})(\/answers|\/approve)?$/.exec(url.pathname);
      const r = m && requests.get(m[1]);
      // Another tenant's request id looks exactly like an unknown one
      if (m && (!r || r.tenant !== who.tenant)) return send(res, 404, { error: 'not found' });
      if (req.method === 'GET' && m && !m[2]) {
        const s = await status(r);
        return send(res, 200, { id: m[1], slug: r.slug, status: s, ...(s === 'needs-info' ? { questions: await questions(r) } : {}) });
      }
      if (req.method === 'POST' && m?.[2] === '/answers') {
        if ((await status(r)) !== 'needs-info') return send(res, 409, { error: 'this request is not waiting for answers' });
        const body = await readJson(req);
        if (typeof body?.answers !== 'string' || !body.answers.trim()) return send(res, 400, { error: 'answers must be a non-empty string' });
        const asked = (await questions(r)).map((q) => `- ${q}`).join('\n');
        return file(`${r.text}\n\nClarifications from the customer, answering:\n${asked}\n\n${body.answers}`, r.slug);
      }
      if (req.method === 'POST' && m?.[2] === '/approve') {
        if (!who.roles?.includes('admin')) return send(res, 403, { error: 'only tenant admins can approve' });
        if ((await status(r)) !== 'preview') return send(res, 409, { error: 'this request has no preview waiting for approval' });
        await github.dispatch('tenant-promote.yml', { approval: signApproval({ id: m[1], tenant: r.tenant, slug: r.slug, user: who.user, issue: r.issue, now: now() }, key) });
        return send(res, 202, { id: m[1], slug: r.slug, status: 'approving' });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, e.message === 'body too large' || e.message === 'body must be JSON' ? 400 : 502, { error: e.message });
    }
  };
}

export function githubClient({ repo, token, api = 'https://api.github.com', defaultBranch = 'main' }) {
  const call = async (method, path, body) => {
    const r = await fetch(`${api}/repos/${repo}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`GitHub API ${method} ${path} failed: ${r.status}`);
    return r.json();
  };
  return {
    async createIssue({ title, body, labels }) {
      const issue = await call('POST', '/issues', { title, body, labels });
      return { number: issue.number, url: issue.html_url };
    },
    async getLabels(number) {
      return (await call('GET', `/issues/${number}`)).labels.map((l) => l.name);
    },
    async getComments(number) {
      return (await call('GET', `/issues/${number}/comments?per_page=100`)).map((c) => c.body ?? '');
    },
    async dispatch(workflow, inputs) {
      const r = await fetch(`${api}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
        body: JSON.stringify({ ref: defaultBranch, inputs }),
      });
      if (!r.ok) throw new Error(`GitHub API dispatch ${workflow} failed: ${r.status}`);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const need = (name) => process.env[name] || (console.error(`${name} is required`), process.exit(2));
  const handler = createIntake({
    authenticate: tokenAuthenticator(JSON.parse(need('OPENPEARL_INTAKE_TOKENS'))),
    github: githubClient({ repo: need('OPENPEARL_REPO'), token: need('OPENPEARL_GITHUB_TOKEN'), api: process.env.GITHUB_API_URL, defaultBranch: process.env.OPENPEARL_BRANCH || 'main' }),
    key: need('OPENPEARL_INTAKE_KEY'),
    perHour: Number(process.env.OPENPEARL_INTAKE_PER_HOUR) || 10,
  });
  const port = Number(process.env.PORT) || 8787;
  createServer(handler).listen(port, () => console.log(`intake listening on :${port}`));
}
