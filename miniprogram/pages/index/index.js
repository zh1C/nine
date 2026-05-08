// pages/index/index.js
Page({
  data: {
    userInfo: null,
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
    this.setData({ userInfo: app.globalData.userInfo });
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

});
