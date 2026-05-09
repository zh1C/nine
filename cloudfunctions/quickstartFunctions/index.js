const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

// 获取openid
const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// ============ 用户模块 ============

// 用户注册
const register = async (event) => {
  try {
    const { username, password } = event;
    if (!username || !password) {
      return { success: false, errMsg: "用户名和密码不能为空" };
    }
    // 检查用户名是否已存在
    const existUser = await db
      .collection("users")
      .where({ username })
      .get();
    if (existUser.data.length > 0) {
      return { success: false, errMsg: "用户名已存在" };
    }
    const wxContext = cloud.getWXContext();
    await db.collection("users").add({
      data: {
        openid: wxContext.OPENID,
        username,
        password, // 实际生产中应加密
        nickname: username, // 默认别名等于用户名
        avatar: "", // 默认无头像
        role: "user", // 默认普通用户
        createTime: db.serverDate(),
      },
    });
    return { success: true, data: { username } };
  } catch (e) {
    return { success: false, errMsg: e.message || "注册失败" };
  }
};

// 用户登录
const login = async (event) => {
  try {
    const { username, password } = event;
    if (!username || !password) {
      return { success: false, errMsg: "用户名和密码不能为空" };
    }
    const res = await db
      .collection("users")
      .where({ username, password })
      .get();
    if (res.data.length === 0) {
      return { success: false, errMsg: "用户名或密码错误" };
    }
    const user = res.data[0];
    return {
      success: true,
      data: {
        _id: user._id,
        username: user.username,
        nickname: user.nickname || user.username,
        avatar: user.avatar || "",
        role: user.role || "user",
      },
    };
  } catch (e) {
    return { success: false, errMsg: e.message || "登录失败" };
  }
};

// ============ 用户管理模块 ============

// 更新个人资料（别名、头像）
const updateProfile = async (event) => {
  try {
    const { username, nickname, avatar } = event;
    if (!username) {
      return { success: false, errMsg: "用户名不能为空" };
    }
    // 先确认用户存在
    const userRes = await db
      .collection("users")
      .where({ username })
      .get();
    if (userRes.data.length === 0) {
      return { success: false, errMsg: "用户不存在" };
    }

    const updateData = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (avatar !== undefined) updateData.avatar = avatar;

    if (Object.keys(updateData).length > 0) {
      await db
        .collection("users")
        .where({ username })
        .update({ data: updateData });
    }

    return { success: true, data: { nickname, avatar } };
  } catch (e) {
    return { success: false, errMsg: e.message || "更新资料失败" };
  }
};

// 修改密码
const changePassword = async (event) => {
  try {
    const { username, oldPassword, newPassword } = event;
    if (!username || !oldPassword || !newPassword) {
      return { success: false, errMsg: "参数不完整" };
    }
    // 验证原密码
    const userRes = await db
      .collection("users")
      .where({ username, password: oldPassword })
      .get();
    if (userRes.data.length === 0) {
      return { success: false, errMsg: "原密码错误" };
    }
    // 更新密码
    await db
      .collection("users")
      .where({ username })
      .update({ data: { password: newPassword } });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "修改密码失败" };
  }
};

// 获取用户列表（仅管理员）
const getUsers = async (event) => {
  try {
    const { operatorUsername, keyword } = event;
    // 校验操作者是否为管理员
    const operatorRes = await db
      .collection("users")
      .where({ username: operatorUsername })
      .get();
    if (operatorRes.data.length === 0 || operatorRes.data[0].role !== "admin") {
      return { success: false, errMsg: "无权限操作" };
    }

    let query = db.collection("users");
    if (keyword) {
      query = query.where(
        _.or([
          { username: db.RegExp({ regexp: keyword, options: "i" }) },
          { nickname: db.RegExp({ regexp: keyword, options: "i" }) },
        ])
      );
    }
    const countRes = await query.count();
    const res = await query
      .orderBy("createTime", "desc")
      .field({ username: true, nickname: true, avatar: true, role: true, createTime: true })
      .get();
    return { success: true, data: { list: res.data, total: countRes.total } };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取用户列表失败" };
  }
};

// 删除用户（仅管理员）
const deleteUser = async (event) => {
  try {
    const { operatorUsername, targetUsername } = event;
    // 校验操作者是否为管理员
    const operatorRes = await db
      .collection("users")
      .where({ username: operatorUsername })
      .get();
    if (operatorRes.data.length === 0 || operatorRes.data[0].role !== "admin") {
      return { success: false, errMsg: "无权限操作" };
    }
    // 不能删除管理员
    const targetRes = await db
      .collection("users")
      .where({ username: targetUsername })
      .get();
    if (targetRes.data.length === 0) {
      return { success: false, errMsg: "目标用户不存在" };
    }
    if (targetRes.data[0].role === "admin") {
      return { success: false, errMsg: "不能删除管理员账号" };
    }
    // 删除用户头像（如果有）
    if (targetRes.data[0].avatar) {
      await cloud.deleteFile({ fileList: [targetRes.data[0].avatar] });
    }
    // 删除用户
    await db.collection("users").where({ username: targetUsername }).remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "删除用户失败" };
  }
};

