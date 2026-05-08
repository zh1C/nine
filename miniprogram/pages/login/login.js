// pages/login/login.js
Page({
    data: {
        username: "",
        password: "",
        isRegister: false,
        loading: false,
    },

    onLoad() { },

    onInputUsername(e) {
        // 只允许字母、数字和下划线
        const value = e.detail.value.replace(/[^a-zA-Z0-9_]/g, "");
        this.setData({ username: value });
    },

    onInputPassword(e) {
        this.setData({ password: e.detail.value });
    },

    toggleMode() {
        this.setData({ isRegister: !this.data.isRegister });
    },

    async handleSubmit() {
        const { username, password, isRegister } = this.data;
        if (!username.trim() || !password.trim()) {
            wx.showToast({ title: "请输入用户名和密码", icon: "none" });
            return;
        }
        // 注册时校验用户名格式
        if (isRegister && !/^[a-zA-Z0-9_]+$/.test(username.trim())) {
            wx.showToast({ title: "用户名只能包含字母、数字和下划线", icon: "none" });
            return;
        }

        this.setData({ loading: true });

        try {
            const res = await wx.cloud.callFunction({
                name: "quickstartFunctions",
                data: {
                    type: isRegister ? "register" : "login",
                    username: username.trim(),
                    password: password.trim(),
                },
            });

            const result = res.result;
            if (result.success) {
                if (isRegister) {
                    wx.showToast({ title: "注册成功，请登录", icon: "success" });
                    this.setData({ isRegister: false, password: "" });
                } else {
                    // 登录成功
                    const userInfo = {
                        _id: result.data._id,
                        username: result.data.username,
                        nickname: result.data.nickname,
                        avatar: result.data.avatar,
                        role: result.data.role,
                    };
                    wx.setStorageSync("userInfo", userInfo);
                    getApp().globalData.userInfo = userInfo;
                    getApp().globalData.isLogin = true;
                    wx.showToast({ title: "登录成功", icon: "success" });
                    setTimeout(() => {
                        wx.reLaunch({ url: "/pages/index/index" });
                    }, 1000);
                }
            } else {
                wx.showToast({ title: result.errMsg || "操作失败", icon: "none" });
            }
        } catch (e) {
            console.error(e);
            wx.showToast({ title: "网络错误，请重试", icon: "none" });
        } finally {
            this.setData({ loading: false });
        }
    },

    // 转发给朋友
    onShareAppMessage() {
        return {
            title: "9号菜单",
            path: "/pages/login/login",
        };
    },

    // 分享到朋友圈
    onShareTimeline() {
        return {
            title: "9号菜单",
        };
    },
});
