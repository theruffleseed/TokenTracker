import { describe, expect, it } from "vitest";
import { parseCsvRows, parseTokenHarborCsv } from "@/lib/tokenharbor-csv";

const HEADER =
  "Date,Type,Source pool,Amount USD,Running balance USD,Status,Order ID,PayPal capture ID";

describe("parseTokenHarborCsv", () => {
  it("reads the latest running balance from a standard export", () => {
    const csv = `${HEADER}
2026-10-01T10:00:00Z,Recharge,Paid pool,"1,000.00","1,000.00",completed,ord_1,cap_1
2026-10-02T11:30:00Z,Usage,Paid pool,-12.50,"987.50",completed,ord_2,
2026-10-03T09:15:00Z,Recharge,Paid pool,50.00,"1,037.50",completed,ord_3,cap_3
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.amount).toBe(1037.5);
    expect(result.preview.currency).toBe("USD");
    expect(result.preview.observedAt).toBe("2026-10-03T09:15:00.000Z");
    expect(result.preview.type).toBe("Recharge");
    expect(result.preview.pool).toBe("Paid pool");
    expect(result.preview.status).toBe("completed");
    expect(result.preview.rowCount).toBe(3);
    expect(result.preview.skippedRows).toBe(0);
  });

  it("handles BOM, CRLF, quoted commas, and header whitespace", () => {
    const csv = `\uFEFF date , type , source pool , amount usd , running balance usd , status \r
2026-09-30T08:00:00Z,"Top-up, monthly",Paid pool,"$2,500.10","$2,500.10",completed\r
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.amount).toBe(2500.1);
    expect(result.preview.type).toBe("Top-up, monthly");
  });

  it("keeps newlines inside quoted fields", () => {
    const csv = `${HEADER}
2026-10-05T12:00:00Z,"Recharge
bonus",Paid pool,25,125.25,completed,ord_9,
`;

    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe("Recharge\nbonus");

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.amount).toBe(125.25);
  });

  it("sorts by date rather than trusting file order", () => {
    const csv = `${HEADER}
2026-10-10T10:00:00Z,Usage,Paid pool,-5,95,completed,ord_3,
2026-10-12T10:00:00Z,Recharge,Paid pool,10,105,completed,ord_1,
2026-10-11T10:00:00Z,Usage,Paid pool,-2,98,completed,ord_2,
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.amount).toBe(105);
    expect(result.preview.observedAt).toBe("2026-10-12T10:00:00.000Z");
  });

  it("skips rows with missing dates or balances and reports them", () => {
    const csv = `${HEADER}
not-a-date,Recharge,Paid pool,10,50,completed,ord_1,
2026-10-01T10:00:00Z,Usage,Paid pool,-1,,completed,ord_2,
2026-10-02T10:00:00Z,Usage,Paid pool,-1,49,completed,ord_3,
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.amount).toBe(49);
    expect(result.preview.rowCount).toBe(3);
    expect(result.preview.skippedRows).toBe(2);
  });

  it("parses parenthesised negatives and plain decimals", () => {
    const csv = `${HEADER}
2026-10-01T10:00:00Z,Adjustment,Paid pool,(2.50),47.50,completed,ord_1,
2026-10-02T10:00:00Z,Adjustment,Paid pool,-2.5,45,completed,ord_2,
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.amount).toBe(45);
  });

  it("rejects a file without the running balance column", () => {
    const csv = `Date,Type,Amount USD
2026-10-01T10:00:00Z,Recharge,10
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Running balance USD");
    expect(result.error).toContain("TokenHarbor");
  });

  it("rejects a file where no row has usable values", () => {
    const csv = `${HEADER}
nope,Recharge,Paid pool,10,,completed,,
`;

    const result = parseTokenHarborCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No row");
  });

  it("rejects an empty file", () => {
    const result = parseTokenHarborCsv(" \n ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("empty");
  });
});
