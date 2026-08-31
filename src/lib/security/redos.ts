/**
 * Self-developed ReDoS (catastrophic backtracking) secure regularity detector (deviation issue list P1/F4-T1).
 *
 * Why is it an independent module: `security-rules.schema.ts` needs to be used at the top level of the module
 * `SECURITY_RULE_KINDS` exported by `rules.ts` (zod schema verification during build); and
 * The `validateSecurityRulePattern` of `rules.ts` also needs to reuse the same detector. If the detector
 * Putting it into schema.ts will form a circular dependency of rules.ts → schema.ts → rules.ts, under ESM
 * Top-level access to `SECURITY_RULE_KINDS` in schema.ts will hit TDZ. Therefore the detector is placed
 * In the zero-dependency module, schema.ts (built-in rule gate) and rules.ts (user rule verification) are referenced together.
 * Ensure that "user rules and built-in rules reuse the same security gate".
 *
 * Detection model (single-pass linear scan, does not rely on any third-party regex analysis library):
 *
 * Only "groups modified by quantifiers" (hereinafter referred to as quantified groups) are reviewed. The top-level quantifiers (`a+`, `[^\n]*`) are
 * Linear safe, uncensored. Quantify grouped risk patterns:
 *
 * 1. Nested/overlapping quantifiers (R1): There are non-definite quantifiers inside the group (at any depth), and
 *    - The grouping quantifier has no upper bound (`*`/`+`/`{n,}`) and there are any non-definite quantifiers inside, or
 *    - The grouping quantifier has an upper bound (such as `{2}`) and there is an internal unbounded quantifier (`*`/`+`/`{n,}`).
 *    That is, both combinations of "unbounded × unbounded" and "unbounded × bounded" will produce ambiguous backtracking.
 *    Definite quantifiers (`{n}`, min===max) do not introduce ambiguity and are allowed (such as `(a{2})+`,
 *    Builtin-24's `(?:\d{1,3}\.){3}` - bounded × bounded, ambiguity is constant).
 *    A single occurrence (`?`, max 1) will not cause repeated ambiguity and will be allowed (such as `(?:sudo\s+)?`).
 * 2. Multiple alternation plus quantifier (R2): There is alternation within the quantified group (max ≥ 2), and the branch is not
 *    "Pairwise disjoint single characters" (such as `(a|b)+` linear safety, allowed). `(a|aa)+`,
 *    `(ab|bc|cd)*`, `(\d|\w)+` are rejected.
 * 3. Backreference (R3): `\1`-`\9`, `\k<name>`. The V8 backtracking engine is
 *    The worst-case index is that the security scanning rules are not used and will be rejected.
 * 4. The quantifier follows the quantifier (R4): `a*+` etc. Most of these writing methods cannot be compiled under JS.
 *    (`a++` is a SyntaxError), this rule serves as a safety net before compiling.
 *
 * The detector only makes sense when called after `new RegExp(pattern, "i")` has been compiled.
 * (`isSafeSecurityPattern` / `validateSecurityRulePattern` are both compiled first);
 * For malformed input (unclosed grouping, illegal escape), errors will not be thrown and null will be returned. Compilation check is responsible for legality.
 */

export type ReDoSDiagnostic = string;

const R1_MESSAGE =
  "正则包含危险的嵌套/重叠量词（如 (a+)+ 或 (a*)*），可能导致扫描卡死";
const R2_MESSAGE =
  "正则包含危险的多重交替加量词（如 (a|aa)+ 或 (ab|bc|cd)*），可能导致扫描卡死";
const R3_MESSAGE = "正则包含反向引用（如 \\1），在回溯引擎下可能导致扫描卡死";
const R4_MESSAGE = "正则存在量词紧跟量词（如 a*+），可能导致扫描卡死";

const UNBOUNDED = Number.POSITIVE_INFINITY;

/** Single character matching set; null means unknown/multiple characters/zero width (conservatively treated as ambiguity). */
type CharSet = ReadonlySet<string> | null;

