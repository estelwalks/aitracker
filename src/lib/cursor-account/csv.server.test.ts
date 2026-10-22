import assert from "node:assert/strict";
import test from "node:test";

import {
  CURSOR_ACCOUNT_PROJECT,
  parseCsvLine,
  parseCursorUsageCsv,
  toCursorUsageCacheRecords,
} from "./csv.server.ts";

const HEADER =
  "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

test("parseCsvLine honours quoted commas and doubled quotes", () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepEqual(parseCsvLine('"he said ""hi""",x'), ['he said "hi"', "x"]);
});

test("parses the account export into token-bearing records", () => {
  const csv = `${HEADER}
"2026-03-20T06:56:12.521Z","Included","composer-2-fast","No","160000","159990","578207","2055","740252","0.49"
"2026-03-19T10:00:00.000Z","Included","claude-4.6-sonnet-medium-thinking","Yes","50000","40000","10000","3000","103000","0.32"`;

  const records = parseCursorUsageCsv(csv);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], {
    timestamp: "2026-03-20T06:56:12.521Z",
    model: "composer-2-fast",
    kind: "Included",
    sessionId: null,
    inputTokens: 159990,
    cachedInputTokens: 578207,
    cacheCreationInputTokens: 10,
    outputTokens: 2055,
    totalTokens: 159990 + 578207 + 10 + 2055,
  });
  assert.equal(records[1].inputTokens, 40000);
  assert.equal(records[1].cacheCreationInputTokens, 10000);
});

test("resolves columns by header name when Cursor inserts new columns", () => {
  const csv = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
"2026-04-16T03:32:33.284Z","agent-abc-1","","On-Demand","composer-2-fast","No","0","3189","194368","1815","199372","0.11"
"2026-04-15T03:39:53.013Z","","","On-Demand","auto","No","0","132586","93728","2303","228617","0.20"`;

  const records = parseCursorUsageCsv(csv);
  assert.equal(records.length, 2);
  assert.equal(records[0].model, "composer-2-fast");
  assert.equal(records[0].kind, "On-Demand");
  assert.equal(records[0].sessionId, "agent-abc-1");
  assert.equal(records[1].sessionId, null);
  assert.equal(records[1].model, "auto");
  assert.equal(records[1].totalTokens, 132586 + 93728 + 2303);
});

test("a missing required column yields no records instead of wrong totals", () => {
  const csv = `Date,Model,Input (w/ Cache Write),Cache Read,Output Tokens,Total Tokens
"2026-03-20T06:56:12.521Z","composer-2-fast","1","2","3","6"`;
  assert.deepEqual(parseCursorUsageCsv(csv), []);
});

test("placeholder rows without tokens are dropped", () => {
  const csv = `${HEADER}
"2026-03-20T06:56:12.521Z","Included","composer-2-fast","No","0","0","0","0","0","0"
"2026-03-20T06:56:13.521Z","Included","composer-2-fast","No","0","0","0","12","12","0"`;
  const records = parseCursorUsageCsv(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].outputTokens, 12);
});

test("cache records use the scanner's default generic mapping shape", () => {
  const csv = `${HEADER}
"2026-03-20T06:56:12.521Z","Included","composer-2-fast","No","160000","159990","578207","2055","740252","0.49"`;
  const [record] = toCursorUsageCacheRecords(parseCursorUsageCsv(csv));
  assert.equal(record.project, CURSOR_ACCOUNT_PROJECT);
  assert.equal(record.session_id, "day-2026-03-20");
  assert.deepEqual(record.usage, {
    input_tokens: 159990,
    cached_input_tokens: 578207,
    cache_creation_input_tokens: 10,
    output_tokens: 2055,
    reasoning_output_tokens: 0,
    total_tokens: 159990 + 578207 + 10 + 2055,
  });
});

test("cloud agent rows keep their own conversation id", () => {
  const csv = `Date,Cloud Agent ID,Kind,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens
"2026-04-16T03:32:33.284Z","agent-abc-1","On-Demand","auto","0","10","0","5","15"`;
  const [record] = toCursorUsageCacheRecords(parseCursorUsageCsv(csv));
  assert.equal(record.session_id, "agent-agent-abc-1");
});
