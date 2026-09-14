import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const g = readFileSync("app/globals.css", "utf8");
const h = readFileSync("public/hr-workspace.css", "utf8");
const tsx = execSync('grep -rho "var(--[a-zA-Z0-9-]*)" app --include=*.tsx --include=*.css || true').toString();

const defs = [...g.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]);
const uniq = [...new Set(defs)];
const count = (hay, name) => {
  let n = 0, i = 0;
  const needle = `var(${name}`;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    const next = hay[i + needle.length];
    if (next === ")" || next === "," || next === " ") n++;
    i += needle.length;
  }
  return n;
};
const rows = uniq.map((v) => ({ v, g: count(g, v), h: count(h, v), t: count(tsx, v) }));
const dead = rows.filter((r) => r.g + r.h + r.t === 0);
console.log(`정의된 변수 ${uniq.length}개\n`);
console.log(`=== 사용처 0 (죽은 변수) ${dead.length}개 ===`);
dead.forEach((r) => console.log("  " + r.v));
console.log(`\n=== 사용 중 ${rows.length - dead.length}개 ===`);
rows.filter((r) => r.g + r.h + r.t > 0).sort((a, b) => (b.g + b.h + b.t) - (a.g + a.h + a.t))
  .forEach((r) => console.log(`  ${r.v.padEnd(26)} globals ${String(r.g).padStart(3)}  hr ${String(r.h).padStart(3)}  기타 ${r.t}`));