/** Approximate character set of `\d`/`\w`/`\s` (used for branch disjointness analysis). */
const ESCAPE_CHAR_SETS: Record<string, ReadonlySet<string>> = {
  "\\d": new Set("0123456789".split("")),
  "\\w": new Set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split(""),
  ),
  // Unicode whitespace character set for \s (\t \n \v \f \r + various Unicode whitespace characters)
  //
  "\\s": new Set([
    "\t",
    "\n",
    "\v",
    "\f",
    "\r",
    " ",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2001",
    "\u2002",
    "\u2003",
    "\u2004",
    "\u2005",
    "\u2006",
    "\u2007",
    "\u2008",
    "\u2009",
    "\u200a",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
    "\ufeff",
  ]),
};

/** Escape literals representing special characters in regular expressions (`\b` is backspace inside a character class, and zero-width assertion outside the class). */
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  f: "\f",
  b: "\u0008",
};

interface Quantifier {
  /** Maximum number of occurrences; UNBOUNDED means `*`/`+`/`{n,}`. */
  max: number;
  /** Whether it is unbounded (`*`/`+`/`{n,}`). */
  unbounded: boolean;
  /** Is a negative number (`{n}`, min===max, n ≥ 1) - does not introduce backtracking ambiguity. */
  fixed: boolean;
  /** Number of characters consumed (including lazy `?` modifier). */
  len: number;
}

function isQuantifierStart(ch: string | undefined): boolean {
  return ch === "*" || ch === "+" || ch === "?" || ch === "{";
}

/**
 * Parse the quantifier suffix after the atom; return null if `{` is not a legal quantifier (in this case it is a literal,
 * Consistent with JS semantics: `a{` is legal, `{` appears alone and is a literal).
 */
function parseQuantifier(pattern: string, i: number): Quantifier | null {
  const ch = pattern[i];
  if (ch === "*" || ch === "+" || ch === "?") {
    let len = 1;
    if (pattern[i + 1] === "?") len = 2; // Lazy modifiers like a*?
    // `?` is a single occurrence (max 1) and does not cause repeated ambiguity; `*`/`+` has no upper bound
    const unbounded = ch !== "?";
    return { max: unbounded ? UNBOUNDED : 1, unbounded, fixed: false, len };
  }
  if (ch !== "{") return null;

  let j = i + 1;
  const nStart = j;
  while (j < pattern.length && pattern[j] >= "0" && pattern[j] <= "9") j++;
  if (j === nStart) return null;
  const n = Number(pattern.slice(nStart, j));

  let m: number;
  let absEnd: number;
  if (pattern[j] === "}") {
    m = n;
    absEnd = j + 1;
  } else if (pattern[j] === ",") {
    const mStart = j + 1;
    let k = mStart;
    while (k < pattern.length && pattern[k] >= "0" && pattern[k] <= "9") k++;
    if (pattern[k] !== "}") return null;
    m = k === mStart ? UNBOUNDED : Number(pattern.slice(mStart, k));
    absEnd = k + 1;
  } else {
    return null;
  }
  if (pattern[absEnd] === "?") absEnd += 1; // Lazy modifiers like a{2,3}?
  const unbounded = m === UNBOUNDED;
  // len is the offset from the starting point of the relative quantifier, which can be directly superimposed by the caller.
  return { max: m, unbounded, fixed: !unbounded && n === m, len: absEnd - i };
}

/**
 * Decode single character escapes (`\xHH`/`\uHHHH`/`\u{...}`/`\cX`/`\0`/`\n` and other special escapes/normal
 * Escape literal), used for character class and branch collection analysis; returns null if it cannot be decoded.
 */
