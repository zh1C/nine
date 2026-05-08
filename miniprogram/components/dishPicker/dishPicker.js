// components/dishPicker/dishPicker.js
Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    selectedIds: {
      type: Array,
      value: [],
    },
  },

  data: {
    dishes: [],
    keyword: "",
    loading: false,
    checkedIds: [],
  },

  observers: {
    show(val) {
      if (val) {
        this.setData({ checkedIds: [...this.properties.selectedIds] });
        this.loadDishes();
      }
    },
  },

  methods: {
    onInputSearch(e) {
      this.setData({ keyword: e.detail.value });
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
            pageSize: 100,
          },
        });
        if (res.result.success) {
          this.setData({ dishes: res.result.data.list });
        }
      } catch (e) {
        console.error(e);
      } finally {
        this.setData({ loading: false });
      }
    },

    toggleCheck(e) {
      const id = e.currentTarget.dataset.id;
      const checkedIds = [...this.data.checkedIds];
      const index = checkedIds.indexOf(id);
      if (index > -1) {
        checkedIds.splice(index, 1);
      } else {
        checkedIds.push(id);
      }
      this.setData({ checkedIds });
    },

    handleConfirm() {
      const selectedDishes = this.data.dishes.filter(
        (d) => this.data.checkedIds.includes(d._id)
      );
      this.triggerEvent("confirm", { dishes: selectedDishes });
    },

    handleClose() {
      this.triggerEvent("close");
    },

    preventBubble() {
      // 阻止冒泡
    },
  },
});
