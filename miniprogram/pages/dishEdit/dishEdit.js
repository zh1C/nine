// pages/dishEdit/dishEdit.js
Page({
  data: {
    dishId: "",
    isEdit: false,
    name: "",
    imageFileID: "",
    imageTempPath: "",
    ingredients: [],
    gardens: [],
    unitOptions: ["kg", "g", "个", "ml", "L", "根", "片", "块", "勺"],
    typeOptions: ["肉类", "蔬菜"],
    category: "student", // "student" | "teacher"
    loading: false,
  },

  onLoad(options) {
    // 权限校验：仅管理员可编辑菜品
    const app = getApp();
    const userInfo = app.globalData.userInfo;
    if (!userInfo || userInfo.role !== "admin") {
      wx.showModal({
        title: "无权限",
        content: "仅管理员可以编辑菜品",
        showCancel: false,
        success: () => {
          wx.navigateBack();
        },
      });
      return;
    }

    if (options.id) {
      this.setData({ dishId: options.id, isEdit: true });
      wx.setNavigationBarTitle({ title: "编辑菜品" });
      this.loadData(options.id);
    } else {
      wx.setNavigationBarTitle({ title: "新增菜品" });
      this.setData({
        ingredients: [{ name: "", unit: "kg", type: "蔬菜", advance: false }],
        category: options.category || "student",
      });
      this.loadGardens();
    }
  },

  // 加载园区列表
  async loadGardens(dishRatios) {
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getGardens",
          operatorUsername: app.globalData.userInfo.username,
        },
      });

      if (res.result.success) {
        const gardenList = res.result.data.list;
        const ingredientCount = this.data.ingredients.length;
        const gardens = gardenList.map((g, idx) => {
          const key = String(g.gardenId);
          let ratios = [];
          if (dishRatios && dishRatios[key]) {
            ratios = dishRatios[key].map((v) => (v !== null && v !== undefined ? String(v) : ""));
          }
          // 确保比例数组长度与配料数一致
          while (ratios.length < ingredientCount) {
            ratios.push("");
          }
          const filled = ratios.some((r) => r !== "" && r !== "0");
          return {
            gardenId: g.gardenId,
            name: g.name,
            expanded: idx === 0,
            filled,
            ratios,
          };
        });
        this.setData({ gardens });
      }
    } catch (e) {
      console.error("加载园区失败", e);
    }
  },

  // 编辑模式：同时加载菜品详情和园区
  async loadData(id) {
    wx.showLoading({ title: "加载中..." });
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: { type: "getDishDetail", dishId: id },
      });
      if (res.result.success) {
        const dish = res.result.data;
        const ingredients =
          dish.ingredients && dish.ingredients.length > 0
            ? dish.ingredients.map((i) => ({
                name: i.name || "",
                unit: i.unit || "kg",
                type: i.type || "蔬菜",
                advance: i.advance || false,
              }))
            : [{ name: "", unit: "kg", type: "蔬菜", advance: false }];

        this.setData({ name: dish.name, imageFileID: dish.imageFileID || "", ingredients, category: dish.category || "student" });
        await this.loadGardens(dish.ratios || {});
      }
    } catch (e) {
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  // ========== 菜品名称 ==========
  onInputName(e) {
    this.setData({ name: e.detail.value });
  },

  // ========== 菜品类型 ==========
  onSelectCategory(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ category: value });
  },

  // ========== 配料操作 ==========
  onInputIngredientName(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `ingredients[${idx}].name`;
    this.setData({ [key]: e.detail.value });
  },

  onPickerChange(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `ingredients[${idx}].unit`;
    this.setData({ [key]: this.data.unitOptions[e.detail.value] });
  },

  onTypePickerChange(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `ingredients[${idx}].type`;
    this.setData({ [key]: this.data.typeOptions[e.detail.value] });
  },

  toggleAdvance(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `ingredients[${idx}].advance`;
    this.setData({ [key]: !this.data.ingredients[idx].advance });
  },

  addIngredient() {
    const ingredients = [...this.data.ingredients, { name: "", unit: "kg", type: "蔬菜", advance: false }];
    // 所有园区比例数组同步新增一个空位
    const gardens = this.data.gardens.map((g) => ({
      ...g,
      ratios: [...g.ratios, ""],
    }));
    this.setData({ ingredients, gardens });
  },

  removeIngredient(e) {
    const idx = e.currentTarget.dataset.idx;
    if (this.data.ingredients.length <= 1) {
      wx.showToast({ title: "至少需要一个配料", icon: "none" });
      return;
    }
    const ingredients = this.data.ingredients.filter((_, i) => i !== idx);
    // 所有园区比例数组同步移除对应位置
    const gardens = this.data.gardens.map((g) => {
      const ratios = g.ratios.filter((_, i) => i !== idx);
      const filled = ratios.some((r) => r !== "" && r !== "0");
      return { ...g, ratios, filled };
    });
    this.setData({ ingredients, gardens });
  },

  // ========== 园区比例操作 ==========
  toggleGarden(e) {
    const idx = e.currentTarget.dataset.idx;
    const key = `gardens[${idx}].expanded`;
    this.setData({ [key]: !this.data.gardens[idx].expanded });
  },

  onInputRatio(e) {
    const { gardenIdx, ingIdx } = e.currentTarget.dataset;
    const key = `gardens[${gardenIdx}].ratios[${ingIdx}]`;
    this.setData({ [key]: e.detail.value });
    // 更新 filled 状态
    const garden = this.data.gardens[gardenIdx];
    const ratios = [...garden.ratios];
    ratios[ingIdx] = e.detail.value;
    const filled = ratios.some((r) => r !== "" && r !== "0");
    this.setData({ [`gardens[${gardenIdx}].filled`]: filled });
  },

  // ========== 图片 ==========
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

  // ========== 保存 ==========
  async handleSave() {
    const { name, ingredients, gardens, isEdit, dishId } = this.data;

    // 校验菜品名称
    if (!name.trim()) {
      wx.showToast({ title: "请输入菜品名称", icon: "none" });
      return;
    }

    // 校验配料
    const validIngredients = ingredients.filter((item) => item.name.trim());
    if (validIngredients.length === 0) {
      wx.showToast({ title: "请至少添加一个配料", icon: "none" });
      return;
    }

    // 构建 ratios：只保存已填写的园区
    const ratios = {};
    for (const garden of gardens) {
      const hasAnyValue = garden.ratios.some(
        (r) => r !== "" && r !== null && r !== undefined
      );
      if (!hasAnyValue) {
        continue; // 全空跳过，不写入
      }
      // 有填写则校验完整性
      for (let i = 0; i < validIngredients.length; i++) {
        const r = garden.ratios[i];
        if (r === "" || r === null || r === undefined || isNaN(parseFloat(r)) || parseFloat(r) <= 0) {
          wx.showToast({
            title: `「${garden.name}」的「${validIngredients[i].name}」比例未填写或无效`,
            icon: "none",
          });
          return;
        }
      }
      ratios[String(garden.gardenId)] = garden.ratios
        .slice(0, validIngredients.length)
        .map((r) => parseFloat(r));
    }

    // 处理配料数据
    const processedIngredients = validIngredients.map((item) => ({
      name: item.name.trim(),
      unit: item.unit,
      type: item.type || "蔬菜",
      advance: item.advance || false,
    }));

    this.setData({ loading: true });
    wx.showLoading({ title: "保存中..." });

    try {
      const imageFileID = await this.uploadImage();

      if (isEdit) {
        await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "updateDish",
            dishId,
            name: name.trim(),
            imageFileID,
            ingredients: processedIngredients,
            ratios,
            category: this.data.category,
          },
        });
      } else {
        await wx.cloud.callFunction({
          name: "quickstartFunctions",
          data: {
            type: "addDish",
            name: name.trim(),
            imageFileID,
            ingredients: processedIngredients,
            ratios,
            category: this.data.category,
          },
        });
      }

      // 标记列表需要刷新
      getApp().globalData.dishListNeedRefresh = true;
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
