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
    checkedCount: 0,
  },

  observers: {
    show(val) {
      if (val) {
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
          const selectedIds = this.properties.selectedIds || [];
          // 给每个 dish 添加 checked 字段
          const dishes = res.result.data.list.map((item) => ({
            ...item,
            checked: selectedIds.indexOf(item._id) > -1,
          }));
          this.setData({
            dishes,
            checkedCount: dishes.filter((d) => d.checked).length,
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        this.setData({ loading: false });
      }
    },

    toggleCheck(e) {
      const idx = e.currentTarget.dataset.idx;
      const key = `dishes[${idx}].checked`;
      const checked = !this.data.dishes[idx].checked;
      const checkedCount = this.data.checkedCount + (checked ? 1 : -1);
      this.setData({
        [key]: checked,
        checkedCount,
      });
    },

    handleConfirm() {
      const selectedDishes = this.data.dishes.filter((d) => d.checked);
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
