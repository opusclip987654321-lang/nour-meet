#!/usr/bin/env node
// Hook PreToolUse (Read/Edit/Write/MultiEdit) : refuse deux familles de fichiers.
// 1. Les vrais fichiers d'environnement (.env, .env.staging…) — ils contiennent les secrets de
//    production ; seuls les modèles *.example / *.sample restent accessibles.
// 2. Les migrations Prisma déjà commitées (apps/api/prisma/migrations/*/migration.sql) : elles sont
//    peut-être déjà appliquées en production, les modifier désynchronise la base. Créer une nouvelle
//    migration reste permis (fichier absent de git).
import { execFileSync } from "node:child_process";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const tool = input.tool_name ?? "";
const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
if (!filePath) process.exit(0);

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  process.exit(0);
};

const base = path.basename(filePath);
if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample)$/.test(base)) {
  deny(`${base} contient de vrais secrets : accès refusé par le hook du projet. Utiliser le fichier .example correspondant, ou demander à l'utilisateur la valeur nécessaire.`);
}

if (tool !== "Read" && /apps\/api\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(filePath)) {
  const repoRoot = input.cwd ?? process.cwd();
  const rel = path.relative(repoRoot, path.resolve(repoRoot, filePath));
  let committed = false;
  try { execFileSync("git", ["cat-file", "-e", `HEAD:${rel}`], { cwd: repoRoot, stdio: "ignore" }); committed = true; } catch { /* nouvelle migration */ }
  if (committed) deny(`${rel} est une migration déjà commitée (peut-être déjà appliquée en production) : ne jamais la modifier. Créer une nouvelle migration à la place (/nouvelle-migration).`);
}
