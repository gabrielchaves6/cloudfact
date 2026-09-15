/**
 * The catalog as a page: a dark grid of cards, one per cloudfact in the account, with a live preview,
 * the project it belongs to, whether it is private and when it last changed. Published like any other
 * deploy, so the index of your sites is itself a cloudfact.
 */
import type { CatalogResult } from '../types.js';

const STYLE = `
@font-face{font-family:'CloudFacts Sans';src:url('./CloudFactsSans-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:'CloudFacts Sans';src:url('./CloudFactsSans-Medium.woff2') format('woff2');font-weight:500;font-style:normal;font-display:swap}
/* CloudFacts Sans ships weights 400 and 500 only: anything heavier is faked by the browser */
:root{--ink:#f4f4f1;--muted:#8e8e89;--surface:#141414;--line:#262626;--bg:#0d0d0d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'CloudFacts Sans',ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;align-items:center;gap:14px;padding:18px 28px 14px;position:sticky;top:0;background:#0d0d0dee;backdrop-filter:blur(8px);z-index:5}
h1{font-size:20px;font-weight:500;margin:0;letter-spacing:-.005em;display:flex;align-items:baseline;gap:10px}
.brand{display:flex;align-items:center;gap:11px;flex:1;min-width:0}
.brand img{width:26px;height:26px;display:block}
.slogan{font-size:12.5px;color:var(--muted);white-space:nowrap}
@media (max-width:620px){.slogan{display:none}}
.tools{display:flex;align-items:center;gap:8px}
input[type=search]{background:#1b1b1b;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px 12px;width:240px;font:inherit;font-size:14px}
input[type=search]:focus{outline:none;border-color:#4a4a4a}
button.icon{background:none;border:1px solid transparent;color:#a1a1a1;border-radius:8px;padding:7px;cursor:pointer;line-height:0}
button.icon:hover,button.icon[aria-pressed=true]{background:#1b1b1b;color:var(--ink);border-color:var(--line)}
nav{display:flex;flex-wrap:wrap;gap:8px;padding:0 28px 16px}
nav button{background:#161616;border:1px solid #2a2a2a;color:#b4b4b4;border-radius:999px;padding:5px 13px;font:inherit;font-size:13px;cursor:pointer}
nav button[aria-pressed=true]{background:var(--ink);color:#111;border-color:var(--ink)}
main{padding:4px 28px 56px}
h2{font-size:12.5px;font-weight:500;text-transform:uppercase;letter-spacing:.07em;color:#8a8a8a;margin:28px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:22px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column;transition:border-color .15s,transform .15s}
.card:hover{border-color:#3d3d3d;transform:translateY(-2px)}
.shot{height:176px;background:#0a0a0a;border-bottom:1px solid #1f1f1f;position:relative;overflow:hidden}
/* rendered at desktop width and shrunk to the card: --s is refined per card on load and on resize */
.shot iframe{width:1280px;height:900px;border:0;transform:scale(var(--s,.24));transform-origin:top left;pointer-events:none;background:#fff}
.shot .fallback{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:radial-gradient(120% 100% at 50% 0%,#1d1d1d 0%,#121212 70%);color:#6d6d6d}
.shot .mono{width:52px;height:52px;border-radius:13px;background:#232323;border:1px solid #303030;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:500;color:#c9c9c9;text-transform:uppercase}
.shot .why{font-size:12px;letter-spacing:.02em}
.meta{padding:13px 15px 15px}
.title{font-weight:500;font-size:15px;margin:0 0 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{display:flex;align-items:center;gap:7px;color:#8a8a8a;font-size:12.5px;flex-wrap:wrap}
.sub.when{margin-top:7px}
.pill{display:inline-flex;align-items:center;gap:5px;background:#1c1c1c;border:1px solid #2a2a2a;border-radius:6px;padding:2px 8px;font-size:11.5px;color:#b0b0b0}
.pill.vis-access{color:#d8c48a;border-color:#3a3325}
.pill.vis-private{color:#9fc0e8;border-color:#243243}
.pill.vis-public{color:#93cba4;border-color:#23392b}
.pill.vis-app-login{color:#d2a5a5;border-color:#3a2828}
.hintline{color:#6f6f6f;font-size:11.5px;margin-top:8px}
.sub svg{flex:none}
.tag{background:#1f1f1f;border:1px solid #2a2a2a;border-radius:6px;padding:2px 8px;font-size:11.5px;color:#9a9a9a}
.card a{color:inherit;text-decoration:none}
.actions{display:flex;gap:7px;margin-top:10px}
.mini{background:#1c1c1c;border:1px solid #2c2c2c;color:#b4b4b4;border-radius:6px;padding:3px 9px;font:inherit;font-size:11.5px;cursor:pointer}
.mini:hover{background:#242424;color:var(--ink)}
.creds{margin-top:9px;display:grid;gap:4px}
.creds[hidden]{display:none}
.creds div{display:flex;gap:8px;align-items:center;font-size:12px}
.creds span{color:#7d7d7d;min-width:38px}
.creds code{background:#1c1c1c;border:1px solid #2c2c2c;border-radius:5px;padding:2px 7px;color:#d8d8d8;user-select:all}
.creds code[data-copy]{cursor:copy}
.creds code[data-copy]:hover{border-color:#3d3d3d;color:var(--ink)}
.empty{color:#7a7a7a;padding:40px 0}
body.list .grid{display:flex;flex-direction:column;gap:9px}
body.list .shot{display:none}
body.list .card{flex-direction:row;align-items:center;padding:11px 15px}
body.list .meta{padding:0;display:flex;align-items:center;gap:14px;width:100%}
body.list .title{margin:0;min-width:220px}
footer{color:#5f5f5f;font-size:12px;padding:0 28px 32px}
`;

