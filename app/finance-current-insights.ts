// Clobe operational bank summary fetched with the 2026-08-14 finance snapshot.
// Values are kept separate from accounting revenue because bank inflows/outflows
// can include transfers and other non-revenue cash movements.
export const financeCurrentInsights = {
  taxInvoicesAsOf: "2026-08-13",
  bankActivity31Days: {
    startDate: "2026-07-14",
    endDate: "2026-08-13",
    inflowKrw: 14_967_327_589.5,
    outflowKrw: 13_385_703_061.2,
    netInflowKrw: 1_581_624_528.3,
    inflowCategories: {
      salesRelatedKrw: 7_835_865_016,
      unclassifiedKrw: 7_127_811_273.5,
      governmentSupportKrw: 3_600_000,
    },
    outflowCategories: {
      unclassifiedKrw: 6_845_402_364.2,
      otherOperatingKrw: 6_167_766_052,
      taxesAndDuesKrw: 308_196_930,
      unlinkedCardSettlementKrw: 17_034_423,
    },
    scopeNote: "Clobe 은행거래 원문 집계 · 계좌간 대체 포함 가능",
  },
} as const;
