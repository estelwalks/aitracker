import assert from "node:assert/strict";
import test from "node:test";

import { createNewestSelection } from "./newest-selection.ts";

/** A row of one database: the key it is ranked by, plus its identity. */
interface Row {
  key: number;
  id: string;
  file: number;
}

/**
 * The behaviour the selection exists for (P2-1): a source's databases share one
 * budget, so the rows that survive it have to be the newest of the whole
 * source. Reading database 0 first must not let its old rows hide database 1's
 * newer ones.
 */
test("keeps the newest rows across databases, whatever the read order", () => {
  const selection = createNewestSelection<string>(4, 2);
  for (const [key, id] of [
    [100, "old-1"],
    [90, "old-2"],
    [80, "old-3"],
    [70, "old-4"],
  ] as const) {
    selection.offer(0, key, id);
  }
  for (const [key, id] of [
    [900, "new-1"],
    [800, "new-2"],
    [700, "new-3"],
  ] as const) {
    selection.offer(1, key, id);
  }

  const { items, offered, truncated } = selection.finish();
  assert.deepEqual(items[0], ["old-1"], "the oldest rows gave way");
  assert.deepEqual(
    items[1],
    ["new-1", "new-2", "new-3"],
    "the newest rows are kept, newest first",
  );
  assert.deepEqual(offered, [4, 3]);
  assert.deepEqual(
    truncated,
    [true, false],
    "only the database that lost rows to a newer one is budget-limited",
  );
  assert.equal(selection.size, 4, "memory stays bounded by the budget");
});

test("a row offered for a database read first loses an exact tie", () => {
  const selection = createNewestSelection<string>(1, 2);
  selection.offer(0, 500, "first");
  assert.equal(selection.rejects(500), true, "a tie loses to what is retained");
  assert.equal(selection.rejects(501), false, "a newer row still wins");
  assert.equal(selection.offer(1, 500, "second"), false);
  assert.deepEqual(selection.finish().items, [["first"], []]);
});

test("rejects predicts what offer would do", () => {
  const selection = createNewestSelection<string>(3, 3);
  const rows: Array<[number, number, string]> = [
    [0, 10, "a"],
    [0, 30, "b"],
    [1, 20, "c"],
    [1, 40, "d"],
    [2, 5, "e"],
    [2, 35, "f"],
    [0, Number.NaN, "unusable"],
  ];
  for (const [file, key, id] of rows) {
    const predicted = selection.rejects(key);
    assert.equal(
      selection.offer(file, key, id),
      !predicted,
      `${id}: rejects must not disagree with offer`,
    );
  }
  const { items } = selection.finish();
  assert.deepEqual(
    items.flat().sort(),
    ["b", "d", "f"],
    "the three newest usable rows (keys 30, 40 and 35) are the ones kept",
  );
});

/**
 * The heap is the only thing standing between a scan and a wrong answer, so it
 * is checked against the obvious implementation - sort everything, keep the
 * newest `limit` - on random input, including duplicate keys. Ties resolve to
 * the row offered first (offer order is the scan's file and row order), which
 * is what keeps a scan deterministic.
 */
test("matches a naive newest-first selection on random input", () => {
  let seed = 0x2f6e2b1;
  const random = (): number => {
    // xorshift32: deterministic, so a failure can be reproduced.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };

  for (let round = 0; round < 300; round += 1) {
    const limit = 1 + Math.floor(random() * 8);
    const fileCount = 1 + Math.floor(random() * 4);
    const rowCount = Math.floor(random() * 40);
    const offered: Row[] = [];
    const selection = createNewestSelection<Row>(limit, fileCount);
    for (let index = 0; index < rowCount; index += 1) {
      const row: Row = {
        key: Math.floor(random() * 12),
        id: `r${index}`,
        file: Math.floor(random() * fileCount),
      };
      offered.push(row);
      selection.offer(row.file, row.key, row);
    }

    const expected = offered
      .slice()
      .sort((left, right) => right.key - left.key)
      .slice(0, limit)
      .map((row) => row.id)
      .sort();
    const { items, offered: counts, truncated } = selection.finish();
    const retained = items
      .flat()
      .map((row) => row.id)
      .sort();

    assert.deepEqual(
      retained,
      expected,
      `round ${round}: limit ${limit}, ${rowCount} rows over ${fileCount} databases`,
    );
    assert.ok(
      retained.length <= limit,
      `round ${round}: the selection must never exceed its limit`,
    );
    for (let file = 0; file < fileCount; file += 1) {
      const kept = items[file] ?? [];
      const lost = (counts[file] ?? 0) > kept.length;
      assert.equal(
        truncated[file],
        lost,
        `round ${round}: database ${file} truncation must match what it kept`,
      );
      for (let index = 1; index < kept.length; index += 1) {
        assert.ok(
          kept[index - 1]!.key >= kept[index]!.key,
          `round ${round}: a database's kept rows must be newest first`,
        );
      }
    }
  }
});