function decodeCharEscape(
  pattern: string,
  i: number,
): { char: string; next: number } | null {
  const e = pattern[i + 1];
  if (e === undefined) return null;
  if (e === "x") {
    const hex = pattern.slice(i + 2, i + 4);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
    return {
      char: String.fromCodePoint(Number.parseInt(hex, 16)),
      next: i + 4,
    };
  }
  if (e === "u") {
    if (pattern[i + 2] === "{") {
      const close = pattern.indexOf("}", i + 3);
      if (close === -1) return null;
      const hex = pattern.slice(i + 3, close);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
      return {
        char: String.fromCodePoint(Number.parseInt(hex, 16)),
        next: close + 1,
      };
    }
    const hex = pattern.slice(i + 2, i + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
    return {
      char: String.fromCodePoint(Number.parseInt(hex, 16)),
      next: i + 6,
    };
  }
  if (e === "c") {
    const c = pattern[i + 2];
    if (c === undefined) return null;
    return { char: String.fromCodePoint(c.charCodeAt(0) % 32), next: i + 3 };
  }
  if (e === "0") {
    const n = pattern[i + 2];
    if (n !== undefined && n >= "0" && n <= "9") return null;
    return { char: "\0", next: i + 2 };
  }
  const simple = SIMPLE_ESCAPES[e];
  if (simple !== undefined) return { char: simple, next: i + 2 };
  // The remaining unknown escapes are "identity escapes" in JS non-unicode mode, matching the literal characters themselves
  return { char: e, next: i + 2 };
}

/**
 * Parse character classes `[...]`; `^` negation, complement classes (`\D`/`\W`/`\S`), complex range endpoints, etc.
 * Returns null if exact representation is not possible (conservatively treated as unknown). `next` points after `]`.
 */
function parseCharClass(
  pattern: string,
  i: number,
): { set: CharSet; next: number } {
  let j = i + 1;
  let negated = false;
  if (pattern[j] === "^") {
    negated = true;
    j++;
  }
  const set = new Set<string>();
  let last: string | null = null;
  let first = true;
  let unknown = false;

  while (j < pattern.length) {
    const ch = pattern[j];
    if (ch === "]" && !first) {
      j++;
      break;
    }
    first = false;

    if (
      ch === "-" &&
      last !== null &&
      j + 1 < pattern.length &&
      pattern[j + 1] !== "]"
    ) {
      // Range a-z; when the end point is an escape or reverse range, it is treated as unknown
      const nextCh = pattern[j + 1];
      if (nextCh === "\\") {
        unknown = true;
        break;
      }
      const from = last.codePointAt(0);
      const to = nextCh.codePointAt(0);
      if (from === undefined || to === undefined || to < from) {
        unknown = true;
        break;
      }
      for (let cp = from; cp <= to; cp++) set.add(String.fromCodePoint(cp));
      last = null;
      j += 2;
      continue;
    }

    if (ch === "\\") {
      const e = pattern[j + 1];
      if (e === undefined) {
        unknown = true;
        break;
      }
      if (e === "d" || e === "w" || e === "s") {
        for (const c of ESCAPE_CHAR_SETS[`\\${e}`]!) set.add(c);
        last = null;
        j += 2;
        continue;
      }
      if (e === "D" || e === "W" || e === "S") {
        unknown = true; // complement → unknown
        break;
      }
      const decoded = decodeCharEscape(pattern, j);
      if (!decoded) {
        unknown = true;
        break;
      }
      set.add(decoded.char);
      last = decoded.char;
      j = decoded.next;
      continue;
    }

    set.add(ch);
    last = ch;
    j++;
  }

  if (negated || unknown) return { set: null, next: j };
  return { set, next: j };
}

interface Atom {
  /** Single character match set; null = unknown/multiple characters/zero width/with quantifier. */
  set: CharSet;
  /** Whether the atom (or its interior) contains an indefinite quantifier. */
  nonFixedQuant: boolean;
  /** Whether the atom (or its interior) contains an unbounded quantifier (`*`/`+`/`{n,}`). */
  unboundedQuant: boolean;
  /** Whether alternation of this atom (or within it) is dangerous (only grouped atoms may be true). */
  altDanger: boolean;
  /** Non-null indicates that a dangerous pattern has been detected that must be rejected. */
  danger: string | null;
  next: number;
}

/** Add a quantifier suffix to the atom; the quantifier follows the quantifier (R4) here. */
function finishAtom(pattern: string, next: number, set: CharSet): Atom {
  const q = parseQuantifier(pattern, next);
  if (!q) {
    return {
      set,
      nonFixedQuant: false,
      unboundedQuant: false,
      altDanger: false,
      danger: null,
      next,
    };
  }
  const end = next + q.len;
  if (isQuantifierStart(pattern[end])) {
    return {
      set: null,
      nonFixedQuant: true,
      unboundedQuant: q.unbounded,
      altDanger: false,
      danger: R4_MESSAGE,
      next: end,
    };
  }
  return {
    set: null,
    nonFixedQuant: !q.fixed,
    unboundedQuant: q.unbounded,
    altDanger: false,
    danger: null,
    next: end,
  };
}

/** Parse escaped atoms (with backreference R3 detection). */
function parseEscapedAtom(pattern: string, i: number): Atom {
  const e = pattern[i + 1];
  if (e === undefined) {
    return {
      set: null,
      nonFixedQuant: false,
      unboundedQuant: false,
      altDanger: false,
      danger: null,
      next: i + 1,
    };
  }
  // Backreference \1-\9
  if (e >= "1" && e <= "9") {
    return {
      set: null,
      nonFixedQuant: true,
      unboundedQuant: true,
      altDanger: false,
      danger: R3_MESSAGE,
      next: i + 2,
    };
  }
  // Named backreference \k<name> (`\k` alone is the literal k)
  if (e === "k" && pattern[i + 2] === "<") {
    if (pattern.indexOf(">", i + 3) !== -1) {
      return {
        set: null,
        nonFixedQuant: true,
        unboundedQuant: true,
        altDanger: false,
        danger: R3_MESSAGE,
        next: i + 2,
      };
    }
    return {
      set: new Set(["k"]),
      nonFixedQuant: false,
      unboundedQuant: false,
      altDanger: false,
      danger: null,
      next: i + 2,
    };
  }
  if (e === "d" || e === "w" || e === "s") {
    return finishAtom(pattern, i + 2, ESCAPE_CHAR_SETS[`\\${e}`]!);
  }
  if (e === "D" || e === "W" || e === "S" || e === "b" || e === "B") {
    // complement or zero-width assertion → unknown
    return finishAtom(pattern, i + 2, null);
  }
  const decoded = decodeCharEscape(pattern, i);
  if (decoded) {
    return finishAtom(pattern, decoded.next, new Set([decoded.char]));
  }
  return finishAtom(pattern, i + 2, null);
}

/** Branches are pairwise disjoint (case folded, matching semantics under the `i` flag). */
function foldCase(set: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (!set) return null;
  const folded = new Set<string>();
  for (const c of set) folded.add(c.toLowerCase());
  return folded;
}

function branchesAreDisjoint(
  branches: (ReadonlySet<string> | null)[],
): boolean {
  for (let i = 0; i < branches.length; i++) {
    const a = branches[i];
    if (!a) return false;
    for (let j = i + 1; j < branches.length; j++) {
      const b = branches[j];
      if (!b) return false;
      for (const c of a) if (b.has(c)) return false;
    }
  }
  return true;
}

function directAltDanger(branches: (ReadonlySet<string> | null)[]): boolean {
  return branches.length >= 2 && !branchesAreDisjoint(branches);
}

interface ContentResult {
  danger: string | null;
  /** Whether there are non-definite quantifiers in the content (at any depth). */
  nonFixed: boolean;
  /** Whether there is an unbounded quantifier in the content (at any depth). */
  unbounded: boolean;
  /** Is direct hierarchical or nested alternation dangerous. */
  altDanger: boolean;
  next: number;
}

/**
 * Parse a regular content (until `)` or the end of the string) and return the combined risk flag.
 * `branchSets` collects the character sets for each alternating branch of the immediate hierarchy (null = unknown).
 */
function parseContent(pattern: string, start: number): ContentResult {
  let i = start;
  let nonFixed = false;
  let unbounded = false;
  let altDanger = false;
  const branchSets: (ReadonlySet<string> | null)[] = [];
  let branchAtoms = 0;
  let branchSet: ReadonlySet<string> | null = null;

  const finalizeBranch = (): void => {
    branchSets.push(branchAtoms === 1 ? foldCase(branchSet) : null);
    branchAtoms = 0;
    branchSet = null;
  };

  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === ")") {
      finalizeBranch();
      return {
        danger: null,
        nonFixed,
        unbounded,
        altDanger: altDanger || directAltDanger(branchSets),
        next: i,
      };
    }
    if (ch === "|") {
      finalizeBranch();
      i++;
      continue;
    }
    if (ch === "*" || ch === "+" || ch === "?") {
      // Quantifier appears at atomic position → JS cannot be compiled (Nothing to repeat), just skip it
      i++;
      continue;
    }
    const atom = parseAtom(pattern, i);
    if (atom.danger) {
      return {
        danger: atom.danger,
        nonFixed,
        unbounded,
        altDanger,
        next: atom.next,
      };
    }
    i = atom.next;
    nonFixed = nonFixed || atom.nonFixedQuant;
    unbounded = unbounded || atom.unboundedQuant;
    altDanger = altDanger || atom.altDanger;
    if (branchAtoms === 0) branchSet = atom.set;
    else branchSet = null;
    branchAtoms++;
  }
  finalizeBranch();
  return {
    danger: null,
    nonFixed,
    unbounded,
    altDanger: altDanger || directAltDanger(branchSets),
    next: i,
  };
}

