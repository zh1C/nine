// components/dishPicker/dishPicker.js
Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    excludeIds: {
      type: Array,
      value: [],
    },
  },

  data: {
    dishes: [],
    keyword: "",
    loading: false,
    visible: false, // 控制动画显隐
  },

  observers: {
    show(val) {
      if (val) {
        this.setData({ visible: true });
        this.loadDishes();
      } else {
        // 延迟隐藏，等动画结束
        setTimeout(() => {
          this.setData({ visible: false });
        }, 200);
      }
    },
  },

  methods: {
    onInputSearch(e) {
      this.setData({ keyword: e.detail.value });
      this.loadDishes();
    },

    handleSearch() {
      this.loadDishes();
    },

    async loadDishes() {
      this.setData({ loading: true });
      try {
        const res = await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "getDishes",
            keyword: this.data.keyword,
            page: 1,
            pageSize: 200,
          },
        });
        if (res.result.success) {
          this._allDishes = res.result.data.list;
          this.filterDishes();
        }
      } catch (e) {
        console.error(e);
      } finally {
        this.setData({ loading: false });
      }
    },

    filterDishes() {
      const excludeIds = this.properties.excludeIds || [];
      const allDishes = this._allDishes || [];
      const dishes = allDishes.filter((d) => excludeIds.indexOf(d._id) === -1);
      this.setData({ dishes });
    },

    handleAdd(e) {
      const idx = e.currentTarget.dataset.idx;
      const dish = this.data.dishes[idx];
      if (!dish) return;
      // 触发 add 事件
      this.triggerEvent("add", { dish });
      // 从当前列表中移除该菜品（即时反馈）
      const dishes = this.data.dishes.filter((_, i) => i !== idx);
      this.setData({ dishes });
    },

    handleClose() {
      this.triggerEvent("close");
    },

    preventBubble() {
      // 阻止冒泡
    },
  },
});
