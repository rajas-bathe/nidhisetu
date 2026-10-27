/* One-shot codemod: turns DB-dependent describes into dbDescribe + guards hooks. */
const fs = require("fs");

const files = [
  "backend/tests/auth.test.ts",
  "backend/tests/scope.test.ts",
  "backend/tests/dashboard.test.ts",
];

const importLine = 'import { dbDescribe, DB_TESTS_ENABLED } from "./helpers/guards.js";';

for (const file of files) {
  let t = fs.readFileSync(file, "utf8");

  // Insert the guards import after the vitest import line.
  const vitestRe = /^import \{([^}]*)\} from "vitest";$/m;
  if (!vitestRe.test(t)) {
    throw new Error(`vitest import not found in ${file}`);
  }
  if (!t.includes("./helpers/guards.js")) {
    t = t.replace(vitestRe, (match) => `${match}\n${importLine}`);
  }

  // Rename describe( -> dbDescribe( at line starts.
  t = t.replace(/^describe\(/gm, "dbDescribe(");

  // Top-level hooks: no-op when the test database is unavailable.
  t = t.replace(
    /beforeEach\(async \(\) => \{\n(\s*)await resetDatabase\(\);/g,
    (match, ws) => `beforeEach(async () => {\n${ws}if (!DB_TESTS_ENABLED) return;\n${ws}await resetDatabase();`,
  );
  t = t.replace(
    /afterEach\(async \(\) => \{\n(\s*)await resetDatabase\(\);/g,
    (match, ws) => `afterEach(async () => {\n${ws}if (!DB_TESTS_ENABLED) return;\n${ws}await resetDatabase();`,
  );

  fs.writeFileSync(file, t);
  console.log("patched", file);
}