const ICON = {
  access:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  private:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="10.5" width="16" height="11" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>',
  public:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>',
  static:
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  app: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  'app-login':
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v4M15 12v3"/></svg>',
};
const VIS_LABEL = { public: 'Public', private: 'Private link', access: 'Sign-in', 'app-login': 'App login' };
const KIND_LABEL = { static: 'Static', app: 'Server app' };

const SCRIPT = `
const fit = () => {
  for (const shot of document.querySelectorAll('.shot')) shot.style.setProperty('--s', (shot.clientWidth / 1280).toFixed(4));
};
fit();
addEventListener('resize', fit);
const rel = (iso, fallback) => {
  if (!iso) return fallback;
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 90) return 'Edited just now';
  if (d < 3600) return 'Edited ' + Math.round(d / 60) + 'm ago';
  if (d < 86400) return 'Edited ' + Math.round(d / 3600) + 'h ago';
  if (d < 86400 * 7) return 'Edited ' + Math.round(d / 86400) + 'd ago';
  return 'Edited ' + new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
for (const el of document.querySelectorAll('[data-at]')) el.textContent = rel(el.dataset.at, el.textContent);
document.addEventListener('click', (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    e.preventDefault();
    navigator.clipboard?.writeText(copy.dataset.copy);
    const was = copy.textContent;
    copy.textContent = 'Copied';
    setTimeout(() => (copy.textContent = was), 1200);
    return;
  }
  const show = e.target.closest('[data-creds]');
  if (show) {
    e.preventDefault();
    const box = show.closest('.meta').querySelector('.creds');
    box.hidden = !box.hidden;
    show.textContent = box.hidden ? 'Show login' : 'Hide login';
  }
});
const search = document.getElementById('q');
const apply = () => {
  const q = search.value.trim().toLowerCase();
  const project = document.querySelector('nav button[aria-pressed=true]').dataset.project;
  for (const section of document.querySelectorAll('section')) {
    let shown = 0;
    for (const card of section.querySelectorAll('.card')) {
      const okQ = !q || card.dataset.search.includes(q);
      const okP = project === '*' || card.dataset.project === project;
      card.hidden = !(okQ && okP);
      if (!card.hidden) shown++;
    }
    section.hidden = shown === 0;
  }
  document.getElementById('empty').hidden = document.querySelectorAll('.card:not([hidden])').length > 0;
};
search.addEventListener('input', apply);
for (const b of document.querySelectorAll('nav button'))
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('nav button')) o.setAttribute('aria-pressed', String(o === b));
    apply();
  });
const view = document.getElementById('view');
view.addEventListener('click', () => {
  const list = document.body.classList.toggle('list');
  view.setAttribute('aria-pressed', String(list));
  try { localStorage.setItem('cloudfact-view', list ? 'list' : 'grid'); } catch {}
});
try { if (localStorage.getItem('cloudfact-view') === 'list') view.click(); } catch {}
fit();
`;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Self-contained page: no build step, no network beyond the previews themselves. */
export function galleryHtml(c: CatalogResult, opts: { title?: string; snapshots?: Record<string, string> } = {}): string {
  const title = opts.title ?? 'CloudFacts';
  const projects = c.projects.map((p) => p.project).filter((p): p is string => Boolean(p));
  const total = c.projects.reduce((n, p) => n + p.deploys.length, 0);

  const card = (d: CatalogResult['projects'][number]['deploys'][number]): string => {
    // a snapshot taken at publish time (scripts off) shows the real page even when a gate guards it;
    // a site open to everyone can simply be framed live; anything else falls back to a monogram
    const snap = opts.snapshots?.[d.name];
    // Only ever render a snapshot captured at publish time. Pointing a frame at the live site would let
    // that site drive the visitor's browser — an HTTP auth challenge there pops a login box over this page.
    const preview = snap
      ? `<iframe srcdoc="${esc(snap)}" loading="lazy" tabindex="-1" sandbox="" title=""></iframe>`
      : `<div class="fallback"><div class="mono">${esc(d.name.slice(0, 2))}</div><div class="why">${
          d.visibility === 'access'
            ? 'sign-in required'
            : d.visibility === 'private'
              ? 'private link'
              : d.visibility === 'app-login'
                ? 'this app asks for its own login'
                : 'no preview'
        }</div></div>`;
    const badge = d.untracked ? '<span class="tag">no local record</span>' : d.inAccount ? '' : '<span class="tag">local tunnel</span>';
    const search = [d.name, d.project ?? '', d.url ?? '', VIS_LABEL[d.visibility], KIND_LABEL[d.kind]].join(' ').toLowerCase();
    const open = d.openUrl ?? d.url ?? '';
    const creds = d.creds
      ? `<div class="creds" hidden>${[
          d.creds.user ? `<div><span>user</span><code data-copy="${esc(d.creds.user)}">${esc(d.creds.user)}</code></div>` : '',
          d.creds.password ? `<div><span>pass</span><code data-copy="${esc(d.creds.password)}">${esc(d.creds.password)}</code></div>` : '',
          d.creds.note ? `<div><span>note</span><code>${esc(d.creds.note)}</code></div>` : '',
        ].join('')}</div>`
      : '';
    const actions = `<div class="actions">
      ${open ? `<button class="mini" data-copy="${esc(open)}">Copy link</button>` : ''}
      ${d.creds ? '<button class="mini" data-creds>Show login</button>' : ''}
    </div>`;
    return `<div class="card" data-project="${esc(d.project ?? '')}" data-vis="${esc(d.visibility)}" data-kind="${esc(d.kind)}" data-search="${esc(search)}">
  <a class="open" href="${esc(open) || '#'}" target="_blank" rel="noopener">
  <div class="shot">${preview}</div>
  </a>
  <div class="meta">
    <p class="title"><a href="${esc(open) || '#'}" target="_blank" rel="noopener">${esc(d.name)}</a></p>
    <div class="sub">
      <span class="pill vis-${esc(d.visibility)}">${ICON[d.visibility]}${VIS_LABEL[d.visibility]}</span>
      <span class="pill">${ICON[d.kind]}${KIND_LABEL[d.kind]}</span>
      ${badge}
    </div>
    <div class="sub when"><span data-at="${esc(d.modifiedAt ?? '')}">${d.modifiedAt ? '' : esc(d.status === 'running' ? 'Live now' : 'No date')}</span></div>
    ${actions}
    ${creds}
    ${d.visibility === 'app-login' && !d.creds ? '<p class="hintline">Its own login. Record it with <code>cloudfact creds</code> to keep it here.</p>' : ''}
  </div>
</div>`;
  };

  const sections = c.projects
    .map(
      (p) => `<section>
  <h2>${esc(p.project ?? 'No project')}</h2>
  <div class="grid">${p.deploys.map(card).join('\n')}</div>
</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="./favicon.png" sizes="any">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body>
<header>
  <div class="brand">
    <img src="./symbol.png" alt="" width="26" height="26">
    <h1>${esc(title)}<span class="slogan">Your stuff, flexible, everywhere.</span></h1>
  </div>
  <div class="tools">
    <input id="q" type="search" placeholder="Search" aria-label="Search deploys">
    <button class="icon" id="view" aria-pressed="false" title="Toggle list view" aria-label="Toggle list view">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  </div>
</header>
<nav>
  <button data-project="*" aria-pressed="true">All (${total})</button>
  ${projects.map((p) => `<button data-project="${esc(p)}" aria-pressed="false">${esc(p)}</button>`).join('\n  ')}
</nav>
<main>
${sections || '<p class="empty">Nothing published yet.</p>'}
<p class="empty" id="empty" hidden>No deploy matches.</p>
</main>
<footer>${esc(c.accountName ?? c.accountId)}${c.subdomain ? ` · ${esc(c.subdomain)}.workers.dev` : ''} · generated by cloudfact</footer>
<script>${SCRIPT}</script>
</body></html>`;
}
