// pages/dishes/dishes.js
Page({
  data: {
    dishes: [],
    keyword: "",
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
  },

  onLoad() {
    this.checkPermission();
  },

  // 权限校验：仅管理员可访问
  checkPermission() {
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== "admin") {
      wx.showModal({
        title: "无权限",
        content: "仅管理员可以管理菜品",
        showCancel: false,
        success: () => {
          wx.navigateBack();
        },
      });
      return;
    }
    this.loadDishes();
  },

  onShow() {
    // 每次显示页面时刷新列表
    this.setData({ page: 1, dishes: [], hasMore: true });
    this.loadDishes();
  },

  onInputSearch(e) {
    this.setData({ keyword: e.detail.value });
  },

  handleSearch() {
    this.setData({ page: 1, dishes: [], hasMore: true });
    this.loadDishes();
  },

  clearSearch() {
    this.setData({ keyword: "", page: 1, dishes: [], hasMore: true });
    this.loadDishes();
  },

  async loadDishes() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getDishes",
          keyword: this.data.keyword,
          page: this.data.page,
          pageSize: this.data.pageSize,
        },
      });

      if (res.result.success) {
        const { list, total } = res.result.data;
        const dishes = this.data.page === 1 ? list : [...this.data.dishes, ...list];
        this.setData({
          dishes,
          total,
          hasMore: dishes.length < total,
        });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.setData({ page: this.data.page + 1 });
      this.loadDishes();
    }
  },

  goAddDish() {
    wx.navigateTo({ url: "/pages/dishEdit/dishEdit" });
  },

  goEditDish(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/dishEdit/dishEdit?id=${id}` });
  },

  deleteDish(e) {
    const { id, image } = e.currentTarget.dataset;
    wx.showModal({
      title: "确认删除",
      content: "删除后不可恢复，确定要删除吗？",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "删除中..." });
          try {
            const result = await wx.cloud.callFunction({
              name: "quickstartFunctions",
              data: {
                type: "deleteDish",
                dishId: id,
                imageFileID: image,
              },
            });
            if (result.result.success) {
              wx.showToast({ title: "删除成功", icon: "success" });
              this.setData({ page: 1, dishes: [], hasMore: true });
              this.loadDishes();
            } else {
              wx.showToast({ title: "删除失败", icon: "none" });
            }
          } catch (e) {
            wx.showToast({ title: "删除失败", icon: "none" });
          } finally {
            wx.hideLoading();
          }
        }
      },
    });
  },
});
