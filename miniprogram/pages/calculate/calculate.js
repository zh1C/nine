// pages/calculate/calculate.js
Page({
  data: {
    // 日历相关
    currentYear: 2026,
    currentMonth: 5,
    calendarDays: [],
    selectedDates: [], // ['2026-05-09', ...]
    weekDays: ["日", "一", "二", "三", "四", "五", "六"],

    // 菜品选择相关
    currentDateIdx: 0, // 当前Tab选中的日期索引
    dailyDishes: {}, // { '2026-05-09': { student: [...], teacher: [...] }, ... }
    dailySubTab: "student", // 当前子Tab: "student" | "teacher"
    showPicker: false,
    pickerExcludeIds: [], // 当天已选菜品ID，传给picker用于过滤
    filteredDishes: [], // 根据当前子Tab过滤后的菜品列表
    currentCategoryDishes: [], // 当前日期+类型下的菜品
    studentDishCount: 0, // 当前日期下学生菜品数
    teacherDishCount: 0, // 当前日期下老师菜品数

    // Tab展示数据
    dateTabList: [], // [{date, label, weekDay, dishCount}]

    // 数据源
    allDishes: [],
    gardens: [],

    pageLoading: true, // 页面级loading，两个请求都完成后才显示内容
    loadError: false, // 加载是否出错

    // 配料详情弹窗
    showDetail: false,
    detailDish: {},
    detailIngredients: [],
    detailGardens: [],
    detailIngExpanded: false,
  },

  async onLoad(options) {
    this._fromHistory = options && options.from === 'history';
    const now = new Date();
    this.setData({
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1,
      pageLoading: true,
      loadError: false,
    });
    this.generateCalendar();
    // 并发加载园区和菜品数据，全部完成后关闭loading
    try {
      await Promise.all([this.loadGardens(), this.loadAllDishes()]);
    } catch (e) {
      console.error('页面数据加载失败', e);
      this.setData({ loadError: true });
    } finally {
      this.setData({ pageLoading: false });
    }
    // 数据加载完成后恢复
    if (!this.data.loadError) {
      if (this._fromHistory) {
        this.restoreFromHistory();
      } else {
        this.tryRestoreDraft();
      }
    }
  },

  // 重新加载
  async retryLoad() {
    this.setData({ pageLoading: true, loadError: false });
    try {
      await Promise.all([this.loadGardens(), this.loadAllDishes()]);
    } catch (e) {
      console.error('页面数据加载失败', e);
      this.setData({ loadError: true });
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  // ========== 日历逻辑 ==========
  generateCalendar() {
    const { currentYear, currentMonth, selectedDates } = this.data;
    const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const calendarDays = [];
    // 前置空白
    for (let i = 0; i < firstDay; i++) {
      calendarDays.push({ day: "", date: "", empty: true, selected: false });
    }
    // 日期
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      calendarDays.push({ day: d, date: dateStr, empty: false, selected: selectedDates.indexOf(dateStr) > -1 });
    }
    this.setData({ calendarDays });
  },

  // 刷新日历选中状态
  refreshCalendarSelection() {
    const { calendarDays, selectedDates } = this.data;
    const updated = calendarDays.map((item) => {
      if (item.empty) return item;
      return { ...item, selected: selectedDates.indexOf(item.date) > -1 };
    });
    this.setData({ calendarDays: updated });
  },

  prevMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth--;
    if (currentMonth < 1) {
      currentMonth = 12;
      currentYear--;
    }
    this.setData({ currentYear, currentMonth });
    this.generateCalendar();
  },

  nextMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
    this.setData({ currentYear, currentMonth });
    this.generateCalendar();
  },

  toggleDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    let selectedDates = [...this.data.selectedDates];
    const idx = selectedDates.indexOf(date);
    if (idx > -1) {
      selectedDates.splice(idx, 1);
      // 同时移除该天的菜品数据
      const dailyDishes = { ...this.data.dailyDishes };
      delete dailyDishes[date];
      this.setData({ selectedDates: selectedDates.sort(), dailyDishes });
    } else {
      selectedDates.push(date);
      selectedDates.sort();
      this.setData({ selectedDates });
    }
    // 调整 currentDateIdx
    if (selectedDates.length > 0 && this.data.currentDateIdx >= selectedDates.length) {
      this.setData({ currentDateIdx: selectedDates.length - 1 });
    }
    this.refreshCalendarSelection();
    this.buildDateTabList();
    this.updateCurrentCategoryView();
    this.saveDraft();
  },

  // 判断当前是否有已配置菜品
  hasExistingSelection() {
    const { dailyDishes } = this.data;
    return Object.keys(dailyDishes).some(key => {
      const dayData = dailyDishes[key];
      if (!dayData) return false;
      return (dayData.student && dayData.student.length > 0) || (dayData.teacher && dayData.teacher.length > 0);
    });
  },

  // 应用快捷选择：更新日期并清理孤儿菜品数据
  applyQuickSelect(dates) {
    const dailyDishes = { ...this.data.dailyDishes };
    Object.keys(dailyDishes).forEach(key => {
      if (dates.indexOf(key) === -1) {
        delete dailyDishes[key];
      }
    });
    this.setData({ selectedDates: dates, currentDateIdx: 0, dailyDishes });
    this.refreshCalendarSelection();
    this.buildDateTabList();
    this.updateCurrentCategoryView();
    this.saveDraft();
  },

  // 快捷选择：本周剩余
  selectThisWeek() {
    const today = new Date();
    const dates = [];
    const dayOfWeek = today.getDay(); // 0=周日
    // 从明天到本周日
    for (let i = 1; i <= 7 - dayOfWeek; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(this.formatDate(d));
    }
    dates.sort();

    if (this.hasExistingSelection()) {
      wx.showModal({
        title: '提示',
        content: '将清除当前已选日期及菜品配置，确认？',
        success: (res) => {
          if (res.confirm) {
            this.applyQuickSelect(dates);
          }
        },
      });
    } else {
      this.applyQuickSelect(dates);
    }
  },

  // 快捷选择：下周一至五
  selectNextWeek() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilNextMon = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const dates = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + daysUntilNextMon + i);
      dates.push(this.formatDate(d));
    }
    dates.sort();

    if (this.hasExistingSelection()) {
      wx.showModal({
        title: '提示',
        content: '将清除当前已选日期及菜品配置，确认？',
        success: (res) => {
          if (res.confirm) {
            this.applyQuickSelect(dates);
          }
        },
      });
    } else {
      this.applyQuickSelect(dates);
    }
  },

  formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  getWeekDay(dateStr) {
    const d = new Date(dateStr);
    return ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  },

  // ========== Tab 切换 ==========
  switchDateTab(e) {
    const idx = e.currentTarget.dataset.idx;
    this.setData({ currentDateIdx: idx });
    this.updateCurrentCategoryView();
  },

  // 切换学生/老师子Tab
  switchSubTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ dailySubTab: tab });
    this.updateCurrentCategoryView();
  },

  // 更新当前日期+类型的视图数据
  updateCurrentCategoryView() {
    const { selectedDates, currentDateIdx, dailyDishes, dailySubTab, allDishes, gardens } = this.data;
    if (selectedDates.length === 0) {
      this.setData({ currentCategoryDishes: [], studentDishCount: 0, teacherDishCount: 0, filteredDishes: [] });
      return;
    }
    const currentDate = selectedDates[currentDateIdx];
    const dayData = dailyDishes[currentDate] || { student: [], teacher: [] };
    const studentDishes = dayData.student || [];
    const teacherDishes = dayData.teacher || [];
    const rawDishes = dailySubTab === "student" ? studentDishes : teacherDishes;

    // 为每道菜生成摘要
    const currentCategoryDishes = rawDishes.map(dish => {
      const ingCount = (dish.ingredients || []).length;
      let configuredCount = 0;
      gardens.forEach(g => {
        const ratioArr = (dish.ratios || {})[String(g.gardenId)] || [];
        if (ratioArr.some(r => r !== undefined && r !== null && r !== '' && parseFloat(r) > 0)) {
          configuredCount++;
        }
      });
      return {
        ...dish,
        summary: `${ingCount}种配料 · ${configuredCount}/${gardens.length}园区已配`,
      };
    });

    // 过滤allDishes：只显示对应category的菜品
    const filteredDishes = allDishes.filter(d => (d.category || "student") === dailySubTab);

    this.setData({
      currentCategoryDishes,
      studentDishCount: studentDishes.length,
      teacherDishCount: teacherDishes.length,
      filteredDishes,
    });
  },

  // 生成 Tab 显示数据
  buildDateTabList() {
    const { selectedDates, dailyDishes } = this.data;
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    const dateTabList = selectedDates.map(dateStr => {
      const d = new Date(dateStr);
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const dayData = dailyDishes[dateStr] || { student: [], teacher: [] };
      const dishCount = (dayData.student || []).length + (dayData.teacher || []).length;

      return {
        date: dateStr,
        label: `${month}/${day} ${weekNames[d.getDay()]}`,
        dishCount,
      };
    });

    this.setData({ dateTabList });
  },

  // ========== 菜品选择 ==========
  async loadAllDishes() {
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getAllDishes" },
    });
    if (res.result.success) {
      this.setData({ allDishes: res.result.data.list });
    }
  },

  async loadGardens() {
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getGardens" },
    });
    if (res.result.success) {
      this.setData({ gardens: res.result.data.list });
    }
  },

  showDishPicker() {
    const { selectedDates, currentDateIdx, dailyDishes, dailySubTab, allDishes } = this.data;
    if (selectedDates.length === 0) {
      wx.showToast({ title: "请先选择日期", icon: "none" });
      return;
    }
    const currentDate = selectedDates[currentDateIdx];
    const dayData = dailyDishes[currentDate] || { student: [], teacher: [] };
    const currentDishes = dayData[dailySubTab] || [];
    // 过滤allDishes：只显示对应category的菜品
    const filteredDishes = allDishes.filter(d => (d.category || "student") === dailySubTab);
    this.setData({
      showPicker: true,
      pickerExcludeIds: currentDishes.map((d) => d._id),
      filteredDishes,
    });
  },

  onPickerClose() {
    this.setData({ showPicker: false });
  },

  onPickerAdd(e) {
    const dish = e.detail.dish;
    const { selectedDates, currentDateIdx, dailyDishes, dailySubTab } = this.data;
    const currentDate = selectedDates[currentDateIdx];
    const dayData = dailyDishes[currentDate] || { student: [], teacher: [] };
    const dishes = [...(dayData[dailySubTab] || [])];
    // 避免重复添加
    if (dishes.some((d) => d._id === dish._id)) return;
    dishes.push({
      _id: dish._id,
      name: dish.name,
      imageFileID: dish.imageFileID || "",
      ingredients: dish.ingredients || [],
      ratios: dish.ratios || {},
    });
    const updatedDayData = { ...dayData, [dailySubTab]: dishes };
    const updatedDailyDishes = { ...dailyDishes, [currentDate]: updatedDayData };
    this.setData({
      dailyDishes: updatedDailyDishes,
      pickerExcludeIds: dishes.map((d) => d._id),
    });
    this.buildDateTabList();
    this.updateCurrentCategoryView();
    this.saveDraft();
  },

  removeDailyDish(e) {
    const idx = e.currentTarget.dataset.idx;
    const { selectedDates, currentDateIdx, dailyDishes, dailySubTab } = this.data;
    const currentDate = selectedDates[currentDateIdx];
    const dayData = dailyDishes[currentDate] || { student: [], teacher: [] };
    const dishes = [...(dayData[dailySubTab] || [])];
    dishes.splice(idx, 1);
    const updatedDayData = { ...dayData, [dailySubTab]: dishes };
    const updatedDailyDishes = { ...dailyDishes, [currentDate]: updatedDayData };
    this.setData({ dailyDishes: updatedDailyDishes });
    this.buildDateTabList();
    this.updateCurrentCategoryView();
    this.saveDraft();
  },

  // ========== 配料详情弹窗 ==========
  showDishDetail(e) {
    const idx = e.currentTarget.dataset.idx;
    const dish = this.data.currentCategoryDishes[idx];
    if (!dish) return;
    const gardens = this.data.gardens;
    const dailySubTab = this.data.dailySubTab;

    // 构建园区展示数据（默认全部展开）
    const detailGardens = gardens.map(g => {
      const key = String(g.gardenId);
      const ratioArr = (dish.ratios || {})[key] || [];
      const filled = ratioArr.some(r => r !== undefined && r !== null && r !== '' && parseFloat(r) > 0);
      return {
        gardenId: g.gardenId,
        name: g.name,
        filled,
        ratios: ratioArr,
      };
    });

    this.setData({
      showDetail: true,
      detailIngExpanded: false,
      detailDish: {
        name: dish.name,
        imageFileID: dish.imageFileID || '',
        categoryLabel: dailySubTab === 'student' ? '学生餐' : '老师餐',
      },
      detailIngredients: dish.ingredients || [],
      detailGardens,
    });
  },

  toggleDetailIng() {
    this.setData({ detailIngExpanded: !this.data.detailIngExpanded });
  },

  closeDetail() {
    this.setData({ showDetail: false });
  },

  preventBubble() {},

  // ========== 计算逻辑 ==========
  handleCalculate() {
    const { selectedDates, dailyDishes, gardens } = this.data;

    if (selectedDates.length === 0) {
      wx.showToast({ title: "请选择日期", icon: "none" });
      return;
    }

    // 检查至少有一天选了菜品
    let hasAnyDish = false;
    for (const date of selectedDates) {
      const dayData = dailyDishes[date];
      if (dayData && ((dayData.student && dayData.student.length > 0) || (dayData.teacher && dayData.teacher.length > 0))) {
        hasAnyDish = true;
        break;
      }
    }
    if (!hasAnyDish) {
      wx.showToast({ title: "请至少为一天选择菜品", icon: "none" });
      return;
    }

    if (gardens.length === 0) {
      wx.showToast({ title: "暂无园区数据", icon: "none" });
      return;
    }

    // 类型排序权重
    const typeOrder = { "肉类": 1, "蔬菜": 2 };

    // 初始化结果结构: { date: { gardenId: { 'ingName_unit': amount } } }
    const resultMap = {};
    selectedDates.forEach((date) => {
      resultMap[date] = {};
      gardens.forEach((g) => {
        resultMap[date][g.gardenId] = {};
      });
    });

    // 计算（合并学生+老师菜品，不区分类型）
    for (const date of selectedDates) {
      const dayData = dailyDishes[date] || { student: [], teacher: [] };
      const dishes = [...(dayData.student || []), ...(dayData.teacher || [])];
      const dateIndex = selectedDates.indexOf(date);

      for (const dish of dishes) {
        for (const garden of gardens) {
          const gardenKey = String(garden.gardenId);
          const ratioArr = dish.ratios[gardenKey] || [];

          for (let ingIdx = 0; ingIdx < dish.ingredients.length; ingIdx++) {
            const ing = dish.ingredients[ingIdx];
            const ratio = ratioArr[ingIdx] !== undefined ? parseFloat(ratioArr[ingIdx]) : 0;
            if (ratio === 0 || isNaN(ratio)) continue;

            const amount = 1 * ratio; // 默认菜品量=1
            const key = `${ing.name}_${ing.unit}`;

            // 提前送货逻辑
            let targetDate = date;
            if (ing.advance && dateIndex > 0) {
              targetDate = selectedDates[dateIndex - 1];
            }

            if (!resultMap[targetDate]) {
              resultMap[targetDate] = {};
            }
            if (!resultMap[targetDate][garden.gardenId]) {
              resultMap[targetDate][garden.gardenId] = {};
            }

            if (!resultMap[targetDate][garden.gardenId][key]) {
              resultMap[targetDate][garden.gardenId][key] = {
                name: ing.name,
                unit: ing.unit,
                type: ing.type || "蔬菜",
                reuse: ing.reuse || false,
                amount: 0,
              };
            }
            if (ing.reuse) {
              // 重复利用：取最大值
              resultMap[targetDate][garden.gardenId][key].amount =
                Math.max(resultMap[targetDate][garden.gardenId][key].amount, amount);
            } else {
              // 默认：累加
              resultMap[targetDate][garden.gardenId][key].amount += amount;
            }
          }
        }
      }
    }

    // 构建按天表格数据
    const tables = selectedDates.map((date) => {
      // 收集当天所有园区的所有配料key
      const allKeys = new Set();
      gardens.forEach((g) => {
        const gardenData = resultMap[date][g.gardenId] || {};
        Object.keys(gardenData).forEach((k) => allKeys.add(k));
      });

      // 构建行数据
      const rows = [];
      allKeys.forEach((key) => {
        const sample = resultMap[date][gardens[0].gardenId]?.[key] ||
          Object.values(resultMap[date]).find((gd) => gd[key])?.[key];
        if (!sample) return;

        const amounts = {};
        gardens.forEach((g) => {
          const val = resultMap[date][g.gardenId]?.[key]?.amount || 0;
          amounts[g.gardenId] = Math.round(val * 1000) / 1000;
        });

        rows.push({
          name: sample.name,
          unit: sample.unit,
          type: sample.type,
          amounts,
        });
      });

      // 按类型排序，同类型按名称排序
      rows.sort((a, b) => {
        const orderA = typeOrder[a.type] || 7;
        const orderB = typeOrder[b.type] || 7;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      });

      const d = new Date(date);
      const weekDay = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
      return {
        date,
        dateLabel: `${d.getMonth() + 1}月${d.getDate()}日（周${weekDay}）`,
        rows,
      };
    });

    // 构建菜品下单汇总（区分学生/老师）
    const summary = {
      dates: selectedDates.map((date) => {
        const d = new Date(date);
        const weekDay = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
        return {
          date,
          label: `${d.getMonth() + 1}/${d.getDate()} 周${weekDay}`,
        };
      }),
      gardens: gardens.map((g) => ({ gardenId: g.gardenId, name: g.name })),
      data: {},
    };
    selectedDates.forEach((date) => {
      summary.data[date] = {};
      const dayData = dailyDishes[date] || { student: [], teacher: [] };
      gardens.forEach((g) => {
        const gardenKey = String(g.gardenId);
        // 学生菜品
        const studentDishes = (dayData.student || []).filter((dish) => {
          const ratioArr = dish.ratios[gardenKey] || [];
          return ratioArr.some((r) => r !== undefined && r !== null && r !== "" && parseFloat(r) > 0);
        });
        // 老师菜品
        const teacherDishes = (dayData.teacher || []).filter((dish) => {
          const ratioArr = dish.ratios[gardenKey] || [];
          return ratioArr.some((r) => r !== undefined && r !== null && r !== "" && parseFloat(r) > 0);
        });
        summary.data[date][g.gardenId] = {
          student: studentDishes.map((d) => d.name),
          teacher: teacherDishes.map((d) => d.name),
        };
      });
    });

    // 存入全局，跳转结果页
    const app = getApp();
    app.globalData.calculateResult = {
      tables,
      summary,
      gardens: gardens.map((g) => ({ gardenId: g.gardenId, name: g.name })),
      selectedDates,
      dailyDishes, // 用于保存记录
    };

    // 计算成功，清除草稿
    this.clearDraft();
    wx.navigateTo({ url: "/pages/result/result" });
  },

  // ========== 从历史记录恢复 ==========
  restoreFromHistory() {
    const app = getApp();
    const editData = app.globalData.editRecord;
    if (!editData || !editData.selectedDates || editData.selectedDates.length === 0) {
      return;
    }

    const { allDishes } = this.data;
    if (!allDishes || allDishes.length === 0) {
      return;
    }

    const { selectedDates, summary } = editData;
    const summaryData = (summary && summary.data) || {};

    // 根据 summary 中的菜品名 + 类型匹配 allDishes 恢复 dailyDishes
    const dishMap = {};
    allDishes.forEach(d => {
      const key = `${d.name}_${d.category || 'student'}`;
      dishMap[key] = d;
    });

    const dailyDishes = {};
    selectedDates.forEach(date => {
      const dateData = summaryData[date] || {};
      const studentNames = new Set();
      const teacherNames = new Set();

      // 遍历所有园区收集菜品名（去重）
      Object.values(dateData).forEach(gardenData => {
        (gardenData.student || []).forEach(name => studentNames.add(name));
        (gardenData.teacher || []).forEach(name => teacherNames.add(name));
      });

      // 按名称+类型匹配，未匹配的跳过
      const studentDishes = [];
      studentNames.forEach(name => {
        const d = dishMap[`${name}_student`];
        if (d) {
          studentDishes.push({
            _id: d._id,
            name: d.name,
            imageFileID: d.imageFileID || '',
            ingredients: d.ingredients || [],
            ratios: d.ratios || {},
          });
        }
      });

      const teacherDishes = [];
      teacherNames.forEach(name => {
        const d = dishMap[`${name}_teacher`];
        if (d) {
          teacherDishes.push({
            _id: d._id,
            name: d.name,
            imageFileID: d.imageFileID || '',
            ingredients: d.ingredients || [],
            ratios: d.ratios || {},
          });
        }
      });

      dailyDishes[date] = { student: studentDishes, teacher: teacherDishes };
    });

    // 将日历切换到第一个选中日期所在月份
    const firstDate = new Date(selectedDates[0]);
    this.setData({
      selectedDates,
      dailyDishes,
      currentYear: firstDate.getFullYear(),
      currentMonth: firstDate.getMonth() + 1,
      currentDateIdx: 0,
      dailySubTab: 'student',
    });
    this.generateCalendar();
    this.refreshCalendarSelection();
    this.buildDateTabList();
    this.updateCurrentCategoryView();

    // 清除全局数据
    app.globalData.editRecord = null;
  },

  // ========== 草稿缓存 ==========
  getDraftKey() {
    const app = getApp();
    const username = (app.globalData.userInfo && app.globalData.userInfo.username) || 'default';
    return `calculate_draft_${username}`;
  },

  saveDraft() {
    const { selectedDates, dailyDishes, dailySubTab, currentDateIdx } = this.data;
    const key = this.getDraftKey();
    // 没有选择日期时清除草稿
    if (selectedDates.length === 0) {
      wx.removeStorageSync(key);
      return;
    }
    // 只保存 _id 列表，不保存完整菜品数据
    const dailyDishIds = {};
    Object.keys(dailyDishes).forEach(date => {
      const dayData = dailyDishes[date] || {};
      dailyDishIds[date] = {
        student: (dayData.student || []).map(d => d._id),
        teacher: (dayData.teacher || []).map(d => d._id),
      };
    });
    wx.setStorageSync(key, {
      selectedDates,
      dailyDishIds,
      dailySubTab,
      currentDateIdx,
      savedAt: Date.now(),
    });
  },

  tryRestoreDraft() {
    const { allDishes } = this.data;
    // allDishes 加载失败时不恢复草稿
    if (!allDishes || allDishes.length === 0) {
      wx.showToast({ title: '菜品数据未加载，草稿恢复失败', icon: 'none' });
      return;
    }

    const key = this.getDraftKey();
    const draft = wx.getStorageSync(key);
    if (!draft || !draft.selectedDates || draft.selectedDates.length === 0) return;

    // 7天过期自动清除
    const expireMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - draft.savedAt > expireMs) {
      wx.removeStorageSync(key);
      return;
    }

    wx.showModal({
      title: '恢复配料草稿',
      content: '检测到上次未完成的配料选择，是否继续？',
      confirmText: '继续',
      cancelText: '重新开始',
      success: (res) => {
        if (res.confirm) {
          // 用 allDishes 构建 ID -> 菜品 的映射
          const dishMap = {};
          allDishes.forEach(d => { dishMap[d._id] = d; });

          // 根据 _id 列表还原完整菜品数据
          const dailyDishes = {};
          const dailyDishIds = draft.dailyDishIds || {};
          Object.keys(dailyDishIds).forEach(date => {
            const dayIds = dailyDishIds[date] || {};
            dailyDishes[date] = {
              student: (dayIds.student || []).map(id => {
                const d = dishMap[id];
                if (!d) return null;
                return {
                  _id: d._id,
                  name: d.name,
                  imageFileID: d.imageFileID || '',
                  ingredients: d.ingredients || [],
                  ratios: d.ratios || {},
                };
              }).filter(Boolean),
              teacher: (dayIds.teacher || []).map(id => {
                const d = dishMap[id];
                if (!d) return null;
                return {
                  _id: d._id,
                  name: d.name,
                  imageFileID: d.imageFileID || '',
                  ingredients: d.ingredients || [],
                  ratios: d.ratios || {},
                };
              }).filter(Boolean),
            };
          });

          this.setData({
            selectedDates: draft.selectedDates,
            dailyDishes,
            dailySubTab: draft.dailySubTab || 'student',
            currentDateIdx: draft.currentDateIdx || 0,
          });
          this.refreshCalendarSelection();
          this.buildDateTabList();
          this.updateCurrentCategoryView();
        } else {
          wx.removeStorageSync(key);
        }
      },
    });
  },

  clearDraft() {
    const key = this.getDraftKey();
    wx.removeStorageSync(key);
  },
});