/** Parse a single atom (character/escape/character class/group) + optional quantifier suffix. */
function parseAtom(pattern: string, i: number): Atom {
  const ch = pattern[i];
  if (ch === "\\") return parseEscapedAtom(pattern, i);
  if (ch === "[") {
    const cls = parseCharClass(pattern, i);
    return finishAtom(pattern, cls.next, cls.set);
  }
  if (ch === "(") return parseGroupAtom(pattern, i);
  if (ch === "{") return finishAtom(pattern, i + 1, new Set(["{"]));
  if (ch === "." || ch === "^" || ch === "$") {
    return finishAtom(pattern, i + 1, null);
  }
  return finishAtom(pattern, i + 1, new Set([ch]));
}

/** Parse group atoms (including prefix `(?:`/`(?=`/`(?!`/`(?<=`/`(?<!`/`(?<name>`)). */
function parseGroupAtom(pattern: string, i: number): Atom {
  let after = i + 1;
  if (pattern[after] === "?") {
    const c = pattern[after + 1];
    if (c === ":" || c === "=" || c === "!") {
      after += 2;
    } else if (c === "<") {
      const d = pattern[after + 2];
      if (d === "=" || d === "!") {
        after += 3;
      } else if (d !== undefined) {
        const gt = pattern.indexOf(">", after + 2);
        after = gt === -1 ? pattern.length : gt + 1;
      } else {
        after = pattern.length;
      }
    } else {
      // (?i and other modifiers not supported by JS → Compilation fails, continue according to content
      after += 1;
    }
  }

  const inner = parseContent(pattern, after);
  if (inner.danger) {
    return {
      set: null,
      nonFixedQuant: true,
      unboundedQuant: true,
      altDanger: true,
      danger: inner.danger,
      next: inner.next,
    };
  }
  let next = inner.next;
  if (pattern[next] !== ")")
    next = pattern.length; // Unclosed → failed to compile
  else next += 1;

  const q = parseQuantifier(pattern, next);
  if (q) {
    const end = next + q.len;
    if (isQuantifierStart(pattern[end])) {
      return {
        set: null,
        nonFixedQuant: true,
        unboundedQuant: q.unbounded,
        altDanger: inner.altDanger,
        danger: R4_MESSAGE,
        next: end,
      };
    }
    // R1: Nested/overlapping quantifiers (max ≥ 2 and "unbounded outer quantifier × internal unbounded number" or "bounded outer quantifier × internal unbounded")
    const nestedQuantDanger =
      q.max >= 2 && (q.unbounded ? inner.nonFixed : inner.unbounded);
    // R2: multiple alternating quantifiers
    const alternationDanger = q.max >= 2 && inner.altDanger;
    const danger = nestedQuantDanger
      ? R1_MESSAGE
      : alternationDanger
        ? R2_MESSAGE
        : null;
    return {
      set: null,
      nonFixedQuant: !q.fixed,
      unboundedQuant: q.unbounded,
      altDanger: inner.altDanger,
      danger,
      next: end,
    };
  }
  // Unquantized grouping: merge internal flags as multi-character atoms
  return {
    set: null,
    nonFixedQuant: inner.nonFixed,
    unboundedQuant: inner.unbounded,
    altDanger: inner.altDanger,
    danger: null,
    next,
  };
}

/**
 * Detect dangerous retracement patterns. Returns a danger description; returns null if safe.
 *
 * Only called after `new RegExp(pattern, "i")` is compiled (diagnosis of malformed input is handled by compilation check).
 */
export function detectReDoS(pattern: string): string | null {
  return parseContent(pattern, 0).danger;
}
