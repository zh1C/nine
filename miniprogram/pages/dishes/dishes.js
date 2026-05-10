// pages/dishes/dishes.js
const app = getApp();

Page({
  data: {
    dishes: [],
    keyword: "",
    loading: false,
    page: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
    activeTab: 0, // 0=学生, 1=老师
    currentCategory: "student", // "student" | "teacher"
  },

  onLoad() {
    this.checkPermission();
  },

  // 权限校验：仅管理员可访问
  checkPermission() {
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
    // 首次加载，完成后清除标记
    app.globalData.dishListNeedRefresh = false;
    this.loadDishes();
  },

  onShow() {
    // 仅在数据发生变更时才刷新列表（新增/编辑/删除后），查看详情返回不刷新
    if (app.globalData.dishListNeedRefresh) {
      app.globalData.dishListNeedRefresh = false;
      this.setData({ page: 1, dishes: [], hasMore: true });
      this.loadDishes();
    }
  },

  // 切换学生/老师 Tab
  switchTab(e) {
    const tab = parseInt(e.currentTarget.dataset.tab);
    const category = tab === 0 ? "student" : "teacher";
    this.setData({ activeTab: tab, currentCategory: category, page: 1, dishes: [], hasMore: true });
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
          category: this.data.currentCategory,
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
    wx.navigateTo({ url: `/pages/dishEdit/dishEdit?category=${this.data.currentCategory}` });
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
