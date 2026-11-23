// pages/result/result.js
const { unitOptions, createRow, sortRows, appendOrMerge, readTables } = require("../../utils/ingredientTable");

function parseAmount(value) {
  const text = String(value).trim();
  if (!/^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/.test(text)) return NaN;
  const amount = Number(text);
  return Number.isSafeInteger(Math.round(amount * 1000)) ? amount : NaN;
}

function listAmounts(gardens, row) {
  return gardens.map(g => `${g.name}：${row.amounts[g.gardenId]} ${row.unit}`).join("\n");
}

Page({
  data: {
    tables: [],
    summary: {},
    gardens: [],
    selectedDates: [],
    saving: false,
    saved: false,
    recordId: "",
    generatingIdx: -1,
    legacyWidth: 800,
    legacyHeight: 1200,
    editor: null,
    unitOptions,
  },

  onLoad(options) {
    const record = getApp().globalData.calculateResult;
    if (!record || (options.from === "history" && !record.recordId)) {
      wx.showToast({ title: "清单数据缺失", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this._revision = record.revision || 0;
    this.setData({
      tables: readTables(record),
      summary: record.summary,
      gardens: record.gardens,
      selectedDates: record.selectedDates,
      recordId: record.recordId || "",
      saved: !!record.recordId,
    });
  },

  openEditor(e) {
    if (this.data.saving) return;
    const { date, rowId } = e.currentTarget.dataset;
    const table = this.data.tables.find(t => t.date === date);
    if (!table) return;
    const row = table.rows.find(r => r.rowId === rowId);
    if (rowId && !row) return;
    const amounts = {};
    for (const { gardenId } of this.data.gardens) {
      amounts[gardenId] = row ? String(row.amounts[gardenId]) : "";
    }
    this.setData({
      editor: {
        date,
        dateLabel: table.dateLabel,
        rowId: rowId || "",
        name: row ? row.name : "",
        unit: row ? row.unit : unitOptions[0],
        unitIdx: 0,
        baseAmounts: row ? row.baseAmounts : {},
        amounts,
      },
    });
  },

  closeEditor() {
    this.setData({ editor: null });
  },

  changeName(e) {
    this.setData({ "editor.name": e.detail.value });
  },

  changeUnit(e) {
    const idx = Number(e.detail.value);
    this.setData({ "editor.unit": unitOptions[idx], "editor.unitIdx": idx });
  },

  setEditorAmount(id, value) {
    this.setData({ "editor.amounts": { ...this.data.editor.amounts, [id]: value } });
  },

  changeAmount(e) {
    this.setEditorAmount(e.currentTarget.dataset.gardenId, e.detail.value);
  },

  quickAdjustRow(e) {
    const { gardenId, delta } = e.currentTarget.dataset;
    const current = parseAmount(this.data.editor.amounts[gardenId] || "0");
    const value = (Math.round(current * 1000) + Number(delta) * 1000) / 1000;
    if (!Number.isFinite(value) || value < 0) {
      wx.showToast({ title: "请输入有效的非负用量", icon: "none" });
      return;
    }
    this.setEditorAmount(gardenId, String(value));
  },

  resetAmounts() {
    this.setData({ "editor.amounts": { ...this.data.editor.baseAmounts } });
  },

  commitRows(date, rows) {
    const tables = this.data.tables.map(table => table.date === date ? { ...table, rows } : table);
    this.setData({ tables, editor: null, saved: false });
  },

  confirmEditor() {
    const { editor, tables, gardens } = this.data;
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      wx.showToast({ title: "请输入配料名称", icon: "none" });
      return;
    }
    const amounts = {};
    const zeros = {};
    for (const { gardenId, name: gardenName } of gardens) {
      const value = editor.amounts[gardenId];
      const amount = value === "" && !editor.rowId ? 0 : parseAmount(value);
      if (!Number.isFinite(amount)) {
        wx.showToast({ title: gardenName + "用量须为非负数，最多三位小数", icon: "none" });
        return;
      }
      amounts[gardenId] = amount;
      zeros[gardenId] = 0;
    }
    if (!editor.rowId && !Object.values(amounts).some(n => n > 0)) {
      wx.showToast({ title: "至少填写一个园区的追加量", icon: "none" });
      return;
    }

    const table = tables.find(t => t.date === editor.date);
    const original = table.rows.find(r => r.rowId === editor.rowId);
    const row = original ? { ...original, name, amounts } : createRow(name, editor.unit, "其他", amounts, zeros);
    const rows = table.rows.filter(r => r.rowId !== editor.rowId);
    const merged = appendOrMerge(rows, row);
    if (merged !== row) {
      wx.showModal({
        title: "合并同名配料",
        content: `${table.dateLabel} · ${name} 合并后的用量\n${listAmounts(gardens, merged)}`,
        confirmText: "确认合并",
        success: res => { if (res.confirm) this.commitRows(table.date, sortRows(rows)); },
      });
    } else {
      this.commitRows(table.date, sortRows(rows));
    }
  },

  deleteRow() {
    const { editor, tables, gardens } = this.data;
    if (!editor || !editor.rowId) return;
    const table = tables.find(t => t.date === editor.date);
    const row = table.rows.find(r => r.rowId === editor.rowId);
    wx.showModal({
      title: "删除当天这一行？",
      content: `${table.dateLabel} · ${row.name}（${row.unit}）\n${listAmounts(gardens, row)}`,
      confirmText: "删除此行",
      confirmColor: "#c0392b",
      success: res => {
        if (res.confirm) this.commitRows(table.date, table.rows.filter(r => r.rowId !== row.rowId));
      },
    });
  },

  preventBubble() {},

  // ========== 生成单个表格图片 ==========
  generateTableImage(e) {
    if (this.data.generatingIdx !== -1) return;
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
    const headerHeight = 96;
    const tableHeaderHeight = 44;
    const colNameWidth = 120;
    const colGardenWidth = 80;
    const colUnitWidth = 60;
    const canvasWidth = Math.max(colNameWidth + gardens.length * colGardenWidth + colUnitWidth + padding * 2, 600);
    const canvasHeight = headerHeight + tableHeaderHeight + table.rows.length * rowHeight + padding * 2 + 20;

    const query = this.createSelectorQuery();
    query.select("#resultCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res[0] || !res[0].node) {
        this.setData({ legacyWidth: canvasWidth, legacyHeight: canvasHeight }, () => {
          this.generateDailyImageLegacy(table, canvasWidth, canvasHeight);
        });
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
  generateDailyImageLegacy(table, canvasWidth, canvasHeight) {
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

  async saveRecord() {
    const { saving, saved, recordId, selectedDates, tables, summary, gardens } = this.data;
    if (saving || saved) return;
    this.setData({ saving: true });
    wx.showLoading({ title: "保存中...", mask: true });
    try {
      const user = getApp().globalData.userInfo;
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: recordId ? "updateRecord" : "saveRecord",
          username: user ? user.username : "",
          recordId, revision: this._revision, schemaVersion: 2,
          selectedDates, tables, summary, gardens,
        },
      });
      if (!res.result.success) {
        wx.showToast({ title: res.result.errMsg || "保存失败", icon: "none" });
        return;
      }
      this._revision = res.result.data.revision;
      this.setData({ recordId: res.result.data._id, saved: true });
      const pages = getCurrentPages();
      const previous = pages[pages.length - 2];
      if (previous && previous.route === "pages/history/history") previous._needRefresh = true;
      wx.showToast({ title: recordId ? "已更新" : "保存成功", icon: "success" });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    } finally {
      this.setData({ saving: false });
      wx.hideLoading();
    }
  },
});
