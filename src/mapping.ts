// normalize.ts
export interface NormalizedMetrics {
  plantCode: string;
  ts: string; // ISO timestamp
  raw: any;
  metrics: {
    panelProductionKw?: number;
    houseLoadKw?: number;
    gridImportKw?: number;
    gridExportKw?: number;
    batteryChargeKw?: number;
    batteryDischargeKw?: number;
    batterySocPct?: number;
  };
}

// Map FusionSolar App KPI response -> NormalizedMetrics
export function normalize(plantCode: string, raw: any): NormalizedMetrics {
  const ts = new Date().toISOString();

  // Heuristics: actual key names vary a bit per region/tenant
  const panelProductionKw =
    raw?.dataItemMap?.realTimePower ?? raw?.dataItemMap?.pvPower;

  const houseLoadKw =
    raw?.dataItemMap?.loadPower ?? raw?.dataItemMap?.consumptionPower;

  const gridImport = raw?.dataItemMap?.gridImportPower;
  const gridExport = raw?.dataItemMap?.gridExportPower;
  const gridMixed = raw?.dataItemMap?.gridPower;

  let gridImportKw: number | undefined = gridImport;
  let gridExportKw: number | undefined = gridExport;
  if (
    gridMixed !== undefined &&
    gridImportKw === undefined &&
    gridExportKw === undefined
  ) {
    if (gridMixed >= 0) gridImportKw = gridMixed;
    else gridExportKw = Math.abs(gridMixed);
  }

  const batt = raw?.dataItemMap?.battPower ?? raw?.dataItemMap?.batteryPower;
  let batteryChargeKw: number | undefined;
  let batteryDischargeKw: number | undefined;
  if (batt !== undefined) {
    // Convention: positive = discharge, negative = charging
    if (batt >= 0) batteryDischargeKw = batt;
    else batteryChargeKw = Math.abs(batt);
  }

  const batterySocPct = raw?.dataItemMap?.soc ?? raw?.dataItemMap?.batterySoc;

  return {
    plantCode,
    ts,
    raw,
    metrics: {
      panelProductionKw,
      houseLoadKw,
      gridImportKw,
      gridExportKw,
      batteryChargeKw,
      batteryDischargeKw,
      batterySocPct,
    },
  };
}
