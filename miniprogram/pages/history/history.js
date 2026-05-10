// pages/history/history.js
Page({
  data: {
    records: [],
    keyword: "",
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    loaded: false,
    noMore: false,
  },

  onLoad() {
    this.loadRecords();
  },

  onShow() {
    // 从详情页返回时刷新
    if (this._needRefresh) {
      this._needRefresh = false;
      this.setData({ records: [], page: 1, noMore: false, loaded: false });
      this.loadRecords();
    }
  },

  // ========== 加载记录 ==========
  async loadRecords() {
    const app = getApp();
    const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";
    if (!username) {
      wx.showToast({ title: "请先登录", icon: "none" });
      return;
    }

    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getRecords",
          username,
          keyword: this.data.keyword,
          page: this.data.page,
          pageSize: this.data.pageSize,
        },
      });

      if (res.result.success) {
        const newList = (res.result.data.list || []).map((item) => {
          return {
            ...item,
            dateRange: this.formatDateRange(item.selectedDates),
            gardenNames: this.formatGardenNames(item.gardens),
            createTimeStr: this.formatTime(item.createTime),
          };
        });

        const records = this.data.page === 1 ? newList : [...this.data.records, ...newList];
        const noMore = records.length >= res.result.data.total;

        this.setData({ records, total: res.result.data.total, noMore, loaded: true });
      } else {
        wx.showToast({ title: res.result.errMsg || "加载失败", icon: "none" });
        this.setData({ loaded: true });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "加载失败", icon: "none" });
      this.setData({ loaded: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ========== 搜索 ==========
  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  doSearch() {
    this.setData({ records: [], page: 1, noMore: false, loaded: false });
    this.loadRecords();
  },

  clearKeyword() {
    this.setData({ keyword: "", records: [], page: 1, noMore: false, loaded: false });
    this.loadRecords();
  },

  // ========== 加载更多 ==========
  loadMore() {
    if (this.data.loading || this.data.noMore) return;
    this.setData({ page: this.data.page + 1 });
    this.loadRecords();
  },

  // ========== 查看详情 ==========
  async viewRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    const app = getApp();
    const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";

    wx.showLoading({ title: "加载中..." });

    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getRecordDetail",
          recordId,
          username,
        },
      });

      wx.hideLoading();

      if (res.result.success) {
        const record = res.result.data;
        // 将记录数据存入全局，跳转到结果页展示
        app.globalData.calculateResult = {
          tables: record.tables,
          summary: record.summary,
          gardens: record.gardens,
          selectedDates: record.selectedDates,
        };
        wx.navigateTo({ url: "/pages/result/result?from=history" });
      } else {
        wx.showToast({ title: res.result.errMsg || "加载失败", icon: "none" });
      }
    } catch (e) {
      wx.hideLoading();
      console.error(e);
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  // ========== 修改记录 ==========
  async editRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    const app = getApp();
    const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";

    wx.showLoading({ title: "加载中..." });

    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getRecordDetail",
          recordId,
          username,
        },
      });

      wx.hideLoading();

      if (res.result.success) {
        const record = res.result.data;
        // 存入全局，跳转到 calculate 页面恢复选择
        app.globalData.editRecord = {
          selectedDates: record.selectedDates,
          summary: record.summary,
        };
        wx.navigateTo({ url: "/pages/calculate/calculate?from=history" });
      } else {
        wx.showToast({ title: res.result.errMsg || "加载失败", icon: "none" });
      }
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  // ========== 删除记录 ==========
  deleteRecord(e) {
    const recordId = e.currentTarget.dataset.id;

    wx.showModal({
      title: "确认删除",
      content: "删除后无法恢复，确定要删除此记录吗？",
      confirmColor: "#F44336",
      success: async (res) => {
        if (!res.confirm) return;

        const app = getApp();
        const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";

        wx.showLoading({ title: "删除中..." });

        try {
          const result = await wx.cloud.callFunction({
            name: "quickstartFunctions",
            data: {
              type: "deleteRecord",
              recordId,
              username,
            },
          });

          wx.hideLoading();

          if (result.result.success) {
            wx.showToast({ title: "已删除", icon: "success" });
            // 从列表中移除
            const records = this.data.records.filter((r) => r._id !== recordId);
            this.setData({ records, total: this.data.total - 1 });
          } else {
            wx.showToast({ title: result.result.errMsg || "删除失败", icon: "none" });
          }
        } catch (err) {
          wx.hideLoading();
          console.error(err);
          wx.showToast({ title: "删除失败", icon: "none" });
        }
      },
    });
  },

  // ========== 格式化工具 ==========
  formatDateRange(dates) {
    if (!dates || dates.length === 0) return "无日期";
    if (dates.length === 1) return dates[0];
    // 取首尾日期，简化显示
    const first = dates[0];
    const last = dates[dates.length - 1];
    return `${first} ~ ${last}`;
  },

  formatGardenNames(gardens) {
    if (!gardens || gardens.length === 0) return "无园区";
    return gardens.map((g) => g.name).join("、");
  },

  formatTime(timeObj) {
    if (!timeObj) return "";
    // 云数据库 serverDate 返回的是 Date 对象或时间戳
    let date;
    if (typeof timeObj === "string") {
      date = new Date(timeObj);
    } else if (timeObj.$date) {
      date = new Date(timeObj.$date);
    } else {
      date = new Date(timeObj);
    }

    if (isNaN(date.getTime())) return "";

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:${min}`;
  },
});
