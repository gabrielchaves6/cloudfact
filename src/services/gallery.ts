/**
 * The catalog as a page: a dark grid of cards, one per cloudfact in the account, with a live preview,
 * the project it belongs to, whether it is private and when it last changed. Published like any other
 * deploy, so the index of your sites is itself a cloudfact.
 */
import type { CatalogResult } from '../types.js';

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#0d0d0d;color:#ededed;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;align-items:center;gap:16px;padding:20px 28px;position:sticky;top:0;background:#0d0d0dee;backdrop-filter:blur(8px);z-index:5}
h1{font-size:21px;font-weight:600;margin:0;flex:1;letter-spacing:-.01em}
.tools{display:flex;align-items:center;gap:8px}
input[type=search]{background:#1b1b1b;border:1px solid #2e2e2e;color:#ededed;border-radius:8px;padding:8px 12px;width:240px;font:inherit;font-size:14px}
input[type=search]:focus{outline:none;border-color:#4a4a4a}
button.icon{background:none;border:1px solid transparent;color:#a1a1a1;border-radius:8px;padding:7px;cursor:pointer;line-height:0}
button.icon:hover,button.icon[aria-pressed=true]{background:#1b1b1b;color:#ededed;border-color:#2e2e2e}
nav{display:flex;flex-wrap:wrap;gap:8px;padding:0 28px 16px}
nav button{background:#161616;border:1px solid #2a2a2a;color:#b4b4b4;border-radius:999px;padding:5px 13px;font:inherit;font-size:13px;cursor:pointer}
nav button[aria-pressed=true]{background:#ededed;color:#111;border-color:#ededed}
main{padding:4px 28px 56px}
h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#8a8a8a;margin:28px 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:22px}
.card{background:#141414;border:1px solid #262626;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;display:flex;flex-direction:column;transition:border-color .15s,transform .15s}
.card:hover{border-color:#3d3d3d;transform:translateY(-2px)}
.shot{height:172px;background:#0a0a0a;border-bottom:1px solid #1f1f1f;position:relative;overflow:hidden}
.shot iframe{width:1280px;height:820px;border:0;transform:scale(.216);transform-origin:top left;pointer-events:none;background:#fff}
.shot .fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5a5a5a;font-size:13px;padding:16px;text-align:center}
.meta{padding:13px 15px 15px}
.title{font-weight:600;font-size:15px;margin:0 0 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{display:flex;align-items:center;gap:7px;color:#8a8a8a;font-size:12.5px;flex-wrap:wrap}
.sub.when{margin-top:7px}
.pill{display:inline-flex;align-items:center;gap:5px;background:#1c1c1c;border:1px solid #2a2a2a;border-radius:6px;padding:2px 8px;font-size:11.5px;color:#b0b0b0}
.pill.vis-access{color:#d8c48a;border-color:#3a3325}
.pill.vis-private{color:#9fc0e8;border-color:#243243}
.pill.vis-public{color:#93cba4;border-color:#23392b}
.sub svg{flex:none}
.tag{margin-left:auto;background:#1f1f1f;border-radius:5px;padding:2px 7px;font-size:11px;color:#a8a8a8}
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
};
const VIS_LABEL = { public: 'Public', private: 'Private link', access: 'Sign-in' };
const KIND_LABEL = { static: 'Static', app: 'Server app' };

const SCRIPT = `
const rel = (iso) => {
  if (!iso) return 'never published';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 90) return 'Edited just now';
  if (d < 3600) return 'Edited ' + Math.round(d / 60) + 'm ago';
  if (d < 86400) return 'Edited ' + Math.round(d / 3600) + 'h ago';
  if (d < 86400 * 7) return 'Edited ' + Math.round(d / 86400) + 'd ago';
  return 'Edited ' + new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
for (const el of document.querySelectorAll('[data-at]')) el.textContent = rel(el.dataset.at);
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
`;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Self-contained page: no build step, no network beyond the previews themselves. */
export function galleryHtml(c: CatalogResult, opts: { title?: string } = {}): string {
  const title = opts.title ?? 'Cloudfacts';
  const projects = c.projects.map((p) => p.project).filter((p): p is string => Boolean(p));
  const total = c.projects.reduce((n, p) => n + p.deploys.length, 0);

  const card = (d: CatalogResult['projects'][number]['deploys'][number]): string => {
    const where = d.url ? esc(d.url) : '';
    // only a public static page renders in a frame: anything gated shows its own sign-in instead
    const preview =
      d.url && d.visibility === 'public' && d.kind === 'static'
        ? `<iframe src="${where}" loading="lazy" tabindex="-1" sandbox="allow-scripts" title=""></iframe>`
        : `<div class="fallback">${d.visibility === 'access' ? 'sign-in required' : d.visibility === 'private' ? 'private link' : 'no preview'}</div>`;
    const badge = d.inAccount ? '' : '<span class="tag">local tunnel</span>';
    const search = [d.name, d.project ?? '', d.url ?? '', VIS_LABEL[d.visibility], KIND_LABEL[d.kind]].join(' ').toLowerCase();
    return `<a class="card" href="${where || '#'}" target="_blank" rel="noopener"
  data-project="${esc(d.project ?? '')}" data-vis="${esc(d.visibility)}" data-kind="${esc(d.kind)}" data-search="${esc(search)}">
  <div class="shot">${preview}</div>
  <div class="meta">
    <p class="title">${esc(d.name)}</p>
    <div class="sub">
      <span class="pill vis-${esc(d.visibility)}">${ICON[d.visibility]}${VIS_LABEL[d.visibility]}</span>
      <span class="pill">${ICON[d.kind]}${KIND_LABEL[d.kind]}</span>
      ${badge}
    </div>
    <div class="sub when"><span data-at="${esc(d.modifiedAt ?? '')}"></span></div>
  </div>
</a>`;
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
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body>
<header>
  <h1>${esc(title)}</h1>
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
