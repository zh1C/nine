// pages/calculate/calculate.js
Page({
  data: {
    gardenName: "",
    selectedDishes: [], // { _id, name, imageFileID, ingredients, quantity }
    showPicker: false,
    selectedIds: [],
  },

  onLoad() {},

  onInputGardenName(e) {
    this.setData({ gardenName: e.detail.value });
  },

  showDishPicker() {
    this.setData({
      showPicker: true,
      selectedIds: this.data.selectedDishes.map((d) => d._id),
    });
  },

  onPickerClose() {
    this.setData({ showPicker: false });
  },

  onPickerConfirm(e) {
    const dishes = e.detail.dishes;
    // 合并已有的quantity
    const existMap = {};
    this.data.selectedDishes.forEach((d) => {
      existMap[d._id] = d.quantity;
    });

    const selectedDishes = dishes.map((d) => ({
      _id: d._id,
      name: d.name,
      imageFileID: d.imageFileID,
      ingredients: d.ingredients,
      quantity: existMap[d._id] || "",
    }));

    this.setData({
      selectedDishes,
      showPicker: false,
    });
  },

  onInputQuantity(e) {
    const idx = e.currentTarget.dataset.idx;
    const selectedDishes = this.data.selectedDishes;
    selectedDishes[idx].quantity = e.detail.value;
    this.setData({ selectedDishes });
  },

  removeDish(e) {
    const idx = e.currentTarget.dataset.idx;
    const selectedDishes = this.data.selectedDishes;
    selectedDishes.splice(idx, 1);
    this.setData({ selectedDishes });
  },

  handleCalculate() {
    const { gardenName, selectedDishes } = this.data;

    if (!gardenName.trim()) {
      wx.showToast({ title: "请输入园区名称", icon: "none" });
      return;
    }

    if (selectedDishes.length === 0) {
      wx.showToast({ title: "请选择菜品", icon: "none" });
      return;
    }

    // 验证所有菜品都输入了量
    for (const dish of selectedDishes) {
      if (!dish.quantity || parseFloat(dish.quantity) <= 0) {
        wx.showToast({ title: `请输入${dish.name}的需求量`, icon: "none" });
        return;
      }
    }

    // 计算配料总量
    const ingredientMap = {}; // { name: { total, unit } }

    selectedDishes.forEach((dish) => {
      const quantity = parseFloat(dish.quantity);
      dish.ingredients.forEach((ing) => {
        const key = `${ing.name}_${ing.unit}`;
        if (!ingredientMap[key]) {
          ingredientMap[key] = { name: ing.name, total: 0, unit: ing.unit };
        }
        ingredientMap[key].total += quantity * ing.ratio;
      });
    });

    const result = Object.values(ingredientMap).map((item) => ({
      name: item.name,
      total: Math.round(item.total * 1000) / 1000, // 保留3位小数
      unit: item.unit,
    }));

    // 准备传递到结果页的数据
    const items = selectedDishes.map((d) => ({
      dishId: d._id,
      dishName: d.name,
      quantity: parseFloat(d.quantity),
    }));

    // 存储数据到全局，通过页面传递
    const app = getApp();
    app.globalData.calculateResult = {
      gardenName: gardenName.trim(),
      items,
      result,
    };

    wx.navigateTo({ url: "/pages/result/result" });
  },
});
