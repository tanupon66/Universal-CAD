function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function landCenter(land) {
  const left = finite(land?.left);
  const top = finite(land?.top);
  const width = finite(land?.width);
  const length = finite(land?.length);
  if ([left, top, width, length].every(Number.isFinite)) return { x: left + width / 2, y: top - length / 2 };
  const x = finite(land?.centerX), y = finite(land?.centerY);
  return x == null || y == null ? null : { x, y };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function estimateTolerance(lands, axis) {
  const sizes = lands.map((land) => Math.abs(Number(axis === 'x' ? land.width : land.length))).filter((value) => Number.isFinite(value) && value > 0);
  const size = median(sizes);
  return Math.max(0.001, size ? size * 0.38 : 0.02);
}

function clusterCoordinates(items, axis, tolerance) {
  const sorted = [...items].sort((a, b) => a.center[axis] - b.center[axis]);
  const clusters = [];
  for (const item of sorted) {
    const value = item.center[axis];
    let cluster = clusters.find((candidate) => Math.abs(candidate.value - value) <= tolerance);
    if (!cluster) { cluster = { value, items: [] }; clusters.push(cluster); }
    cluster.items.push(item);
    cluster.value = cluster.items.reduce((sum, current) => sum + current.center[axis], 0) / cluster.items.length;
  }
  return clusters.sort((a, b) => a.value - b.value);
}

export function spreadsheetColumnName(index) {
  let value = Math.max(0, Number(index) || 0) + 1;
  let result = '';
  while (value > 0) {
    const digit = (value - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function detectLandGrid(component, options = {}) {
  const items = (component?.lands || []).map((land) => ({ land, center: landCenter(land) })).filter((item) => item.center);
  if (!items.length) throw new RangeError('This component has no lands with complete coordinates.');
  const xTolerance = Number(options.xTolerance) > 0 ? Number(options.xTolerance) : estimateTolerance(items.map((item) => item.land), 'x');
  const yTolerance = Number(options.yTolerance) > 0 ? Number(options.yTolerance) : estimateTolerance(items.map((item) => item.land), 'y');
  const columns = clusterCoordinates(items, 'x', xTolerance);
  const rowsAscending = clusterCoordinates(items, 'y', yTolerance);
  const rows = [...rowsAscending].sort((a, b) => b.value - a.value); // physical top → bottom
  const matrix = Array.from({ length: rows.length }, () => Array(columns.length).fill(null));
  const collisions = [];
  for (const item of items) {
    const rowIndex = rows.reduce((best, row, index) => Math.abs(row.value - item.center.y) < Math.abs(rows[best].value - item.center.y) ? index : best, 0);
    const columnIndex = columns.reduce((best, column, index) => Math.abs(column.value - item.center.x) < Math.abs(columns[best].value - item.center.x) ? index : best, 0);
    if (matrix[rowIndex][columnIndex]) collisions.push({ rowIndex, columnIndex, lands: [matrix[rowIndex][columnIndex], item.land] });
    else matrix[rowIndex][columnIndex] = item.land;
  }
  return {
    component,
    rows: rows.map((row, index) => ({ index, coordinate: row.value, lands: row.items.map((item) => item.land) })),
    columns: columns.map((column, index) => ({ index, coordinate: column.value, lands: column.items.map((item) => item.land) })),
    matrix,
    rowCount: rows.length,
    columnCount: columns.length,
    landCount: items.length,
    missingCount: matrix.flat().filter((land) => !land).length,
    collisions,
    tolerance: { x: xTolerance, y: yTolerance },
  };
}

export function defaultGridLabels(grid, options = {}) {
  const rowStart = Math.max(0, Number(options.rowStart) || 0);
  const columnStart = Number.isFinite(Number(options.columnStart)) ? Number(options.columnStart) : 1;
  return {
    rows: Array.from({ length: grid.rowCount }, (_, index) => spreadsheetColumnName(rowStart + index)),
    columns: Array.from({ length: grid.columnCount }, (_, index) => String(columnStart + index)),
  };
}

export function orderedGridCells(grid, options = {}) {
  const supported = new Set(['row-major', 'column-major', 'snake-row', 'snake-column', 'perimeter-clockwise', 'perimeter-counterclockwise']);
  const order = supported.has(options.order) ? options.order : 'row-major';
  const reverseRows = Boolean(options.reverseRows);
  const reverseColumns = Boolean(options.reverseColumns);
  const rowIndexes = Array.from({ length: grid.rowCount }, (_, index) => reverseRows ? grid.rowCount - 1 - index : index);
  const columnIndexes = Array.from({ length: grid.columnCount }, (_, index) => reverseColumns ? grid.columnCount - 1 - index : index);
  const cells = [];
  const push = (row, column) => { const land = grid.matrix[row]?.[column]; if (land) cells.push({ row, column, land }); };
  if (order === 'column-major') {
    for (const column of columnIndexes) for (const row of rowIndexes) push(row, column);
  } else if (order === 'snake-row') {
    rowIndexes.forEach((row, index) => { const cols = index % 2 ? [...columnIndexes].reverse() : columnIndexes; for (const column of cols) push(row, column); });
  } else if (order === 'snake-column') {
    columnIndexes.forEach((column, index) => { const rows = index % 2 ? [...rowIndexes].reverse() : rowIndexes; for (const row of rows) push(row, column); });
  } else if (order.startsWith('perimeter-')) {
    const physicalRows = rowIndexes, physicalCols = columnIndexes;
    const path = [];
    if (physicalRows.length && physicalCols.length) {
      for (const col of physicalCols) path.push([physicalRows[0], col]);
      for (let i = 1; i < physicalRows.length; i += 1) path.push([physicalRows[i], physicalCols.at(-1)]);
      if (physicalRows.length > 1) for (let i = physicalCols.length - 2; i >= 0; i -= 1) path.push([physicalRows.at(-1), physicalCols[i]]);
      if (physicalCols.length > 1) for (let i = physicalRows.length - 2; i > 0; i -= 1) path.push([physicalRows[i], physicalCols[0]]);
      const seen = new Set(path.map(([r,c]) => `${r}:${c}`));
      for (const row of physicalRows) for (const col of physicalCols) if (!seen.has(`${row}:${col}`)) path.push([row,col]);
    }
    const resolved = order === 'perimeter-counterclockwise' ? path.slice(0,1).concat(path.slice(1).reverse()) : path;
    for (const [row, col] of resolved) push(row,col);
  } else {
    for (const row of rowIndexes) for (const column of columnIndexes) push(row, column);
  }
  const startRow = Number(options.startRow), startColumn = Number(options.startColumn);
  if (Number.isInteger(startRow) && Number.isInteger(startColumn)) {
    const index = cells.findIndex((cell) => cell.row === startRow && cell.column === startColumn);
    if (index > 0) return cells.slice(index).concat(cells.slice(0, index));
  }
  return cells;
}

function paddedNumber(value, padding) {
  const number = String(Math.trunc(Number(value) || 0));
  const width = Math.max(0, Math.min(12, Number(padding) || 0));
  return width ? number.padStart(width, '0') : number;
}


function spreadsheetColumnIndex(label) {
  const text = String(label ?? '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) return 0;
  let value = 0;
  for (const character of text) value = value * 26 + (character.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

function landMappingKey(land, component = null) {
  return `${String(land?.componentId ?? component?.id ?? '')}:${String(land?.globalId ?? land?.uid ?? '')}`;
}

function normalizeOverrideMap(overrides) {
  if (overrides instanceof Map) return overrides;
  if (Array.isArray(overrides)) return new Map(overrides.map((item) => [String(item?.key ?? item?.landKey ?? ''), String(item?.value ?? item?.name ?? '')]));
  if (overrides && typeof overrides === 'object') return new Map(Object.entries(overrides).map(([key, value]) => [String(key), String(value ?? '')]));
  return new Map();
}

function existingGeneratedNameMap(existingAssignments, component = null) {
  const map = new Map();
  for (const item of existingAssignments || []) {
    const key = String(item?.landKey || `${String(item?.componentId ?? component?.id ?? '')}:${String(item?.globalId ?? '')}`);
    if (key && key !== ':') map.set(key, String(item?.newName ?? item?.generatedName ?? ''));
  }
  return map;
}

function gridRowLabel(startLabel, offset, options = {}) {
  const alphabet = String(options.alphabet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').toUpperCase().replace(/[^A-Z]/g, '') || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const skip = new Set(String(options.skipLetters || '').toUpperCase().replace(/[^A-Z]/g, '').split(''));
  const usable = [...new Set(alphabet.split(''))].filter((letter) => !skip.has(letter));
  if (!usable.length) return spreadsheetColumnName(spreadsheetColumnIndex(startLabel) + Math.max(0, Number(offset) || 0));
  const start = Math.max(0, usable.indexOf(String(startLabel || 'A').trim().toUpperCase()));
  let value = start + Math.max(0, Number(offset) || 0);
  let result = '';
  do { result = usable[value % usable.length] + result; value = Math.floor(value / usable.length) - 1; } while (value >= 0);
  return result;
}

/**
 * Build a generated Land Map that maps a user-configured new name to the
 * immutable/current CAD Land name. This does not rename CAD data and does not
 * require an external XLSX/CSV source.
 */
export function buildGeneratedLandMapPlan(grid, options = {}) {
  if (!grid?.matrix || !grid?.landCount) throw new RangeError('Grid / Land Map has no usable lands.');
  const namingMode = ['grid', 'sequence', 'number'].includes(options.namingMode) ? options.namingMode : 'grid';
  const gapMode = options.gapMode === 'physical' ? 'physical' : 'compact';
  const supportedOrders = new Set(['row-major','column-major','snake-row','snake-column','perimeter-clockwise','perimeter-counterclockwise']);
  const order = supportedOrders.has(options.order) ? options.order : 'row-major';
  const reverseRows = Boolean(options.reverseRows);
  const reverseColumns = Boolean(options.reverseColumns);
  const prefix = String(options.prefix ?? (namingMode === 'sequence' ? 'LAND ' : ''));
  const suffix = String(options.suffix ?? '');
  const separator = String(options.separator ?? '');
  const rowStart = String(options.rowStart ?? 'A').trim().toUpperCase() || 'A';
  const columnStart = Number.isFinite(Number(options.columnStart)) ? Number(options.columnStart) : 1;
  const columnStep = Number.isFinite(Number(options.columnStep)) && Number(options.columnStep) !== 0 ? Number(options.columnStep) : 1;
  const start = Number.isFinite(Number(options.start)) ? Number(options.start) : 1;
  const step = Number.isFinite(Number(options.step)) && Number(options.step) !== 0 ? Number(options.step) : 1;
  const padding = Math.max(0, Math.min(12, Number(options.padding) || 0));
  const overrides = normalizeOverrideMap(options.manualOverrides);
  const existing = existingGeneratedNameMap(options.existingAssignments, grid.component);
  const plan = [];

  const pushItem = ({ land, physicalRow, physicalColumn, logicalRow, logicalColumn, generatedName, sequenceIndex }) => {
    const key = landMappingKey(land, grid.component);
    const manualName = overrides.has(key) ? String(overrides.get(key) ?? '').trim() : null;
    const newName = manualName != null && manualName !== '' ? manualName : generatedName;
    const previousNewName = existing.get(key) || '';
    plan.push({
      land,
      landKey: key,
      componentId: String(land?.componentId ?? grid.component?.id ?? ''),
      globalId: land?.globalId ?? null,
      cadName: String(land?.cadName ?? ''),
      physicalRow,
      physicalColumn,
      logicalRow,
      logicalColumn,
      sequenceIndex,
      generatedName,
      newName,
      previousNewName,
      manualOverride: manualName != null && manualName !== '',
      changed: previousNewName !== newName,
    });
  };

  if (namingMode === 'sequence' || namingMode === 'number') {
    const cells = orderedGridCells(grid, { order, reverseRows, reverseColumns, startRow: options.startRow, startColumn: options.startColumn });
    cells.forEach((cell, index) => {
      const value = paddedNumber(start + index * step, padding);
      const generatedName = `${namingMode === 'number' ? '' : prefix}${value}${suffix}`;
      pushItem({
        land: cell.land,
        physicalRow: cell.row,
        physicalColumn: cell.column,
        logicalRow: reverseRows ? grid.rowCount - 1 - cell.row : cell.row,
        logicalColumn: reverseColumns ? grid.columnCount - 1 - cell.column : cell.column,
        generatedName,
        sequenceIndex: index + 1,
      });
    });
  } else if (gapMode === 'compact') {
    const rowIndexes = Array.from({ length: grid.rowCount }, (_, index) => reverseRows ? grid.rowCount - 1 - index : index);
    const columnIndexes = Array.from({ length: grid.columnCount }, (_, index) => reverseColumns ? grid.columnCount - 1 - index : index);
    const rows = rowIndexes.map((physicalRow, logicalRow) => ({
      physicalRow,
      logicalRow,
      items: columnIndexes
        .filter((physicalColumn) => grid.matrix[physicalRow][physicalColumn])
        .map((physicalColumn, logicalColumn) => ({ physicalColumn, logicalColumn, land: grid.matrix[physicalRow][physicalColumn] })),
    }));
    const emit = (row, cell) => {
      const rowLabel = gridRowLabel(rowStart, row.logicalRow, options);
      const columnLabel = paddedNumber(columnStart + cell.logicalColumn * columnStep, padding);
      pushItem({
        land: cell.land,
        physicalRow: row.physicalRow,
        physicalColumn: cell.physicalColumn,
        logicalRow: row.logicalRow,
        logicalColumn: cell.logicalColumn,
        generatedName: `${prefix}${rowLabel}${separator}${columnLabel}${suffix}`,
        sequenceIndex: plan.length + 1,
      });
    };
    if (order === 'column-major') {
      const maxColumns = Math.max(0, ...rows.map((row) => row.items.length));
      for (let logicalColumn = 0; logicalColumn < maxColumns; logicalColumn += 1) {
        for (const row of rows) {
          const cell = row.items[logicalColumn];
          if (cell) emit(row, cell);
        }
      }
    } else {
      for (const row of rows) for (const cell of row.items) emit(row, cell);
    }
  } else {
    const rowIndexes = Array.from({ length: grid.rowCount }, (_, index) => reverseRows ? grid.rowCount - 1 - index : index);
    const columnIndexes = Array.from({ length: grid.columnCount }, (_, index) => reverseColumns ? grid.columnCount - 1 - index : index);
    const rowPosition = new Map(rowIndexes.map((physicalRow, logicalRow) => [physicalRow, logicalRow]));
    const columnPosition = new Map(columnIndexes.map((physicalColumn, logicalColumn) => [physicalColumn, logicalColumn]));
    const emit = (physicalRow, physicalColumn) => {
      const land = grid.matrix[physicalRow][physicalColumn];
      if (!land) return;
      const logicalRow = rowPosition.get(physicalRow);
      const logicalColumn = columnPosition.get(physicalColumn);
      const rowLabel = gridRowLabel(rowStart, logicalRow, options);
      const columnLabel = paddedNumber(columnStart + logicalColumn * columnStep, padding);
      pushItem({
        land,
        physicalRow,
        physicalColumn,
        logicalRow,
        logicalColumn,
        generatedName: `${prefix}${rowLabel}${separator}${columnLabel}${suffix}`,
        sequenceIndex: plan.length + 1,
      });
    };
    if (order === 'column-major') {
      for (const physicalColumn of columnIndexes) for (const physicalRow of rowIndexes) emit(physicalRow, physicalColumn);
    } else {
      for (const physicalRow of rowIndexes) for (const physicalColumn of columnIndexes) emit(physicalRow, physicalColumn);
    }
  }

  const names = new Map();
  for (const item of plan) {
    const name = String(item.newName || '').trim();
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(item);
  }
  const duplicates = [...names.entries()]
    .filter(([name, items]) => !name || items.length > 1)
    .map(([name, items]) => ({ name, items, lands: items.map((item) => item.land) }));
  const byLandKey = new Map(plan.map((item) => [item.landKey, item]));
  return {
    grid,
    namingMode,
    gapMode,
    plan,
    byLandKey,
    duplicates,
    changedCount: plan.filter((item) => item.changed).length,
    manualCount: plan.filter((item) => item.manualOverride).length,
    settings: {
      namingMode, gapMode, order, reverseRows, reverseColumns, prefix, suffix, separator,
      rowStart, columnStart, columnStep, start, step, padding, skipLetters: String(options.skipLetters || ''), alphabet: String(options.alphabet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), startRow: Number.isInteger(Number(options.startRow)) ? Number(options.startRow) : null, startColumn: Number.isInteger(Number(options.startColumn)) ? Number(options.startColumn) : null,
    },
  };
}

export function buildGridRenamePlan(grid, options = {}) {
  const defaults = defaultGridLabels(grid, options);
  const rowLabels = options.rowLabels || defaults.rows;
  const columnLabels = options.columnLabels || defaults.columns;
  const reverseRows = Boolean(options.reverseRows);
  const reverseColumns = Boolean(options.reverseColumns);
  const separator = String(options.separator ?? '');
  const prefix = String(options.prefix ?? '');
  const suffix = String(options.suffix ?? '');
  const namingMode = ['coordinate-compact', 'sequence', 'number'].includes(options.namingMode) ? options.namingMode : 'coordinate-physical';
  const plan = [];
  const names = new Map();

  if (namingMode === 'sequence' || namingMode === 'number') {
    const cells = orderedGridCells(grid, { order: options.order, reverseRows, reverseColumns });
    const start = Number.isFinite(Number(options.start)) ? Number(options.start) : 1;
    const step = Number.isFinite(Number(options.step)) && Number(options.step) !== 0 ? Number(options.step) : 1;
    const sequencePrefix = namingMode === 'number' ? '' : String(options.sequencePrefix ?? 'LAND ');
    cells.forEach((cell, index) => {
      const nextName = `${sequencePrefix}${paddedNumber(start + index * step, options.padding)}${suffix}`;
      plan.push({ land: cell.land, physicalRow: cell.row, physicalColumn: cell.column, rowIndex: cell.row, columnIndex: cell.column, rowLabel: '', columnLabel: '', previousName: String(cell.land.cadName || ''), nextName });
    });
  } else if (namingMode === 'coordinate-compact') {
    for (let physicalRow = 0; physicalRow < grid.rowCount; physicalRow += 1) {
      const rowIndex = reverseRows ? grid.rowCount - 1 - physicalRow : physicalRow;
      const physicalColumns = Array.from({ length: grid.columnCount }, (_, index) => reverseColumns ? grid.columnCount - 1 - index : index);
      const occupied = physicalColumns.filter((physicalColumn) => grid.matrix[physicalRow][physicalColumn]);
      occupied.forEach((physicalColumn, compactIndex) => {
        const land = grid.matrix[physicalRow][physicalColumn];
        const rowLabel = String(rowLabels[rowIndex] ?? '');
        const columnLabel = String(Number(options.columnStart ?? 1) + compactIndex);
        const nextName = `${prefix}${rowLabel}${separator}${columnLabel}${suffix}`;
        plan.push({ land, physicalRow, physicalColumn, rowIndex, columnIndex: compactIndex, rowLabel, columnLabel, previousName: String(land.cadName || ''), nextName });
      });
    }
  } else {
    for (let physicalRow = 0; physicalRow < grid.rowCount; physicalRow += 1) {
      for (let physicalColumn = 0; physicalColumn < grid.columnCount; physicalColumn += 1) {
        const land = grid.matrix[physicalRow][physicalColumn];
        if (!land) continue;
        const rowIndex = reverseRows ? grid.rowCount - 1 - physicalRow : physicalRow;
        const columnIndex = reverseColumns ? grid.columnCount - 1 - physicalColumn : physicalColumn;
        const rowLabel = String(rowLabels[rowIndex] ?? '');
        const columnLabel = String(columnLabels[columnIndex] ?? '');
        const nextName = `${prefix}${rowLabel}${separator}${columnLabel}${suffix}`;
        plan.push({ land, physicalRow, physicalColumn, rowIndex, columnIndex, rowLabel, columnLabel, previousName: String(land.cadName || ''), nextName });
      }
    }
  }

  for (const item of plan) {
    if (!names.has(item.nextName)) names.set(item.nextName, []);
    names.get(item.nextName).push(item.land);
  }
  const duplicates = [...names.entries()].filter(([name, lands]) => !name || lands.length > 1).map(([name, lands]) => ({ name, lands }));
  return { grid, namingMode, plan, duplicates, changedCount: plan.filter((item) => item.previousName !== item.nextName).length };
}

export function applyGridRenamePlan(plan) {
  if (!plan?.plan?.length) throw new RangeError('There are no generated land names to apply.');
  if (plan.duplicates?.length) throw new RangeError(`Generated land names contain ${plan.duplicates.length} duplicate or blank group(s).`);
  for (const item of plan.plan) item.land.cadName = item.nextName;
  return { changedCount: plan.changedCount, landCount: plan.plan.length };
}

function sourceSequence(mapping) {
  const value = Number(mapping?.rawOrder ?? mapping?.sourceRow);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function protectedMapping(mapping) {
  return Boolean(mapping?.anchorLocked || mapping?.userConfirmation || (mapping?.manual && mapping?.verified) || mapping?.mappingState === 'manual-match');
}

export function buildGridMappingPlan(grid, sourceMappings, options = {}) {
  const preserveConfirmed = options.preserveConfirmed !== false;
  const reverseSource = Boolean(options.reverseSource);
  const orderedSources = [...(sourceMappings || [])]
    .filter((mapping) => mapping && mapping.sourceRow != null && !mapping.cadOnly)
    .sort((a, b) => sourceSequence(a) - sourceSequence(b) || Number(a.sourceRow || 0) - Number(b.sourceRow || 0));
  if (reverseSource) orderedSources.reverse();

  const orderedTargets = orderedGridCells(grid, {
    order: options.order,
    reverseRows: options.reverseRows,
    reverseColumns: options.reverseColumns,
  });
  const protectedSources = preserveConfirmed ? orderedSources.filter(protectedMapping) : [];
  const reservedTargetIds = new Set(protectedSources.filter((mapping) => mapping.mapped && mapping.globalId != null).map((mapping) => `${mapping.componentId}:${mapping.globalId}`));
  const availableSources = preserveConfirmed ? orderedSources.filter((mapping) => !protectedMapping(mapping)) : orderedSources;
  const availableTargets = orderedTargets.filter((cell) => !reservedTargetIds.has(`${cell.land.componentId ?? grid.component?.id}:${cell.land.globalId}`));
  const pairCount = Math.min(availableSources.length, availableTargets.length);
  const assignments = [];
  for (let index = 0; index < pairCount; index += 1) {
    const mapping = availableSources[index];
    const cell = availableTargets[index];
    assignments.push({
      mapping,
      land: cell.land,
      row: cell.row,
      column: cell.column,
      currentGlobalId: mapping.globalId ?? null,
      changed: String(mapping.globalId ?? '') !== String(cell.land.globalId ?? '')
        || String(mapping.componentId ?? '') !== String(cell.land.componentId ?? grid.component?.id ?? ''),
    });
  }
  const duplicateTargets = new Map();
  for (const assignment of assignments) {
    const key = `${assignment.land.componentId ?? grid.component?.id}:${assignment.land.globalId}`;
    duplicateTargets.set(key, (duplicateTargets.get(key) || 0) + 1);
  }
  const conflicts = [...duplicateTargets.entries()].filter(([, count]) => count > 1).map(([target, count]) => ({ target, count }));
  return {
    grid,
    assignments,
    conflicts,
    sourceCount: orderedSources.length,
    targetCount: orderedTargets.length,
    changedCount: assignments.filter((item) => item.changed).length,
    protectedCount: protectedSources.length,
    unassignedSourceCount: Math.max(0, availableSources.length - pairCount),
    unusedTargetCount: Math.max(0, availableTargets.length - pairCount),
    options: { preserveConfirmed, reverseSource, order: options.order === 'column-major' ? 'column-major' : 'row-major', reverseRows: Boolean(options.reverseRows), reverseColumns: Boolean(options.reverseColumns) },
  };
}

export function buildSequentialLandLabels(grid, options = {}) {
  const cells = orderedGridCells(grid, options);
  const descending = options.descending !== false;
  const start = Number.isFinite(Number(options.start)) ? Number(options.start) : (descending ? cells.length : 1);
  const step = descending ? -1 : 1;
  const labels = new Map();
  cells.forEach((cell, index) => labels.set(cell.land, start + index * step));
  return labels;
}
