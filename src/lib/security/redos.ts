/**
 * 自研 ReDoS（灾难性回溯）安全正则检测器（偏差问题清单 P1 / F4-T1）。
 *
 * 为什么独立成模块：`security-rules.schema.ts` 需要在模块顶层使用
 * `rules.ts` 导出的 `SECURITY_RULE_KINDS`（构建期 Zod schema 校验）；而
 * `rules.ts` 的 `validateSecurityRulePattern` 也要复用同一个检测器。若把检测器
 * 放进 schema.ts，会形成 rules.ts → schema.ts → rules.ts 的循环依赖，ESM 下
 * schema.ts 顶层访问 `SECURITY_RULE_KINDS` 会命中 TDZ。因此检测器放在
 * 零依赖模块中，schema.ts（内建规则 gate）与 rules.ts（用户规则校验）共同引用，
 * 保证「用户规则与内建规则复用同一安全 gate」。
 *
 * 检测模型（单遍线性扫描，不依赖任何第三方 regex 分析库）：
 *
 * 只审查「被量词修饰的分组」（下称量化分组）。顶层量词（`a+`、`[^\n]*`）是
 * 线性安全的，不审查。量化分组的危险形态：
 *
 * 1. 嵌套/重叠量词（R1）：分组内部（任意深度）存在非定数量词，且
 *    - 分组量词无上界（`*`/`+`/`{n,}`）且内部存在任意非定数量词，或
 *    - 分组量词有上界（如 `{2}`）且内部存在无上界量词（`*`/`+`/`{n,}`）。
 *    即「无界×无界」与「无界×有界」两种组合都会产生歧义回溯。
 *    定数量词（`{n}`，min===max）不引入歧义，放行（如 `(a{2})+`、
 *    内建 builtin-24 的 `(?:\d{1,3}\.){3}`——有界×有界，歧义为常量）。
 *    单次出现（`?`，max 1）也不产生重复歧义，放行（如 `(?:sudo\s+)?`）。
 * 2. 多重交替加量词（R2）：量化分组（max ≥ 2）内部存在交替，且分支并非
 *    「两两不相交的单个字符」（如 `(a|b)+` 线性安全，放行）。`(a|aa)+`、
 *    `(ab|bc|cd)*`、`(\d|\w)+` 均拒绝。
 * 3. 反向引用（R3）：`\1`-`\9`、`\k<name>`。V8 回溯引擎对反向引用是
 *    最坏指数级，安全扫描规则用不到，一律拒绝。
 * 4. 量词紧跟量词（R4）：`a*+` 等。JS 下这类写法大多编译不过
 *    （`a++` 是 SyntaxError），此规则作为编译前兜底。
 *
 * 检测器只在 `new RegExp(pattern, "i")` 编译通过后调用才有意义
 * （`isSafeSecurityPattern` / `validateSecurityRulePattern` 均先编译）；
 * 对畸形输入（未闭合分组、非法转义）不抛错、返回 null，合法性由编译检查负责。
 */

export type ReDoSDiagnostic = string;

const R1_MESSAGE =
  "正则包含危险的嵌套/重叠量词（如 (a+)+ 或 (a*)*），可能导致扫描卡死";
const R2_MESSAGE =
  "正则包含危险的多重交替加量词（如 (a|aa)+ 或 (ab|bc|cd)*），可能导致扫描卡死";
const R3_MESSAGE = "正则包含反向引用（如 \\1），在回溯引擎下可能导致扫描卡死";
const R4_MESSAGE = "正则存在量词紧跟量词（如 a*+），可能导致扫描卡死";

const UNBOUNDED = Number.POSITIVE_INFINITY;

/** 单字符匹配集合；null 表示未知/多字符/零宽（保守按歧义处理）。 */
type CharSet = ReadonlySet<string> | null;

/** `\d`/`\w`/`\s` 的近似字符集（用于分支不相交性分析）。 */
const ESCAPE_CHAR_SETS: Record<string, ReadonlySet<string>> = {
  "\\d": new Set("0123456789".split("")),
  "\\w": new Set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split(""),
  ),
  // \s 的 Unicode 空白字符集（\t \n \v \f \r + 各类 Unicode 空白）
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

/** 正则中代表特殊字符的转义字面量（`\b` 在字符类内是退格，类外是零宽断言）。 */
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  f: "\f",
  b: "\u0008",
};

interface Quantifier {
  /** 最多出现次数；UNBOUNDED 表示 `*`/`+`/`{n,}`。 */
  max: number;
  /** 是否无上界（`*`/`+`/`{n,}`）。 */
  unbounded: boolean;
  /** 是否定数（`{n}`，min===max，n ≥ 1）——不引入回溯歧义。 */
  fixed: boolean;
  /** 已消费的字符数（含惰性 `?` 修饰符）。 */
  len: number;
}

