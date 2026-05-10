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
    dailyDishes: {}, // { '2026-05-09': [{_id, name, imageFileID, ingredients, ratios}], ... }
    showPicker: false,
    pickerExcludeIds: [], // 当天已选菜品ID，传给picker用于过滤

    // Tab展示数据
    dateTabList: [], // [{date, label, weekDay, dishCount}]

    // 数据源
    allDishes: [],
    gardens: [],

    pageLoading: true, // 页面级loading，两个请求都完成后才显示内容
    loadError: false, // 加载是否出错
  },

  async onLoad() {
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
  },

  // 判断当前是否有已配置菜品
  hasExistingSelection() {
    const { dailyDishes } = this.data;
    return Object.keys(dailyDishes).some(key => dailyDishes[key] && dailyDishes[key].length > 0);
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
  },

  // 生成 Tab 显示数据
  buildDateTabList() {
    const { selectedDates, dailyDishes } = this.data;
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    const dateTabList = selectedDates.map(dateStr => {
      const d = new Date(dateStr);
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const dishes = dailyDishes[dateStr] || [];

      return {
        date: dateStr,
        label: `${month}/${day} ${weekNames[d.getDay()]}`,
        dishCount: dishes.length,
      };
    });

    this.setData({ dateTabList });
  },

  // ========== 菜品选择 ==========
  async loadAllDishes() {
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getDishes", page: 1, pageSize: 200 },
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
    const { selectedDates, currentDateIdx, dailyDishes } = this.data;
    if (selectedDates.length === 0) {
      wx.showToast({ title: "请先选择日期", icon: "none" });
      return;
    }
    const currentDate = selectedDates[currentDateIdx];
    const currentDishes = dailyDishes[currentDate] || [];
    this.setData({
      showPicker: true,
      pickerExcludeIds: currentDishes.map((d) => d._id),
    });
  },

  onPickerClose() {
    this.setData({ showPicker: false });
  },

  onPickerAdd(e) {
    const dish = e.detail.dish;
    const { selectedDates, currentDateIdx, dailyDishes } = this.data;
    const currentDate = selectedDates[currentDateIdx];
    const dishes = [...(dailyDishes[currentDate] || [])];
    // 避免重复添加
    if (dishes.some((d) => d._id === dish._id)) return;
    dishes.push({
      _id: dish._id,
      name: dish.name,
      imageFileID: dish.imageFileID || "",
      ingredients: dish.ingredients || [],
      ratios: dish.ratios || {},
    });
    const updatedDailyDishes = { ...dailyDishes };
    updatedDailyDishes[currentDate] = dishes;
    this.setData({
      dailyDishes: updatedDailyDishes,
      pickerExcludeIds: dishes.map((d) => d._id),
    });
    this.buildDateTabList();
  },

  removeDailyDish(e) {
    const idx = e.currentTarget.dataset.idx;
    const { selectedDates, currentDateIdx, dailyDishes } = this.data;
    const currentDate = selectedDates[currentDateIdx];
    const dishes = [...(dailyDishes[currentDate] || [])];
    dishes.splice(idx, 1);
    const updatedDailyDishes = { ...dailyDishes };
    updatedDailyDishes[currentDate] = dishes;
    this.setData({ dailyDishes: updatedDailyDishes });
    this.buildDateTabList();
  },

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
      if (dailyDishes[date] && dailyDishes[date].length > 0) {
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
    const typeOrder = { "肉类": 1, "海鲜": 2, "蔬菜": 3, "豆制品": 4, "主食": 5, "调料": 6, "其他": 7 };

    // 初始化结果结构: { date: { gardenId: { 'ingName_unit': amount } } }
    const resultMap = {};
    selectedDates.forEach((date) => {
      resultMap[date] = {};
      gardens.forEach((g) => {
        resultMap[date][g.gardenId] = {};
      });
    });

    // 计算
    for (const date of selectedDates) {
      const dishes = dailyDishes[date] || [];
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
            const key = `${ing.name}_${ing.unit}_${ing.type || "其他"}`;

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
                type: ing.type || "其他",
                amount: 0,
              };
            }
            resultMap[targetDate][garden.gardenId][key].amount += amount;
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

    // 构建菜品下单汇总
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
      const dishes = dailyDishes[date] || [];
      gardens.forEach((g) => {
        // 列出该园区在当天有配料比例的菜品
        const gardenDishes = dishes.filter((dish) => {
          const ratioArr = dish.ratios[String(g.gardenId)] || [];
          return ratioArr.some((r) => r !== undefined && r !== null && r !== "" && parseFloat(r) > 0);
        });
        summary.data[date][g.gardenId] = gardenDishes.map((d) => d.name);
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

    wx.navigateTo({ url: "/pages/result/result" });
  },
});
