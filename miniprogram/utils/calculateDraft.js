// 每份草稿独立存储。version 只随本地内容变化，用于识别云端确认的是哪次编辑。
function username() {
  const user = getApp().globalData.userInfo;
  return user ? user.username : "";
}

function prefix(owner) {
  return "calculate:draft:" + encodeURIComponent(owner) + ":";
}

function belongsTo(owner, key) {
  return typeof key === "string" &&
    (key.startsWith(prefix(owner)) || key === "calculate_draft_" + (owner || "default"));
}

function read(owner, key) {
  if (!belongsTo(owner, key)) return null;
  const draft = wx.getStorageSync(key);
  return draft && Array.isArray(draft.selectedDates) ? draft : null;
}

function reference(key, draft) {
  return { key, version: draft.version || 0, menuVersion: draft.menuVersion || 0 };
}

function list(owner) {
  const choices = [];
  for (const key of wx.getStorageInfoSync().keys) {
    const draft = read(owner, key);
    if (!draft) continue;
    const dates = draft.selectedDates;
    const modified = new Date(draft.savedAt);
    choices.push({
      ...reference(key, draft),
      dateLabel: dates.length > 1 ? dates[0] + " 至 " + dates[dates.length - 1] : dates[0] || "未选日期",
      timeLabel: draft.savedAt ? modified.toLocaleString() : "",
      hasResult: !!draft.result,
      savedAt: draft.savedAt || 0,
    });
  }
  return choices.sort((a, b) => b.savedAt - a.savedAt);
}

function write(owner, ref, menu, result) {
  const current = ref && read(owner, ref.key);
  if (ref && (!current || (current.version || 0) !== ref.version)) return null;
  const key = ref ? ref.key : prefix(owner) + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  const version = ref ? ref.version + 1 : 1;
  // 改菜或改日期时一次写入新菜单并清空原结果。仅编辑配料时沿用原菜单版本。
  const menuVersion = result ? (current && current.menuVersion) || 0 : version;
  if (current && result && current.result && current.result.revision > (result.revision || 0)) {
    result = { ...result, recordId: current.result.recordId, revision: current.result.revision };
  }
  wx.setStorageSync(key, { ...menu, result, version, menuVersion, savedAt: Date.now() });
  return { key, version, menuVersion };
}

function discard(owner, ref) {
  const current = read(owner, ref.key);
  if (!current || (current.version || 0) !== ref.version) return false;
  wx.removeStorageSync(ref.key);
  return true;
}

function acknowledge(owner, ref, saved) {
  const current = read(owner, ref.key);
  if (!current || !current.result || (current.menuVersion || 0) !== (ref.menuVersion || 0)) return false;
  if (current.version === ref.version) {
    try {
      wx.removeStorageSync(ref.key);
    } catch (err) {
      current.result = { ...current.result, recordId: saved._id, revision: saved.revision };
      wx.setStorageSync(ref.key, current);
      throw err;
    }
    return true;
  }
  if ((current.result.revision || 0) < saved.revision &&
      (!current.result.recordId || current.result.recordId === saved._id)) {
    // 上传过程中又编辑过同一份清单。保留新内容，下次保存接着更新同一条云记录。
    current.result = { ...current.result, recordId: saved._id, revision: saved.revision };
    wx.setStorageSync(ref.key, current);
  }
  return false;
}

// 多天选择同一道菜时，菜谱快照只存一份。旧草稿只有 dailyDishIds，要从菜品库取菜谱。
function captureMenu({ selectedDates, dailyDishes, dailySubTab, currentDateIdx }) {
  const dailyDishIds = {};
  const dishesById = {};
  for (const [date, day] of Object.entries(dailyDishes)) {
    dailyDishIds[date] = {};
    for (const category of ["student", "teacher"]) {
      dailyDishIds[date][category] = (day[category] || []).map(dish => {
        dishesById[dish._id] = dish;
        return dish._id;
      });
    }
  }
  return { selectedDates, dailyDishIds, dishesById, dailySubTab, currentDateIdx };
}

module.exports = { username, read, reference, list, write, discard, acknowledge, captureMenu };
