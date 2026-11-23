const unitOptions = ["kg", "g", "个", "ml", "L", "根", "片", "块", "勺"];
const typeOrder = { "肉类": 1, "蔬菜": 2 };
let sequence = 0;

function createRow(name, unit, type, amounts, baseAmounts = amounts) {
  return {
    rowId: "r_" + Date.now().toString(36) + "_" + (++sequence).toString(36) + "_" + Math.random().toString(36).slice(2, 8),
    name: name.trim(),
    unit,
    type,
    amounts: { ...amounts },
    baseAmounts: { ...baseAmounts },
  };
}

function sortRows(rows) {
  return rows.sort((a, b) => (typeOrder[a.type] || 7) - (typeOrder[b.type] || 7)
    || a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
}

function addAmounts(left, right) {
  const result = { ...left };
  for (const id of Object.keys(right)) {
    result[id] = (Math.round((left[id] || 0) * 1000) + Math.round(right[id] * 1000)) / 1000;
  }
  return result;
}

// rows 是当天的工作副本。合并时保留目标行的 ID 和分类。
function appendOrMerge(rows, row) {
  const idx = rows.findIndex(other => other.name === row.name && other.unit === row.unit);
  if (idx === -1) {
    rows.push(row);
    return row;
  }
  const target = rows[idx];
  const merged = {
    ...target,
    baseAmounts: addAmounts(target.baseAmounts, row.baseAmounts),
    amounts: addAmounts(target.amounts, row.amounts),
  };
  rows[idx] = merged;
  return merged;
}

function readTables(record) {
  if (record.schemaVersion === 2) return record.tables;
  const adjustments = record.adjustments || {};
  return record.tables.map((table, tableIdx) => {
    const rows = [];
    table.rows.forEach((row, rowIdx) => {
      const base = {};
      const deltas = {};
      for (const { gardenId } of record.gardens) {
        base[gardenId] = Number(row.amounts[gardenId] || 0);
        deltas[gardenId] = Number(adjustments[[tableIdx, rowIdx, gardenId].join("_")] || 0);
      }
      appendOrMerge(rows, createRow(row.name, row.unit, row.type || "蔬菜", addAmounts(base, deltas), base));
    });
    return { ...table, rows: sortRows(rows) };
  });
}

module.exports = { unitOptions, createRow, sortRows, appendOrMerge, readTables };
