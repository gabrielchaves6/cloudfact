/**
 * The catalog as a page: a dark grid of cards, one per cloudfact in the account, with a live preview,
 * the project it belongs to, whether it is private and when it last changed. Published like any other
 * deploy, so the index of your sites is itself a cloudfact.
 */
import type { CatalogResult } from '../types.js';
import { compareCloudfacts, matchesCloudfact } from './gallery-filters.js';

const STYLE = `
@font-face{font-family:'CloudFacts Sans';src:url('./CloudFactsSans-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:'CloudFacts Sans';src:url('./CloudFactsSans-Medium.woff2') format('woff2');font-weight:500;font-style:normal;font-display:swap}
/* CloudFacts Sans ships weights 400 and 500 only: anything heavier is faked by the browser */
:root{--ink:#f4f4f1;--muted:#8e8e89;--surface:#141414;--line:#262626;--bg:#0d0d0d}
*{box-sizing:border-box}
[hidden]{display:none!important}
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
.title{display:flex;align-items:center;gap:8px;font-weight:500;font-size:15px;margin:0 0 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.title a{min-width:0;overflow:hidden;text-overflow:ellipsis}
.title .tag{flex:none}
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
.actions{display:flex;align-items:center;gap:7px;margin-top:10px}
.mini{background:#1c1c1c;border:1px solid #2c2c2c;color:#b4b4b4;border-radius:6px;padding:3px 9px;font:inherit;font-size:11.5px;cursor:pointer}
.mini:hover{background:#242424;color:var(--ink)}
.mini:disabled{opacity:.6;cursor:default}
/* the on/off switch: only on a catalog behind sign-in, only for what this page can actually switch */
.actions .switch{margin-left:4px}
.action-link{border:0;background:none;padding:3px 0;color:#a8aaa8;font:inherit;font-size:11.5px;cursor:pointer;text-decoration:none}
.action-link:hover{color:var(--ink);text-decoration:underline}
.action-link:focus-visible,.project-button:focus-visible{outline:1px solid #8e8e89;outline-offset:3px}
.project-button{border:0;background:none;color:#8e8e89;padding:3px;line-height:0;cursor:pointer}
.project-button:hover{color:var(--ink)}
.managed:disabled{opacity:.4;cursor:default}
body:not([data-control="1"]) .managed{display:none}
.toggle{width:34px;height:20px;flex:none;border:1px solid #343434;border-radius:999px;background:#232323;padding:2px;cursor:pointer;display:flex;align-items:center}
.toggle::before{content:"";width:14px;height:14px;border-radius:50%;background:#a0a09b;transition:transform .15s,background .15s}
.toggle[aria-checked="true"]{background:#284333;border-color:#3a5d48}
.toggle[aria-checked="true"]::before{transform:translateX(14px);background:#e5ede7}
.toggle:focus-visible{outline:1px solid #a6b5ac;outline-offset:3px}
.toggle:disabled{opacity:.4;cursor:wait}
.power{background:none;border:1px solid transparent;color:#6a6a6a;border-radius:999px;padding:2px;cursor:pointer;line-height:0}
.power:hover,.power:focus-visible{color:#f07575;background:#221414;border-color:#432424;outline:none}
.card[data-switch="0"] .switch,body:not([data-control="1"]) .switch{display:none}
.card.off .shot{filter:grayscale(1);opacity:.32}
.card.off .title a{color:#8a8a8a}
.confirm{margin-top:10px;padding:10px 11px;border:1px solid #3d2626;background:#1a1313;border-radius:9px;font-size:12px;line-height:1.45;color:#cdb9b9}
.confirm[hidden],.power-msg[hidden]{display:none}
.confirm div{display:flex;gap:7px;margin-top:9px}
.mini[data-on]{color:#b9dcc4;border-color:#27402f;background:#141d17}
.mini[data-on]:hover{background:#1a281f;color:#e3f5e8}
.mini.danger{background:#3b1c1c;border-color:#5c2c2c;color:#ffc2c2}
.mini.danger:hover{background:#4b2020;color:#fff}
.power-msg{margin:8px 0 0;font-size:11.5px;color:#e79a9a}
.creds{margin-top:9px;display:grid;gap:4px}
.creds[hidden]{display:none}
.creds div{display:flex;gap:8px;align-items:center;font-size:12px}
.creds span{color:#7d7d7d;min-width:38px}
.creds code{background:#1c1c1c;border:1px solid #2c2c2c;border-radius:5px;padding:2px 7px;color:#d8d8d8;user-select:all}
.creds code[data-copy]{cursor:copy}
.creds code[data-copy]:hover{border-color:#3d3d3d;color:var(--ink)}
.empty{color:#7a7a7a;padding:40px 0}
/* names get room for the longest one first; whatever is left is shared evenly by the other columns */
body.list main{display:grid;grid-template-columns:minmax(150px,max-content) repeat(6,minmax(max-content,1fr)) max-content;column-gap:clamp(8px,0.9vw,22px);overflow-x:auto}
body.list .table-head,body.list .grid,body.list .card,body.list .meta{display:grid;grid-template-columns:subgrid;grid-column:1/-1}
body.list main>.empty{grid-column:1/-1}
body.list .grid{row-gap:9px;column-gap:normal}
body.list .shot,body.list .card>.open{display:none}
body.list .card{padding:11px 15px}
body.list .meta{padding:0;align-items:center;row-gap:10px;min-width:0}
body.list .project-cell{grid-column:2;grid-row:1;margin:0}
body.list .title{grid-column:1;grid-row:1;margin:0;min-width:0}
body.list .summary{display:contents}
body.list .summary>*{grid-row:1;justify-self:start}
body.list .summary>.cell-size{grid-column:3}
body.list .summary>.cell-origin{grid-column:4}
body.list .summary>.cell-vis{grid-column:5}
body.list .summary>.cell-kind{grid-column:6}
body.list .when{grid-column:7;grid-row:1;margin:0;white-space:nowrap}
body.list .actions{grid-column:8;grid-row:1;display:grid;grid-template-columns:24px 24px 34px 24px 30px;gap:4px;align-items:center;justify-items:center;margin:0}
body.list .actions>[data-project-edit]{grid-column:1;grid-row:1}
body.list .actions>[data-copy]{grid-column:2;grid-row:1}
body.list .actions>[data-power]{grid-column:3;grid-row:1;margin:0}
body.list .actions>[data-remove]{grid-column:4;grid-row:1}
body.list .actions>[data-creds]{grid-column:5;grid-row:1}
body.list .confirm,body.list .project-editor,body.list .power-msg,body.list .creds,body.list .hintline{grid-column:1/-1;margin:0;min-width:0}
.project-cell{display:block;max-width:128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:4px 0 8px;color:#aaa;font-size:12.5px}
.project-cell.no-project{color:#686868}
.table-head{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0 10px;padding:0 16px;align-items:center}
body.list .table-head{column-gap:normal;row-gap:0}
.column-head{position:relative;min-width:0;display:flex;align-items:center;gap:3px;color:#8e8e89;font-size:12px}
.column-head:nth-child(1){grid-column:1}.column-head:nth-child(2){grid-column:2}.column-head:nth-child(3){grid-column:3}.column-head:nth-child(4){grid-column:4}.column-head:nth-child(5){grid-column:5}.column-head:nth-child(6){grid-column:6}.column-head:nth-child(7){grid-column:7}.column-head:nth-child(8){grid-column:8}
.column-head [data-sort]{border:0;background:none;padding:4px 0;color:inherit;font:inherit;cursor:pointer;text-align:left;display:flex;align-items:center;gap:4px}
.column-head [data-sort]:hover,.column-head[aria-sort=ascending],.column-head[aria-sort=descending]{color:var(--ink)}
.sort-direction{font-size:11px;min-width:9px}
.sort-direction:empty{display:none}
.filter-button{border:0;background:none;padding:4px;line-height:0;color:#686868;cursor:pointer;border-radius:4px}
.filter-button:hover,.filter-button[aria-pressed=true],.filter-button[aria-expanded=true]{color:var(--ink);background:#262626}
.column-head button:focus-visible{outline:1px solid #8e8e89;outline-offset:2px}
.column-filter-box{position:absolute;top:100%;left:0;z-index:10;min-width:170px;padding:9px;background:#1b1b1b;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 8px 24px #0008}
.column-head[data-column=modified] .column-filter-box{left:auto;right:0}
/* the list's column header already says "Atualizado"; the cards have no header */
body:not(.list) .when [data-at]:not([data-at=""])::before{content:'Edited '}
.cell-size{font-variant-numeric:tabular-nums;color:#b0b0b0;font-size:12.5px;white-space:nowrap}
.cell-size.unknown{color:#5f5f5f}
.cell-origin{display:inline-flex;align-items:center;gap:5px;color:#aaa;font-size:12.5px;white-space:nowrap}
.cell-origin svg{color:#777}
.column-filter-box input,.column-filter-box select{box-sizing:border-box;width:100%;background:#141414;border:1px solid #363636;border-radius:5px;padding:6px;color:var(--ink);font:inherit;font-size:12px}
.column-filter-box label{display:grid;gap:5px}
body:not(.list) #column-actions{display:none}
.project-editor{margin-top:10px;border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px;color:var(--muted)}
.project-editor label{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.project-editor input{background:#1b1b1b;border:1px solid #363636;border-radius:6px;padding:6px 8px;color:var(--ink);font:inherit;min-width:0}
@media(max-width:650px){header{padding:16px}.slogan{display:none}input[type=search]{width:130px}main{padding:4px 16px 32px}nav{padding:0 16px 16px}}
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
  project:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M8 13h8m-3-3 3 3-3 3"/></svg>',
  remove:
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>',
  copy: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
};
const ORIGIN_ICON = {
  cloudflare:
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10a4 4 0 0 1 0 8z"/></svg>',
  vm: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  ssh: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 4 4-4 4M12 16h7"/></svg>',
};
const ORIGIN_LABEL = { cloudflare: 'Cloudflare', vm: 'VM', ssh: 'SSH' };
const ORIGIN_TITLE = {
  cloudflare: 'Arquivos hospedados direto na Cloudflare',
  vm: 'Servido por uma VM, através de um túnel da Cloudflare',
  ssh: 'App em outra máquina, ligada à VM por SSH',
};
/** Megabytes (MiB), as the size column shows them. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return '< 0,1 MB';
  return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace('.', ',') + ' MB';
}
const VIS_LABEL = { public: 'Public', private: 'Private link', access: 'Sign-in', 'app-login': 'App login' };
const KIND_LABEL = { static: 'Static', app: 'Server app' };

const SCRIPT = `
const matchesCloudfact = ${matchesCloudfact.toString()};
const compareCloudfacts = ${compareCloudfacts.toString()};
const fit = () => {
  for (const shot of document.querySelectorAll('.shot')) shot.style.setProperty('--s', (shot.clientWidth / 1280).toFixed(4));
};
fit();
addEventListener('resize', fit);
const rel = (iso, fallback) => {
  if (!iso) return fallback;
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 90) return 'just now';
  if (d < 3600) return Math.round(d / 60) + 'm ago';
  if (d < 86400) return Math.round(d / 3600) + 'h ago';
  if (d < 86400 * 7) return Math.round(d / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
for (const el of document.querySelectorAll('[data-at]')) el.textContent = rel(el.dataset.at, el.textContent);
document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    e.preventDefault();
    if (copy.dataset.copying) return;
    copy.dataset.copying = '1';
    try { await navigator.clipboard.writeText(copy.dataset.copy); }
    catch { copy.title = 'Could not copy'; delete copy.dataset.copying; return; }
    const icon = copy.querySelector('svg');
    if (icon) {
      const was = copy.innerHTML;
      copy.title = 'Copied';
      copy.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
      setTimeout(() => { copy.innerHTML = was; copy.title = 'Copy link'; delete copy.dataset.copying; }, 1200);
    } else {
      const was = copy.textContent;
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = was; delete copy.dataset.copying; }, 1200);
    }
    return;
  }
  const show = e.target.closest('[data-creds]');
  if (show) {
    e.preventDefault();
    const box = show.closest('.meta').querySelector('.creds');
    box.hidden = !box.hidden;
    show.setAttribute('aria-expanded', String(!box.hidden));
  }
});
// All mutations go through the signed-in catalog Worker; secrets stay server-side.
const setOff = (card, off) => {
  card.classList.toggle('off', off);
  card.dataset.search = card.dataset.search.replace(/ off$/, '') + (off ? ' off' : '');
  const toggle = card.querySelector('[data-power]');
  if (toggle) {
    toggle.setAttribute('aria-checked', String(!off));
    toggle.title = off ? 'Turn on' : 'Turn off';
    toggle.setAttribute('aria-label', (off ? 'Turn on ' : 'Turn off ') + card.dataset.name);
  }
};
const say = (card, text) => {
  const msg = card.querySelector('.power-msg');
  msg.textContent = text;
  msg.hidden = !text;
};
const closePanels = (except) => {
  for (const box of document.querySelectorAll('.confirm,.project-editor')) if (box !== except) box.hidden = true;
};
const mutate = async (route, body) => {
  const res = await fetch('/.cloudfact/' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-cloudfact': '1' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'HTTP ' + res.status);
  return data;
};
const removeCard = (card) => {
  card.remove();
  apply();
};
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-power],[data-remove],[data-remove-yes],[data-remove-no],[data-project-edit],[data-project-save],[data-project-cancel]');
  if (!button || button.disabled) return;
  const card = button.closest('.card');
  const box = card.querySelector('.confirm');
  const editor = card.querySelector('.project-editor');
  say(card, '');
  if (button.hasAttribute('data-remove') || button.hasAttribute('data-project-edit')) {
    const panel = button.hasAttribute('data-remove') ? box : editor;
    closePanels(panel);
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.querySelector('input,button').focus();
    return;
  }
  if (button.hasAttribute('data-remove-no') || button.hasAttribute('data-project-cancel')) {
    closePanels(null);
    return;
  }
  button.disabled = true;
  const label = button.textContent;
  button.setAttribute('aria-busy', 'true');
  if (button.hasAttribute('data-remove-yes')) button.textContent = 'Deleting…';
  if (button.hasAttribute('data-project-save')) button.textContent = 'Moving…';
  try {
    if (button.hasAttribute('data-power')) {
      const data = await mutate('power', { name: card.dataset.name, on: card.classList.contains('off') });
      setOff(card, data.on === false);
      apply();
    } else if (button.hasAttribute('data-remove-yes')) {
      const data = await mutate('remove', { name: card.dataset.name, confirm: card.dataset.name });
      if (!data.removed) throw new Error('Deletion was not confirmed.');
      removeCard(card);
      if (data.warning) alert(data.warning);
    } else {
      const data = await mutate('project', { name: card.dataset.name, project: editor.querySelector('input').value.trim() || null });
      if (data.warning) { say(card, data.warning); return; }
      location.reload();
    }
  } catch (err) { say(card, err.message); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = label; }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePanels(null); closeColumnFilters(null); } });
