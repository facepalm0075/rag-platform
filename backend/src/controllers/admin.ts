import { Request, Response, NextFunction } from 'express';
import { querySystemLogs, countSystemLogsByLevel, countSystemLogsSince } from '../repositories/systemLog.js';
import { log } from '../logging/index.js';
import { LogLevel, SystemLog } from '../types/index.js';
import {
  verifyAdminCredentials,
  createAdminSession,
  destroyAdminSession,
  getSessionToken,
  getSessionCookieName,
} from '../middleware/adminAuth.js';

const PAGE_SIZE = 50;
const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
  a { color: #38bdf8; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  h1 { margin-top: 0; }
  .card { display: inline-block; min-width: 140px; margin: 0 12px 12px 0; padding: 14px 18px;
         background: #1e293b; border-radius: 8px; border-left: 4px solid #64748b; }
  .card .num { font-size: 26px; font-weight: 700; }
  .card.error { border-color: #ef4444; } .card.warn { border-color: #f59e0b; }
  .card.info { border-color: #38bdf8; } .card.total { border-color: #22c55e; }
  form.filter { background: #1e293b; padding: 14px; border-radius: 8px; margin-bottom: 16px; }
  form.filter input, form.filter select { background: #0f172a; color: #e2e8f0; border: 1px solid #475569;
         padding: 6px 8px; border-radius: 6px; margin: 4px 8px 4px 0; }
  button { background: #0284c7; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #334155; font-size: 13px; vertical-align: top; }
  th { background: #334155; }
  .lvl { font-weight: 700; text-transform: uppercase; font-size: 11px; }
  .lvl.debug { color: #94a3b8; } .lvl.info { color: #38bdf8; }
  .lvl.warn { color: #f59e0b; } .lvl.error { color: #ef4444; }
  .msg { word-break: break-word; } .meta { color: #94a3b8; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
  .pager { margin-top: 12px; } .pager a { margin-right: 10px; }
  .err { color: #f87171; } .login-box { max-width: 340px; margin: 80px auto; background: #1e293b;
         padding: 28px; border-radius: 10px; }
  .login-box input { width: 100%; box-sizing: border-box; margin: 6px 0 14px; padding: 9px;
         background: #0f172a; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px; }
  .login-box label { font-size: 13px; } .login-box button { width: 100%; margin-top: 6px; }
  .topbar { display: flex; justify-content: space-between; align-items: center; }
</style>
</head>
<body>
<div class="wrap">${body}</div>
</body>
</html>`;
}

function loginPageHtml(error?: string): string {
  const errorHtml = error ? `<p class="err">${escapeHtml(error)}</p>` : '';
  return layout('Admin sign in', `
<h1>RAG Backend — Admin</h1>
<div class="login-box">
  <h2>Sign in</h2>
  ${errorHtml}
  <form method="post" action="/admin/login">
    <label>Username</label>
    <input type="text" name="username" autocomplete="username" required>
    <label>Password</label>
    <input type="password" name="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</div>
`);
}

function formatMeta(meta: Record<string, unknown>): string {
  const json = JSON.stringify(meta);
  return json && json !== '{}' ? json.slice(0, 160) : '';
}

function summaryCardsHtml(levelCounts: { level: string; count: number }[], errors24h: number): string {
  const get = (level: string) => levelCounts.find((c) => c.level === level)?.count ?? 0;
  const total = levelCounts.reduce((sum, c) => sum + c.count, 0);
  const card = (label: string, value: number, cls: string) => `
    <div class="card ${cls}"><div class="num">${value}</div><div>${label}</div></div>`;
  return `
    ${card('Total entries', total, 'total')}
    ${card('Errors (24h)', errors24h, 'error')}
    ${card('Errors', get('error'), 'error')}
    ${card('Warnings', get('warn'), 'warn')}
    ${card('Info', get('info'), 'info')}`;
}

function logsTableHtml(rows: SystemLog[]): string {
  if (rows.length === 0) {
    return '<p>No log entries match the current filters.</p>';
  }
  const levelClass = (level: string) => `lvl ${level}`;
  return `<table>
<thead><tr><th>Timestamp</th><th>Level</th><th>Category</th><th>Message</th><th>User</th><th>Meta</th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr>
  <td>${escapeHtml(row.timestamp.toISOString())}</td>
  <td><span class="${levelClass(row.level)}">${escapeHtml(row.level)}</span></td>
  <td>${escapeHtml(row.category)}</td>
  <td class="msg">${escapeHtml(row.message)}</td>
  <td>${escapeHtml(row.username ?? '')}</td>
  <td class="meta">${escapeHtml(formatMeta(row.meta))}</td>
</tr>`
  )
  .join('\n')}
</tbody>
</table>`;
}

interface DashboardQuery {
  level?: LogLevel;
  category?: string;
  search?: string;
  from?: Date;
  to?: Date;
  page: number;
}

function parseDashboardQuery(query: Record<string, unknown>): DashboardQuery {
  const level = LEVELS.includes(query.level as LogLevel) ? (query.level as LogLevel) : undefined;
  const category = typeof query.category === 'string' && query.category.trim() ? query.category.trim() : undefined;
  const search = typeof query.search === 'string' && query.search.trim() ? query.search.trim() : undefined;
  const from = typeof query.from === 'string' && query.from ? new Date(`${query.from}T00:00:00`) : undefined;
  const to = typeof query.to === 'string' && query.to ? new Date(`${query.to}T23:59:59.999`) : undefined;
  const page = typeof query.page === 'string' && /^\d+$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  return { level, category, search, from, to, page };
}

function paginationHtml(baseQuery: string, page: number, totalPages: number): string {
  const link = (label: string, target: number) =>
    `<a href="/admin?${baseQuery}&page=${target}">${label}</a>`;
  let html = `<div class="pager">Page ${page} of ${Math.max(totalPages, 1)}`;
  if (page > 1) html += ` — ${link('Previous', page - 1)}`;
  if (page < totalPages) html += ` — ${link('Next', page + 1)}`;
  return html + '</div>';
}

export async function loginPage(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).send(loginPageHtml());
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  const { username, password } = req.body as { username?: string; password?: string };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).send(loginPageHtml('Username and password are required.'));
  }

  if (!verifyAdminCredentials(username, password)) {
    log('warn', 'Admin sign-in failed', { username }, 'admin');
    return res.status(401).send(loginPageHtml('Invalid username or password.'));
  }

  log('info', 'Admin signed in', { username }, 'admin');
  const token = createAdminSession();
  res.cookie(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.redirect('/admin');
}

export async function logout(req: Request, res: Response) {
  const token = getSessionToken(req);
  if (token) destroyAdminSession(token);
  res.clearCookie(getSessionCookieName());
  res.redirect('/admin/login');
}

export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const { level, category, search, from, to, page } = parseDashboardQuery(req.query as Record<string, unknown>);
    const limit = PAGE_SIZE;
    const offset = (page - 1) * PAGE_SIZE;

    const [logResult, levelCounts, errors24h] = await Promise.all([
      querySystemLogs({ level, category, search, from, to, limit, offset }),
      countSystemLogsByLevel(),
      countSystemLogsSince(new Date(Date.now() - 24 * 60 * 60 * 1000), 'error'),
    ]);

    const { rows, total } = logResult;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    const baseQuery = new URLSearchParams();
    if (level) baseQuery.set('level', level);
    if (category) baseQuery.set('category', category);
    if (search) baseQuery.set('search', search);
    if (from) baseQuery.set('from', from.toISOString().slice(0, 10));
    if (to) baseQuery.set('to', to.toISOString().slice(0, 10));
    const queryString = baseQuery.toString();

    const levelOptions = LEVELS.map(
      (l) => `<option value="${l}" ${l === level ? 'selected' : ''}>${l}</option>`
    ).join('');

    const body = `
<div class="topbar">
  <h1>System Report</h1>
  <a href="/admin/logout">Sign out</a>
</div>
${summaryCardsHtml(levelCounts, errors24h)}
<form class="filter" method="get" action="/admin">
  <select name="level">${levelOptions}</select>
  <input type="text" name="category" placeholder="Category (e.g. auth)" value="${escapeHtml(category ?? '')}">
  <input type="text" name="search" placeholder="Search message or username" value="${escapeHtml(search ?? '')}">
  <input type="date" name="from" value="${escapeHtml(from ? from.toISOString().slice(0, 10) : '')}">
  <input type="date" name="to" value="${escapeHtml(to ? to.toISOString().slice(0, 10) : '')}">
  <button type="submit">Filter</button>
  <a href="/admin">Clear</a>
</form>
${logsTableHtml(rows)}
${paginationHtml(queryString, page, totalPages)}
`;
    res.status(200).send(layout('System Report', body));
  } catch (err) {
    next(err);
  }
}
