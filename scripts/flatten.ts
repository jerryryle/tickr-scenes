// Flatten a scene's ES modules into the single scene.ts that tickr runs, keeping it TypeScript.
//
//   node scripts/flatten.ts <entry.ts> [--root <dir>] [--define NAME=VALUE ...] > scene.ts
//
// tickr stores a scene as one source file that may import only npm packages, and every standard
// bundler emits JavaScript. This does the one thing they don't: starting at the entry, it
// follows relative imports in the order ES modules run (each module after the modules it
// imports), drops relative imports and `export` modifiers, and joins the modules under one
// `// ==== <file> ====` banner each. Package imports are hoisted to the top, unchanged.
//
// Because the modules end up in one scope, the rules are: no two modules declare the same
// top-level name; local imports name things as declared (no `as`, `* as` or default imports);
// only the entry has `export default`. --define replaces the value of a top-level
// `const NAME = ...;` (for test builds). --root sets the directory banners are relative to.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";

const fail = (msg: string): never => {
  console.error(`flatten: ${msg}`);
  process.exit(1);
};

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { root: { type: "string" }, define: { type: "string", multiple: true, default: [] } },
});
if (positionals.length !== 1) fail("usage: node scripts/flatten.ts <entry.ts> [--root dir] [--define NAME=VALUE]");
const entry = path.resolve(positionals[0]);
const root = path.resolve(opts.root ?? path.dirname(entry));

interface Module { file: string; body: string }
const order: Module[] = [];
const state = new Map<string, "visiting" | "done">();
const packageImports = new Map<string, string>();   // import line -> first module using it
const declaredBy = new Map<string, string>();       // top-level name -> module

const where = (sf: ts.SourceFile, node: ts.Node) =>
  `${path.relative(process.cwd(), sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

function visit(file: string, from?: string) {
  if (state.get(file) === "done") return;
  if (state.get(file) === "visiting") return;   // a cycle: like ES modules, the first visit wins
  if (!fs.existsSync(file)) fail(`${from ?? "entry"} imports ${file}, which does not exist`);
  state.set(file, "visiting");
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
  const dropLines = new Set<number>();
  const cuts: [number, number][] = [];

  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      const spec = (s.moduleSpecifier as ts.StringLiteral).text;
      for (let l = lineOf(s.getStart()); l <= lineOf(s.getEnd()); l++) dropLines.add(l);
      if (!spec.startsWith(".")) {
        const line = s.getText();
        if (!packageImports.has(line)) packageImports.set(line, file);
        continue;
      }
      const c = s.importClause;
      const nb = c?.namedBindings;
      if (c?.name || (nb && ts.isNamespaceImport(nb)) || (nb && nb.elements.some((e) => e.propertyName)))
        fail(`${where(sf, s)}: local imports must name things as declared (no default, \`* as\` or \`as\`)`);
      visit(path.resolve(path.dirname(file), spec), path.relative(process.cwd(), file));
      continue;
    }
    if (ts.isExportAssignment(s) && !s.isExportEquals) {
      if (file !== entry) fail(`${where(sf, s)}: only the entry module may \`export default\``);
      continue;
    }
    if (ts.isExportDeclaration(s) || ts.isExportAssignment(s))
      fail(`${where(sf, s)}: export declarations directly instead of \`${s.getText().split("\n")[0]}\``);
    const mods = (ts.canHaveModifiers(s) && ts.getModifiers(s)) || [];
    const exp = mods.find((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exp && mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      if (file !== entry) fail(`${where(sf, s)}: only the entry module may \`export default\``);
    } else if (exp) {
      let end = exp.getEnd();
      while (text[end] === " ") end++;
      cuts.push([exp.getStart(), end]);
    }
    for (const name of declaredNames(s)) {
      const prev = declaredBy.get(name);
      if (prev && prev !== file) fail(`${where(sf, s)}: top-level ${name} is also declared in ${path.relative(process.cwd(), prev)}`);
      declaredBy.set(name, file);
    }
  }

  let out = text;
  for (const [a, b] of cuts.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + out.slice(b);
  const lines = out.split("\n");
  for (const l of [...dropLines].filter((l) => !dropLines.has(l + 1)))
    if (lines[l + 1] === "") dropLines.add(l + 1);   // the blank line after an import block
  order.push({ file, body: lines.filter((_, i) => !dropLines.has(i)).join("\n").trimEnd() });
  state.set(file, "done");
}

function declaredNames(s: ts.Statement): string[] {
  const binding = (n: ts.BindingName): string[] => ts.isIdentifier(n) ? [n.text]
    : n.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : binding(e.name)));
  if (ts.isVariableStatement(s)) return s.declarationList.declarations.flatMap((d) => binding(d.name));
  if (ts.isFunctionDeclaration(s) && s.name && !s.body) return [];   // overload signatures
  if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) ||
       ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) return [s.name.text];
  return [];
}

visit(entry);

let code = [
  `// Generated from ${path.relative(process.cwd(), root) || "."}/ by scripts/flatten.ts: edit the modules, not this file.`,
  ...packageImports.keys(),
  "",
  ...order.map((m) => `// ==== ${path.relative(root, m.file)} `.padEnd(79, "=") + "\n" + m.body + "\n"),
].join("\n");

for (const d of opts.define) {
  const eq = d.indexOf("=");
  if (eq < 1) fail(`--define needs NAME=VALUE, got ${d}`);
  const name = d.slice(0, eq), raw = d.slice(eq + 1);
  const value = /^(-?\d+(\.\d+)?|true|false|".*")$/.test(raw) ? raw : JSON.stringify(raw);
  const re = new RegExp(`^(const ${name}\\b(?:\\s*:[^=]+)?\\s*=\\s*)[^;]*;`, "gm");
  const hits = code.match(re)?.length ?? 0;
  if (hits !== 1) fail(`--define ${name}: expected one top-level \`const ${name} = ...;\`, found ${hits}`);
  code = code.replace(re, `$1${value};`);
}
process.stdout.write(code);
