import { describe, expect, it } from "vitest";
import {
  defaultWindow,
  splitRange,
  toTimeEntryRow,
  type FortnoxRegistration,
} from "../supabase/functions/_shared/map";

const SYNCED = "2026-09-04T02:00:00.000Z";

const full: FortnoxRegistration = {
  id: "abc-123",
  userId: "42",
  workedDate: "2026-08-14",
  workedHours: 7.5,
  chargeHours: 6,
  registrationCode: { code: "TID", name: "Tid" },
  customer: { id: 100, name: "Saldo AB" },
  project: { id: "P7", description: "Saldo OS" },
  service: { id: "S1", name: "Utveckling" },
  invoiceText: "  Sprint 12  ",
  note: "",
  nonInvoiceable: false,
  invoiceBasisId: 9001,
  documentId: null,
  documentType: null,
  unitCost: 650,
  unitPrice: 1200,
  createdTime: "2026-08-14T16:02:11Z",
  updatedBy: "42",
};

describe("toTimeEntryRow", () => {
  it("mappar en fullständig registrering fält för fält", () => {
    const row = toTimeEntryRow(full, SYNCED);
    expect(row).toMatchObject({
      fortnox_id: "abc-123",
      worked_date: "2026-08-14",
      worked_hours: 7.5,
      charge_hours: 6,
      registration_code: "TID",
      fortnox_user_id: "42",
      fortnox_customer_id: "100",
      fortnox_customer_name: "Saldo AB",
      fortnox_project_id: "P7",
      fortnox_project_name: "Saldo OS",
      fortnox_service_id: "S1",
      fortnox_service_name: "Utveckling",
      invoice_text: "Sprint 12",
      note: null,
      non_invoiceable: false,
      invoice_basis_id: 9001,
      document_id: null,
      unit_cost: 650,
      unit_price: 1200,
      fortnox_created_at: "2026-08-14T16:02:11Z",
      synced_at: SYNCED,
    });
    expect(row.raw).toBe(full);
  });

  it("defaultar saknad kod till TID och saknade timmar till 0", () => {
    const row = toTimeEntryRow(
      { id: 1 as unknown as string, workedDate: "2026-01-02T00:00:00" },
      SYNCED,
    );
    expect(row.fortnox_id).toBe("1");
    expect(row.worked_date).toBe("2026-01-02");
    expect(row.registration_code).toBe("TID");
    expect(row.worked_hours).toBe(0);
    expect(row.charge_hours).toBe(0);
    expect(row.fortnox_user_id).toBeNull();
    expect(row.fortnox_project_name).toBeNull();
  });

  it("behåller frånvarokoder som de är", () => {
    const row = toTimeEntryRow(
      { ...full, registrationCode: { code: "SEM" }, chargeHours: 0 },
      SYNCED,
    );
    expect(row.registration_code).toBe("SEM");
  });
});

describe("defaultWindow", () => {
  it("ger idag − N dagar → idag", () => {
    const w = defaultWindow(new Date("2026-09-04T02:00:00Z"), 31);
    expect(w).toEqual({ from: "2026-08-04", to: "2026-09-04" });
  });
});

describe("splitRange", () => {
  it("lämnar ett spann under ett år orört", () => {
    expect(splitRange("2026-01-01", "2026-09-04")).toEqual([
      { from: "2026-01-01", to: "2026-09-04" },
    ]);
  });

  it("delar ett flerårigt spann i bitar om max 365 dagar", () => {
    const parts = splitRange("2025-01-01", "2026-09-04");
    expect(parts).toEqual([
      { from: "2025-01-01", to: "2025-12-31" },
      { from: "2026-01-01", to: "2026-09-04" },
    ]);
  });

  it("hanterar from === to", () => {
    expect(splitRange("2026-05-05", "2026-05-05")).toEqual([
      { from: "2026-05-05", to: "2026-05-05" },
    ]);
  });
});
