// pages/welcome/welcome.js
Page({
  data: {},

  onShow() {
    // 已登录用户自动进入功能首页
    const app = getApp();
    if (app.globalData.isLogin) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  // 转发给朋友
  onShareAppMessage() {
    return {
      title: '9号菜单',
      path: '/pages/welcome/welcome',
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '9号菜单',
    };
  },
});
