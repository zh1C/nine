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
        role: "user",
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
    return { success: true, data: { username, role: res.data[0].role } };
  } catch (e) {
    return { success: false, errMsg: e.message || "登录失败" };
  }
};

// ============ 菜品模块 ============

// 添加菜品
const addDish = async (event) => {
  try {
    const { name, imageFileID, ingredients } = event;
    const wxContext = cloud.getWXContext();
    const res = await db.collection("dishes").add({
      data: {
        _openid: wxContext.OPENID,
        name,
        imageFileID: imageFileID || "",
        ingredients: ingredients || [],
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
    const { dishId, name, imageFileID, ingredients } = event;
    const updateData = { updateTime: db.serverDate() };
    if (name !== undefined) updateData.name = name;
    if (imageFileID !== undefined) updateData.imageFileID = imageFileID;
    if (ingredients !== undefined) updateData.ingredients = ingredients;
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

// ============ 记录模块 ============

// 保存计算记录
const saveRecord = async (event) => {
  try {
    const { gardenName, items, result, resultImageFileID } = event;
    const wxContext = cloud.getWXContext();
    const res = await db.collection("records").add({
      data: {
        _openid: wxContext.OPENID,
        gardenName,
        items,
        result,
        resultImageFileID: resultImageFileID || "",
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
    const { page = 1, pageSize = 20 } = event;
    const wxContext = cloud.getWXContext();
    const query = db.collection("records").where({
      _openid: wxContext.OPENID,
    });
    const countRes = await query.count();
    const total = countRes.total;
    const res = await query
      .orderBy("createTime", "desc")
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    return { success: true, data: { list: res.data, total } };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取记录失败" };
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
    // 记录模块
    case "saveRecord":
      return await saveRecord(event);
    case "getRecords":
      return await getRecords(event);
    default:
      return { success: false, errMsg: "未知的操作类型" };
  }
};
