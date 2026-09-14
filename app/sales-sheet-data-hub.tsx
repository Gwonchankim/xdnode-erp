"use client";

import SalesSheetSyncView from "./sales-sheet-sync-view";
import SalesSheetInsightsView from "./sales-sheet-insights-view";

export default function SalesSheetDataHub() {
  return <div className="sales-sheet-data-hub">
    <SalesSheetInsightsView />
    <SalesSheetSyncView />
  </div>;
}
