// pages/result/result.js
Page({
  data: {
    gardenName: "",
    items: [],
    result: [],
    date: "",
    saving: false,
    generating: false,
    tempImagePath: "",
  },

  onLoad() {
    const app = getApp();
    const data = app.globalData.calculateResult;
    if (!data) {
      wx.showToast({ title: "数据异常", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    this.setData({
      gardenName: data.gardenName,
      items: data.items,
      result: data.result,
      date,
    });
  },

  async generateImage() {
    this.setData({ generating: true });
    wx.showLoading({ title: "生成图片中..." });

    try {
      const { gardenName, items, result, date } = this.data;

      // 计算canvas尺寸
      const padding = 40;
      const headerHeight = 140;
      const rowHeight = 50;
      const tableHeaderHeight = 60;
      const sectionGap = 40;

      const resultRows = result.length;
      const itemRows = items.length;
      const totalHeight =
        padding * 2 +
        headerHeight +
        tableHeaderHeight +
        resultRows * rowHeight +
        sectionGap +
        tableHeaderHeight +
        itemRows * rowHeight +
        60;
      const canvasWidth = 600;
      const canvasHeight = Math.max(totalHeight, 400);

      // 使用离屏Canvas
      const query = this.createSelectorQuery();
      query
        .select("#resultCanvas")
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0]) {
            // 降级方案：使用旧版canvas API
            this.generateImageLegacy(canvasWidth, canvasHeight);
            return;
          }

          const canvas = res[0].node;
          const ctx = canvas.getContext("2d");
          const dpr = wx.getWindowInfo().pixelRatio;

          canvas.width = canvasWidth * dpr;
          canvas.height = canvasHeight * dpr;
          ctx.scale(dpr, dpr);

          // 绘制背景
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);

          // 绘制标题区域
          ctx.fillStyle = "#4CAF50";
          ctx.fillRect(0, 0, canvasWidth, 100);

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 28px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`🏫 ${gardenName}`, canvasWidth / 2, 40);

          ctx.font = "16px sans-serif";
          ctx.fillText(`📅 ${date}`, canvasWidth / 2, 70);

          // 配料汇总标题
          let y = 130;
          ctx.fillStyle = "#333333";
          ctx.font = "bold 20px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("📋 配料汇总", padding, y);
          y += 35;

          // 表头
          ctx.fillStyle = "#f5f5f5";
          ctx.fillRect(padding, y, canvasWidth - padding * 2, tableHeaderHeight);
          ctx.fillStyle = "#666666";
          ctx.font = "14px sans-serif";
          ctx.fillText("配料名称", padding + 16, y + 36);
          ctx.fillText("总量", 320, y + 36);
          ctx.fillText("单位", 460, y + 36);
          y += tableHeaderHeight;

          // 配料数据行
          ctx.font = "15px sans-serif";
          result.forEach((item, index) => {
            if (index % 2 === 0) {
              ctx.fillStyle = "#fafafa";
              ctx.fillRect(padding, y, canvasWidth - padding * 2, rowHeight);
            }
            ctx.fillStyle = "#333333";
            ctx.fillText(item.name, padding + 16, y + 32);
            ctx.fillStyle = "#FF9800";
            ctx.font = "bold 15px sans-serif";
            ctx.fillText(String(item.total), 320, y + 32);
            ctx.fillStyle = "#666666";
            ctx.font = "15px sans-serif";
            ctx.fillText(item.unit, 460, y + 32);
            y += rowHeight;
          });

          // 菜品明细
          y += sectionGap;
          ctx.fillStyle = "#333333";
          ctx.font = "bold 20px sans-serif";
          ctx.fillText("🍽️ 菜品明细", padding, y);
          y += 35;

          ctx.font = "15px sans-serif";
          items.forEach((item) => {
            ctx.fillStyle = "#333333";
            ctx.fillText(`· ${item.dishName}`, padding + 16, y + 28);
            ctx.fillStyle = "#4CAF50";
            ctx.fillText(`${item.quantity} kg`, 400, y + 28);
            y += rowHeight;
          });

          // 导出图片
          wx.canvasToTempFilePath({
            canvas,
            x: 0,
            y: 0,
            width: canvasWidth * dpr,
            height: canvasHeight * dpr,
            destWidth: canvasWidth * 2,
            destHeight: canvasHeight * 2,
            fileType: "png",
            success: (res) => {
              this.setData({ tempImagePath: res.tempFilePath, generating: false });
              wx.hideLoading();
              wx.showToast({ title: "图片生成成功", icon: "success" });
            },
            fail: (err) => {
              console.error(err);
              this.setData({ generating: false });
              wx.hideLoading();
              wx.showToast({ title: "生成失败", icon: "none" });
            },
          });
        });
    } catch (e) {
      console.error(e);
      this.setData({ generating: false });
      wx.hideLoading();
      wx.showToast({ title: "生成失败", icon: "none" });
    }
  },

  // 降级方案 - 旧版canvas API
  generateImageLegacy(canvasWidth, canvasHeight) {
    const { gardenName, items, result, date } = this.data;
    const ctx = wx.createCanvasContext("resultCanvasLegacy", this);
    const padding = 40;
    const rowHeight = 50;
    const tableHeaderHeight = 60;
    const sectionGap = 40;

    // 绘制背景
    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 绘制标题区域
    ctx.setFillStyle("#4CAF50");
    ctx.fillRect(0, 0, canvasWidth, 100);

    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(28);
    ctx.setTextAlign("center");
    ctx.fillText(`${gardenName}`, canvasWidth / 2, 45);

    ctx.setFontSize(16);
    ctx.fillText(`${date}`, canvasWidth / 2, 75);

    // 配料汇总标题
    let y = 130;
    ctx.setFillStyle("#333333");
    ctx.setFontSize(20);
    ctx.setTextAlign("left");
    ctx.fillText("配料汇总", padding, y);
    y += 35;

    // 表头
    ctx.setFillStyle("#f5f5f5");
    ctx.fillRect(padding, y, canvasWidth - padding * 2, tableHeaderHeight);
    ctx.setFillStyle("#666666");
    ctx.setFontSize(14);
    ctx.fillText("配料名称", padding + 16, y + 36);
    ctx.fillText("总量", 320, y + 36);
    ctx.fillText("单位", 460, y + 36);
    y += tableHeaderHeight;

    // 配料数据行
    ctx.setFontSize(15);
    result.forEach((item, index) => {
      if (index % 2 === 0) {
        ctx.setFillStyle("#fafafa");
        ctx.fillRect(padding, y, canvasWidth - padding * 2, rowHeight);
      }
      ctx.setFillStyle("#333333");
      ctx.fillText(item.name, padding + 16, y + 32);
      ctx.setFillStyle("#FF9800");
      ctx.fillText(String(item.total), 320, y + 32);
      ctx.setFillStyle("#666666");
      ctx.fillText(item.unit, 460, y + 32);
      y += rowHeight;
    });

    // 菜品明细
    y += sectionGap;
    ctx.setFillStyle("#333333");
    ctx.setFontSize(20);
    ctx.fillText("菜品明细", padding, y);
    y += 35;

    ctx.setFontSize(15);
    items.forEach((item) => {
      ctx.setFillStyle("#333333");
      ctx.fillText(`· ${item.dishName}`, padding + 16, y + 28);
      ctx.setFillStyle("#4CAF50");
      ctx.fillText(`${item.quantity} kg`, 400, y + 28);
      y += rowHeight;
    });

    ctx.draw(false, () => {
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvasId: "resultCanvasLegacy",
          x: 0,
          y: 0,
          width: canvasWidth,
          height: canvasHeight,
          destWidth: canvasWidth * 2,
          destHeight: canvasHeight * 2,
          fileType: "png",
          success: (res) => {
            this.setData({ tempImagePath: res.tempFilePath, generating: false });
            wx.hideLoading();
            wx.showToast({ title: "图片生成成功", icon: "success" });
          },
          fail: (err) => {
            console.error(err);
            this.setData({ generating: false });
            wx.hideLoading();
            wx.showToast({ title: "生成失败", icon: "none" });
          },
        }, this);
      }, 500);
    });
  },

  async saveToAlbum() {
    if (!this.data.tempImagePath) {
      wx.showToast({ title: "请先生成图片", icon: "none" });
      return;
    }

    try {
      await wx.saveImageToPhotosAlbum({
        filePath: this.data.tempImagePath,
      });
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (e) {
      if (e.errMsg.indexOf("auth deny") > -1) {
        wx.showModal({
          title: "提示",
          content: "需要授权保存图片到相册",
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          },
        });
      } else {
        wx.showToast({ title: "保存失败", icon: "none" });
      }
    }
  },

  async saveRecord() {
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中..." });

    try {
      const { gardenName, items, result, tempImagePath } = this.data;
      let resultImageFileID = "";

      // 如果有图片，上传到云存储
      if (tempImagePath) {
        const timestamp = Date.now();
        const cloudPath = `results/${timestamp}_${Math.random().toString(36).substr(2, 8)}.png`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath: tempImagePath,
        });
        resultImageFileID = uploadRes.fileID;
      }

      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "saveRecord",
          gardenName,
          items,
          result,
          resultImageFileID,
        },
      });

      if (res.result.success) {
        wx.showToast({ title: "保存成功", icon: "success" });
      } else {
        wx.showToast({ title: "保存失败", icon: "none" });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
      wx.hideLoading();
    }
  },

  previewImage() {
    if (this.data.tempImagePath) {
      wx.previewImage({
        urls: [this.data.tempImagePath],
      });
    }
  },
});
