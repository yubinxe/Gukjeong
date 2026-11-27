// 운영 소스 폴더에 이 저장소의 증분 모듈을 한 번에 올린다 (윈도·맥 공용, 의존성 0)
//   node scripts/apply.mjs <운영 소스 폴더>          미리 보기: 무엇이 바뀌는지만 보여 준다
//   node scripts/apply.mjs <운영 소스 폴더> --write  실제로 복사하고 통합 패치까지 적용
// 운영 파일(assets/·api/ 의 기존 함수)은 덮어쓰지 않고, 모듈 폴더만 더한다. 통합 패치는 기준 표지를 못 찾으면 멈춘다.
// 다음 단계: 운영 폴더에서 `vercel` (미리보기 배포) → 확인 → `vercel --prod`
import { cp, stat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("..", import.meta.url));
export const MODULES = ["briefing", "officials", "elections", "motion", "core", "cite", "world", "og", "api/briefing"];

async function exists(p) { try { await stat(p); return true; } catch { return false; } }
async function count(dir) { let n = 0; for (const e of await readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await count(join(dir, e.name)) : 1; return n; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] && resolve(process.argv[2]);
  const write = process.argv.includes("--write");
  if (!target) { console.error("사용법: node scripts/apply.mjs <운영 소스 폴더> [--write]"); process.exit(1); }
  for (const must of ["index.html", "assets/app.js", "assets/style.css"]) {
    if (!(await exists(join(target, must)))) { console.error(`운영 소스 폴더가 아닌 것 같습니다: ${must} 없음`); process.exit(1); }
  }
  console.log(`${write ? "적용" : "미리 보기"}: ${target}`);
  for (const m of MODULES) {
    const from = join(repo, m);
    if (!(await exists(from))) continue;
    console.log(`· ${m}/ (${await count(from)}개 파일)${(await exists(join(target, m))) ? " — 이미 있음, 새것으로 교체" : ""}`);
    if (write) await cp(from, join(target, m), { recursive: true, force: true, filter: (p) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(p) });
  }
  const r = spawnSync(process.execPath, [join(repo, "scripts/integrate.mjs"), target, ...(write ? [] : ["--dry"])], { stdio: "inherit" });
  if (r.status) process.exit(r.status);
  console.log(write ? "\n다음: 운영 폴더에서 `vercel` 로 미리보기 배포 → 화면 확인 → `vercel --prod`" : "\n문제가 없으면 같은 명령 끝에 --write 를 붙여 적용하십시오.");
}
