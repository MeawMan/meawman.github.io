// Admin preview. Loaded only for index.html?preview=1: renders the draft that
// admin.html saved in localStorage with the same templates the build uses.
import { renderHomeBody } from '../templates/site.mjs';
import { mapSprite } from '../templates/map.mjs';

export async function preview(reinit) {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem('mrj_draft') || 'null'); } catch (e) { /* ignore */ }
  if (!draft) return;
  const meta = await (await fetch(new URL('../../assets/dist/build-meta.json', import.meta.url))).json();
  const ctx = { data: draft, build: meta };
  const main = document.getElementById('main');
  document.querySelectorAll('.sprite, .cite-dlg').forEach((el) => el.remove());
  main.innerHTML = renderHomeBody(ctx);
  main.insertAdjacentHTML('beforebegin', mapSprite(meta.geo));
  const dlg = main.querySelector('.cite-dlg');
  if (dlg) document.body.appendChild(dlg);
  document.title = '[Preview] ' + (draft.meta && draft.meta.title ? draft.meta.title : '');
  const bar = document.createElement('p');
  bar.className = 'preview-bar';
  bar.setAttribute('role', 'status');
  bar.textContent = 'Preview of your unpublished draft. Dates, screenshots and the CV link come from the last build.';
  document.body.prepend(bar);
  reinit();
}
