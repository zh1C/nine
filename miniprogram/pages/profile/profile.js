// pages/profile/profile.js
const app = getApp();

Page({
  data: {
    username: "",
    nickname: "",
    avatar: "",
    role: "",
    roleText: "",
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
    saving: false,
  },

  onLoad() {
    const userInfo = app.globalData.userInfo;
    if (!userInfo) {
      wx.reLaunch({ url: "/pages/login/login" });
      return;
    }
    this.setData({
      username: userInfo.username,
      nickname: userInfo.nickname || userInfo.username,
      avatar: userInfo.avatar || "",
      role: userInfo.role,
      roleText: userInfo.role === "admin" ? "管理员" : "普通用户",
    });
  },

  onInputNickname(e) {
    this.setData({ nickname: e.detail.value });
  },

  onInputOldPwd(e) {
    this.setData({ oldPassword: e.detail.value });
  },

  onInputNewPwd(e) {
    this.setData({ newPassword: e.detail.value });
  },

  onInputConfirmPwd(e) {
    this.setData({ confirmPassword: e.detail.value });
  },

  // 选择头像
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadAvatar(tempFilePath);
      },
    });
  },

  // 上传头像到云存储
  async uploadAvatar(filePath) {
    wx.showLoading({ title: "上传中..." });
    try {
      const cloudPath = `avatars/${this.data.username}_${Date.now()}.jpg`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath,
      });

      this.setData({ avatar: uploadRes.fileID });
      wx.hideLoading();
      wx.showToast({ title: "头像已更新", icon: "success" });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: "上传失败", icon: "none" });
    }
  },

  // 保存修改
  async saveProfile() {
    const { username, nickname, avatar, oldPassword, newPassword, confirmPassword } = this.data;

    if (!nickname.trim()) {
      wx.showToast({ title: "别名不能为空", icon: "none" });
      return;
    }

    // 如果填了密码相关字段，进行密码修改校验
    const hasPasswordChange = oldPassword || newPassword || confirmPassword;
    if (hasPasswordChange) {
      if (!oldPassword || !newPassword || !confirmPassword) {
        wx.showToast({ title: "请完整填写密码信息", icon: "none" });
        return;
      }
      if (newPassword !== confirmPassword) {
        wx.showToast({ title: "两次输入的新密码不一致", icon: "none" });
        return;
      }
      if (newPassword.length < 4) {
        wx.showToast({ title: "新密码至少4位", icon: "none" });
        return;
      }
    }

    this.setData({ saving: true });

    try {
      // 更新个人资料（传入旧头像用于云函数端删除）
      const oldAvatar = app.globalData.userInfo.avatar || "";
      const profileRes = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateProfile",
          username,
          nickname: nickname.trim(),
          avatar,
          oldAvatar: avatar !== oldAvatar ? oldAvatar : "",
        },
      });

      if (!profileRes.result.success) {
        wx.showToast({ title: profileRes.result.errMsg || "保存失败", icon: "none" });
        this.setData({ saving: false });
        return;
      }

      // 修改密码
      if (hasPasswordChange) {
        const pwdRes = await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "changePassword",
            username,
            oldPassword,
            newPassword,
          },
        });

        if (!pwdRes.result.success) {
          wx.showToast({ title: pwdRes.result.errMsg || "密码修改失败", icon: "none" });
          this.setData({ saving: false });
          return;
        }
      }

      // 更新全局状态
      app.globalData.userInfo.nickname = nickname.trim();
      app.globalData.userInfo.avatar = avatar;
      wx.setStorageSync("userInfo", app.globalData.userInfo);

      wx.showToast({ title: "保存成功", icon: "success" });
      this.setData({
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
        saving: false,
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "网络错误", icon: "none" });
      this.setData({ saving: false });
    }
  },
});
