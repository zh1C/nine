// pages/cartResult/cartResult.js
const BATCH_SIZE = 5;

const STATUS_LABELS = {
  NOT_FOUND: "搜索为空",
  MULTIPLE_MATCH: "存在多个",
  NAME_MISMATCH: "名称不等",
  ADD_FAILED: "加购失败",
};

Page({
  data: {
    date: "",
    running: false,
    progressText: "",
    progressPercent: 0,
    activeIdx: 0,
    gardens: [],
  },

  onLoad() {
    this._sessionTokens = {};
    this._unloaded = false;

    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== "admin") {
      wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/index/index" }) });
      return;
    }

    const task = app.globalData.cartTask;
    app.globalData.cartTask = null;
    if (!task || !Array.isArray(task.gardens) || task.gardens.length === 0) {
      wx.showToast({ title: "缺少任务数据", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    const gardens = task.gardens.map((g) => ({
      gardenId: g.gardenId,
      name: g.name,
      deptName: "",
      dlrName: "",
      status: "PENDING",
      errMsg: "",
      cartCount: 0,
      totalPrice: "0.0",
      rawItems: g.items || [],
      totalCount: (g.items || []).length,
      doneCount: 0,
      successItems: [],
      failedItems: [],
      showSuccess: false,
    }));

    this.setData({ date: task.date, gardens });
    this.runAllGardens();
  },

  onUnload() {
    this._unloaded = true;
    this._sessionTokens = {};
  },

  async runAllGardens() {
    this.setData({ running: true });
    for (let i = 0; i < this.data.gardens.length; i++) {
      if (this._unloaded) return;
      await this.runSingleGarden(i);
    }
    if (!this._unloaded) {
      this.setData({ running: false, progressText: "处理完成", progressPercent: 100 });
    }
  },

  async runSingleGarden(idx) {
    const garden = this.data.gardens[idx];
    const username = getApp().globalData.userInfo.username;

    if (garden.totalCount === 0) {
      this.setData({ [`gardens[${idx}].status`]: "EMPTY" });
      return;
    }

    this.setData({
      [`gardens[${idx}].status`]: "RUNNING",
      [`gardens[${idx}].errMsg`]: "",
      [`gardens[${idx}].doneCount`]: 0,
      [`gardens[${idx}].successItems`]: [],
      [`gardens[${idx}].failedItems`]: [],
      progressText: `正在初始化 ${garden.name}...`,
    });

    try {
      const initRes = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "cartInitGarden",
          operatorUsername: username,
          gardenId: garden.gardenId,
        },
      });

      if (this._unloaded) return;

      if (!initRes.result || !initRes.result.success) {
        this.setData({
          [`gardens[${idx}].status`]: "LOGIN_FAILED",
          [`gardens[${idx}].errMsg`]: (initRes.result && initRes.result.errMsg) || "初始化失败",
        });
        return;
      }

      const info = initRes.result.data;
      if (info.status !== "READY") {
        this.setData({
          [`gardens[${idx}].status`]: info.status,
          [`gardens[${idx}].errMsg`]: info.errMsg || "",
          [`gardens[${idx}].cartCount`]: info.cartCount || 0,
          [`gardens[${idx}].totalPrice`]: info.totalPrice || "0.0",
          [`gardens[${idx}].deptName`]: info.deptName || "",
          [`gardens[${idx}].dlrName`]: info.dlrName || "",
        });
        return;
      }

      this._sessionTokens[garden.gardenId] = info.sessionToken;
      this.setData({
        [`gardens[${idx}].deptName`]: info.deptName || "",
        [`gardens[${idx}].dlrName`]: info.dlrName || "",
      });

      await this.processItemsInBatches(idx, garden.rawItems, false);
    } catch (e) {
      if (this._unloaded) return;
      console.error(e);
      this.setData({
        [`gardens[${idx}].status`]: "LOGIN_FAILED",
        [`gardens[${idx}].errMsg`]: e.message || "网络异常",
      });
    }
  },

  async processItemsInBatches(idx, itemsToRun, isRetry) {
    const username = getApp().globalData.userInfo.username;
    const garden = this.data.gardens[idx];
    const total = itemsToRun.length;
    let processed = 0;

    for (let start = 0; start < total; start += BATCH_SIZE) {
      if (this._unloaded) return;
      const batch = itemsToRun.slice(start, start + BATCH_SIZE);

      this.setData({
        progressText: `正在处理 ${garden.name}（${processed}/${total}）`,
        progressPercent: total > 0 ? Math.round((processed / total) * 100) : 100,
      });

      try {
        const res = await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "cartProcessItems",
            operatorUsername: username,
            gardenId: garden.gardenId,
            sessionToken: this._sessionTokens[garden.gardenId] || "",
            items: batch.map((it) => ({
              rowId: it.rowId,
              name: isRetry ? it.editName : it.name,
              weight: it.weight,
            })),
          },
        });

        if (this._unloaded) return;

        if (!res.result || !res.result.success) {
          const errMsg = (res.result && res.result.errMsg) || "加购请求失败";
          this.applyBatchResults(
            idx,
            batch.map((it) => ({
              rowId: it.rowId,
              queryName: isRetry ? it.editName : it.name,
              weight: it.weight,
              status: "ADD_FAILED",
              reason: errMsg,
              candidates: [],
            })),
            isRetry
          );
        } else {
          const data = res.result.data;
          if (data.sessionToken) {
            this._sessionTokens[garden.gardenId] = data.sessionToken;
          }
          this.applyBatchResults(idx, data.results || [], isRetry);
        }
      } catch (e) {
        if (this._unloaded) return;
        console.error(e);
        this.applyBatchResults(
          idx,
          batch.map((it) => ({
            rowId: it.rowId,
            queryName: isRetry ? it.editName : it.name,
            weight: it.weight,
            status: "ADD_FAILED",
            reason: e.message || "网络异常",
            candidates: [],
          })),
          isRetry
        );
      }

      processed += batch.length;
    }

    if (!this._unloaded) {
      const current = this.data.gardens[idx];
      this.setData({
        [`gardens[${idx}].status`]: "DONE",
        [`gardens[${idx}].doneCount`]: current.successItems.length + current.failedItems.length,
        [`gardens[${idx}].showSuccess`]: current.failedItems.length === 0,
      });
    }
  },

  applyBatchResults(idx, results, isRetry) {
    const garden = this.data.gardens[idx];
    const successItems = [...garden.successItems];
    let failedItems = [...garden.failedItems];

    results.forEach((r) => {
      if (r.status === "SUCCESS") {
        failedItems = failedItems.filter((f) => f.rowId !== r.rowId);
        successItems.push({
          rowId: r.rowId,
          name: r.queryName,
          weight: r.weight,
          format: r.format || "",
          saleCode: r.saleCode || "",
        });
      } else {
        const failItem = {
          rowId: r.rowId,
          originalName: r.queryName,
          editName: r.queryName,
          weight: r.weight,
          status: r.status,
          statusLabel: STATUS_LABELS[r.status] || "异常",
          reason: r.reason || "匹配失败",
          candidates: r.candidates || [],
        };
        const existIdx = failedItems.findIndex((f) => f.rowId === r.rowId);
        if (isRetry && existIdx !== -1) {
          failItem.originalName = failedItems[existIdx].originalName;
          failedItems[existIdx] = failItem;
        } else if (existIdx === -1) {
          failedItems.push(failItem);
        }
      }
    });

    this.setData({
      [`gardens[${idx}].successItems`]: successItems,
      [`gardens[${idx}].failedItems`]: failedItems,
      [`gardens[${idx}].doneCount`]: successItems.length + failedItems.length,
    });
  },

  switchTab(e) {
    this.setData({ activeIdx: Number(e.currentTarget.dataset.idx) });
  },

  toggleSuccess() {
    const idx = this.data.activeIdx;
    const current = this.data.gardens[idx].showSuccess;
    this.setData({ [`gardens[${idx}].showSuccess`]: !current });
  },

  onEditNameInput(e) {
    const { itemIdx } = e.currentTarget.dataset;
    const gIdx = this.data.activeIdx;
    this.setData({ [`gardens[${gIdx}].failedItems[${itemIdx}].editName`]: e.detail.value });
  },

  pickCandidate(e) {
    const { itemIdx, name } = e.currentTarget.dataset;
    const gIdx = this.data.activeIdx;
    this.setData({ [`gardens[${gIdx}].failedItems[${itemIdx}].editName`]: name });
  },

  async retrySingleItem(e) {
    if (this.data.running) return;
    const itemIdx = Number(e.currentTarget.dataset.itemIdx);
    const gIdx = this.data.activeIdx;
    const item = this.data.gardens[gIdx].failedItems[itemIdx];
    if (!item || !String(item.editName || "").trim()) {
      wx.showToast({ title: "请输入菜品名称", icon: "none" });
      return;
    }

    this.setData({ running: true });
    try {
      await this.processItemsInBatches(gIdx, [item], true);
    } finally {
      if (!this._unloaded) {
        this.setData({ running: false, progressText: "重试完成", progressPercent: 100 });
      }
    }
  },

  async retryAllFailed() {
    if (this.data.running) return;
    const gIdx = this.data.activeIdx;
    const failedItems = this.data.gardens[gIdx].failedItems;
    if (failedItems.length === 0) return;

    this.setData({ running: true });
    try {
      await this.processItemsInBatches(gIdx, failedItems, true);
    } finally {
      if (!this._unloaded) {
        this.setData({ running: false, progressText: "重试完成", progressPercent: 100 });
      }
    }
  },

  async recheckGarden() {
    if (this.data.running) return;
    const gIdx = this.data.activeIdx;
    this.setData({ running: true });
    try {
      await this.runSingleGarden(gIdx);
    } finally {
      if (!this._unloaded) {
        this.setData({ running: false, progressText: "处理完成", progressPercent: 100 });
      }
    }
  },

  goGardenMeta() {
    wx.navigateTo({ url: "/pages/gardenMetaManage/gardenMetaManage" });
  },
});
