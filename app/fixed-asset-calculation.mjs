/** @param {string} from @param {string} to */
export function monthsBetween(from, to) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}

/**
 * Deterministic full-month straight-line depreciation in whole won.
 * Remainder won are allocated from the first service month; the final month absorbs any verified opening variance.
 * @param {{ acquisitionCost:number; residualValue:number; usefulLifeMonths:number; inServicePeriod:string;
 * period:string; openingAccumulated?:number; postedAccumulated?:number }} input
 */
export function calculateStraightLineDepreciation(input) {
  const { acquisitionCost, residualValue, usefulLifeMonths, inServicePeriod, period,
    openingAccumulated = 0, postedAccumulated = 0 } = input;
  if (![acquisitionCost, residualValue, usefulLifeMonths, openingAccumulated, postedAccumulated].every(Number.isSafeInteger)
    || acquisitionCost <= 0 || residualValue < 0 || residualValue >= acquisitionCost || usefulLifeMonths < 1
    || openingAccumulated < 0 || postedAccumulated < 0) throw new Error("Invalid fixed-asset depreciation inputs");
  const monthIndex = monthsBetween(inServicePeriod, period);
  const depreciable = acquisitionCost - residualValue;
  const opening = openingAccumulated + postedAccumulated;
  if (monthIndex < 0 || monthIndex >= usefulLifeMonths || opening >= depreciable) return { monthIndex, opening, depreciation: 0, closingAccumulated: opening, closingBookValue: acquisitionCost - opening };
  const base = Math.floor(depreciable / usefulLifeMonths);
  const remainder = depreciable % usefulLifeMonths;
  const scheduled = monthIndex === usefulLifeMonths - 1 ? depreciable - opening : base + (monthIndex < remainder ? 1 : 0);
  const depreciation = Math.max(0, Math.min(scheduled, depreciable - opening));
  return { monthIndex, opening, depreciation, closingAccumulated: opening + depreciation,
    closingBookValue: acquisitionCost - opening - depreciation };
}
