/**
 * TokenHarbor billing ledger import.
 *
 * The official export (Dashboard → Billing) is an append-only transaction
 * ledger with these columns: Date, Type, Source pool, Amount USD,
 * Running balance USD, Status, Order ID, PayPal capture ID.
 *
 * It contains wallet/pool transactions only. Office Pass weekly allowances
 * are not part of this file and still need the two percentage fields.
 */

export interface TokenHarborCsvPreview {
  amount: number;
  currency: "USD";
  observedAt: string;
  dateRaw: string;
  type: string | null;
  pool: string | null;
  status: string | null;
  rowCount: number;
  skippedRows: number;
}

export type TokenHarborCsvResult =
  | { ok: true; preview: TokenHarborCsvPreview }
  | { ok: false; error: string };

type ColumnKey = "date" | "type" | "pool" | "amount" | "balance" | "status";

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  date: ["date", "timestamp", "created at"],
  type: ["type", "transaction type"],
  pool: ["source pool", "pool", "source"],
  amount: ["amount usd", "amount"],
  balance: ["running balance usd", "running balance", "balance"],
  status: ["status"],
};

const REQUIRED: ColumnKey[] = ["date", "balance"];

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF and blank rows. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; index < text.length; index += 1) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  return rows;
}

function parseMoney(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "—") return null;

  let value = trimmed;
  let negative = false;
  if (value.startsWith("(") && value.endsWith(")")) {
    negative = true;
    value = value.slice(1, -1);
  }

  value = value.replace(/[$,\s]/g, "").replace(/^\+/, "");
  if (value === "" || !/^-?\d+(\.\d+)?$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function parseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let candidate = trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate = `${candidate}T00:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(candidate)) {
    candidate = `${candidate.replace(" ", "T")}Z`;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function parseTokenHarborCsv(text: string): TokenHarborCsvResult {
  if (text.trim() === "") {
    return { ok: false, error: "This file is empty. Export the ledger from TokenHarbor Dashboard → Billing." };
  }

  const rows = parseCsvRows(text);
  const header = rows[0];
  if (!header || header.length === 0) {
    return { ok: false, error: "This file has no header row. Export the ledger from TokenHarbor Dashboard → Billing." };
  }

  const indexes = new Map<ColumnKey, number>();
  header.forEach((cell, position) => {
    const normalized = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<
      [ColumnKey, string[]]
    >) {
      if (!indexes.has(key) && aliases.includes(normalized)) indexes.set(key, position);
    }
  });

  const missing = REQUIRED.filter((key) => !indexes.has(key));
  if (missing.length > 0) {
    const labels = missing.map((key) =>
      key === "balance" ? "Running balance USD" : "Date",
    );
    return {
      ok: false,
      error: `This does not look like a TokenHarbor billing export: missing ${labels.join(" and ")}.`,
    };
  }

  const cell = (row: string[], key: ColumnKey): string => {
    const position = indexes.get(key);
    return position === undefined ? "" : (row[position] ?? "");
  };

  let rowCount = 0;
  let skippedRows = 0;
  let latest: TokenHarborCsvPreview | null = null;

  for (const row of rows.slice(1)) {
    rowCount += 1;

    const date = parseDate(cell(row, "date"));
    const amount = parseMoney(cell(row, "balance"));
    if (!date || amount === null) {
      skippedRows += 1;
      continue;
    }

    if (latest && date.getTime() < new Date(latest.observedAt).getTime()) continue;

    const dateRaw = cell(row, "date").trim();
    latest = {
      amount,
      currency: "USD",
      observedAt: date.toISOString(),
      dateRaw,
      type: clean(cell(row, "type")),
      pool: clean(cell(row, "pool")),
      status: clean(cell(row, "status")),
      rowCount: 0,
      skippedRows: 0,
    };
  }

  if (!latest) {
    return {
      ok: false,
      error: "No row in this file has both a valid Date and Running balance USD.",
    };
  }

  return { ok: true, preview: { ...latest, rowCount, skippedRows } };
}
