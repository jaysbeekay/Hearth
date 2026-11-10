import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// #637 — GLOSSARY.md names the thing a household owns an **Item** and lists
// "inventory item" under Avoid. No user-facing copy in the web app or the
// phone shell may say "Inventory item(s)". Only string literals, template
// text and JSX text are checked, so code identifiers (INVENTORY,
// inventoryItem, inventory_item) and comments are exempt by construction;
// so are server log lines (console.*), which the household never sees.

const ROOT = path.resolve(__dirname, "../..");
const PHRASE = /\binventory items?\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "generated") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js)$/.test(name) ? [full] : [];
  });
}

function isConsoleCall(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const target = n.expression.expression;
      if (ts.isIdentifier(target) && target.text === "console") return true;
    }
  }
  return false;
}

/** Every piece of copy in the source that uses the phrase, as "line: text". */
export function offendingCopy(source: string, fileName: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const text =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
        ? node.text
        : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
          ? node.text
          : null;
    if (text !== null && PHRASE.test(text) && !isConsoleCall(node)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${line + 1}: ${text.trim().slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("glossary: Item, not Inventory item (#637)", () => {
  it.each([
    ["the web app", path.join(ROOT, "src")],
    ["the phone shell", path.join(ROOT, "ios-shell", "www")],
  ])("%s has no user-facing \"Inventory item\" copy", (_name, dir) => {
    const problems = sourceFiles(dir).flatMap((file) =>
      offendingCopy(readFileSync(file, "utf8"), file).map((hit) => `${path.relative(ROOT, file)}:${hit}`),
    );
    expect(problems).toEqual([]);
  });

  it("checks copy only: strings, template text and JSX text, not comments, identifiers or logs", () => {
    const fixture = [
      "// Inventory items move to Item Documents",
      "/* an Inventory item, and image/* */",
      "const inventoryItem = INVENTORY;",
      'console.error("[items] couldn\'t retire staged Inventory item %s", id);',
      'const label = "Inventory item";',
      "const note = `Detected as an inventory item for ${name}`;",
      "const el = <option>Inventory items</option>;",
    ].join("\n");
    expect(offendingCopy(fixture, "fixture.tsx").map((hit) => hit.split(":")[0])).toEqual(["5", "6", "7"]);
  });
});
