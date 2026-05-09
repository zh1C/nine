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
    allDishes: {
      type: Array,
      value: [],
    },
  },

  data: {
    dishes: [],
    keyword: "",
    visible: false, // 控制动画显隐
  },

  observers: {
    "show, excludeIds, allDishes"(show) {
      if (show) {
        this.setData({ visible: true, keyword: "" });
        this.filterDishes();
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
      this.filterDishes();
    },

    handleSearch() {
      this.filterDishes();
    },

    filterDishes() {
      const excludeIds = this.properties.excludeIds || [];
      const allDishes = this.properties.allDishes || [];
      const keyword = this.data.keyword.trim().toLowerCase();
      let dishes = allDishes.filter((d) => excludeIds.indexOf(d._id) === -1);
      if (keyword) {
        dishes = dishes.filter((d) => d.name.toLowerCase().indexOf(keyword) > -1);
      }
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
