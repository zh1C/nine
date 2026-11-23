function isMap(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validAmounts(amounts, gardenIds) {
  if (!isMap(amounts) || Object.keys(amounts).length !== gardenIds.size) return false;
  return Object.entries(amounts).every(([id, n]) => gardenIds.has(id) && typeof n === "number"
    && n >= 0 && Number.isSafeInteger(Math.round(n * 1000)) && Math.round(n * 1000) / 1000 === n);
}

function validateSnapshot({ selectedDates, gardens, tables, summary }) {
  if (!Array.isArray(selectedDates) || !selectedDates.length || !Array.isArray(tables)
      || tables.length !== selectedDates.length || !Array.isArray(gardens) || !gardens.length || !isMap(summary)) {
    throw new Error("请提交完整的日期、园区、配料清单和菜单");
  }
  const dates = new Set(selectedDates);
  const gardenIds = new Set(gardens.map(g => String(g.gardenId)));
  if (dates.size !== selectedDates.length || gardenIds.size !== gardens.length
      || gardens.some(g => g.gardenId == null || !String(g.gardenId).trim())
      || selectedDates.some(date => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error("日期或园区无效");
  }
  for (const table of tables) {
    if (!dates.delete(table.date) || !Array.isArray(table.rows)) throw new Error("每日配料清单不完整");
    const ids = new Set();
    const ingredients = new Set();
    for (const row of table.rows) {
      const key = JSON.stringify([row.name, row.unit]);
      if (typeof row.rowId !== "string" || !row.rowId || ids.has(row.rowId)
          || typeof row.name !== "string" || !row.name || row.name !== row.name.trim()
          || typeof row.unit !== "string" || !row.unit.trim() || ingredients.has(key)) {
        throw new Error("配料行缺少标识、名称、单位或同日配料重复");
      }
      if (!validAmounts(row.amounts, gardenIds) || !validAmounts(row.baseAmounts, gardenIds)) {
        throw new Error("各园区用量须为非负数，最多三位小数");
      }
      ids.add(row.rowId);
      ingredients.add(key);
    }
  }
}

// 旧版客户端仍可保存旧格式。新版写入完整快照，允许某一天的 rows 为空。
function recordFields(event, removeAdjustments) {
  const { schemaVersion, selectedDates, tables, summary, gardens, adjustments } = event;
  if (schemaVersion != null && schemaVersion !== 1 && schemaVersion !== 2) throw new Error("清单版本不支持");
  if (schemaVersion === 2) validateSnapshot(event);
  const fields = {
    selectedDates: selectedDates || [], tables: tables || [],
    summary: summary || {}, gardens: gardens || [],
  };
  if (schemaVersion === 2) fields.schemaVersion = 2;
  if (schemaVersion !== 2 && adjustments && Object.keys(adjustments).length) {
    fields.adjustments = adjustments;
  } else if (removeAdjustments) {
    fields.adjustments = removeAdjustments;
  }
  return fields;
}

module.exports = { recordFields };
