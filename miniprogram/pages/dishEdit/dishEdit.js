// pages/dishEdit/dishEdit.js
Page({
  data: {
    dishId: "",
    isEdit: false,
    name: "",
    imageFileID: "",
    imageTempPath: "",
    ingredients: [],
    loading: false,
    unitOptions: ["kg", "g", "个", "ml", "L", "根", "片", "块", "勺"],
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ dishId: options.id, isEdit: true });
      wx.setNavigationBarTitle({ title: "编辑菜品" });
      this.loadDishDetail(options.id);
    } else {
      wx.setNavigationBarTitle({ title: "新增菜品" });
      // 默认添加一个空配料
      this.setData({
        ingredients: [{ name: "", ratio: "", unit: "kg" }],
      });
    }
  },

  async loadDishDetail(id) {
    wx.showLoading({ title: "加载中..." });
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type: "getDishDetail", dishId: id },
      });
      if (res.result.success) {
        const dish = res.result.data;
        this.setData({
          name: dish.name,
          imageFileID: dish.imageFileID || "",
          ingredients: dish.ingredients.length > 0 ? dish.ingredients : [{ name: "", ratio: "", unit: "kg" }],
        });
      }
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  onInputName(e) {
    this.setData({ name: e.detail.value });
  },

  onInputIngredientName(e) {
    const idx = e.currentTarget.dataset.idx;
    const ingredients = this.data.ingredients;
    ingredients[idx].name = e.detail.value;
    this.setData({ ingredients });
  },

  onInputIngredientRatio(e) {
    const idx = e.currentTarget.dataset.idx;
    const ingredients = this.data.ingredients;
    ingredients[idx].ratio = e.detail.value;
    this.setData({ ingredients });
  },

  onPickerChange(e) {
    const idx = e.currentTarget.dataset.idx;
    const ingredients = this.data.ingredients;
    ingredients[idx].unit = this.data.unitOptions[e.detail.value];
    this.setData({ ingredients });
  },

  addIngredient() {
    const ingredients = this.data.ingredients;
    ingredients.push({ name: "", ratio: "", unit: "kg" });
    this.setData({ ingredients });
  },

  removeIngredient(e) {
    const idx = e.currentTarget.dataset.idx;
    const ingredients = this.data.ingredients;
    if (ingredients.length <= 1) {
      wx.showToast({ title: "至少需要一个配料", icon: "none" });
      return;
    }
    ingredients.splice(idx, 1);
    this.setData({ ingredients });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.setData({ imageTempPath: tempFilePath });
      },
    });
  },

  async uploadImage() {
    if (!this.data.imageTempPath) return this.data.imageFileID;

    const timestamp = Date.now();
    const cloudPath = `dishes/${timestamp}_${Math.random().toString(36).substr(2, 8)}.jpg`;
    const uploadRes = await wx.cloud.uploadFile({
      cloudPath,
      filePath: this.data.imageTempPath,
    });
    return uploadRes.fileID;
  },

  async handleSave() {
    const { name, ingredients, isEdit, dishId } = this.data;

    if (!name.trim()) {
      wx.showToast({ title: "请输入菜品名称", icon: "none" });
      return;
    }

    // 验证配料
    const validIngredients = ingredients.filter(
      (item) => item.name.trim() && item.ratio
    );
    if (validIngredients.length === 0) {
      wx.showToast({ title: "请至少添加一个配料", icon: "none" });
      return;
    }

    // 转换比例为数字
    const processedIngredients = validIngredients.map((item) => ({
      name: item.name.trim(),
      ratio: parseFloat(item.ratio),
      unit: item.unit,
    }));

    // 验证比例值
    for (const item of processedIngredients) {
      if (isNaN(item.ratio) || item.ratio <= 0) {
        wx.showToast({ title: `${item.name}的比例无效`, icon: "none" });
        return;
      }
    }

    this.setData({ loading: true });
    wx.showLoading({ title: "保存中..." });

    try {
      // 上传图片
      const imageFileID = await this.uploadImage();

      if (isEdit) {
        // 更新菜品
        await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "updateDish",
            dishId,
            name: name.trim(),
            imageFileID,
            ingredients: processedIngredients,
          },
        });
      } else {
        // 新增菜品
        await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "addDish",
            name: name.trim(),
            imageFileID,
            ingredients: processedIngredients,
          },
        });
      }

      wx.showToast({ title: "保存成功", icon: "success" });
      setTimeout(() => {
        wx.navigateBack();
      }, 1000);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },
});
