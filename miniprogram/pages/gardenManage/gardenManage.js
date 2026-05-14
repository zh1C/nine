// pages/gardenManage/gardenManage.js
Page({
  data: {
    gardens: [],
    keyword: "",
    loading: false,
    showDialog: false,
    isEdit: false,
    dialogName: "",
    editingGardenId: null,
    hasPermission: false,
  },

  onLoad() {
    this.checkPermission();
  },

  onShow() {
    if (this.data.hasPermission) {
      this.loadGardens();
    }
  },

  // 权限校验（所有已登录用户可访问）
  checkPermission() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo) {
      wx.showModal({
        title: "未登录",
        content: "请先登录",
        showCancel: false,
        success: () => { wx.navigateBack(); },
      });
      return;
    }
    this.setData({ hasPermission: true });
    this.loadGardens();
  },

  // 搜索相关
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

  // 加载园区列表
  async loadGardens() {
    this.setData({ loading: true });
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getGardens",
          operatorUsername: app.globalData.userInfo.username,
          keyword: this.data.keyword,
        },
      });

      if (res.result.success) {
        const gardens = res.result.data.list.map((item) => {
          let createTimeStr = "";
          if (item.createTime) {
            const date = new Date(item.createTime);
            createTimeStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          }
          return { ...item, createTimeStr };
        });
        this.setData({ gardens });
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

  // 弹窗相关
  showAddDialog() {
    this.setData({
      showDialog: true,
      isEdit: false,
      dialogName: "",
      editingGardenId: null,
    });
  },

  showEditDialog(e) {
    const garden = e.currentTarget.dataset.garden;
    this.setData({
      showDialog: true,
      isEdit: true,
      dialogName: garden.name,
      editingGardenId: garden.gardenId,
    });
  },

  hideDialog() {
    this.setData({ showDialog: false });
  },

  onDialogInput(e) {
    this.setData({ dialogName: e.detail.value });
  },

  // 确认新增/编辑
  async confirmDialog() {
    const { isEdit, dialogName, editingGardenId } = this.data;
    if (!dialogName || !dialogName.trim()) {
      wx.showToast({ title: "园区名称不能为空", icon: "none" });
      return;
    }

    wx.showLoading({ title: isEdit ? "修改中..." : "新增中..." });
    try {
      const app = getApp();
      const data = {
        type: isEdit ? "updateGarden" : "addGarden",
        operatorUsername: app.globalData.userInfo.username,
        name: dialogName.trim(),
      };
      if (isEdit) {
        data.gardenId = editingGardenId;
      }

      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data,
      });

      if (res.result.success) {
        wx.showToast({ title: isEdit ? "修改成功" : "新增成功", icon: "success" });
        this.setData({ showDialog: false });
        this.loadGardens();
      } else {
        wx.showToast({ title: res.result.errMsg || "操作失败", icon: "none" });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "网络错误", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  // 删除园区
  deleteGarden(e) {
    const { gardenId, name } = e.currentTarget.dataset;
    wx.showModal({
      title: "确认删除",
      content: `确定要删除园区「${name}」吗？删除后不可恢复。`,
      confirmColor: "#d32f2f",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "删除中..." });
          try {
            const app = getApp();
            const result = await wx.cloud.callFunction({
              name: "quickstartFunctions",
              data: {
                type: "deleteGarden",
                operatorUsername: app.globalData.userInfo.username,
                gardenId,
              },
            });

            if (result.result.success) {
              wx.showToast({ title: "删除成功", icon: "success" });
              this.loadGardens();
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
