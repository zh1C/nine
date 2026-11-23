// components/dishPicker/dishPicker.js
Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: "添加菜品",
    },
    selectedDishes: {
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
    hasQuery: false,
    queryVersion: 0,
    keyboardMaxHeight: null,
    reviewingSelected: false,
    selectedPreview: "",
  },

  observers: {
    show(show) {
      if (show) {
        this._fullHeight = wx.getWindowInfo().windowHeight;
        this.setData({
          keyword: "", hasQuery: false, queryVersion: 0, keyboardMaxHeight: null,
          reviewingSelected: false,
        });
        this.refreshDishes();
      }
    },
    "selectedDishes, allDishes"() {
      if (this.properties.show) this.refreshDishes();
    },
  },

  methods: {
    onBackgroundTap(e) {
      if (e.target.id !== "dish-search-input") wx.hideKeyboard();
    },

    measureBeforeTyping() {
      // 再次点搜索框时，窗口可能已从上一次收键盘或分屏操作中恢复。
      if (this.data.keyboardMaxHeight === null) this._fullHeight = wx.getWindowInfo().windowHeight;
    },

    onInputSearch(e) {
      const keyword = e.detail.value;
      if (keyword === this.data.keyword) return;
      this.setData({
        keyword,
        hasQuery: !!keyword.trim(),
        dishes: this.matchingDishes(keyword),
        // 新关键词定位到列表顶部；连续添加时保留列表位置。
        queryVersion: this.data.queryVersion + 1,
      });
    },

    onKeyboardHeightChange(e) {
      if (!this.properties.show || this.data.reviewingSelected) return;
      const height = e.detail.height;
      // 以打开前的可用高度计算上限；若系统已缩小视口，固定面板自然取两者中较小的高度。
      this.setData({ keyboardMaxHeight: height > 0 ? Math.max(0, this._fullHeight - height) : null });
    },

    matchingDishes(keyword) {
      const { allDishes, selectedDishes } = this.properties;
      const query = keyword.trim().toLowerCase();
      const excluded = new Set(selectedDishes.map(dish => dish._id));
      return allDishes.filter(d => !excluded.has(d._id) && d.name.toLowerCase().includes(query));
    },

    refreshDishes() {
      const names = this.properties.selectedDishes.map(dish => dish.name);
      this.setData({
        selectedPreview: names.reverse().join(" · "),
        dishes: this.matchingDishes(this.data.keyword),
      });
    },

    toggleSelectionView() {
      const reviewingSelected = !this.data.reviewingSelected;
      if (reviewingSelected) wx.hideKeyboard();
      this.setData({ reviewingSelected, keyboardMaxHeight: null });
    },

    handleRemove(e) {
      this.triggerEvent("remove", { id: e.currentTarget.dataset.id });
    },

    handleAdd(e) {
      const id = e.currentTarget.dataset.id;
      const dish = this.data.dishes.find(d => d._id === id);
      if (!dish) return;
      // 从当前列表中移除该菜品（即时反馈）
      const dishes = this.data.dishes.filter(d => d._id !== id);
      this.setData({ dishes });
      // 触发 add 事件（放在 setData 之后，避免 observer 覆盖本地列表）
      this.triggerEvent("add", { dish });
    },

    handleClose() {
      if (this.data.keyboardMaxHeight !== null) wx.hideKeyboard();
      this.triggerEvent("close");
    },
  },
});
