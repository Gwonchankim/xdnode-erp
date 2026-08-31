import postcss from "postcss";
import { readFileSync, writeFileSync } from "node:fs";

const files = ["app/globals.css", "public/hr-workspace.css"];
const apply = process.argv.includes("--write");

for (const file of files) {
  const css = readFileSync(file, "utf8");
  const root = postcss.parse(css);

  // Pass 1: index every (media || single-selector || property) occurrence in source order.
  const occ = new Map();
  let blockSeq = 0;
  root.walkRules((rule) => {
    const media = rule.parent?.type === "atrule"
      ? `@${rule.parent.name} ${rule.parent.params.replace(/\s+/g, "")}` : "";
    const block = blockSeq++;
    rule.selectors.forEach((sel) => {
      rule.walkDecls((decl) => {
        const key = `${media}||${sel.trim()}||${decl.prop}`;
        if (!occ.has(key)) occ.set(key, []);
        occ.get(key).push({ decl, block, important: decl.important });
      });
    });
  });

  // Which (key, decl) pairs lose? Same selector + same media means identical specificity, so
  // source order decides unless !important intervenes.
  const losesFor = new Map(); // decl -> Set of keys where it is overridden
  for (const list of occ.values()) {
    if (list.length < 2) continue;
    let winner = list[0];
    for (const cur of list.slice(1)) {
      if (winner.important && !cur.important) continue;
      winner = cur;
    }
    for (const cur of list) {
      if (cur === winner || cur.block === winner.block) continue; // same block = fallback idiom
      if (!losesFor.has(cur.decl)) losesFor.set(cur.decl, new Set());
      losesFor.get(cur.decl).add(cur);
    }
  }

  // A declaration may only go if EVERY selector its rule carries is overridden for that property.
  // `html, body { color: X }` beside a later `body { color: Y }` overrides only the body half —
  // dropping the declaration would strip html's colour too, which is what broke the first attempt.
  let removedDecls = 0, keptShared = 0;
  const doomed = [];
  root.walkRules((rule) => {
    const media = rule.parent?.type === "atrule"
      ? `@${rule.parent.name} ${rule.parent.params.replace(/\s+/g, "")}` : "";
    rule.walkDecls((decl) => {
      const overriddenCount = rule.selectors.filter((sel) => {
        const list = occ.get(`${media}||${sel.trim()}||${decl.prop}`) || [];
        const mine = list.find((e) => e.decl === decl);
        return mine && losesFor.has(decl) && losesFor.get(decl).has(mine);
      }).length;
      if (overriddenCount === 0) return;
      if (overriddenCount === rule.selectors.length) doomed.push(decl);
      else keptShared++;
    });
  });

  doomed.forEach((d) => { d.remove(); removedDecls++; });
  let removedRules = 0, removedAtRules = 0;
  root.walkRules((rule) => { if (rule.nodes.length === 0) { rule.remove(); removedRules++; } });
  root.walkAtRules((at) => {
    if (["media", "supports"].includes(at.name) && at.nodes && at.nodes.length === 0) { at.remove(); removedAtRules++; }
  });

  const out = root.toString();
  console.log(`\n=== ${file} ===`);
  console.log(`  제거: 선언 ${removedDecls} / 빈 규칙 ${removedRules} / 빈 미디어 ${removedAtRules}`);
  console.log(`  일부 선택자만 덮여 보존: ${keptShared}`);
  console.log(`  크기: ${(css.length/1024).toFixed(0)}KB → ${(out.length/1024).toFixed(0)}KB`);
  if (apply) { writeFileSync(file, out); console.log("  → 기록함"); }
}
if (!apply) console.log("\n(미리보기 — 적용하려면 --write)");
