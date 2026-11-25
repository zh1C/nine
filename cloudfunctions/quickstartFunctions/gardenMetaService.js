const crypto = require("crypto");

let localSecret = {};
try {
  localSecret = require("./secret.local.json");
} catch (e) {
  localSecret = {};
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const rawSecret = (process.env.GARDEN_META_SECRET || localSecret.gardenMetaSecret || "").trim();
  if (!rawSecret) {
    throw new Error("未配置园区元信息加密密钥（GARDEN_META_SECRET），请在云函数环境变量中配置");
  }
  return crypto.createHash("sha256").update(rawSecret, "utf8").digest();
}

function encryptPassword(plainText) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPassword(cipherText) {
  if (!cipherText || typeof cipherText !== "string") {
    return "";
  }
  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("密码密文格式异常");
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// 校验管理员角色及微信服务端可信 OPENID
async function verifyAdminIdentity(db, cloud, operatorUsername) {
  if (!operatorUsername) {
    return { ok: false, errMsg: "用户名不能为空" };
  }
  const userRes = await db
    .collection("users")
    .where({ username: operatorUsername })
    .limit(1)
    .get();
  if (userRes.data.length === 0 || userRes.data[0].role !== "admin") {
    return { ok: false, errMsg: "无权限操作" };
  }
  const user = userRes.data[0];
  const wxContext = cloud.getWXContext();
  const currentOpenid = wxContext && wxContext.OPENID;
  if (currentOpenid) {
    const boundOpenids = [user.openid, user.lastOpenid].filter(Boolean);
    if (boundOpenids.length === 0 || !boundOpenids.includes(currentOpenid)) {
      return { ok: false, errMsg: "身份校验失败，请重新登录" };
    }
  }
  return { ok: true, user };
}

// 校验园区存在且归属当前管理员
async function verifyGardenOwner(db, gardenId, operatorUsername) {
  const numId = Number(gardenId);
  if (!Number.isSafeInteger(numId) || numId <= 0) {
    return { ok: false, errMsg: "园区 ID 无效" };
  }
  const gardenRes = await db
    .collection("gardens")
    .where({ gardenId: numId })
    .limit(1)
    .get();
  if (gardenRes.data.length === 0) {
    return { ok: false, errMsg: "园区不存在" };
  }
  if (gardenRes.data[0].username !== operatorUsername) {
    return { ok: false, errMsg: "无权操作此园区" };
  }
  return { ok: true, garden: gardenRes.data[0] };
}

// 获取当前管理员的园区列表及元信息配置状态（不含明文密码）
async function getGardenMetaList(event, { db, _, cloud }) {
  try {
    const { operatorUsername, keyword } = event;
    const auth = await verifyAdminIdentity(db, cloud, operatorUsername);
    if (!auth.ok) {
      return { success: false, errMsg: auth.errMsg };
    }

    const whereCondition = { username: operatorUsername };
    if (keyword && String(keyword).trim()) {
      whereCondition.name = db.RegExp({ regexp: String(keyword).trim(), options: "i" });
    }

    const MAX_LIMIT = 100;
    const countRes = await db.collection("gardens").where(whereCondition).count();
    const total = countRes.total;
    if (total === 0) {
      return { success: true, data: { list: [], total: 0 } };
    }

    const batchTimes = Math.ceil(total / MAX_LIMIT);
    const gardenTasks = [];
    for (let i = 0; i < batchTimes; i++) {
      gardenTasks.push(
        db
          .collection("gardens")
          .where(whereCondition)
          .orderBy("gardenId", "asc")
          .skip(i * MAX_LIMIT)
          .limit(MAX_LIMIT)
          .field({ gardenId: true, name: true, createTime: true })
          .get()
      );
    }
    const gardenResults = await Promise.all(gardenTasks);
    const gardens = [];
    gardenResults.forEach((r) => gardens.push(...r.data));

    const gardenIds = gardens.map((g) => g.gardenId);
    const metaMap = {};
    for (let i = 0; i < gardenIds.length; i += MAX_LIMIT) {
      const idChunk = gardenIds.slice(i, i + MAX_LIMIT);
      const metaRes = await db
        .collection("garden_meta")
        .where({
          username: operatorUsername,
          gardenId: _.in(idChunk),
        })
        .limit(MAX_LIMIT)
        .field({
          gardenId: true,
          accountUsername: true,
          createTime: true,
          updateTime: true,
        })
        .get();
      metaRes.data.forEach((m) => {
        metaMap[m.gardenId] = m;
      });
    }

    const list = gardens.map((g) => {
      const meta = metaMap[g.gardenId];
      return {
        gardenId: g.gardenId,
        name: g.name,
        hasMeta: Boolean(meta),
        accountUsername: meta ? meta.accountUsername : "",
        updateTime: meta ? meta.updateTime || meta.createTime : null,
      };
    });

    return { success: true, data: { list, total } };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取园区元信息列表失败" };
  }
}

// 获取单个园区的元信息详情（按需解密密码）
async function getGardenMetaDetail(event, { db, cloud }) {
  try {
    const { operatorUsername, gardenId } = event;
    const auth = await verifyAdminIdentity(db, cloud, operatorUsername);
    if (!auth.ok) {
      return { success: false, errMsg: auth.errMsg };
    }

    const ownership = await verifyGardenOwner(db, gardenId, operatorUsername);
    if (!ownership.ok) {
      return { success: false, errMsg: ownership.errMsg };
    }
    const garden = ownership.garden;

    const metaRes = await db
      .collection("garden_meta")
      .where({ gardenId: garden.gardenId, username: operatorUsername })
      .limit(1)
      .get();

    if (metaRes.data.length === 0) {
      return {
        success: true,
        data: {
          gardenId: garden.gardenId,
          name: garden.name,
          hasMeta: false,
          accountUsername: "",
          password: "",
          updateTime: null,
        },
      };
    }

    const meta = metaRes.data[0];
    const password = decryptPassword(meta.passwordCipher);
    return {
      success: true,
      data: {
        gardenId: garden.gardenId,
        name: garden.name,
        hasMeta: true,
        accountUsername: meta.accountUsername || "",
        password,
        updateTime: meta.updateTime || meta.createTime || null,
      },
    };
  } catch (e) {
    return { success: false, errMsg: e.message || "获取园区元信息失败" };
  }
}

// 新增或更新单个园区的元信息（一对一 Upsert）
async function saveGardenMeta(event, { db, cloud }) {
  try {
    const { operatorUsername, gardenId, accountUsername, password } = event;
    const auth = await verifyAdminIdentity(db, cloud, operatorUsername);
    if (!auth.ok) {
      return { success: false, errMsg: auth.errMsg };
    }

    const trimmedAccount = String(accountUsername || "").trim();
    const trimmedPassword = String(password || "").trim();
    if (!trimmedAccount) {
      return { success: false, errMsg: "用户名不能为空" };
    }
    if (!trimmedPassword) {
      return { success: false, errMsg: "密码不能为空" };
    }

    const ownership = await verifyGardenOwner(db, gardenId, operatorUsername);
    if (!ownership.ok) {
      return { success: false, errMsg: ownership.errMsg };
    }
    const numId = ownership.garden.gardenId;

    const passwordCipher = encryptPassword(trimmedPassword);

    const existRes = await db
      .collection("garden_meta")
      .where({ gardenId: numId })
      .limit(1)
      .field({ _id: true })
      .get();

    if (existRes.data.length > 0) {
      await db
        .collection("garden_meta")
        .doc(existRes.data[0]._id)
        .update({
          data: {
            username: operatorUsername,
            accountUsername: trimmedAccount,
            passwordCipher,
            updateTime: db.serverDate(),
          },
        });
    } else {
      await db.collection("garden_meta").add({
        data: {
          gardenId: numId,
          username: operatorUsername,
          accountUsername: trimmedAccount,
          passwordCipher,
          createTime: db.serverDate(),
          updateTime: db.serverDate(),
        },
      });
    }

    return { success: true, data: { gardenId: numId } };
  } catch (e) {
    return { success: false, errMsg: e.message || "保存园区元信息失败" };
  }
}

// 清空/删除单个园区的元信息（保留园区本身）
async function deleteGardenMeta(event, { db, cloud }) {
  try {
    const { operatorUsername, gardenId } = event;
    const auth = await verifyAdminIdentity(db, cloud, operatorUsername);
    if (!auth.ok) {
      return { success: false, errMsg: auth.errMsg };
    }

    const ownership = await verifyGardenOwner(db, gardenId, operatorUsername);
    if (!ownership.ok) {
      return { success: false, errMsg: ownership.errMsg };
    }

    await db
      .collection("garden_meta")
      .where({ gardenId: ownership.garden.gardenId, username: operatorUsername })
      .remove();

    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e.message || "清空园区元信息失败" };
  }
}

module.exports = {
  encryptPassword,
  decryptPassword,
  getGardenMetaList,
  getGardenMetaDetail,
  saveGardenMeta,
  deleteGardenMeta,
};
