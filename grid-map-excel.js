import { buildGeneratedLandMapPlan, detectLandGrid } from './land-grid-mapper.js';
import { buildGridMapXlsx } from './xlsx-report.js';

function planOptions(options = {}) {
  return {
    namingMode: options.namingMode,
    gapMode: options.gapMode,
    order: options.order,
    reverseRows: options.reverseRows,
    reverseColumns: options.reverseColumns,
    prefix: options.prefix,
    suffix: options.suffix,
    separator: options.separator,
    rowStart: options.rowStart,
    columnStart: options.columnStart,
    columnStep: options.columnStep,
    start: options.start,
    step: options.step,
    padding: options.padding,
    manualOverrides: options.manualOverrides,
    existingAssignments: options.existingAssignments,
  };
}

function mappingStatus(item, savedAssignment) {
  if (item.changed) return savedAssignment ? 'Changed preview' : 'New preview';
  if (item.manualOverride) return 'Saved manual override';
  return savedAssignment ? 'Saved mapping' : 'Preview';
}

/**
 * Create an Excel model where the generated/new Land Map name is explicitly
 * mapped to the existing CAD Land name. The legacy second `mappings` argument
 * is accepted for API compatibility but is not used as a naming source.
 */
export function createGridMapExcelModel(component, mappingsOrOptions = [], maybeOptions = {}) {
  if (!component) throw new TypeError('Select a component for Grid / Land Map.');
  const options = Array.isArray(mappingsOrOptions) ? maybeOptions : mappingsOrOptions;
  const grid = options.grid || detectLandGrid(component, options.gridOptions || {});
  if (grid.collisions.length) throw new RangeError(`Found ${grid.collisions.length} grid-cell land collision(s).`);
  const physicalCells = grid.rowCount * grid.columnCount;
  if (grid.columnCount + 1 > 16384 || grid.rowCount * 2 + 10 > 1048576) throw new RangeError('The grid exceeds Excel worksheet limits.');
  if (physicalCells > Number(options.maxPhysicalCells || 250000)) throw new RangeError(`Grid size ${physicalCells.toLocaleString()} cells exceeds the Excel export budget.`);

  const plan = options.plan || buildGeneratedLandMapPlan(grid, planOptions(options));
  if (plan.duplicates.length) throw new RangeError(`Generated names contain ${plan.duplicates.length} duplicate or blank group(s).`);
  const savedByKey = new Map((options.existingAssignments || []).map((item) => [String(item.landKey || `${item.componentId}:${item.globalId}`), item]));
  const cells = plan.plan.map((item, index) => {
    const land = item.land;
    const centerX = Number(land.left) + Number(land.width) / 2;
    const centerY = Number(land.top) - Number(land.length) / 2;
    const saved = savedByKey.get(item.landKey) || null;
    return {
      sequence: index + 1,
      row: item.physicalRow,
      column: item.physicalColumn,
      logicalRow: item.logicalRow,
      logicalColumn: item.logicalColumn,
      land,
      newName: String(item.newName || ''),
      generatedName: String(item.generatedName || ''),
      cadName: String(item.cadName || land.cadName || land.globalId || '—'),
      globalId: land.globalId,
      componentId: component.id,
      landKey: item.landKey,
      previousNewName: item.previousNewName || saved?.newName || '',
      proposed: Boolean(item.changed),
      manualOverride: Boolean(item.manualOverride),
      mappingStatus: mappingStatus(item, saved),
      centerX: Number.isFinite(centerX) ? centerX : null,
      centerY: Number.isFinite(centerY) ? centerY : null,
      width: Number.isFinite(Number(land.width)) ? Number(land.width) : null,
      length: Number.isFinite(Number(land.length)) ? Number(land.length) : null,
    };
  });

  return {
    title: options.title || `Grid / Land Map ${component.name || component.id}`,
    boardName: String(options.boardName || ''),
    componentName: String(component.name || component.id || 'Component'),
    packageName: String(component.packageName || '—'),
    generatedAt: options.generatedAt || new Date().toISOString(),
    grid,
    cells,
    mappingCount: cells.length,
    generatedCount: cells.filter((cell) => !cell.previousNewName).length,
    proposedCount: cells.filter((cell) => cell.proposed).length,
    manualCount: cells.filter((cell) => cell.manualOverride).length,
    settings: { ...plan.settings },
    projectMetadata: options.metadata || {},
  };
}

export async function buildGridMapExcelBlob(model) {
  return buildGridMapXlsx(model);
}