function isQuantifierStart(ch: string | undefined): boolean {
  return ch === "*" || ch === "+" || ch === "?" || ch === "{";
}

/**
 * 解析原子后面的量词后缀；`{` 不是合法量词时返回 null（此时它是字面量，
 * 与 JS 语义一致：`a{` 合法、`{` 单独出现是字面量）。
 */
function parseQuantifier(pattern: string, i: number): Quantifier | null {
  const ch = pattern[i];
  if (ch === "*" || ch === "+" || ch === "?") {
    let len = 1;
    if (pattern[i + 1] === "?") len = 2; // 惰性修饰符，如 a*?
    // `?` 是单次出现（max 1），不产生重复歧义；`*`/`+` 无上界
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
  if (pattern[absEnd] === "?") absEnd += 1; // 惰性修饰符，如 a{2,3}?
  const unbounded = m === UNBOUNDED;
  // len 是相对量词起点的偏移，供调用方直接叠加
  return { max: m, unbounded, fixed: !unbounded && n === m, len: absEnd - i };
}

/**
 * 解码单字符转义（`\xHH`/`\uHHHH`/`\u{...}`/`\cX`/`\0`/`\n` 等特殊转义/普通
 * 转义字面量），供字符类与分支集合分析使用；无法解码时返回 null。
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
  // 其余未知转义在 JS 非 unicode 模式下是「身份转义」，匹配字面字符本身
  return { char: e, next: i + 2 };
}

/**
 * 解析字符类 `[...]`；`^` 取反、补集类（`\D`/`\W`/`\S`）、复杂范围端点等
 * 无法精确表示时返回 null（保守按未知处理）。`next` 指向 `]` 之后。
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
      // 范围 a-z；终点为转义或反向范围时按未知处理
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
        unknown = true; // 补集 → 未知
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
  /** 单字符匹配集合；null = 未知/多字符/零宽/带量词。 */
  set: CharSet;
  /** 该原子（或其内部）是否含非定数量词。 */
  nonFixedQuant: boolean;
  /** 该原子（或其内部）是否含无上界量词（`*`/`+`/`{n,}`）。 */
  unboundedQuant: boolean;
  /** 该原子（或其内部）的交替是否危险（仅分组原子可能为 true）。 */
  altDanger: boolean;
  /** 非 null 表示检测到必须拒绝的危险形态。 */
  danger: string | null;
  next: number;
}

/** 给原子挂量词后缀；量词紧跟量词（R4）在此兜底。 */
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

/** 解析转义原子（含反向引用 R3 检测）。 */
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
  // 反向引用 \1-\9
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
  // 命名反向引用 \k<name>（`\k` 单独出现是字面量 k）
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
    // 补集或零宽断言 → 未知
    return finishAtom(pattern, i + 2, null);
  }
  const decoded = decodeCharEscape(pattern, i);
  if (decoded) {
    return finishAtom(pattern, decoded.next, new Set([decoded.char]));
  }
  return finishAtom(pattern, i + 2, null);
}

/** 分支两两不相交（大小写折叠，匹配 `i` 标志下的语义）。 */
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
  /** 内容中（任意深度）是否存在非定数量词。 */
  nonFixed: boolean;
  /** 内容中（任意深度）是否存在无上界量词。 */
  unbounded: boolean;
  /** 直接层级或嵌套的交替是否危险。 */
  altDanger: boolean;
  next: number;
}

/**
 * 解析一段正则内容（直到 `)` 或串尾），返回合并后的风险标志。
 * `branchSets` 收集直接层级各交替分支的字符集（null = 未知）。
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
      // 量词出现在原子位置 → JS 编译不过（Nothing to repeat），跳过即可
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

/** 解析单个原子（字符/转义/字符类/分组）+ 可选量词后缀。 */
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

/** 解析分组原子（含前缀 `(?:`/`(?=`/`(?!`/`(?<=`/`(?<!`/`(?<name>`）。 */
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
      // (?i 等 JS 不支持的修饰符 → 编译不过，按内容继续
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
    next = pattern.length; // 未闭合 → 编译不过
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
    // R1：嵌套/重叠量词（max ≥ 2 且「无界外量词 × 内部非定数」或「有界外量词 × 内部无界」）
    const nestedQuantDanger =
      q.max >= 2 && (q.unbounded ? inner.nonFixed : inner.unbounded);
    // R2：多重交替加量词
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
  // 未量化的分组：作为多字符原子合并内部标志
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
 * 检测危险回溯形态。返回危险描述；安全时返回 null。
 *
 * 只在 `new RegExp(pattern, "i")` 编译通过后调用（畸形输入的诊断由编译检查负责）。
 */
export function detectReDoS(pattern: string): string | null {
  return parseContent(pattern, 0).danger;
}
