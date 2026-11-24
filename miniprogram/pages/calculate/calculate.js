// pages/calculate/calculate.js
const { createRow, sortRows } = require("../../utils/ingredientTable");
const drafts = require("../../utils/calculateDraft");
const {
  splitSpokenDishes,
  matchDishesInCategory,
  toggleVoiceCandidate,
  collectSelectedDishIds,
} = require("../../utils/voiceDishMatcher");

let activeVoicePage = null;
let recorderInitialized = false;

function getSharedRecorder() {
  const manager = wx.getRecorderManager();
  if (!recorderInitialized) {
    recorderInitialized = true;
    manager.onStart(() => {
      if (activeVoicePage) activeVoicePage._onRecorderStart();
    });
    manager.onStop((res) => {
      if (activeVoicePage) activeVoicePage._onRecorderStop(res);
    });
    manager.onError((err) => {
      if (activeVoicePage) activeVoicePage._onRecorderError(err);
    });
  }
  return manager;
}

function getTouchClientY(e) {
  if (e && e.touches && e.touches[0] && typeof e.touches[0].clientY === "number") {
    return e.touches[0].clientY;
  }
  if (e && e.detail && typeof e.detail.clientY === "number") {
    return e.detail.clientY;
  }
  return 0;
}

function menuDish(dish) {
  return {
    _id: dish._id, name: dish.name, imageFileID: dish.imageFileID || "",
    ingredients: dish.ingredients || [], ratios: dish.ratios || {},
  };
}

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
    pickerSelectedDishes: [], // 当前日期和餐别的已选菜名，按菜单顺序
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
    draftChoices: [],
    showDraftChoices: true,
    hasDraftResult: false,

    // 配料详情弹窗
    showDetail: false,
    detailDish: {},
    detailIngredients: [],
    detailGardens: [],
    detailIngExpanded: false,

    // 语音报菜与识别确认弹窗
    voiceRecording: false,
    voiceCancelMove: false,
    voiceRecognizing: false,
    showVoiceResult: false,
    voiceTargetLabel: "",
    voiceRawText: "",
    voiceSegments: [],
    voiceItems: [],
    voiceSelectedCount: 0,
    voiceRematching: false,
  },

  async onLoad(options) {
    activeVoicePage = this;
    this._voicePressing = false;
    this._recorderRunning = false;
    this._hasRecordAuth = false;
    wx.getSetting({
      success: (res) => {
        if (res.authSetting && res.authSetting["scope.record"] === true) {
          this._hasRecordAuth = true;
        }
      },
    });
    this._fromHistory = options && options.from === 'history';
    this._session = { owner: drafts.username(), ref: null };
    const now = new Date();
    this.setData({
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1,
      pageLoading: true,
      loadError: false,
    });
    this.generateCalendar();
    return this.retryLoad();
  },

  async onShow() {
    activeVoicePage = this;
    this.refreshDraftChoices();
    const app = getApp();
    if (app.globalData.dishListNeedRefresh) {
      app.globalData.dishListNeedRefresh = false;
      try {
        await this.loadAllDishes();
        this.updateCurrentCategoryView();
        if (this.data.showVoiceResult) {
          this.rematchCurrentVoiceResult(true);
        }
      } catch (e) {
        console.error("同步最新菜品列表失败", e);
      }
    }
  },

  onHide() {
    this._abortVoiceRecordingIfNeeded();
  },

  onUnload() {
    this._abortVoiceRecordingIfNeeded();
    if (activeVoicePage === this) {
      activeVoicePage = null;
    }
  },

  // 重新加载
  async retryLoad() {
    this.setData({ pageLoading: true, loadError: false });
    try {
      await Promise.all([this.loadGardens(), this.loadAllDishes()]);
      if (this._fromHistory) this.restoreFromHistory();
      else this.updateCurrentCategoryView();
    } catch (e) {
      console.error('页面数据加载失败', e);
      this.setData({ loadError: true });
    } finally {
      this.setData({ pageLoading: false });
      this.refreshDraftChoices();
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
    const selectedDates = [...this.data.selectedDates];
    const dailyDishes = { ...this.data.dailyDishes };
    const idx = selectedDates.indexOf(date);
    if (idx > -1) {
      selectedDates.splice(idx, 1);
      // 同时移除该天的菜品数据
      delete dailyDishes[date];
    } else {
      selectedDates.push(date);
      selectedDates.sort();
    }
    const currentDateIdx = Math.max(0, Math.min(this.data.currentDateIdx, selectedDates.length - 1));
    this.commitMenu({ selectedDates, dailyDishes, currentDateIdx });
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
    const previous = this.data.selectedDates;
    if (dates.length === previous.length && dates.every((date, idx) => date === previous[idx])) return;
    const dailyDishes = { ...this.data.dailyDishes };
    Object.keys(dailyDishes).forEach(key => {
      if (dates.indexOf(key) === -1) {
        delete dailyDishes[key];
      }
    });
    this.commitMenu({ selectedDates: dates, currentDateIdx: 0, dailyDishes });
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
      this.setData({ currentCategoryDishes: [], pickerSelectedDishes: [], studentDishCount: 0, teacherDishCount: 0, filteredDishes: [] });
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
      pickerSelectedDishes: rawDishes.map(({ _id, name }) => ({ _id, name })),
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
    const app = getApp();
    const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getAllDishes", username },
    });
    if (!res.result.success) throw new Error(res.result.errMsg || "加载菜品失败");
    this.setData({ allDishes: res.result.data.list });
  },

  async loadGardens() {
    const app = getApp();
    const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: { type: "getGardens", operatorUsername: username },
    });
    if (!res.result.success) throw new Error(res.result.errMsg || "加载园区失败");
    this.setData({ gardens: res.result.data.list });
  },

  showDishPicker() {
    if (this.data.selectedDates.length === 0) {
      wx.showToast({ title: "请先选择日期", icon: "none" });
      return;
    }
    this.updateCurrentCategoryView();
    this.setData({ showPicker: true });
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
    dishes.push(menuDish(dish));
    this.saveCategoryDishes(currentDate, dishes);
  },

  removeDailyDish(e) {
    const id = e.detail?.id ?? e.currentTarget.dataset.id;
    const { selectedDates, currentDateIdx, dailyDishes, dailySubTab } = this.data;
    const currentDate = selectedDates[currentDateIdx];
    const dayData = dailyDishes[currentDate] || { student: [], teacher: [] };
    const dishes = dayData[dailySubTab] || [];
    const remaining = dishes.filter(dish => dish._id !== id);
    if (remaining.length !== dishes.length) this.saveCategoryDishes(currentDate, remaining);
  },

  saveCategoryDishes(date, dishes) {
    const { dailyDishes, dailySubTab } = this.data;
    const day = dailyDishes[date] || { student: [], teacher: [] };
    this.commitMenu({ dailyDishes: { ...dailyDishes, [date]: { ...day, [dailySubTab]: dishes } } });
  },

  // 批量将多道菜加入当前日期+餐别（单次 commitMenu 写入本地草稿）
  batchAddCurrentCategoryDishes(dishIds = []) {
    const { selectedDates, currentDateIdx, dailyDishes, dailySubTab, filteredDishes } = this.data;
    if (!selectedDates.length || !dishIds.length) return 0;
    const currentDate = selectedDates[currentDateIdx];
    const dayData = dailyDishes[currentDate] || { student: [], teacher: [] };
    const existing = [...(dayData[dailySubTab] || [])];
    const existingSet = new Set(existing.map((d) => d._id));
    const dishMap = {};
    filteredDishes.forEach((d) => {
      dishMap[d._id] = d;
    });

    let added = 0;
    for (const id of dishIds) {
      if (existingSet.has(id)) continue;
      const dish = dishMap[id];
      if (!dish) continue;
      existingSet.add(id);
      existing.push(menuDish(dish));
      added++;
    }

    if (added > 0) {
      this.saveCategoryDishes(currentDate, existing);
    }
    return added;
  },

  // ========== 语音报菜与识别结果弹窗 ==========
  _abortVoiceRecordingIfNeeded() {
    this._voicePressing = false;
    this._ignoreNextStop = true;
    if (this._recorderRunning) {
      try {
        getSharedRecorder().stop();
      } catch (e) {
        // ignore
      }
      this._recorderRunning = false;
    }
    if (this.data.voiceRecording || this.data.voiceCancelMove) {
      this.setData({ voiceRecording: false, voiceCancelMove: false });
    }
  },

  onVoiceTouchStart(e) {
    if (this.data.voiceRecognizing) return;
    if (this.data.selectedDates.length === 0) {
      wx.showToast({ title: "请先选择日期", icon: "none" });
      return;
    }

    activeVoicePage = this;

    // 首次未授权时先完成权限引导，避免系统授权弹窗打断触摸流导致录音卡住
    if (!this._hasRecordAuth) {
      this._voicePressing = false;
      wx.getSetting({
        success: (res) => {
          const auth = res.authSetting && res.authSetting["scope.record"];
          if (auth === true) {
            this._hasRecordAuth = true;
            wx.showToast({ title: "麦克风已就绪，请按住说话", icon: "none" });
          } else if (auth === false) {
            wx.showModal({
              title: "需要麦克风权限",
              content: "请在设置中开启麦克风权限，以使用语音识别添加菜品",
              confirmText: "去开启",
              success: (mRes) => {
                if (mRes.confirm) {
                  wx.openSetting({
                    success: (sRes) => {
                      if (sRes.authSetting && sRes.authSetting["scope.record"]) {
                        this._hasRecordAuth = true;
                      }
                    },
                  });
                }
              },
            });
          } else {
            wx.authorize({
              scope: "scope.record",
              success: () => {
                this._hasRecordAuth = true;
                wx.showToast({ title: "授权成功，请按住说话", icon: "none" });
              },
              fail: () => {
                wx.showToast({ title: "未授予麦克风权限", icon: "none" });
              },
            });
          }
        },
      });
      return;
    }

    this.updateCurrentCategoryView();
    this._voiceStartY = getTouchClientY(e);
    this._voicePressing = true;
    this._ignoreNextStop = false;
    this._recordStartTs = Date.now();

    this.setData({
      voiceRecording: true,
      voiceCancelMove: false,
    });

    if (wx.vibrateShort) {
      wx.vibrateShort({ type: "light" });
    }

    getSharedRecorder().start({
      duration: 30000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: "mp3",
    });
  },

  onVoiceTouchMove(e) {
    if (!this._voicePressing || !this.data.voiceRecording) return;
    const currentY = getTouchClientY(e);
    if (!currentY || !this._voiceStartY) return;
    const cancelMove = this._voiceStartY - currentY > 60;
    if (cancelMove !== this.data.voiceCancelMove) {
      this.setData({ voiceCancelMove: cancelMove });
    }
  },

  onVoiceTouchEnd() {
    if (!this._voicePressing) return;
    this._voicePressing = false;
    if (this._recorderRunning) {
      getSharedRecorder().stop();
    } else {
      // 用户在 onStart 触发前极快松手：等待 _onRecorderStart 捕获后立即停止并忽略
      this._ignoreNextStop = true;
      this.setData({ voiceRecording: false, voiceCancelMove: false });
      wx.showToast({ title: "说话时间太短", icon: "none" });
    }
  },

  onVoiceTouchCancel() {
    this._voicePressing = false;
    this._ignoreNextStop = true;
    if (this._recorderRunning) {
      getSharedRecorder().stop();
    }
    this.setData({ voiceRecording: false, voiceCancelMove: false });
  },

  _onRecorderStart() {
    this._recorderRunning = true;
    this._recordStartTs = Date.now();
    if (!this._voicePressing) {
      this._ignoreNextStop = true;
      getSharedRecorder().stop();
    }
  },

  _onRecorderError(err) {
    console.error("录音异常:", err);
    this._voicePressing = false;
    this._recorderRunning = false;
    this.setData({ voiceRecording: false, voiceCancelMove: false });
    const msg = (err && err.errMsg) || "";
    if (msg.includes("auth") || msg.includes("authorize")) {
      this._hasRecordAuth = false;
      wx.showToast({ title: "请先授予麦克风权限", icon: "none" });
    } else {
      wx.showToast({ title: "录音启动失败，请重试", icon: "none" });
    }
  },

  async _onRecorderStop(res) {
    this._recorderRunning = false;
    const wasCancel = this.data.voiceCancelMove || this._ignoreNextStop;
    this._ignoreNextStop = false;
    this.setData({ voiceRecording: false, voiceCancelMove: false });

    if (wasCancel) return;

    const duration = (res && res.duration) || (Date.now() - (this._recordStartTs || 0));
    if (!res || !res.tempFilePath || duration < 600) {
      wx.showToast({ title: "说话时间太短", icon: "none" });
      return;
    }

    let audioBase64 = "";
    try {
      audioBase64 = wx.getFileSystemManager().readFileSync(res.tempFilePath, "base64");
    } catch (readErr) {
      console.error("读取录音文件失败:", readErr);
      wx.showToast({ title: "读取录音失败，请重试", icon: "none" });
      return;
    }

    const app = getApp();
    const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";
    const knownDishNames = (this.data.filteredDishes || []).map((d) => d.name);

    this.setData({ voiceRecognizing: true });
    wx.showLoading({ title: "语音识别中...", mask: true });

    try {
      const cfRes = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "recognizeSpeech",
          username,
          audioBase64,
          format: "mp3",
          knownDishNames,
        },
      });

      if (!cfRes.result || !cfRes.result.success) {
        wx.showToast({
          title: (cfRes.result && cfRes.result.errMsg) || "语音识别失败",
          icon: "none",
        });
        return;
      }

      const { rawText = "", segments = [] } = cfRes.result.data || {};
      if (!rawText.trim()) {
        wx.showToast({ title: "未识别到有效语音，请重试", icon: "none" });
        return;
      }

      const effectiveSegments = segments.length > 0 ? segments : [{ text: rawText.trim(), _py: "", _pyFuzzy: "" }];
      this._openVoiceResultModal(rawText, effectiveSegments);
    } catch (err) {
      console.error("调用语音识别云函数失败:", err);
      wx.showToast({ title: "识别请求失败，请检查网络或云函数配置", icon: "none" });
    } finally {
      this.setData({ voiceRecognizing: false });
      wx.hideLoading();
    }
  },

  _buildVoiceTargetLabel() {
    const { dateTabList, currentDateIdx, selectedDates, dailySubTab } = this.data;
    const datePart = (dateTabList[currentDateIdx] && dateTabList[currentDateIdx].label) || selectedDates[currentDateIdx] || "";
    const catPart = dailySubTab === "student" ? "学生餐" : "老师餐";
    return `${datePart} · ${catPart}`;
  },

  _openVoiceResultModal(rawText, segments) {
    const voiceItems = matchDishesInCategory({
      segments,
      candidateDishes: this.data.filteredDishes,
      selectedDishes: this.data.currentCategoryDishes,
      gardens: this.data.gardens,
    });
    const voiceSelectedCount = collectSelectedDishIds(voiceItems).length;
    this.setData({
      showVoiceResult: true,
      voiceTargetLabel: this._buildVoiceTargetLabel(),
      voiceRawText: rawText,
      voiceSegments: segments,
      voiceItems,
      voiceSelectedCount,
    });
  },

  // 菜品库新增返回或编辑文本后重新匹配当前弹窗结果
  rematchCurrentVoiceResult(preserveChecked = false) {
    const prevStateMap = new Map();
    if (preserveChecked) {
      for (const oldItem of this.data.voiceItems || []) {
        for (const oldCand of oldItem.candidates || []) {
          prevStateMap.set(`${oldItem.spokenText}::${oldCand._id}`, !!oldCand.checked);
        }
      }
    }

    let voiceItems = matchDishesInCategory({
      segments: this.data.voiceSegments,
      candidateDishes: this.data.filteredDishes,
      selectedDishes: this.data.currentCategoryDishes,
      gardens: this.data.gardens,
    });

    if (preserveChecked && prevStateMap.size > 0) {
      voiceItems = voiceItems.map((item) => {
        if (!item.candidates || item.candidates.length === 0) return item;
        const candidates = item.candidates.map((c) => {
          const key = `${item.spokenText}::${c._id}`;
          return prevStateMap.has(key) ? { ...c, checked: prevStateMap.get(key) } : c;
        });
        return {
          ...item,
          candidates,
          selectedIds: candidates.filter((c) => c.checked).map((c) => c._id),
        };
      });
    }

    this.setData({
      voiceItems,
      voiceSelectedCount: collectSelectedDishIds(voiceItems).length,
    });
  },

  onVoiceRawTextInput(e) {
    this.setData({ voiceRawText: e.detail.value });
  },

  async handleVoiceRematch() {
    if (this.data.voiceRematching) return;
    const rawText = (this.data.voiceRawText || "").trim();
    if (!rawText) {
      wx.showToast({ title: "请输入要匹配的菜名文本", icon: "none" });
      return;
    }

    const knownDishNames = (this.data.filteredDishes || []).map((d) => d.name);
    this.setData({ voiceRematching: true });

    let segments = [];
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type: "parseVoiceText", text: rawText, knownDishNames },
      });
      if (res.result && res.result.success && res.result.data) {
        segments = res.result.data.segments || [];
      }
    } catch (e) {
      // 网络波动时降级使用本地分词
      segments = splitSpokenDishes(rawText, knownDishNames).map((text) => ({ text, _py: "", _pyFuzzy: "" }));
    } finally {
      this.setData({ voiceRematching: false });
    }

    if (segments.length === 0) {
      segments = [{ text: rawText, _py: "", _pyFuzzy: "" }];
    }
    this._openVoiceResultModal(rawText, segments);
  },

  toggleVoiceDish(e) {
    const itemIdx = Number(e.currentTarget.dataset.itemIdx);
    const dishId = e.currentTarget.dataset.dishId;
    if (Number.isNaN(itemIdx) || !dishId) return;
    const voiceItems = toggleVoiceCandidate(this.data.voiceItems, itemIdx, dishId);
    this.setData({
      voiceItems,
      voiceSelectedCount: collectSelectedDishIds(voiceItems).length,
    });
  },

  goAddUnmatchedDish(e) {
    const dishName = e.currentTarget.dataset.name || "";
    const category = this.data.dailySubTab;
    wx.navigateTo({
      url: `/pages/dishEdit/dishEdit?category=${category}&name=${encodeURIComponent(dishName)}`,
    });
  },

  confirmVoiceAdd() {
    const dishIds = collectSelectedDishIds(this.data.voiceItems);
    if (dishIds.length === 0) {
      wx.showToast({ title: "请先勾选要添加的菜品", icon: "none" });
      return;
    }
    const addedCount = this.batchAddCurrentCategoryDishes(dishIds);
    this.setData({ showVoiceResult: false });
    if (addedCount > 0) {
      wx.showToast({ title: `已添加 ${addedCount} 道菜`, icon: "success" });
    } else {
      wx.showToast({ title: "所选菜品已在当天菜单中", icon: "none" });
    }
  },

  closeVoiceResult() {
    this.setData({ showVoiceResult: false });
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
    const { owner, ref } = this._session;
    try {
      const current = ref && drafts.read(owner, ref.key);
      if (current && current.result && (current.menuVersion || 0) === ref.menuVersion) {
        if (current.version !== ref.version) this._session.ref = drafts.reference(ref.key, current);
        this.openResult(current.result);
        return;
      }
    } catch (e) {
      wx.showToast({ title: "本地草稿读取失败，请重试", icon: "none" });
      return;
    }

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

    // 按送货日期、园区、配料名称和单位归集
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
            const name = ing.name.trim();
            const key = JSON.stringify([name, ing.unit]);

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
                name,
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

        rows.push(createRow(sample.name, sample.unit, sample.type, amounts));
      });

      const d = new Date(date);
      const weekDay = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
      return {
        date,
        dateLabel: `${d.getMonth() + 1}月${d.getDate()}日（周${weekDay}）`,
        rows: sortRows(rows),
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

    const result = {
      schemaVersion: 2,
      tables,
      summary,
      gardens: gardens.map((g) => ({ gardenId: g.gardenId, name: g.name })),
      selectedDates,
    };
    const menu = drafts.captureMenu(this.data);
    if (this.persistDraft(menu, result)) this.openResult(result, menu);
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
        if (d) studentDishes.push(menuDish(d));
      });

      const teacherDishes = [];
      teacherNames.forEach(name => {
        const d = dishMap[`${name}_teacher`];
        if (d) teacherDishes.push(menuDish(d));
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

  // ========== 本地草稿 ==========
  refreshDraftChoices() {
    const { owner, ref } = this._session;
    if (owner !== drafts.username()) return;
    try {
      const choices = drafts.list(owner);
      const latest = ref && choices.find(item => item.key === ref.key);
      const active = latest && latest.menuVersion === ref.menuVersion ? latest : null;
      if (!latest) this._session.ref = null;
      if (active && active.version !== ref.version) this._session.ref = drafts.reference(ref.key, active);
      this.setData({
        hasDraftResult: !!(active && active.hasResult),
        draftChoices: this._fromHistory ? [] : choices.filter(item =>
          item !== active || (item.hasResult && (this.data.pageLoading || this.data.loadError))),
      });
    } catch (e) {
      wx.showToast({ title: "本地草稿读取失败，请重试", icon: "none" });
    }
  },

  toggleDraftChoices() {
    this.setData({ showDraftChoices: !this.data.showDraftChoices });
  },

  persistDraft(menu, result = null) {
    const { owner, ref } = this._session;
    if (owner !== drafts.username()) {
      wx.showToast({ title: "账号已切换，请重新进入生成配料", icon: "none" });
      return false;
    }
    try {
      const next = drafts.write(owner, ref, menu, result);
      if (!next) {
        this.refreshDraftChoices();
        wx.showToast({ title: "草稿已变更，请重新打开", icon: "none" });
        return false;
      }
      this._session = { owner, ref: next };
      if (!ref || this.data.hasDraftResult !== !!result) this.refreshDraftChoices();
      return true;
    } catch (e) {
      wx.showToast({ title: "本地草稿写入失败，请检查存储空间后重试", icon: "none" });
      return false;
    }
  },

  commitMenu(changes) {
    const menu = drafts.captureMenu({ ...this.data, ...changes });
    if (!this.persistDraft(menu)) {
      this.updateCurrentCategoryView();
      return;
    }
    this.setData(changes);
    this.refreshCalendarSelection();
    this.buildDateTabList();
    this.updateCurrentCategoryView();
  },

  openResult(result, menu = drafts.captureMenu(this.data)) {
    getApp().globalData.calculateResult = {
      ...result,
      draftSession: this._session,
      menu,
    };
    wx.navigateTo({
      url: "/pages/result/result",
      fail: () => wx.showToast({ title: "打开失败，草稿已保留", icon: "none" }),
    });
  },

  restoreDraft(e) {
    const key = e.currentTarget.dataset.key;
    const { owner } = this._session;
    let draft;
    try {
      draft = drafts.read(owner, key);
    } catch (err) {
      wx.showToast({ title: "本地草稿读取失败，请重试", icon: "none" });
      return;
    }
    if (!draft) {
      this.refreshDraftChoices();
      return;
    }

    const { selectedDates, dailyDishIds = {}, dishesById } = draft;
    if (!dishesById && (this.data.pageLoading || this.data.loadError)) {
      wx.showToast({ title: "请先加载菜品，再恢复旧草稿", icon: "none" });
      return;
    }
    const catalog = dishesById || {};
    if (!dishesById) this.data.allDishes.forEach(dish => { catalog[dish._id] = menuDish(dish); });
    const dailyDishes = {};
    let missing = false;
    for (const date of selectedDates) {
      const ids = dailyDishIds[date] || {};
      const day = {};
      for (const category of ["student", "teacher"]) {
        const dishes = (ids[category] || []).map(id => catalog[id]);
        if (dishes.some(d => !d)) missing = true;
        day[category] = dishes.filter(Boolean);
      }
      dailyDishes[date] = day;
    }
    this._session = { owner, ref: drafts.reference(key, draft) };
    const currentDateIdx = Math.max(0, Math.min(draft.currentDateIdx || 0, selectedDates.length - 1));
    const date = selectedDates[currentDateIdx];
    this.setData({
      selectedDates, dailyDishes, currentDateIdx, dailySubTab: draft.dailySubTab || "student",
      ...(date ? { currentYear: Number(date.slice(0, 4)), currentMonth: Number(date.slice(5, 7)) } : {}),
    });
    this.generateCalendar();
    this.buildDateTabList();
    this.updateCurrentCategoryView();
    this.refreshDraftChoices();
    if (draft.result) this.openResult(draft.result);
    else if (missing) wx.showToast({ title: "部分菜品已移除，已恢复现有菜品", icon: "none" });
  },

  discardDraft(e) {
    const ref = this.data.draftChoices.find(item => item.key === e.currentTarget.dataset.key);
    if (!ref) return;
    const { owner } = this._session;
    wx.showModal({
      title: "丢弃本地草稿？",
      content: ref.dateLabel + " 的这份草稿将从本机删除。",
      confirmText: "丢弃",
      confirmColor: "#c0392b",
      success: res => {
        if (!res.confirm) return;
        try {
          if (!drafts.discard(owner, ref)) wx.showToast({ title: "草稿已变更，请重新确认", icon: "none" });
        } catch (err) {
          wx.showToast({ title: "删除草稿失败，请重试", icon: "none" });
        }
        this.refreshDraftChoices();
      },
    });
  },
});
