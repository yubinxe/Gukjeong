// 국정 상황판 · 바닥글 '이 화면 인용하기' — 페이지가 따로 인용 정보를 주지 않으면 문서 정보(제목·주소)로 만든다.
// 페이지는 window.__citeMeta = () => ({ title, sub, issued, kind, … }) 로 덧붙일 수 있다(홈은 core.js 가 지금 보기와 수집 시각을 준다).
import { mount } from './cite.js?v=1';

const SUFFIX = /\s*[—·-]\s*국정 상황판\s*$/;
function docMeta() {
  const og = document.querySelector('meta[property="og:title"]')?.content || document.title;
  const t = (og || '').replace(SUFFIX, '').trim() || '국정 상황판';
  return { title: t, kind: 'webpage', url: location.href };
}
function run() {
  const foot = document.querySelector('footer.foot');
  if (!foot || foot.querySelector('.ct-row')) return;
  const row = Object.assign(document.createElement('p'), { className: 'ct-row' });
  foot.append(row);
  mount(row, () => ({ ...docMeta(), ...(window.__citeMeta?.() || {}) }), { label: '이 화면 인용하기' });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
