// pages/userManage/userManage.js
Page({
  data: {
    users: [],
    keyword: "",
    loading: false,
  },

  onLoad() {
    this.checkPermission();
  },

  onShow() {
    if (this.data.hasPermission) {
      this.loadUsers();
    }
  },

  // 权限校验
  checkPermission() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== "admin") {
      wx.showModal({
        title: "无权限",
        content: "仅管理员可以访问此页面",
        showCancel: false,
        success: () => {
          wx.navigateBack();
        },
      });
      return;
    }
    this.data.hasPermission = true;
    this.loadUsers();
  },

  onInputSearch(e) {
    this.setData({ keyword: e.detail.value });
  },

  handleSearch() {
    this.loadUsers();
  },

  clearSearch() {
    this.setData({ keyword: "" });
    this.loadUsers();
  },

  // 加载用户列表
  async loadUsers() {
    this.setData({ loading: true });
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getUsers",
          operatorUsername: app.globalData.userInfo.username,
          keyword: this.data.keyword,
        },
      });

      if (res.result.success) {
        const users = res.result.data.list.map((user) => {
          // 格式化注册时间
          let createTimeStr = "";
          if (user.createTime) {
            const date = new Date(user.createTime);
            createTimeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          }
          return { ...user, createTimeStr };
        });
        this.setData({ users });
      } else {
        wx.showToast({ title: res.result.errMsg || "加载失败", icon: "none" });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "网络错误", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 删除用户
  deleteUser(e) {
    const { username, nickname } = e.currentTarget.dataset;
    wx.showModal({
      title: "确认删除",
      content: `确定要删除用户「${nickname}」吗？\n将同时删除该用户的所有菜品、园区、历史记录等数据，删除后不可恢复。`,
      confirmColor: "#d32f2f",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "删除中..." });
          try {
            const app = getApp();
            const result = await wx.cloud.callFunction({
              name: "quickstartFunctions",
              data: {
                type: "deleteUser",
                operatorUsername: app.globalData.userInfo.username,
                targetUsername: username,
              },
            });

            if (result.result.success) {
              wx.showToast({ title: "删除成功", icon: "success" });
              this.loadUsers();
            } else {
              wx.showToast({ title: result.result.errMsg || "删除失败", icon: "none" });
            }
          } catch (e) {
            console.error(e);
            wx.showToast({ title: "网络错误", icon: "none" });
          } finally {
            wx.hideLoading();
          }
        }
      },
    });
  },
});