// ============ 菜品模块 ============

// 添加菜品
const addDish = async (event) => {
  try {
    const { name, imageFileID, ingredients, ratios } = event;
    const wxContext = cloud.getWXContext();
    const res = await db.collection("dishes").add({
      data: {
        _openid: wxContext.OPENID,
        name,
        imageFileID: imageFileID || "",
        ingredients: ingredients || [],
        ratios: ratios || {},
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    return { success: true, data: { _id: res._id } };
  } catch (e) {
    return { success: false, errMsg: e.message || "添加菜品失败" };
  }
};

// 获取菜品列表
const getDishes = async (event) => {
  try {
    const { keyword, page = 1, pageSize = 20 } = event;
    let query = db.collection("dishes");
    if (keyword) {
      query = query.where({
        name: db.RegExp({
          regexp: keyword,
          options: "i",
        }),
      });
    }
    const countRes = await query.count();
    const total = countRes.total;
    const res = await query
      .orderBy("createTime", "desc")
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    return { success: true, data: { list: res.data, total } };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取菜品列表失败" };
  }
};

// 获取单个菜品详情
const getDishDetail = async (event) => {
  try {
    const { dishId } = event;
    const res = await db.collection("dishes").doc(dishId).get();
    return { success: true, data: res.data };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取菜品详情失败" };
  }
};

// 更新菜品
const updateDish = async (event) => {
  try {
    const { dishId, name, imageFileID, ingredients, ratios } = event;
    const updateData = { updateTime: db.serverDate() };
    if (name !== undefined) updateData.name = name;
    if (imageFileID !== undefined) updateData.imageFileID = imageFileID;
    if (ingredients !== undefined) updateData.ingredients = ingredients;
    if (ratios !== undefined) updateData.ratios = ratios;
    await db.collection("dishes").doc(dishId).update({
      data: updateData,
    });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "更新菜品失败" };
  }
};

// 删除菜品
const deleteDish = async (event) => {
  try {
    const { dishId, imageFileID } = event;
    // 如果有图片，先删除云存储的图片
    if (imageFileID) {
      await cloud.deleteFile({ fileList: [imageFileID] });
    }
    await db.collection("dishes").doc(dishId).remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "删除菜品失败" };
  }
};

// ============ 园区模块 ============

// 管理员权限校验
const checkAdmin = async (operatorUsername) => {
  const res = await db
    .collection("users")
    .where({ username: operatorUsername })
    .get();
  return res.data.length > 0 && res.data[0].role === "admin";
};

// 获取下一个 gardenId（查询当前最大值 + 1）
const getNextGardenId = async () => {
  const res = await db
    .collection("gardens")
    .orderBy("gardenId", "desc")
    .limit(1)
    .field({ gardenId: true })
    .get();
  return res.data.length === 0 ? 1 : res.data[0].gardenId + 1;
};

// 新增园区
const addGarden = async (event) => {
  try {
    const { operatorUsername, name } = event;
    if (!(await checkAdmin(operatorUsername))) {
      return { success: false, errMsg: "无权限操作" };
    }
    if (!name || !name.trim()) {
      return { success: false, errMsg: "园区名称不能为空" };
    }
    // 检查园区名称是否已存在
    const existGarden = await db
      .collection("gardens")
      .where({ name: name.trim() })
      .get();
    if (existGarden.data.length > 0) {
      return { success: false, errMsg: "园区名称已存在" };
    }
    const gardenId = await getNextGardenId();
    await db.collection("gardens").add({
      data: {
        gardenId,
        name: name.trim(),
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    return { success: true, data: { gardenId } };
  } catch (e) {
    return { success: false, errMsg: e.message || "新增园区失败" };
  }
};

// 获取园区列表
const getGardens = async (event) => {
  try {
    const { keyword } = event;
    let query = db.collection("gardens");
    if (keyword) {
      query = query.where({
        name: db.RegExp({ regexp: keyword, options: "i" }),
      });
    }
    const countRes = await query.count();
    const res = await query.orderBy("gardenId", "asc").get();
    return { success: true, data: { list: res.data, total: countRes.total } };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取园区列表失败" };
  }
};

// 修改园区
const updateGarden = async (event) => {
  try {
    const { operatorUsername, gardenId, name } = event;
    if (!(await checkAdmin(operatorUsername))) {
      return { success: false, errMsg: "无权限操作" };
    }
    if (!name || !name.trim()) {
      return { success: false, errMsg: "园区名称不能为空" };
    }
    // 检查新名称是否与其他园区重复
    const existGarden = await db
      .collection("gardens")
      .where({ name: name.trim(), gardenId: _.neq(gardenId) })
      .get();
    if (existGarden.data.length > 0) {
      return { success: false, errMsg: "园区名称已存在" };
    }
    const res = await db
      .collection("gardens")
      .where({ gardenId })
      .update({
        data: { name: name.trim(), updateTime: db.serverDate() },
      });
    if (res.stats.updated === 0) {
      return { success: false, errMsg: "园区不存在" };
    }
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "修改园区失败" };
  }
};

// 删除园区
const deleteGarden = async (event) => {
  try {
    const { operatorUsername, gardenId } = event;
    if (!(await checkAdmin(operatorUsername))) {
      return { success: false, errMsg: "无权限操作" };
    }
    const res = await db.collection("gardens").where({ gardenId }).remove();
    if (res.stats.removed === 0) {
      return { success: false, errMsg: "园区不存在" };
    }
    // 同步清理所有菜品中该园区的 ratios 数据（清理失败不影响删除结果）
    try {
      const gardenKey = String(gardenId);
      const MAX_LIMIT = 100;
      const countRes = await db.collection("dishes").count();
      const total = countRes.total;
      for (let i = 0; i < total; i += MAX_LIMIT) {
        const dishes = await db
          .collection("dishes")
          .skip(i)
          .limit(MAX_LIMIT)
          .field({ _id: true, ratios: true })
          .get();
        const tasks = dishes.data
          .filter((dish) => dish.ratios && dish.ratios[gardenKey] !== undefined)
          .map((dish) =>
            db.collection("dishes").doc(dish._id).update({
              data: { [`ratios.${gardenKey}`]: _.remove() },
            })
          );
        if (tasks.length > 0) {
          await Promise.all(tasks);
        }
      }
    } catch (cleanErr) {
      console.error("清理菜品关联 ratios 数据失败:", cleanErr);
    }
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "删除园区失败" };
  }
};

// ============ 记录模块 ============

// 保存计算记录
const saveRecord = async (event) => {
  try {
    const { selectedDates, tables, summary, gardens, username } = event;
    const wxContext = cloud.getWXContext();
    const res = await db.collection("records").add({
      data: {
        _openid: wxContext.OPENID,
        username: username || "",
        selectedDates: selectedDates || [],
        tables: tables || [],
        summary: summary || {},
        gardens: gardens || [],
        createTime: db.serverDate(),
      },
    });
    return { success: true, data: { _id: res._id } };
  } catch (e) {
    return { success: false, errMsg: e.message || "保存记录失败" };
  }
};

// 获取历史记录
const getRecords = async (event) => {
  try {
    const { username, keyword, page = 1, pageSize = 20 } = event;
    if (!username) {
      return { success: false, errMsg: "用户名不能为空" };
    }
    let whereCondition = { username };
    if (keyword) {
      whereCondition.selectedDates = _.elemMatch(
        db.RegExp({ regexp: keyword, options: "i" })
      );
    }
    const query = db.collection("records").where(whereCondition);
    const countRes = await query.count();
    const total = countRes.total;
    const res = await query
      .orderBy("createTime", "desc")
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .field({ _id: true, selectedDates: true, gardens: true, createTime: true })
      .get();
    return { success: true, data: { list: res.data, total } };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取记录失败" };
  }
};

// 获取记录详情
const getRecordDetail = async (event) => {
  try {
    const { recordId, username } = event;
    if (!recordId || !username) {
      return { success: false, errMsg: "参数不完整" };
    }
    const record = await db.collection("records").doc(recordId).get();
    if (record.data.username !== username) {
      return { success: false, errMsg: "无权查看此记录" };
    }
    return { success: true, data: record.data };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取记录详情失败" };
  }
};

// 删除记录
const deleteRecord = async (event) => {
  try {
    const { recordId, username } = event;
    if (!recordId || !username) {
      return { success: false, errMsg: "参数不完整" };
    }
    const record = await db.collection("records").doc(recordId).get();
    if (record.data.username !== username) {
      return { success: false, errMsg: "无权删除此记录" };
    }
    await db.collection("records").doc(recordId).remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "删除记录失败" };
  }
};

// 云函数入口函数
exports.main = async (event, context) => {
  switch (event.type) {
    // 基础功能
    case "getOpenId":
      return await getOpenId();
    // 用户模块
    case "register":
      return await register(event);
    case "login":
      return await login(event);
    // 用户管理模块
    case "updateProfile":
      return await updateProfile(event);
    case "changePassword":
      return await changePassword(event);
    case "getUsers":
      return await getUsers(event);
    case "deleteUser":
      return await deleteUser(event);
    // 菜品模块
    case "addDish":
      return await addDish(event);
    case "getDishes":
      return await getDishes(event);
    case "getDishDetail":
      return await getDishDetail(event);
    case "updateDish":
      return await updateDish(event);
    case "deleteDish":
      return await deleteDish(event);
    // 园区模块
    case "addGarden":
      return await addGarden(event);
    case "getGardens":
      return await getGardens(event);
    case "updateGarden":
      return await updateGarden(event);
    case "deleteGarden":
      return await deleteGarden(event);
    // 记录模块
    case "saveRecord":
      return await saveRecord(event);
    case "getRecords":
      return await getRecords(event);
    case "getRecordDetail":
      return await getRecordDetail(event);
    case "deleteRecord":
      return await deleteRecord(event);
    default:
      return { success: false, errMsg: "未知的操作类型" };
  }
};
