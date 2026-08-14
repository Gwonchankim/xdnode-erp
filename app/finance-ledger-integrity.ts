export type LedgerIntegritySnapshot = { asOf: string; ledgerHash: string; lineCount: number; openingSetId: string;
  openingChecksum: string; totals: Record<string, number> };

export function evaluateLedgerSnapshotDrift(frozen: LedgerIntegritySnapshot, current: LedgerIntegritySnapshot) {
  const totalKeys = new Set([...Object.keys(frozen.totals ?? {}), ...Object.keys(current.totals ?? {})]);
  const totalsChanged = [...totalKeys].some((key) => Number(frozen.totals?.[key] ?? 0) !== Number(current.totals?.[key] ?? 0));
  const openingChanged = frozen.openingSetId !== current.openingSetId || frozen.openingChecksum !== current.openingChecksum;
  return { checked: true, drifted: frozen.ledgerHash !== current.ledgerHash,
    checkedAsOf: frozen.asOf, frozenHash: frozen.ledgerHash, currentHash: current.ledgerHash,
    frozenLineCount: Number(frozen.lineCount ?? 0), currentLineCount: Number(current.lineCount ?? 0),
    lineCountDelta: Number(current.lineCount ?? 0) - Number(frozen.lineCount ?? 0), totalsChanged, openingChanged };
}
