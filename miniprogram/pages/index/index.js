// pages/index/index.js
Page({
  data: {
    userInfo: null,
    isAdmin: false,
  },

  onLoad() {
    this.checkLogin();
  },

  onShow() {
    this.checkLogin();
  },

  checkLogin() {
    const app = getApp();
    if (!app.globalData.isLogin) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    const userInfo = app.globalData.userInfo;
    this.setData({
      userInfo,
      isAdmin: userInfo && userInfo.role === "admin",
    });
  },

  navigateTo(e) {
    const page = e.currentTarget.dataset.page;
    wx.navigateTo({ url: page });
  },

  handleLogout() {
    wx.showModal({
      title: "提示",
      content: "确定要退出登录吗？",
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync("userInfo");
          getApp().globalData.userInfo = null;
          getApp().globalData.isLogin = false;
          wx.reLaunch({ url: "/pages/login/login" });
        }
      },
    });
  },

  // 转发给朋友
  onShareAppMessage() {
    return {
      title: "9号菜单",
      path: "/pages/login/login",
    };
  },
});
