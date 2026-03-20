/**
 * Safe formula evaluator for workload tracker computed columns.
 *
 * Supports:
 *   - Column references by key (e.g., hours, qty)
 *   - Basic arithmetic: +, -, *, /
 *   - Parentheses
 *   - Ternary: condition ? trueVal : falseVal
 *   - Comparison: >, <, >=, <=, ==, !=
 *
 * No eval() — uses a recursive descent parser.
 */

type Cells = Record<string, unknown>;

export function evaluateFormula(
  formula: string,
  cells: Cells
): number | string {
  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens, cells);
    const result = parser.parseTernary();
    if (typeof result === "boolean") return result ? 1 : 0;
    if (typeof result === "number") {
      return Math.round(result * 100) / 100; // 2 decimal places
    }
    return Number(result) || 0;
  } catch {
    return "#ERR";
  }
}

// ── Tokenizer ──────────────────────────────────────────────

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "ternary"; value: "?" | ":" };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        num += expr[i++];
      }
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        id += expr[i++];
      }
      tokens.push({ type: "ident", value: id });
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === "?") {
      tokens.push({ type: "ternary", value: "?" });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "ternary", value: ":" });
      i++;
      continue;
    }
    // Multi-char operators
    const two = expr.slice(i, i + 2);
    if ([">=", "<=", "==", "!="].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if (["+", "-", "*", "/", ">", "<", "!"].includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    i++; // skip unknown
  }
  return tokens;
}

// ── Parser ─────────────────────────────────────────────────

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private cells: Cells
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  parseTernary(): number | boolean {
    const cond = this.parseComparison();
    const tok = this.peek();
    if (tok?.type === "ternary" && tok.value === "?") {
      this.advance(); // ?
      const trueVal = this.parseExpr();
      const colon = this.peek();
      if (colon?.type === "ternary" && colon.value === ":") {
        this.advance(); // :
        const falseVal = this.parseExpr();
        return this.toBool(cond) ? this.toNum(trueVal) : this.toNum(falseVal);
      }
      return this.toBool(cond) ? this.toNum(trueVal) : 0;
    }
    return this.toNum(cond);
  }

  private parseComparison(): number | boolean {
    let left = this.parseExpr();
    const tok = this.peek();
    if (tok?.type === "op" && [">", "<", ">=", "<=", "==", "!="].includes(tok.value)) {
      this.advance();
      const right = this.parseExpr();
      const l = this.toNum(left);
      const r = this.toNum(right);
      switch (tok.value) {
        case ">": return l > r;
        case "<": return l < r;
        case ">=": return l >= r;
        case "<=": return l <= r;
        case "==": return l === r;
        case "!=": return l !== r;
      }
    }
    return left;
  }

  private parseExpr(): number | boolean {
    let left = this.parseTerm();
    while (this.peek()?.type === "op" && ["+", "-"].includes(String(this.peek()!.value))) {
      const op = this.advance().value;
      const right = this.parseTerm();
      if (op === "+") left = this.toNum(left) + this.toNum(right);
      else left = this.toNum(left) - this.toNum(right);
    }
    return left;
  }

  private parseTerm(): number | boolean {
    let left = this.parsePrimary();
    while (this.peek()?.type === "op" && ["*", "/"].includes(String(this.peek()!.value))) {
      const op = this.advance().value;
      const right = this.parsePrimary();
      if (op === "*") left = this.toNum(left) * this.toNum(right);
      else {
        const d = this.toNum(right);
        left = d === 0 ? 0 : this.toNum(left) / d;
      }
    }
    return left;
  }

  private parsePrimary(): number | boolean {
    const tok = this.peek();
    if (!tok) return 0;

    if (tok.type === "number") {
      this.advance();
      return tok.value;
    }

    if (tok.type === "ident") {
      this.advance();
      const val = this.cells[tok.value];
      if (typeof val === "boolean") return val;
      if (typeof val === "number") return val;
      return Number(val) || 0;
    }

    if (tok.type === "paren" && tok.value === "(") {
      this.advance();
      const val = this.parseTernary();
      if (this.peek()?.type === "paren" && this.peek()?.value === ")") {
        this.advance();
      }
      return val;
    }

    // Unary minus
    if (tok.type === "op" && tok.value === "-") {
      this.advance();
      return -this.toNum(this.parsePrimary());
    }

    // Unary not (!)
    if (tok.type === "op" && tok.value === "!") {
      this.advance();
      return !this.toBool(this.parsePrimary());
    }

    this.advance();
    return 0;
  }

  private toNum(v: number | boolean): number {
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  }

  private toBool(v: number | boolean): boolean {
    if (typeof v === "boolean") return v;
    return v !== 0;
  }
}
