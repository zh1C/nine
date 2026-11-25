// pages/gardenMetaManage/gardenMetaManage.js
Page({
  data: {
    gardens: [],
    keyword: "",
    loading: false,
    hasPermission: false,
    revealedPasswords: {},
    showDialog: false,
    dialogIsEdit: false,
    dialogGardenId: null,
    dialogGardenName: "",
    dialogAccountUsername: "",
    dialogPassword: "",
    showDialogPassword: false,
    saving: false,
  },

  onLoad() {
    this.checkPermission();
  },

  onShow() {
    if (this.data.hasPermission) {
      this.loadGardens();
    }
  },

  noop() {},

  // 管理员权限校验
  checkPermission() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== "admin") {
      wx.showModal({
        title: "无权限",
        content: "仅管理员可以访问此页面",
        showCancel: false,
        success: () => {
          wx.navigateBack({
            fail: () => {
              wx.reLaunch({ url: "/pages/index/index" });
            },
          });
        },
      });
      return;
    }
    this.setData({ hasPermission: true });
    this.loadGardens();
  },

  onInputSearch(e) {
    this.setData({ keyword: e.detail.value });
  },

  handleSearch() {
    this.loadGardens();
  },

  clearSearch() {
    this.setData({ keyword: "" });
    this.loadGardens();
  },

  // 加载管理员本人的园区及元信息配置状态
  async loadGardens() {
    this.setData({ loading: true });
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getGardenMetaList",
          operatorUsername: app.globalData.userInfo.username,
          keyword: this.data.keyword,
        },
      });

      if (res.result && res.result.success) {
        const gardens = res.result.data.list.map((item) => {
          let updateTimeStr = "";
          if (item.updateTime) {
            const date = new Date(item.updateTime);
            updateTimeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          }
          return { ...item, updateTimeStr };
        });
        this.setData({ gardens, revealedPasswords: {} });
      } else {
        wx.showToast({
          title: (res.result && res.result.errMsg) || "加载失败",
          icon: "none",
        });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "网络错误", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 请求单条元信息详情（服务端按需解密）
  async fetchMetaDetail(gardenId) {
    const app = getApp();
    const res = await wx.cloud.callFunction({
      name: "quickstartFunctions",
      data: {
        type: "getGardenMetaDetail",
        operatorUsername: app.globalData.userInfo.username,
        gardenId,
      },
    });
    if (res.result && res.result.success) {
      return res.result.data;
    }
    throw new Error((res.result && res.result.errMsg) || "获取元信息失败");
  },

  // 切换卡片中密码显示/隐藏
  async togglePassword(e) {
    const gardenId = e.currentTarget.dataset.gardenId;
    const revealed = { ...this.data.revealedPasswords };
    if (revealed[gardenId]) {
      delete revealed[gardenId];
      this.setData({ revealedPasswords: revealed });
      return;
    }

    wx.showLoading({ title: "获取中..." });
    try {
      const detail = await this.fetchMetaDetail(gardenId);
      revealed[gardenId] = detail.password;
      this.setData({ revealedPasswords: revealed });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || "获取密码失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  // 复制用户名
  copyAccount(e) {
    const account = e.currentTarget.dataset.account;
    if (!account) return;
    wx.setClipboardData({
      data: account,
      success: () => {
        wx.showToast({ title: "已复制用户名", icon: "success" });
      },
    });
  },

  // 复制密码
  async copyPassword(e) {
    const gardenId = e.currentTarget.dataset.gardenId;
    let password = this.data.revealedPasswords[gardenId];
    if (!password) {
      wx.showLoading({ title: "获取中..." });
      try {
        const detail = await this.fetchMetaDetail(gardenId);
        password = detail.password;
      } catch (err) {
        console.error(err);
        wx.showToast({ title: err.message || "获取密码失败", icon: "none" });
        return;
      } finally {
        wx.hideLoading();
      }
    }
    if (!password) {
      wx.showToast({ title: "密码为空", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: password,
      success: () => {
        wx.showToast({ title: "已复制密码", icon: "success" });
      },
    });
  },

  // 打开录入/编辑弹窗
  async openMetaDialog(e) {
    const garden = e.currentTarget.dataset.garden;
    if (!garden.hasMeta) {
      this.setData({
        showDialog: true,
        dialogIsEdit: false,
        dialogGardenId: garden.gardenId,
        dialogGardenName: garden.name,
        dialogAccountUsername: "",
        dialogPassword: "",
        showDialogPassword: false,
      });
      return;
    }

    wx.showLoading({ title: "加载中..." });
    try {
      const detail = await this.fetchMetaDetail(garden.gardenId);
      this.setData({
        showDialog: true,
        dialogIsEdit: true,
        dialogGardenId: garden.gardenId,
        dialogGardenName: garden.name,
        dialogAccountUsername: detail.accountUsername || "",
        dialogPassword: detail.password || "",
        showDialogPassword: false,
      });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: err.message || "加载元信息失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  hideDialog() {
    this.setData({ showDialog: false });
  },

  onDialogAccountInput(e) {
    this.setData({ dialogAccountUsername: e.detail.value });
  },

  onDialogPasswordInput(e) {
    this.setData({ dialogPassword: e.detail.value });
  },

  toggleDialogPassword() {
    this.setData({ showDialogPassword: !this.data.showDialogPassword });
  },

  // 保存元信息
  async confirmDialog() {
    if (this.data.saving) return;
    const { dialogGardenId, dialogAccountUsername, dialogPassword } = this.data;
    const accountUsername = (dialogAccountUsername || "").trim();
    const password = (dialogPassword || "").trim();

    if (!accountUsername) {
      wx.showToast({ title: "请输入用户名", icon: "none" });
      return;
    }
    if (!password) {
      wx.showToast({ title: "请输入密码", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: "保存中..." });
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "saveGardenMeta",
          operatorUsername: app.globalData.userInfo.username,
          gardenId: dialogGardenId,
          accountUsername,
          password,
        },
      });

      if (res.result && res.result.success) {
        wx.showToast({ title: "保存成功", icon: "success" });
        this.setData({ showDialog: false });
        this.loadGardens();
      } else {
        wx.showToast({
          title: (res.result && res.result.errMsg) || "保存失败",
          icon: "none",
        });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "网络错误", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  // 清空元信息
  clearMeta(e) {
    const { gardenId, name } = e.currentTarget.dataset;
    wx.showModal({
      title: "确认清空",
      content: `确定要清空园区「${name}」的账号密码吗？不会删除园区本身。`,
      confirmColor: "#d32f2f",
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "清空中..." });
        try {
          const app = getApp();
          const result = await wx.cloud.callFunction({
            name: "quickstartFunctions",
            data: {
              type: "deleteGardenMeta",
              operatorUsername: app.globalData.userInfo.username,
              gardenId,
            },
          });

          if (result.result && result.result.success) {
            wx.showToast({ title: "已清空", icon: "success" });
            this.loadGardens();
          } else {
            wx.showToast({
              title: (result.result && result.result.errMsg) || "清空失败",
              icon: "none",
            });
          }
        } catch (err) {
          console.error(err);
          wx.showToast({ title: "网络错误", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },
});
