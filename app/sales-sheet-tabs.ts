import { dateValue, num, text, type SheetSyncConfig } from "./sales-sheet-sync-kit";

// Five Tier-1 read-only mirror tables — see docs/sales-sheet-integration-plan.md.
// Each config's column order matches the sheet's own column order for straightforward review.

export const leadProtectionSync: SheetSyncConfig = {
  key: "lead_protection",
  sheetName: "영업보호",
  tableName: "sales_sheet_lead_protections",
  headerRows: 4, // rows 1-3 are blank/merged instruction text; row 4 is the real header.
  columns: [
    { name: "registered_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "requester_company", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "contact_person", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "customer_company", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "end_user", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "phone", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "email", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "product", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "timing", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "sales_rep", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "progress", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "project_name", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "note", sqlType: "TEXT NOT NULL DEFAULT ''" },
  ],
  parseRow(row, rowNumber) {
    const customerCompany = text(row[3]);
    const product = text(row[7]);
    if (!customerCompany && !product) return null;
    return {
      registered_date: dateValue(row[0]), requester_company: text(row[1]), contact_person: text(row[2]),
      customer_company: customerCompany, end_user: text(row[4]), phone: text(row[5]), email: text(row[6]),
      product, timing: text(row[8]), sales_rep: text(row[9]), progress: text(row[10]),
      project_name: text(row[11]), note: text(row[12]),
    };
  },
  searchColumns: ["customer_company", "requester_company", "contact_person", "end_user", "product", "sales_rep", "project_name"],
  customerField: "customer_company",
  dateField: "registered_date",
};

export const inboundLeadSync: SheetSyncConfig = {
  key: "inbound_lead",
  sheetName: "인바운드 영업",
  tableName: "sales_sheet_inbound_leads",
  headerRows: 2, // row 1 is a group header (고객정보/문의내용/...); row 2 is the real header.
  columns: [
    { name: "inflow_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "channel", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "inquiry_type", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "company", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "contact_person", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "phone", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "email", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "product", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "quantity", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "expected_budget", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "desired_delivery", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "quoted_amount_incl", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "first_contact_rep", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "first_contact_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "quote_sent_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "quote_amount", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "stage", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "final_result", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "contract_amount", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "margin", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "contract_completed_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "fail_hold_reason", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "memo", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "reflected", sqlType: "TEXT NOT NULL DEFAULT ''" },
  ],
  parseRow(row, rowNumber) {
    const company = text(row[3]);
    const product = text(row[7]);
    if (!company && !product) return null;
    return {
      inflow_date: dateValue(row[0]), channel: text(row[1]), inquiry_type: text(row[2]), company,
      contact_person: text(row[4]), phone: text(row[5]), email: text(row[6]), product,
      quantity: text(row[8]), expected_budget: text(row[9]), desired_delivery: text(row[10]),
      quoted_amount_incl: Math.round(num(row[11])), first_contact_rep: text(row[12]),
      first_contact_date: dateValue(row[13]), quote_sent_date: dateValue(row[14]), quote_amount: Math.round(num(row[15])),
      stage: text(row[16]), final_result: text(row[17]), contract_amount: Math.round(num(row[18])), margin: Math.round(num(row[19])),
      contract_completed_date: dateValue(row[20]), fail_hold_reason: text(row[21]),
      memo: [text(row[22]), text(row[23])].filter(Boolean).join(" / "), reflected: text(row[24]),
    };
  },
  searchColumns: ["company", "contact_person", "product", "memo", "first_contact_rep"],
  customerField: "company",
  dateField: "inflow_date",
};

export const deliverySync: SheetSyncConfig = {
  key: "delivery",
  sheetName: "서버납품",
  tableName: "sales_sheet_deliveries",
  headerRows: 1,
  columns: [
    { name: "delivery_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "invoice_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "rep", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "customer_name", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "model", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "quantity", sqlType: "REAL NOT NULL DEFAULT 0" },
    { name: "serial", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "note", sqlType: "TEXT NOT NULL DEFAULT ''" },
  ],
  parseRow(row, rowNumber) {
    const customerName = text(row[3]);
    const model = text(row[4]);
    if (!customerName && !model) return null;
    return {
      delivery_date: dateValue(row[0]), invoice_date: dateValue(row[1]), rep: text(row[2]), customer_name: customerName,
      model, quantity: num(row[5]), serial: text(row[6]), note: text(row[7]),
    };
  },
  searchColumns: ["customer_name", "model", "rep", "serial"],
  customerField: "customer_name",
  dateField: "delivery_date",
};

export const serviceLogSync: SheetSyncConfig = {
  key: "service_log",
  sheetName: "AS",
  tableName: "sales_sheet_service_logs",
  headerRows: 2, // row 1 is scattered merged instruction text; row 2 is the real header.
  columns: [
    { name: "product_name", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "serial_number", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "purchase_vendor", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "customer_name", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "contact_phone", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "sales_rep", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "shipped_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "issue_description", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "as_phone_received", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "product_received_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "return_refund_replace", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "replacement_shipped", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "replacement_vendor", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "rma_date", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "rma_result_type", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "result", sqlType: "TEXT NOT NULL DEFAULT ''" },
  ],
  parseRow(row, rowNumber) {
    const productName = text(row[0]);
    const customerName = text(row[3]);
    if (!productName && !customerName) return null;
    return {
      product_name: productName, serial_number: text(row[1]), purchase_vendor: text(row[2]), customer_name: customerName,
      contact_phone: text(row[4]), sales_rep: text(row[5]), shipped_date: dateValue(row[6]), issue_description: text(row[7]),
      as_phone_received: text(row[8]), product_received_date: dateValue(row[9]), return_refund_replace: text(row[10]),
      replacement_shipped: text(row[11]), replacement_vendor: text(row[12]), rma_date: dateValue(row[13]),
      rma_result_type: text(row[14]), result: text(row[15]),
    };
  },
  searchColumns: ["product_name", "customer_name", "sales_rep", "issue_description", "serial_number"],
  customerField: "customer_name",
  dateField: "shipped_date",
};

export const priceCatalogSync: SheetSyncConfig = {
  key: "price_catalog",
  sheetName: "매입단가고지",
  tableName: "sales_sheet_price_catalog",
  headerRows: 1,
  columns: [
    { name: "item", sqlType: "TEXT NOT NULL DEFAULT ''" },
    { name: "cost", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "retail_price", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "retail_price_vat_included", sqlType: "INTEGER NOT NULL DEFAULT 0" },
    { name: "notice", sqlType: "TEXT NOT NULL DEFAULT ''" },
  ],
  parseRow(row, rowNumber) {
    const item = text(row[0]);
    if (!item) return null;
    return {
      item, cost: Math.round(num(row[1])), retail_price: Math.round(num(row[2])),
      retail_price_vat_included: Math.round(num(row[3])), notice: text(row[5]),
    };
  },
  searchColumns: ["item", "notice"],
};

export const ALL_TAB_SYNCS: SheetSyncConfig[] = [
  leadProtectionSync, inboundLeadSync, deliverySync, serviceLogSync, priceCatalogSync,
];
