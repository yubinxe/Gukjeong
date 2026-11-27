// 국정 상황판 · 인용하기 대화상자 (의존성 0). 쓰는 쪽은 mount(단추를 놓을 곳, 인용 정보를 돌려주는 함수)만 부른다.
import { FORMATS, citeKey, normalize } from './lib.mjs?v=1';

const css = new URL('./cite.css?v=1', import.meta.url).href;
if (!document.querySelector(`link[href="${css}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: css }));

let dlg, cur, fmt = 'apa';
function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'ct';
  dlg.setAttribute('aria-labelledby', 'ctH');
  dlg.innerHTML = `<form method="dialog" class="ct-in">
    <header class="ct-h"><h2 id="ctH">이 화면 인용하기</h2><button class="ct-x" value="close" aria-label="닫기">닫기</button></header>
    <p class="ct-what" id="ctWhat"></p>
    <div class="ct-tabs" role="tablist" aria-label="인용 형식">${FORMATS.map((f) => `<button type="button" role="tab" data-f="${f.id}">${f.name}</button>`).join('')}</div>
    <pre class="ct-out" id="ctOut" tabindex="0" aria-live="polite"></pre>
    <div class="ct-act"><button type="button" class="ct-btn" id="ctCopy">복사</button><button type="button" class="ct-btn ghost" id="ctSave" hidden>파일로 저장</button><span class="ct-msg" id="ctMsg" role="status"></span></div>
    <p class="ct-note">바뀌는 화면이라 열람일과 자료 기준 시각을 함께 적습니다. 주소에는 지금 고른 조건이 들어 있어 같은 화면을 다시 열 수 있습니다. 학술지마다 세부 규정이 다르니 투고 규정에 맞춰 다듬어 쓰십시오.</p>
  </form>`;
  document.body.append(dlg);
  dlg.querySelector('.ct-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { fmt = b.dataset.f; paint(); } });
  dlg.querySelector('.ct-tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = FORMATS.findIndex((f) => f.id === fmt), n = FORMATS[(i + (e.key === 'ArrowRight' ? 1 : FORMATS.length - 1)) % FORMATS.length];
    fmt = n.id; paint(); dlg.querySelector(`[data-f="${n.id}"]`).focus(); e.preventDefault();
  });
  dlg.querySelector('#ctCopy').addEventListener('click', async () => {
    const t = dlg.querySelector('#ctOut').textContent;
    try { await navigator.clipboard.writeText(t); say('복사했습니다'); }
    catch { const r = document.createRange(); r.selectNodeContents(dlg.querySelector('#ctOut')); getSelection().removeAllRanges(); getSelection().addRange(r); say('선택해 두었습니다 — 복사 단축키를 누르세요'); }
  });
  dlg.querySelector('#ctSave').addEventListener('click', () => {
    const f = FORMATS.find((x) => x.id === fmt);
    save(`${citeKey(cur)}.${f.file}`, dlg.querySelector('#ctOut').textContent, f.mime);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}
function say(t) { const m = dlg.querySelector('#ctMsg'); m.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { m.textContent = ''; }, 2400); }
function paint() {
  const f = FORMATS.find((x) => x.id === fmt);
  dlg.querySelectorAll('[data-f]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.f === fmt)); b.tabIndex = b.dataset.f === fmt ? 0 : -1; });
  dlg.querySelector('#ctOut').textContent = f.fn(cur);
  const save = dlg.querySelector('#ctSave'); save.hidden = !f.file; if (f.file) save.textContent = `.${f.file} 파일로 저장`;
}
export function save(name, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000); // 바로 지우면 일부 브라우저가 파일 이름을 잃는다
}
export function openCite(meta) {
  if (!dlg) build();
  cur = normalize(meta);
  dlg.querySelector('#ctWhat').innerHTML = '';
  dlg.querySelector('#ctWhat').append(document.createTextNode(`${cur.title}${cur.sub ? ` — ${cur.sub}` : ''}`));
  paint();
  dlg.showModal();
}
// 단추를 놓는다. getMeta 는 누르는 순간의 화면 상태(고른 조건·자료 시각)를 돌려준다.
export function mount(target, getMeta, { label = '인용하기', cls = '' } = {}) {
  if (!target) return null;
  const b = Object.assign(document.createElement('button'), { type: 'button', className: `ct-open ${cls}`.trim(), textContent: label });
  b.addEventListener('click', () => openCite(getMeta()));
  target.append(b);
  return b;
}