if (document.body.dataset.control === '1')
  fetch('/.cloudfact/state', { headers: { 'x-cloudfact': '1' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(({ deploys }) => {
      for (const card of document.querySelectorAll('.card')) {
        const st = deploys[card.dataset.name];
        if (!st) continue;
        if (st.removed) { removeCard(card); continue; }
        if (st.error) card.dataset.switch = '0';
        else setOff(card, !st.on);
      }
    }).catch(() => {});
const search = document.getElementById('q');
const container = document.getElementById('cloudfacts');
const filterFields = Object.fromEntries([...document.querySelectorAll('[data-filter]')].map((el) => [el.dataset.filter, el]));
let sortKey = 'modified', descending = true;
const rowData = (card) => ({
  name: card.dataset.name, project: card.dataset.project || null, visibility: card.dataset.vis, kind: card.dataset.kind,
  modifiedAt: card.dataset.modified || null, search: card.dataset.search,
  bytes: card.dataset.bytes ? Number(card.dataset.bytes) : null,
  origin: card.dataset.origin,
  originLabel: card.querySelector('.cell-origin').textContent,
  visibilityLabel: card.querySelector('.cell-vis').textContent,
  kindLabel: card.querySelector('.cell-kind').textContent,
});
const closeColumnFilters = (except) => {
  for (const box of document.querySelectorAll('.column-filter-box')) {
    if (box !== except) {
      box.hidden = true;
      box.parentElement.querySelector('[data-filter-open]').setAttribute('aria-expanded', 'false');
    }
  }
};
const apply = () => {
  const filters = Object.fromEntries(Object.entries(filterFields).map(([key, el]) => [key, el.value]));
  filters.query = search.value;
  const rows = [...container.querySelectorAll('.card')].map((card) => ({ card, row: rowData(card) }));
  for (const { card, row } of rows) card.hidden = !matchesCloudfact(row, filters);
  if (sortKey) rows.sort((a, b) => compareCloudfacts(a.row, b.row, sortKey, descending));
  rows.forEach(({ card }, i) => { if (container.children[i] !== card) container.insertBefore(card, container.children[i] || null); });
  document.getElementById('empty').hidden = rows.some(({ card }) => !card.hidden);
  for (const el of Object.values(filterFields)) {
    const active = el.value !== (el.tagName === 'INPUT' ? '' : '*');
    el.closest('.column-head').querySelector('[data-filter-open]').setAttribute('aria-pressed', String(active));
  }
};
search.addEventListener('input', apply);
for (const field of Object.values(filterFields)) field.addEventListener(field.tagName === 'INPUT' ? 'input' : 'change', apply);
for (const button of document.querySelectorAll('[data-sort]')) button.addEventListener('click', () => {
  const key = button.dataset.sort;
  descending = key === sortKey ? !descending : key === 'modified' || key === 'size';
  sortKey = key;
  for (const head of document.querySelectorAll('.column-head[data-column]')) {
    const active = head.dataset.column === key;
    head.setAttribute('aria-sort', active ? (descending ? 'descending' : 'ascending') : 'none');
    head.querySelector('.sort-direction').textContent = active ? (descending ? '↓' : '↑') : '';
  }
  closeColumnFilters(null);
  apply();
});
for (const button of document.querySelectorAll('[data-filter-open]')) button.addEventListener('click', () => {
  const box = button.parentElement.querySelector('.column-filter-box');
  closeColumnFilters(box);
  box.hidden = !box.hidden;
  button.setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden) box.querySelector('input,select').focus();
});
document.addEventListener('click', (e) => { if (!e.target.closest('.column-head')) closeColumnFilters(null); });
const view = document.getElementById('view');
view.addEventListener('click', () => {
  const list = document.body.classList.toggle('list');
  view.setAttribute('aria-pressed', String(list));
  try { localStorage.setItem('cloudfact-view-v2', list ? 'list' : 'grid'); } catch {}
  fit();
});
try { if (localStorage.getItem('cloudfact-view-v2') === 'grid') view.click(); } catch {}
fit();
`;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Self-contained page: no build step, no network beyond the previews themselves. */
const originOf = (d: CatalogResult['projects'][number]['deploys'][number]): keyof typeof ORIGIN_LABEL =>
  d.origin ?? (d.backend === 'tunnel' ? 'vm' : 'cloudflare');

export function galleryHtml(
  c: CatalogResult,
  opts: { title?: string; snapshots?: Record<string, string>; control?: boolean } = {},
): string {
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
    const search =
      [d.name, d.project ?? '', d.url ?? '', ORIGIN_LABEL[originOf(d)], VIS_LABEL[d.visibility], KIND_LABEL[d.kind]].join(' ').toLowerCase() +
      (d.off ? ' off' : '');
    const origin = originOf(d);
    const bytes = typeof d.bytes === 'number' && Number.isFinite(d.bytes) ? d.bytes : null;
    const open = d.openUrl ?? d.url ?? '';
    const creds = d.creds
      ? `<div class="creds" hidden>${[
          d.creds.user ? `<div><span>user</span><code data-copy="${esc(d.creds.user)}">${esc(d.creds.user)}</code></div>` : '',
          d.creds.password ? `<div><span>pass</span><code data-copy="${esc(d.creds.password)}">${esc(d.creds.password)}</code></div>` : '',
          d.creds.note ? `<div><span>note</span><code>${esc(d.creds.note)}</code></div>` : '',
        ].join('')}</div>`
      : '';
    const switchable = Boolean(opts.control && d.switchable);
    const manageable = Boolean(opts.control && d.removable);
    const actions = `<div class="actions" role="cell">
      ${manageable ? `<button class="project-button managed" data-project-edit title="Move to project" aria-label="Move ${esc(d.name)} to project">${ICON.project}</button>` : ''}
      ${open ? `<button class="project-button" data-copy="${esc(open)}" title="Copy link" aria-label="Copy link for ${esc(d.name)}">${ICON.copy}</button>` : ''}
      ${switchable ? `<button class="toggle switch" data-power role="switch" aria-checked="${!d.off}" title="${d.off ? 'Turn on' : 'Turn off'}" aria-label="${d.off ? 'Turn on' : 'Turn off'} ${esc(d.name)}"></button>` : ''}
      ${manageable ? `<button class="power managed" data-remove title="Delete" aria-label="Delete ${esc(d.name)}">${ICON.remove}</button>` : ''}
      ${d.creds ? '<button class="action-link" data-creds>Login</button>' : ''}
    </div>`;
    const confirm = manageable
      ? `<div class="confirm" hidden>Delete <strong>${esc(d.name)}</strong>? This removes the cloudfact and its link. Source files are kept.
      <div><button class="mini danger" data-remove-yes>Delete permanently</button><button class="mini" data-remove-no>Cancel</button></div></div>`
      : '';
    const editor = manageable
      ? `<div class="project-editor" hidden><label>Project <input list="projects" value="${esc(d.project ?? '')}" placeholder="No project" aria-label="Project for ${esc(d.name)}"><button class="mini" data-project-save>Move</button><button class="mini" data-project-cancel>Cancel</button></label><p>Choose a project, type a new name, or leave empty for no project.</p></div>`
      : '';
    return `<div class="card${d.off ? ' off' : ''}" data-name="${esc(d.name)}"${switchable ? ' data-switch="1"' : ''} data-project="${esc(d.project ?? '')}" data-vis="${esc(d.visibility)}" data-kind="${esc(d.kind)}" data-origin="${origin}" data-bytes="${bytes ?? ''}" data-search="${esc(search)}" data-modified="${esc(d.modifiedAt ?? '')}" role="row">
  <a class="open" href="${esc(open) || '#'}" target="_blank" rel="noopener">
  <div class="shot">${preview}</div>
  </a>
  <div class="meta" role="presentation">
    <p class="title" role="cell"><a href="${esc(open) || '#'}" target="_blank" rel="noopener" title="${esc(d.name)}">${esc(d.name)}</a>${badge}</p>
    <span class="project-cell${d.project ? '' : ' no-project'}" role="cell" title="${esc(d.project ?? 'Sem projeto')}">${esc(d.project ?? 'Sem projeto')}</span>
    <div class="sub summary" role="presentation">
      <span class="cell-size${bytes === null ? ' unknown' : ''}" role="cell"${
        bytes === null ? ` title="${d.kind === 'app' ? 'Um app não publica arquivos' : 'Tamanho desconhecido'}"` : ''
      }>${formatBytes(bytes)}</span>
      <span class="cell-origin" role="cell" title="${ORIGIN_TITLE[origin]}">${ORIGIN_ICON[origin]}${ORIGIN_LABEL[origin]}</span>
      <span class="pill cell-vis vis-${esc(d.visibility)}" role="cell">${ICON[d.visibility]}${VIS_LABEL[d.visibility]}</span>
      <span class="pill cell-kind" role="cell">${ICON[d.kind]}${KIND_LABEL[d.kind]}</span>
    </div>
    <div class="sub when" role="cell"><span data-at="${esc(d.modifiedAt ?? '')}">${d.modifiedAt ? '' : esc(d.status === 'running' ? 'Live now' : 'No date')}</span></div>
    ${actions}
    ${confirm}
    ${editor}
    ${opts.control ? '<p class="power-msg" hidden></p>' : ''}
    ${creds}
    ${d.visibility === 'app-login' && !d.creds ? '<p class="hintline">Its own login. Record it with <code>cloudfact creds</code> to keep it here.</p>' : ''}
  </div>
</div>`;
  };

  const entries = c.projects.flatMap((p) => p.deploys);
  const options = (values: [string, string][]) =>
    values.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  const column = (
    key: string,
    label: string,
    filter: string,
  ) => `<div class="column-head" data-column="${key}" role="columnheader" aria-sort="${key === 'modified' ? 'descending' : 'none'}">
    <button data-sort="${key}" title="Ordenar por ${label}">${label}<span class="sort-direction" aria-hidden="true">${key === 'modified' ? '↓' : ''}</span></button>
    <button class="filter-button" data-filter-open="${key}" title="Filtrar por ${label}" aria-label="Filtrar por ${label}" aria-expanded="false" aria-pressed="false" aria-controls="filter-${key}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 4h18l-7 8v6l-4 2v-8z"/></svg></button>
    <div class="column-filter-box" id="filter-${key}" hidden><label>Filtrar ${label}${filter}</label></div>
  </div>`;
  const head = `<div class="table-head" role="row">
    ${column('name', 'Cloudfact', '<input data-filter="name" type="search" aria-label="Filtrar Cloudfact" placeholder="Nome do cloudfact">')}
    ${column('project', 'Projeto', `<select data-filter="project" aria-label="Filtrar Projeto">${options([['*', 'Todos'], ['', 'Sem projeto'], ...projects.map((p): [string, string] => [p, p])])}</select>`)}
    ${column(
      'size',
      'Tamanho',
      `<select data-filter="size" aria-label="Filtrar Tamanho">${options([
        ['*', 'Todos'],
        ['small', 'Até 1 MB'],
        ['medium', '1 a 10 MB'],
        ['large', 'Mais de 10 MB'],
        ['none', 'Sem tamanho'],
      ])}</select>`,
    )}
    ${column('origin', 'Local', `<select data-filter="origin" aria-label="Filtrar Local">${options([['*', 'Todos'], ...Object.entries(ORIGIN_LABEL)])}</select>`)}
    ${column('visibility', 'Acesso', `<select data-filter="visibility" aria-label="Filtrar Acesso">${options([['*', 'Todos'], ...Object.entries(VIS_LABEL)])}</select>`)}
    ${column('kind', 'Tipo', `<select data-filter="kind" aria-label="Filtrar Tipo">${options([['*', 'Todos'], ...Object.entries(KIND_LABEL)])}</select>`)}
    ${column(
      'modified',
      'Atualizado',
      `<select data-filter="modified" aria-label="Filtrar Atualizado">${options([
        ['*', 'Todas as datas'],
        ['day', 'Últimas 24 horas'],
        ['week', 'Últimos 7 dias'],
        ['month', 'Últimos 30 dias'],
        ['none', 'Sem data'],
      ])}</select>`,
    )}
    <div class="column-head" id="column-actions" role="columnheader">Ações</div>
  </div>`;
  const rows = [...entries]
    .sort((a, b) => compareCloudfacts({ ...a, search: '' }, { ...b, search: '' }, 'modified', true))
    .map(card)
    .join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="./favicon.png" sizes="any">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body class="list"${opts.control ? ' data-control="1"' : ''}>
<header>
  <div class="brand">
    <img src="./symbol.png" alt="" width="26" height="26">
    <h1>${esc(title)}<span class="slogan">Your stuff, flexible, everywhere.</span></h1>
  </div>
  <div class="tools">
    <input id="q" type="search" placeholder="Search" aria-label="Buscar cloudfacts">
    <button class="icon" id="view" aria-pressed="true" title="Toggle list view" aria-label="Toggle list view">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  </div>
</header>
<datalist id="projects">${projects.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
<main role="table" aria-label="Cloudfacts">
${head}
<div class="grid" id="cloudfacts" role="rowgroup">${rows}</div>
<p class="empty" id="empty"${total ? ' hidden' : ''}>Nenhum cloudfact encontrado.</p>
</main>
<footer>${esc(c.accountName ?? c.accountId)}${c.subdomain ? ` · ${esc(c.subdomain)}.workers.dev` : ''} · generated by cloudfact</footer>
<script>${SCRIPT}</script>
</body></html>`;
}
