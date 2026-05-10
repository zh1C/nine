// pages/result/result.js
Page({
  data: {
    tables: [], // 每天一个配料表
    summary: {}, // 菜品下单汇总
    gardens: [], // 园区列表
    selectedDates: [],
    saving: false,
    saved: false, // 是否已保存到云端
    fromHistory: false, // 是否从历史记录查看
    generatingIdx: -1, // 当前正在生成图片的表格索引, -1=无
  },

  onLoad(options) {
    const app = getApp();
    const data = app.globalData.calculateResult;
    if (!data) {
      wx.showToast({ title: "数据异常", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({
      tables: data.tables,
      summary: data.summary,
      gardens: data.gardens,
      selectedDates: data.selectedDates,
      fromHistory: options.from === "history",
    });

    // 保存原始数据用于存云数据库
    this._rawData = data;
  },

  // ========== 生成单个表格图片 ==========
  generateTableImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const type = e.currentTarget.dataset.type; // 'daily' 或 'summary'

    if (type === "daily") {
      this.generateDailyTableImage(idx);
    } else {
      this.generateSummaryImage();
    }
  },

  generateDailyTableImage(tableIdx) {
    const table = this.data.tables[tableIdx];
    const gardens = this.data.gardens;
    if (!table) return;

    this.setData({ generatingIdx: tableIdx });
    wx.showLoading({ title: "生成图片中..." });

    const padding = 30;
    const rowHeight = 44;
    const headerHeight = 80;
    const tableHeaderHeight = 44;
    const colNameWidth = 120;
    const colGardenWidth = 80;
    const colUnitWidth = 60;
    const canvasWidth = Math.max(colNameWidth + gardens.length * colGardenWidth + colUnitWidth + padding * 2, 600);
    const canvasHeight = headerHeight + tableHeaderHeight + table.rows.length * rowHeight + padding * 2 + 20;

    const query = this.createSelectorQuery();
    query.select("#resultCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res[0]) {
        this.generateDailyImageLegacy(tableIdx, canvasWidth, canvasHeight);
        return;
      }

      const canvas = res[0].node;
      const ctx = canvas.getContext("2d");
      const dpr = wx.getWindowInfo().pixelRatio;

      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      ctx.scale(dpr, dpr);

      // 背景
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 标题
      ctx.fillStyle = "#4CAF50";
      ctx.fillRect(0, 0, canvasWidth, headerHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`📋 ${table.dateLabel} 配料清单`, canvasWidth / 2, headerHeight / 2 + 8);

      let y = headerHeight + 10;

      // 表头
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(padding, y, canvasWidth - padding * 2, tableHeaderHeight);
      ctx.fillStyle = "#666666";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("配料", padding + 8, y + 28);

      ctx.textAlign = "center";
      gardens.forEach((g, gIdx) => {
        const x = padding + colNameWidth + gIdx * colGardenWidth + colGardenWidth / 2;
        ctx.fillText(g.name, x, y + 28);
      });

      const unitX = padding + colNameWidth + gardens.length * colGardenWidth + colUnitWidth / 2;
      ctx.fillText("单位", unitX, y + 28);
      y += tableHeaderHeight;

      // 数据行
      ctx.font = "13px sans-serif";
      table.rows.forEach((row, rIdx) => {
        if (rIdx % 2 === 0) {
          ctx.fillStyle = "#fafafa";
          ctx.fillRect(padding, y, canvasWidth - padding * 2, rowHeight);
        }

        ctx.fillStyle = "#333333";
        ctx.textAlign = "left";
        ctx.fillText(row.name, padding + 8, y + 28);

        ctx.textAlign = "center";
        gardens.forEach((g, gIdx) => {
          const x = padding + colNameWidth + gIdx * colGardenWidth + colGardenWidth / 2;
          const val = row.amounts[g.gardenId] || 0;
          ctx.fillStyle = val > 0 ? "#FF9800" : "#ccc";
          ctx.font = val > 0 ? "bold 13px sans-serif" : "13px sans-serif";
          ctx.fillText(val > 0 ? String(val) : "0", x, y + 28);
        });

        ctx.fillStyle = "#666666";
        ctx.font = "13px sans-serif";
        ctx.fillText(row.unit, unitX, y + 28);
        y += rowHeight;
      });

      // 导出
      wx.canvasToTempFilePath({
        canvas,
        x: 0, y: 0,
        width: canvasWidth * dpr,
        height: canvasHeight * dpr,
        destWidth: canvasWidth * 2,
        destHeight: canvasHeight * 2,
        fileType: "png",
        success: (res) => {
          this.setData({ generatingIdx: -1 });
          wx.hideLoading();
          this.saveImageToAlbum(res.tempFilePath);
        },
        fail: () => {
          this.setData({ generatingIdx: -1 });
          wx.hideLoading();
          wx.showToast({ title: "生成失败", icon: "none" });
        },
      });
    });
  },

  generateSummaryImage() {
    const { summary, gardens } = this.data;
    if (!summary || !summary.dates) return;

    this.setData({ generatingIdx: 999 });
    wx.showLoading({ title: "生成图片中..." });

    const padding = 30;
    const headerHeight = 80;
    const rowHeight = 36;
    const tableHeaderHeight = 44;
    const colDateWidth = 100;
    const colGardenWidth = 140;
    const canvasWidth = Math.max(colDateWidth + gardens.length * colGardenWidth + padding * 2, 600);

    // 计算总行数：每天按学生+老师菜品总数决定
    let totalRows = 0;
    summary.dates.forEach((dateObj) => {
      let maxLines = 1;
      gardens.forEach((g) => {
        const gardenData = summary.data[dateObj.date]?.[g.gardenId] || { student: [], teacher: [] };
        const studentDishes = gardenData.student || [];
        const teacherDishes = gardenData.teacher || [];
        // 每个分组标题占1行 + 菜品行数
        let lines = 0;
        if (studentDishes.length > 0) lines += 1 + studentDishes.length;
        if (teacherDishes.length > 0) lines += 1 + teacherDishes.length;
        maxLines = Math.max(maxLines, lines || 1);
      });
      totalRows += maxLines;
    });

    const canvasHeight = headerHeight + tableHeaderHeight + totalRows * rowHeight + padding * 2 + 20;

    const query = this.createSelectorQuery();
    query.select("#resultCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res[0]) {
        this.setData({ generatingIdx: -1 });
        wx.hideLoading();
        wx.showToast({ title: "Canvas不可用", icon: "none" });
        return;
      }

      const canvas = res[0].node;
      const ctx = canvas.getContext("2d");
      const dpr = wx.getWindowInfo().pixelRatio;

      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      ctx.scale(dpr, dpr);

      // 背景
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 标题
      ctx.fillStyle = "#FF9800";
      ctx.fillRect(0, 0, canvasWidth, headerHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("菜品下单汇总", canvasWidth / 2, headerHeight / 2 + 8);

      let y = headerHeight + 10;

      // 表头
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(padding, y, canvasWidth - padding * 2, tableHeaderHeight);
      ctx.fillStyle = "#666666";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("日期", padding + 8, y + 28);

      ctx.textAlign = "center";
      gardens.forEach((g, gIdx) => {
        const x = padding + colDateWidth + gIdx * colGardenWidth + colGardenWidth / 2;
        ctx.fillText(g.name, x, y + 28);
      });
      y += tableHeaderHeight;

      // 数据行
      summary.dates.forEach((dateObj, dIdx) => {
        let maxLines = 1;
        gardens.forEach((g) => {
          const gardenData = summary.data[dateObj.date]?.[g.gardenId] || { student: [], teacher: [] };
          const studentDishes = gardenData.student || [];
          const teacherDishes = gardenData.teacher || [];
          let lines = 0;
          if (studentDishes.length > 0) lines += 1 + studentDishes.length;
          if (teacherDishes.length > 0) lines += 1 + teacherDishes.length;
          maxLines = Math.max(maxLines, lines || 1);
        });
        const blockHeight = maxLines * rowHeight;

        if (dIdx % 2 === 0) {
          ctx.fillStyle = "#fafafa";
          ctx.fillRect(padding, y, canvasWidth - padding * 2, blockHeight);
        }

        // 日期标签
        ctx.fillStyle = "#333333";
        ctx.textAlign = "left";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(dateObj.label, padding + 8, y + 24);

        // 各园区菜品
        ctx.textAlign = "center";
        gardens.forEach((g, gIdx) => {
          const gardenData = summary.data[dateObj.date]?.[g.gardenId] || { student: [], teacher: [] };
          const studentDishes = gardenData.student || [];
          const teacherDishes = gardenData.teacher || [];
          const x = padding + colDateWidth + gIdx * colGardenWidth + colGardenWidth / 2;
          let lineY = y;

          if (studentDishes.length > 0) {
            ctx.fillStyle = "#1976D2";
            ctx.font = "bold 11px sans-serif";
            ctx.fillText("🎒学生", x, lineY + 22);
            lineY += rowHeight;
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#333333";
            studentDishes.forEach((dishName) => {
              ctx.fillText(dishName, x, lineY + 22);
              lineY += rowHeight;
            });
          }

          if (teacherDishes.length > 0) {
            ctx.fillStyle = "#E65100";
            ctx.font = "bold 11px sans-serif";
            ctx.fillText("👨‍🏫老师", x, lineY + 22);
            lineY += rowHeight;
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#333333";
            teacherDishes.forEach((dishName) => {
              ctx.fillText(dishName, x, lineY + 22);
              lineY += rowHeight;
            });
          }

          if (studentDishes.length === 0 && teacherDishes.length === 0) {
            ctx.fillStyle = "#ccc";
            ctx.font = "13px sans-serif";
            ctx.fillText("-", x, y + 24);
          }
        });

        y += blockHeight;
      });

      // 导出
      wx.canvasToTempFilePath({
        canvas,
        x: 0, y: 0,
        width: canvasWidth * dpr,
        height: canvasHeight * dpr,
        destWidth: canvasWidth * 2,
        destHeight: canvasHeight * 2,
        fileType: "png",
        success: (res) => {
          this.setData({ generatingIdx: -1 });
          wx.hideLoading();
          this.saveImageToAlbum(res.tempFilePath);
        },
        fail: () => {
          this.setData({ generatingIdx: -1 });
          wx.hideLoading();
          wx.showToast({ title: "生成失败", icon: "none" });
        },
      });
    });
  },

  // 降级方案（旧版Canvas）
  generateDailyImageLegacy(tableIdx, canvasWidth, canvasHeight) {
    const table = this.data.tables[tableIdx];
    const gardens = this.data.gardens;
    const ctx = wx.createCanvasContext("resultCanvasLegacy", this);

    const padding = 30;
    const rowHeight = 44;
    const headerHeight = 80;
    const tableHeaderHeight = 44;
    const colNameWidth = 120;
    const colGardenWidth = 80;
    const colUnitWidth = 60;
    const unitX = padding + colNameWidth + gardens.length * colGardenWidth + colUnitWidth / 2;

    // 背景
    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 标题
    ctx.setFillStyle("#4CAF50");
    ctx.fillRect(0, 0, canvasWidth, headerHeight);
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(22);
    ctx.setTextAlign("center");
    ctx.fillText(`${table.dateLabel} 配料清单`, canvasWidth / 2, headerHeight / 2 + 8);

    let y = headerHeight + 10;

    // 表头
    ctx.setFillStyle("#f0f0f0");
    ctx.fillRect(padding, y, canvasWidth - padding * 2, tableHeaderHeight);
    ctx.setFillStyle("#666666");
    ctx.setFontSize(13);
    ctx.setTextAlign("left");
    ctx.fillText("配料", padding + 8, y + 28);
    ctx.setTextAlign("center");
    gardens.forEach((g, gIdx) => {
      const x = padding + colNameWidth + gIdx * colGardenWidth + colGardenWidth / 2;
      ctx.fillText(g.name, x, y + 28);
    });
    ctx.fillText("单位", unitX, y + 28);
    y += tableHeaderHeight;

    // 数据行
    ctx.setFontSize(13);
    table.rows.forEach((row, rIdx) => {
      if (rIdx % 2 === 0) {
        ctx.setFillStyle("#fafafa");
        ctx.fillRect(padding, y, canvasWidth - padding * 2, rowHeight);
      }
      ctx.setFillStyle("#333333");
      ctx.setTextAlign("left");
      ctx.fillText(row.name, padding + 8, y + 28);
      ctx.setTextAlign("center");
      gardens.forEach((g, gIdx) => {
        const x = padding + colNameWidth + gIdx * colGardenWidth + colGardenWidth / 2;
        const val = row.amounts[g.gardenId] || 0;
        ctx.setFillStyle(val > 0 ? "#FF9800" : "#ccc");
        ctx.fillText(val > 0 ? String(val) : "0", x, y + 28);
      });
      ctx.setFillStyle("#666666");
      ctx.fillText(row.unit, unitX, y + 28);
      y += rowHeight;
    });

    ctx.draw(false, () => {
      setTimeout(() => {
        wx.canvasToTempFilePath({
          canvasId: "resultCanvasLegacy",
          x: 0, y: 0,
          width: canvasWidth,
          height: canvasHeight,
          destWidth: canvasWidth * 2,
          destHeight: canvasHeight * 2,
          fileType: "png",
          success: (res) => {
            this.setData({ generatingIdx: -1 });
            wx.hideLoading();
            this.saveImageToAlbum(res.tempFilePath);
          },
          fail: () => {
            this.setData({ generatingIdx: -1 });
            wx.hideLoading();
            wx.showToast({ title: "生成失败", icon: "none" });
          },
        }, this);
      }, 500);
    });
  },

  // ========== 保存图片到相册 ==========
  async saveImageToAlbum(filePath) {
    try {
      await wx.saveImageToPhotosAlbum({ filePath });
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (e) {
      if (e.errMsg && e.errMsg.indexOf("auth deny") > -1) {
        wx.showModal({
          title: "提示",
          content: "需要授权保存图片到相册",
          success: (res) => {
            if (res.confirm) wx.openSetting();
          },
        });
      } else {
        wx.showToast({ title: "保存失败", icon: "none" });
      }
    }
  },

  // ========== 保存记录到云数据库 ==========
  async saveRecord() {
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中..." });

    try {
      const { tables, summary, gardens, selectedDates } = this.data;

      const app = getApp();
      const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";

      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "saveRecord",
          username,
          selectedDates,
          tables,
          summary,
          gardens,
        },
      });

      if (res.result.success) {
        this.setData({ saved: true });
        wx.showToast({ title: "保存成功", icon: "success" });
      } else {
        wx.showToast({ title: res.result.errMsg || "保存失败", icon: "none" });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
      wx.hideLoading();
    }
  },
});
