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

    // ====== 配料微调（整行模式） ======
    adjustments: {}, // 调整记录: { "tableIdx_rowIdx_gardenId": deltaValue }
    showAdjustPanel: false,
    adjustTarget: null, // { tableIdx, rowIdx, ingName, unit }
    adjustRowDeltas: {}, // 面板内临时状态: { gardenId: delta }
    adjustRowOriginals: {}, // 面板内原始值: { gardenId: originalVal }
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
      adjustments: data.adjustments || {},
    });

    // 保存原始数据用于存云数据库
    this._rawData = data;
    // 历史记录对应的云端记录 id（仅历史模式存在）
    this._recordId = data.recordId || "";
  },

  // ========== 配料微调（整行模式） ==========

  // 长按配料行，打开调整面板
  openAdjustPanel(e) {
    const { tableIdx, rowIdx, ingName, unit } = e.currentTarget.dataset;
    const { tables, gardens, adjustments } = this.data;
    const row = tables[tableIdx].rows[rowIdx];

    // 初始化每个园区的原始值和已有调整量
    const adjustRowOriginals = {};
    const adjustRowDeltas = {};
    gardens.forEach((g) => {
      const gardenId = String(g.gardenId);
      adjustRowOriginals[gardenId] = row.amounts[gardenId] || 0;
      const key = `${tableIdx}_${rowIdx}_${gardenId}`;
      adjustRowDeltas[gardenId] = adjustments[key] || 0;
    });

    this.setData({
      showAdjustPanel: true,
      adjustTarget: { tableIdx, rowIdx, ingName, unit },
      adjustRowDeltas,
      adjustRowOriginals,
    });
  },

  closeAdjustPanel() {
    this.setData({ showAdjustPanel: false, adjustTarget: null, adjustRowDeltas: {}, adjustRowOriginals: {} });
  },

  // 快捷加减某个园区
  quickAdjustRow(e) {
    const { gardenId, delta } = e.currentTarget.dataset;
    const { adjustRowDeltas, adjustRowOriginals } = this.data;
    const gId = String(gardenId);
    const newDelta = (adjustRowDeltas[gId] || 0) + Number(delta);
    const finalVal = (adjustRowOriginals[gId] || 0) + newDelta;

    if (finalVal < 0) {
      wx.showToast({ title: "不能为负数", icon: "none" });
      return;
    }

    this.setData({ [`adjustRowDeltas.${gId}`]: newDelta });
  },

  // 手动输入某个园区的调整量
  onAdjustRowInput(e) {
    const gardenId = String(e.currentTarget.dataset.gardenId);
    const val = e.detail.value;
    const delta = parseFloat(val) || 0;
    const { adjustRowOriginals } = this.data;
    const finalVal = (adjustRowOriginals[gardenId] || 0) + delta;

    if (finalVal < 0) {
      wx.showToast({ title: "不能为负数", icon: "none" });
      return;
    }

    this.setData({ [`adjustRowDeltas.${gardenId}`]: delta });
  },

  // 确认整行调整
  confirmAdjust() {
    const { adjustTarget, adjustRowDeltas, adjustments } = this.data;
    if (!adjustTarget) return;

    const { tableIdx, rowIdx } = adjustTarget;
    const newAdjustments = { ...adjustments };

    // 将每个园区的调整量写入 adjustments
    Object.keys(adjustRowDeltas).forEach((gardenId) => {
      const key = `${tableIdx}_${rowIdx}_${gardenId}`;
      const delta = adjustRowDeltas[gardenId];
      if (delta === 0) {
        delete newAdjustments[key];
      } else {
        newAdjustments[key] = delta;
      }
    });

    this.setData({
      adjustments: newAdjustments,
      showAdjustPanel: false,
      adjustTarget: null,
      adjustRowDeltas: {},
      adjustRowOriginals: {},
    });
  },

  // 还原整行所有调整
  resetAdjust() {
    const { adjustTarget, adjustments, gardens } = this.data;
    if (!adjustTarget) return;

    const { tableIdx, rowIdx } = adjustTarget;
    const newAdjustments = { ...adjustments };

    // 删除该行所有园区的调整
    gardens.forEach((g) => {
      const key = `${tableIdx}_${rowIdx}_${g.gardenId}`;
      delete newAdjustments[key];
    });

    this.setData({
      adjustments: newAdjustments,
      showAdjustPanel: false,
      adjustTarget: null,
      adjustRowDeltas: {},
      adjustRowOriginals: {},
    });
  },

  preventBubble() {},

  // ========== 构建调整后的 tables（用于保存和导出） ==========
  buildFinalTables() {
    const { tables, adjustments } = this.data;
    if (!adjustments || Object.keys(adjustments).length === 0) {
      return tables;
    }
    return tables.map((table, tIdx) => ({
      ...table,
      rows: table.rows.map((row, rIdx) => {
        const newAmounts = { ...row.amounts };
        Object.keys(newAmounts).forEach((gardenId) => {
          const key = `${tIdx}_${rIdx}_${gardenId}`;
          if (adjustments[key]) {
            newAmounts[gardenId] = Math.round(((newAmounts[gardenId] || 0) + adjustments[key]) * 1000) / 1000;
          }
        });
        return { ...row, amounts: newAmounts };
      }),
    }));
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
    const finalTables = this.buildFinalTables();
    const table = finalTables[tableIdx];
    const gardens = this.data.gardens;
    if (!table) return;

    this.setData({ generatingIdx: tableIdx });
    wx.showLoading({ title: "生成图片中..." });

    const padding = 30;
    const rowHeight = 44;
    const headerHeight = 96;
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

      // 标题（两行：主标题 + 配料数量）
      ctx.fillStyle = "#4CAF50";
      ctx.fillRect(0, 0, canvasWidth, headerHeight);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(`📋 ${table.dateLabel} 配料清单`, canvasWidth / 2, 38);
      ctx.font = "14px sans-serif";
      ctx.fillText(`🥗 共 ${table.rows.length} 种配料`, canvasWidth / 2, 70);

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

    let totalRows = 0;
    summary.dates.forEach((dateObj) => {
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

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      ctx.fillStyle = "#FF9800";
      ctx.fillRect(0, 0, canvasWidth, headerHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("菜品下单汇总", canvasWidth / 2, headerHeight / 2 + 8);

      let y = headerHeight + 10;

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

        ctx.fillStyle = "#333333";
        ctx.textAlign = "left";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(dateObj.label, padding + 8, y + 24);

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
    const finalTables = this.buildFinalTables();
    const table = finalTables[tableIdx];
    const gardens = this.data.gardens;
    const ctx = wx.createCanvasContext("resultCanvasLegacy", this);

    const padding = 30;
    const rowHeight = 44;
    const headerHeight = 96;
    const tableHeaderHeight = 44;
    const colNameWidth = 120;
    const colGardenWidth = 80;
    const colUnitWidth = 60;
    const unitX = padding + colNameWidth + gardens.length * colGardenWidth + colUnitWidth / 2;

    ctx.setFillStyle("#ffffff");
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.setFillStyle("#4CAF50");
    ctx.fillRect(0, 0, canvasWidth, headerHeight);
    ctx.setFillStyle("#ffffff");
    ctx.setTextAlign("center");
    ctx.setFontSize(22);
    ctx.fillText(`${table.dateLabel} 配料清单`, canvasWidth / 2, 38);
    ctx.setFontSize(14);
    ctx.fillText(`共 ${table.rows.length} 种配料`, canvasWidth / 2, 70);

    let y = headerHeight + 10;

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

  // ========== 保存记录到云数据库（新建） ==========
  async saveRecord() {
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中..." });

    try {
      // 口径A：tables 存“原始值”，adjustments 单独存增量（展示/导出时再叠加）
      const { tables, summary, gardens, selectedDates, adjustments } = this.data;

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
          adjustments: Object.keys(adjustments).length > 0 ? adjustments : undefined,
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

  // ========== 更新已有记录（历史模式） ==========
  async updateRecord() {
    if (!this._recordId) {
      wx.showToast({ title: "记录ID缺失", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: "更新中..." });

    try {
      // 口径A：tables 存“原始值”，adjustments 单独存增量
      const { tables, summary, gardens, selectedDates, adjustments } = this.data;

      const app = getApp();
      const username = app.globalData.userInfo ? app.globalData.userInfo.username : "";

      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "updateRecord",
          recordId: this._recordId,
          username,
          selectedDates,
          tables,
          summary,
          gardens,
          adjustments: Object.keys(adjustments).length > 0 ? adjustments : undefined,
        },
      });

      if (res.result.success) {
        this.setData({ saved: true });
        wx.showToast({ title: "已更新", icon: "success" });

        // 通知历史页刷新
        const pages = getCurrentPages();
        const prevPage = pages[pages.length - 2];
        if (prevPage && prevPage.route && prevPage.route.indexOf("pages/history/history") > -1) {
          prevPage._needRefresh = true;
        }

        setTimeout(() => wx.navigateBack(), 800);
      } else {
        wx.showToast({ title: res.result.errMsg || "更新失败", icon: "none" });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "更新失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
      wx.hideLoading();
    }
  },
});
