/**
 * P2-1: keep the newest rows of a whole source while its databases are read one
 * after another.
 *
 * A usage source can span several sqlite databases - Hermes keeps one
 * `state.db` per profile - and they share one row budget. Reading them in file
 * order and letting the first database spend that budget kept the OLDEST rows
 * of the source whenever that database happened to be walked first: a database
 * file's mtime says when it was last written, not how old the rows inside it
 * are, so which rows a source reported depended on which profile was written
 * last. With a budget of four rows, a profile holding day-old sessions that was
 * written a minute ago hid another profile's ten-minute-old sessions entirely.
 *
 * This selection keeps the newest rows of the entire source instead, with
 * memory bounded by the budget: a row older than every retained row is dropped
 * as it arrives, and a row that earns a place replaces the oldest retained one
 * in place. Rows are offered with the key the caller ranks them by and the
 * database they came from, so the caller can rebuild one cache entry per
 * database afterwards.
 *
 * The structure is a binary min-heap of slots holding at most `limit` rows, and
 * the slot data lives in parallel typed arrays rather than in one object per
 * row: at half a million rows a wrapper object per slot costs tens of megabytes
 * the retained rows themselves do not, and this budget exists to bound exactly
 * that. The heap root is the row that would be dropped first, so being full and
 * comparing an arriving row against the root is O(1) plus the sift, and no
 * operation allocates at all.
 */
export interface NewestSelection<T> {
  /**
   * Offers one row of `file`, ranked by `key` (the event time in milliseconds).
   * Returns whether it is retained. Rows are dropped, never buffered, once the
   * selection is full.
   */
  offer(file: number, key: number, item: T): boolean;
  /**
   * Whether a row with this key would be dropped. Only meaningful for a
   * database the caller reads newest-first: every later row of that database is
   * then older too, so the first rejected key ends the read.
   */
  rejects(key: number): boolean;
  /** Rows retained right now (at most the limit). */
  readonly size: number;
  /**
   * Ends the selection: the retained rows per database, each list newest first,
   * plus how many rows every database offered and whether any of them were
   * dropped. A database that offered more rows than it retained lost some to a
   * newer database, which is what makes its cache entry budget-dependent.
   */
  finish(): {
    items: T[][];
    offered: number[];
    truncated: boolean[];
  };
}

export function createNewestSelection<T>(
  limit: number,
  /**
   * Databases the caller will offer rows for, so a database that returns no row
   * at all still has a bucket in `finish()`.
   */
  fileCount = 0,
): NewestSelection<T> {
  const capacity = Math.max(0, Math.trunc(limit));
  // Slot data, indexed by slot; `heap` holds slot indexes. A slot is written
  // once and then only ever reused by a row that displaces the one in it, so a
  // slot index is stable for as long as its row is retained.
  const slotFile = new Int32Array(capacity);
  const slotKey = new Float64Array(capacity);
  const slotSequence = new Float64Array(capacity);
  const slotItem: T[] = new Array<T>(capacity);
  const heap = new Int32Array(capacity);
  const offered: number[] = new Array<number>(fileCount).fill(0);
  const truncated: boolean[] = new Array<boolean>(fileCount).fill(false);
  let size = 0;
  let sequence = 0;

  const observe = (file: number): void => {
    while (offered.length <= file) {
      offered.push(0);
      truncated.push(false);
    }
    offered[file] = (offered[file] ?? 0) + 1;
  };

  /** True when the row in slot `a` should be dropped before the row in `b`. */
  const worseSlot = (a: number, b: number): boolean =>
    slotKey[a]! < slotKey[b]! ||
    (slotKey[a]! === slotKey[b]! && slotSequence[a]! > slotSequence[b]!);

  /**
   * True when the row in `slot` should be dropped before the arriving row
   * `(key, at)`. An arriving row never wins an exact tie, so `>` on the
   * sequence is what makes an unchanged scan deterministic: the row offered
   * first keeps its place.
   */
  const worseThanArriving = (slot: number, key: number, at: number): boolean =>
    slotKey[slot]! < key ||
    (slotKey[slot]! === key && slotSequence[slot]! > at);

  const siftDown = (position: number): void => {
    let parent = position;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let worst = parent;
      if (left < size && worseSlot(heap[left]!, heap[worst]!)) {
        worst = left;
      }
      if (right < size && worseSlot(heap[right]!, heap[worst]!)) {
        worst = right;
      }
      if (worst === parent) return;
      const parentSlot = heap[parent]!;
      heap[parent] = heap[worst]!;
      heap[worst] = parentSlot;
      parent = worst;
    }
  };

  return {
    offer(file: number, key: number, item: T): boolean {
      observe(file);
      // A row without a usable event time cannot be ranked, so it never earns a
      // slot; it is still counted as offered, because its database did not get
      // to keep it.
      if (capacity === 0 || !Number.isFinite(key)) return false;
      const at = sequence++;
      let slot: number;
      if (size < capacity) {
        slot = size;
        heap[slot] = slot;
        size += 1;
        slotFile[slot] = file;
        slotKey[slot] = key;
        slotSequence[slot] = at;
        slotItem[slot] = item;
        // The array is only read once it is full, so it is arranged then and
        // there: Floyd's build is one pass over the filled array, where sifting
        // every row into place costs a comparison per level instead - millions
        // of them at a budget of half a million rows.
        if (size === capacity) {
          for (let index = (size >> 1) - 1; index >= 0; index -= 1) {
            siftDown(index);
          }
        }
        return true;
      }
      const root = heap[0]!;
      if (!worseThanArriving(root, key, at)) return false;
      // The displaced row's database keeps one fewer retained row, which
      // `finish` reports for it; the slot itself is reused, so nothing is left
      // behind for the collector.
      slot = root;
      slotFile[slot] = file;
      slotKey[slot] = key;
      slotSequence[slot] = at;
      slotItem[slot] = item;
      siftDown(0);
      return true;
    },

    rejects(key: number): boolean {
      if (capacity === 0 || !Number.isFinite(key)) return true;
      if (size < capacity) return false;
      // A row offered later also loses an exact tie, so `<=` is the answer.
      return key <= slotKey[heap[0]!]!;
    },

    get size(): number {
      return size;
    },

    finish() {
      const order: number[][] = [];
      for (let slot = 0; slot < size; slot += 1) {
        (order[slotFile[slot]!] ??= []).push(slot);
      }
      const items: T[][] = [];
      const dropped: boolean[] = [];
      for (let file = 0; file < offered.length; file += 1) {
        const slots = order[file] ?? [];
        // Heap order says nothing about time order, so each database's retained
        // rows are sorted once here - at most `limit` rows in total, not one
        // sort per database read.
        slots.sort((left, right) => {
          if (slotKey[left] !== slotKey[right]) {
            return slotKey[right]! - slotKey[left]!;
          }
          return slotSequence[left]! - slotSequence[right]!;
        });
        items.push(slots.map((slot) => slotItem[slot]!));
        dropped.push((offered[file] ?? 0) > slots.length);
      }
      return { items, offered, truncated: dropped };
    },
  };
}
