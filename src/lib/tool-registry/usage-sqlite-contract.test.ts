import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { listTools } from "./registry.ts";

/**
 * Contract for every `format: "sqlite"` usage adapter (issue #42).
 *
 * The scanner queries a sqlite database through a prepared statement instead
 * of buffering the file, and bounds the result with a row budget
 * (`maxSqliteRows`). Two properties therefore have to hold in the definitions
 * themselves, and neither is visible from the TypeScript side:
 *
 * 1. The query must prepare against the schema it targets. `ORDER BY <alias>`
 *    only resolves when the alias is in scope, so a later edit can turn a
 *    working query into a hard SQL error.
 * 2. The query must return newest-first. The row budget keeps the rows it sees
 *    first, so without an ordering the budget would silently retain the OLDEST
 *    events of a long-lived database and drop everything recent.
 */

/** Minimal schemas holding exactly the columns each query references. */
const SCHEMAS: Record<string, string> = {
  aipy: `
    CREATE TABLE task_event(id TEXT, time INTEGER, task_id TEXT, model TEXT, usage TEXT);
    CREATE TABLE task(id TEXT, title TEXT, workdir TEXT, model TEXT, workspace_id TEXT);
    CREATE TABLE workspace(id TEXT, workdir TEXT);`,
  anythingllm: `
    CREATE TABLE workspace_chats(id TEXT, createdAt TEXT, response TEXT, include INTEGER);`,
  goose: `
    CREATE TABLE sessions(id TEXT, created_at TEXT, model_config_json TEXT,
      input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER,
      accumulated_input_tokens INTEGER, accumulated_output_tokens INTEGER,
      accumulated_total_tokens INTEGER);`,
  hermes: `
    CREATE TABLE sessions(id TEXT, started_at INTEGER, ended_at INTEGER, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER);`,
  kiro: `
    CREATE TABLE tokens_generated(id TEXT, timestamp TEXT, model TEXT,
      tokens_prompt INTEGER, tokens_generated INTEGER);`,
  mimo: `
    CREATE TABLE message(id TEXT, session_id TEXT, time_updated INTEGER, data TEXT);`,
  qodercn: `
    CREATE TABLE chat_message(session_id TEXT, gmt_create INTEGER, model_info TEXT,
      token_info TEXT, request_id TEXT, role TEXT);
    CREATE TABLE chat_record(request_id TEXT, extra TEXT);
    CREATE TABLE chat_session(session_id TEXT, project_name TEXT, project_uri TEXT,
      preferred_model_info TEXT);`,
  zcode: `
    CREATE TABLE model_usage(session_id TEXT, started_at INTEGER, completed_at INTEGER,
      model_id TEXT, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER);
    CREATE TABLE session(id TEXT, directory TEXT);`,
};

/**
 * Run the tool's real query against its fixture schema. Preparing is the real
 * check: an out-of-scope `ORDER BY` alias is a hard error here rather than a
 * silently unordered result at scan time.
 */
function queryPrepares(toolId: string, schema: string, query: string): void {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(schema);
    database.prepare(query);
  } catch (error) {
    assert.fail(`${toolId}: sqlite usage query failed - ${String(error)}`);
  } finally {
    database.close();
  }
}

test("every sqlite usage query opens newest-first and prepares", () => {
  const sqliteTools = listTools().filter(
    (tool) =>
      tool.capabilities.usage.mode !== "unsupported" &&
      tool.capabilities.usage.paths?.some((path) => path.format === "sqlite"),
  );
  // Zed is the native `zed-threads-v1` reader: its SQL lives in the scanner.
  const native = sqliteTools.filter((tool) => tool.id === "zed");
  const definitions = sqliteTools.filter((tool) => tool.id !== "zed");
  assert.ok(
    definitions.length >= 8,
    `expected the generic sqlite adapters, saw ${definitions.length}`,
  );
  // Fix coverage for issue #42 is structural, not per-tool: every one of these
  // dispatches through `scanGenericAdapter` -> `parseGenericFile`, which is the
  // single place the byte cap was lifted and the row budget applied. A sqlite
  // tool that arrives on a different reader would silently skip both.
  for (const tool of [...definitions, ...native]) {
    const expected = tool.id === "zed" ? "zed-threads-v1" : "generic-sqlite";
    assert.equal(
      tool.capabilities.usage.reader,
      expected,
      `${tool.id}: sqlite scanning must stay on the ${expected} reader`,
    );
  }

  for (const tool of definitions) {
    const query = tool.capabilities.usage.query;
    assert.ok(query, `${tool.id}: a sqlite adapter must declare a query`);
    const schema = SCHEMAS[tool.id];
    assert.ok(
      schema,
      `${tool.id}: missing fixture schema in this contract test`,
    );

    // Preparing is the real check: an out-of-scope ORDER BY alias is a hard
    // error here rather than a silently unordered result at scan time.
    assert.doesNotThrow(() => queryPrepares(tool.id, schema, query));

    const ordering = query
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.toUpperCase().startsWith("ORDER BY"));
    assert.ok(ordering, `${tool.id}: sqlite query must declare an ORDER BY`);
    // The scanner's row budget keeps the rows it sees first, so the newest row
    // must come first. A DESC on the leading term is what guarantees it.
    const leadingTerm = ordering.replace(/^ORDER BY\s+/iu, "").split(",")[0]!;
    assert.match(
      leadingTerm,
      / DESC$/iu,
      `${tool.id}: ORDER BY must lead with DESC (newest-first) - saw "${ordering}"`,
    );
    assert.match(
      leadingTerm,
      /^(timestamp|cm\.gmt_create) DESC$/iu,
      `${tool.id}: ORDER BY must lead with the mapped timestamp - saw "${ordering}"`,
    );
  }
});

/**
 * The window pushdown is a performance contract, not a correctness one: with
 * the cutoff applied in TypeScript as well, dropping `windowFilter` still
 * produces the right events and only makes a multi-gigabyte database slow
 * again. Nothing else would catch that regression, so it is asserted here -
 * measured on a 634 MB / 5M-row fixture, a 365-day scan drops from 13.4 s to
 * 27.0 s when the filter is removed.
 */
test("every sqlite adapter pushes the scan window into its query", () => {
  const definitions = listTools().filter(
    (tool) =>
      tool.capabilities.usage.mode !== "unsupported" &&
      tool.capabilities.usage.paths?.some((path) => path.format === "sqlite") &&
      // The native reader builds its own SQL in the scanner, window included.
      tool.capabilities.usage.reader !== "zed-threads-v1",
  );
  assert.ok(definitions.length >= 8);

  for (const tool of definitions) {
    const usage = tool.capabilities.usage;
    const filter = usage.windowFilter;
    assert.ok(
      filter,
      `${tool.id}: a sqlite adapter must declare windowFilter, or the scan reads every historical row`,
    );
    assert.equal(
      (filter.match(/\?/gu) ?? []).length,
      1,
      `${tool.id}: windowFilter must bind exactly one parameter (the cutoff)`,
    );
    // It filters the adapter query's own output, so the comparison happens on
    // the timestamp the adapter already normalized - not a raw column whose
    // storage class might coerce a millisecond parameter.
    assert.match(
      filter,
      /timestamp\s*>=\s*\?/iu,
      `${tool.id}: windowFilter must bound the mapped timestamp - saw "${filter}"`,
    );
  }
});
