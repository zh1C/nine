// pages/cart/cart.js
const { readTables } = require("../../utils/ingredientTable");

function toPositiveInt(value) {
  const clean = Math.round(Number(value) * 1000) / 1000;
  return Math.max(1, Math.ceil(clean));
}

Page({
  data: {
    hasPermission: false,
    records: [],
    keyword: "",
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    loaded: false,
    noMore: false,
    selectedRecordId: "",
    selectedDate: "",
    showGardenModal: false,
    gardenLoading: false,
    gardenOptions: [],
    selectedGardenCount: 0,
  },

  onLoad() {
    this.checkPermission();
  },

  noop() {},

  checkPermission() {
    const userInfo = getApp().globalData.userInfo;
    if (!userInfo || userInfo.role !== "admin") {
      wx.showModal({
        title: "无权限",
        content: "仅管理员可以访问此页面",
        showCancel: false,
        success: () => {
          wx.navigateBack({
            fail: () => wx.reLaunch({ url: "/pages/index/index" }),
          });
        },
      });
      return;
    }
    this.setData({ hasPermission: true });
    this.loadRecords();
  },

  async loadRecords() {
    const username = getApp().globalData.userInfo.username;
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getRecords",
          username,
          keyword: this.data.keyword.trim(),
          page: this.data.page,
          pageSize: this.data.pageSize,
        },
      });

      if (res.result && res.result.success) {
        const list = (res.result.data.list || []).map((item) => ({
          _id: item._id,
          createTimeStr: this.formatTime(item.createTime),
          gardenNames: (item.gardens || []).map((g) => g.name).join("、") || "无园区",
          dates: (item.selectedDates || []).map((d) => ({
            full: d,
            short: d.length === 10 ? d.slice(5) : d,
          })),
        }));

        const records = this.data.page === 1 ? list : [...this.data.records, ...list];
        const total = res.result.data.total || 0;
        this.setData({
          records,
          total,
          noMore: records.length >= total,
          loaded: true,
        });
      } else {
        wx.showToast({ title: (res.result && res.result.errMsg) || "加载失败", icon: "none" });
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

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  doSearch() {
    this.setData({
      records: [],
      page: 1,
      noMore: false,
      loaded: false,
      selectedRecordId: "",
      selectedDate: "",
    });
    this.loadRecords();
  },

  clearKeyword() {
    this.setData({
      keyword: "",
      records: [],
      page: 1,
      noMore: false,
      loaded: false,
      selectedRecordId: "",
      selectedDate: "",
    });
    this.loadRecords();
  },

  loadMore() {
    if (this.data.loading || this.data.noMore) return;
    this.setData({ page: this.data.page + 1 });
    this.loadRecords();
  },

  selectDate(e) {
    const { recordId, date } = e.currentTarget.dataset;
    this.setData({
      selectedRecordId: recordId,
      selectedDate: date,
    });
  },

  async openGardenModal() {
    const { selectedRecordId, selectedDate } = this.data;
    if (!selectedRecordId || !selectedDate) {
      wx.showToast({ title: "请先选择一天", icon: "none" });
      return;
    }

    const username = getApp().globalData.userInfo.username;
    this.setData({ showGardenModal: true, gardenLoading: true, gardenOptions: [], selectedGardenCount: 0 });

    try {
      const [detailRes, metaRes] = await Promise.all([
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "getRecordDetail", recordId: selectedRecordId, username },
        }),
        wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: { type: "getGardenMetaList", operatorUsername: username },
        }),
      ]);

      if (!detailRes.result || !detailRes.result.success) {
        throw new Error((detailRes.result && detailRes.result.errMsg) || "获取记录详情失败");
      }

      const record = detailRes.result.data;
      const tables = readTables(record);
      const dayTable = tables.find((t) => t.date === selectedDate);
      const rows = (dayTable && dayTable.rows) || [];

      const metaMap = {};
      if (metaRes.result && metaRes.result.success) {
        (metaRes.result.data.list || []).forEach((m) => {
          metaMap[String(m.gardenId)] = Boolean(m.hasMeta);
        });
      }

      const gardenOptions = (record.gardens || []).map((g) => {
        const key = String(g.gardenId);
        const items = [];
        rows.forEach((row) => {
          const rawAmount = Number((row.amounts && row.amounts[key]) || 0);
          if (rawAmount > 0) {
            items.push({
              rowId: row.rowId,
              name: row.name,
              weight: toPositiveInt(rawAmount),
            });
          }
        });
        const hasMeta = Boolean(metaMap[key]);
        return {
          gardenId: g.gardenId,
          name: g.name,
          hasMeta,
          itemCount: items.length,
          items,
          selected: hasMeta && items.length > 0,
        };
      });

      const selectedGardenCount = gardenOptions.filter((g) => g.selected).length;
      this.setData({ gardenOptions, selectedGardenCount, gardenLoading: false });
    } catch (e) {
      console.error(e);
      this.setData({ showGardenModal: false, gardenLoading: false });
      wx.showToast({ title: e.message || "加载园区失败", icon: "none" });
    }
  },

  closeGardenModal() {
    this.setData({ showGardenModal: false });
  },

  toggleGarden(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const gardenOptions = this.data.gardenOptions.map((g, i) =>
      i === idx ? { ...g, selected: !g.selected } : g
    );
    const selectedGardenCount = gardenOptions.filter((g) => g.selected).length;
    this.setData({ gardenOptions, selectedGardenCount });
  },

  confirmStart() {
    const chosen = this.data.gardenOptions.filter((g) => g.selected);
    if (chosen.length === 0) {
      wx.showToast({ title: "请至少选择一个园区", icon: "none" });
      return;
    }

    getApp().globalData.cartTask = {
      recordId: this.data.selectedRecordId,
      date: this.data.selectedDate,
      gardens: chosen.map((g) => ({
        gardenId: g.gardenId,
        name: g.name,
        items: g.items,
      })),
    };

    this.setData({ showGardenModal: false });
    wx.navigateTo({ url: "/pages/cartResult/cartResult" });
  },

  formatTime(timeObj) {
    if (!timeObj) return "";
    const date = new Date(timeObj.$date || timeObj);
    if (isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${h}:${min}`;
  },
});
