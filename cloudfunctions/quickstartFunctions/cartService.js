const https = require("https");
const crypto = require("crypto");
const {
  encryptPassword,
  decryptPassword,
  verifyAdminIdentity,
  verifyGardenOwner,
} = require("./gardenMetaService");

const API_HOST = "weixin.lctxmy.com";
const SESSION_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.7(0x13080712) UnifiedPCMacWechat(0xf2642050) XWEB/26154",
  xweb_xhr: "1",
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
  referer: "https://servicewechat.com/wx3a070971fceb708e/13/page-frame.html",
  "accept-language": "zh-CN,zh;q=0.9",
  priority: "u=1, i",
};

function md5(text) {
  return crypto.createHash("md5").update(String(text), "utf8").digest("hex");
}

function isApiOk(body) {
  return Boolean(body && body.state === true && Number(body.code) === 200);
}

function apiErrMsg(body, fallback) {
  return (body && (body.msg || body.debugMsg)) || fallback;
}

function isAuthExpired(statusCode, body) {
  if (statusCode === 401 || statusCode === 403) return true;
  if (!body) return false;
  const code = Number(body.code);
  if (code === 401 || code === 403) return true;
  const msg = String(body.msg || body.debugMsg || "");
  return /登录|session|会话|超时|过期|未授权/i.test(msg);
}

function extractSessionCookie(headers) {
  const setCookies = headers && headers["set-cookie"];
  const list = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  for (const item of list) {
    const match = String(item).match(/SESSION=[^;]+/);
    if (match) return match[0];
  }
  return "";
}

function requestApi({ method, path, cookie, form, contentType }) {
  return new Promise((resolve, reject) => {
    let payload = "";
    const headers = { ...COMMON_HEADERS };

    if (cookie) {
      headers.Cookie = cookie;
    }

    if (form) {
      payload = new URLSearchParams(form).toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    } else if (method === "POST") {
      headers["Content-Type"] = contentType || "application/x-www-form-urlencoded";
      headers["Content-Length"] = 0;
    } else if (contentType) {
      headers["content-type"] = contentType;
    }

    const req = https.request(
      {
        hostname: API_HOST,
        path,
        method,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let body = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch (e) {
            body = null;
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("外部接口请求超时"));
    });
    req.on("error", reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function signSessionToken({ operatorUsername, gardenId, sessionCookie, dlrGuid }) {
  const payload = JSON.stringify({
    u: operatorUsername,
    g: gardenId,
    c: sessionCookie,
    d: dlrGuid,
    exp: Date.now() + SESSION_TTL_MS,
  });
  return encryptPassword(payload);
}

function parseSessionToken(token, operatorUsername, gardenId) {
  if (!token) return null;
  try {
    const data = JSON.parse(decryptPassword(token));
    if (data.u !== operatorUsername || data.g !== gardenId) return null;
    if (!data.c || !data.d || Date.now() >= data.exp) return null;
    return { sessionCookie: data.c, dlrGuid: data.d };
  } catch (e) {
    return null;
  }
}

async function loginAndGetDlr(db, gardenId, operatorUsername) {
  const metaRes = await db
    .collection("garden_meta")
    .where({ gardenId, username: operatorUsername })
    .limit(1)
    .get();

  if (metaRes.data.length === 0) {
    return { ok: false, status: "NO_META", errMsg: "该园区尚未配置账号密码" };
  }

  const meta = metaRes.data[0];
  const plainPassword = decryptPassword(meta.passwordCipher);

  // 1. 登录获取 SESSION
  const loginRes = await requestApi({
    method: "POST",
    path: "/yb/web/base/login",
    form: {
      userName: meta.accountUsername,
      password: md5(plainPassword),
    },
  });

  if (!isApiOk(loginRes.body)) {
    return {
      ok: false,
      status: "LOGIN_FAILED",
      errMsg: apiErrMsg(loginRes.body, "外部平台登录失败"),
    };
  }

  const sessionCookie = extractSessionCookie(loginRes.headers);
  if (!sessionCookie) {
    return {
      ok: false,
      status: "LOGIN_FAILED",
      errMsg: "登录成功但未获取到 SESSION",
    };
  }

  const deptName = (loginRes.body.data && (loginRes.body.data.deptName || loginRes.body.data.realName)) || "";

  // 2. 获取 dlr 列表
  const dlrRes = await requestApi({
    method: "GET",
    path: "/yb/index/dlrlist",
    cookie: sessionCookie,
    contentType: "application/json",
  });

  const dlrList = dlrRes.body && Array.isArray(dlrRes.body.data) ? dlrRes.body.data : [];
  if (!isApiOk(dlrRes.body) || dlrList.length === 0 || !dlrList[0].guid) {
    return {
      ok: false,
      status: "DLR_FAILED",
      errMsg: apiErrMsg(dlrRes.body, "未获取到供应商信息"),
      deptName,
    };
  }

  return {
    ok: true,
    sessionCookie,
    dlrGuid: dlrList[0].guid,
    dlrName: dlrList[0].dlrName || "",
    deptName,
  };
}

// 阶段 1：单园区初始化（校验元信息 → 登录 → 获取 dlr → 检查购物车为空）
async function cartInitGarden(event, { db, cloud }) {
  try {
    const { operatorUsername, gardenId } = event;
    const auth = await verifyAdminIdentity(db, cloud, operatorUsername);
    if (!auth.ok) return { success: false, errMsg: auth.errMsg };

    const ownership = await verifyGardenOwner(db, gardenId, operatorUsername);
    if (!ownership.ok) return { success: false, errMsg: ownership.errMsg };
    const numId = ownership.garden.gardenId;

    const session = await loginAndGetDlr(db, numId, operatorUsername);
    if (!session.ok) {
      return {
        success: true,
        data: {
          status: session.status,
          errMsg: session.errMsg,
          deptName: session.deptName || "",
        },
      };
    }

    // 3. 检查购物车是否为空
    const countRes = await requestApi({
      method: "POST",
      path: "/yb/cart/getcart/count/v2",
      cookie: session.sessionCookie,
    });

    if (!isApiOk(countRes.body)) {
      return {
        success: true,
        data: {
          status: "CHECK_CART_FAILED",
          errMsg: apiErrMsg(countRes.body, "检查购物车数量失败"),
          deptName: session.deptName,
          dlrName: session.dlrName,
        },
      };
    }

    const totalAmount = Number((countRes.body.data && countRes.body.data.totalAmount) || 0);
    const totalPrice = String((countRes.body.data && countRes.body.data.totalPrice) || "0.0");

    if (totalAmount > 0) {
      return {
        success: true,
        data: {
          status: "CART_NOT_EMPTY",
          cartCount: totalAmount,
          totalPrice,
          deptName: session.deptName,
          dlrName: session.dlrName,
          errMsg: `购物车当前已有 ${totalAmount} 件商品，请先清空后再试`,
        },
      };
    }

    const sessionToken = signSessionToken({
      operatorUsername,
      gardenId: numId,
      sessionCookie: session.sessionCookie,
      dlrGuid: session.dlrGuid,
    });

    return {
      success: true,
      data: {
        status: "READY",
        sessionToken,
        deptName: session.deptName,
        dlrName: session.dlrName,
      },
    };
  } catch (e) {
    return { success: false, errMsg: e.message || "初始化园区失败" };
  }
}

function toPositiveInt(value) {
  const clean = Math.round(Number(value) * 1000) / 1000;
  return Math.max(1, Math.ceil(clean));
}

function mapCandidates(list) {
  return list.slice(0, 10).map((p) => ({
    pdtname: String(p.pdtname || "").trim(),
    unit: p.unit || p.pdtUnit || "",
    saleCode: p.saleCode || "",
  }));
}

// 阶段 2：单园区小批量搜索并加购（含自动续期，不检空车）
async function cartProcessItems(event, { db, cloud }) {
  try {
    const { operatorUsername, gardenId, sessionToken, items = [] } = event;
    const auth = await verifyAdminIdentity(db, cloud, operatorUsername);
    if (!auth.ok) return { success: false, errMsg: auth.errMsg };

    const ownership = await verifyGardenOwner(db, gardenId, operatorUsername);
    if (!ownership.ok) return { success: false, errMsg: ownership.errMsg };
    const numId = ownership.garden.gardenId;

    let currentToken = sessionToken || "";
    let session = parseSessionToken(currentToken, operatorUsername, numId);
    let renewedInCall = false;

    const ensureFreshSession = async () => {
      const fresh = await loginAndGetDlr(db, numId, operatorUsername);
      if (!fresh.ok) {
        throw new Error(fresh.errMsg || "重新登录失败");
      }
      session = { sessionCookie: fresh.sessionCookie, dlrGuid: fresh.dlrGuid };
      currentToken = signSessionToken({
        operatorUsername,
        gardenId: numId,
        sessionCookie: fresh.sessionCookie,
        dlrGuid: fresh.dlrGuid,
      });
      renewedInCall = true;
    };

    if (!session) {
      await ensureFreshSession();
    }

    const requestWithAutoRenew = async (reqOptions) => {
      let res = await requestApi({ ...reqOptions, cookie: session.sessionCookie });
      if (!isApiOk(res.body) && isAuthExpired(res.statusCode, res.body) && !renewedInCall) {
        await ensureFreshSession();
        const nextForm = reqOptions.form && reqOptions.form.dlrGuid
          ? { ...reqOptions.form, dlrGuid: session.dlrGuid }
          : reqOptions.form;
        res = await requestApi({ ...reqOptions, cookie: session.sessionCookie, form: nextForm });
      }
      return res;
    };

    const results = [];

    for (const item of items) {
      const queryName = String(item.name || "").trim();
      const weight = toPositiveInt(item.weight);

      if (!queryName) {
        results.push({
          rowId: item.rowId,
          queryName,
          weight,
          status: "NOT_FOUND",
          reason: "菜品名称不能为空",
          candidates: [],
        });
        continue;
      }

      try {
        const searchRes = await requestWithAutoRenew({
          method: "POST",
          path: "/yb/selectPdtList",
          form: {
            keywords: queryName,
            pageNumber: "1",
            pageSize: "20",
            dlrGuid: session.dlrGuid,
          },
        });

        if (!isApiOk(searchRes.body)) {
          results.push({
            rowId: item.rowId,
            queryName,
            weight,
            status: "ADD_FAILED",
            reason: apiErrMsg(searchRes.body, "搜索菜品失败"),
            candidates: [],
          });
          continue;
        }

        const list = Array.isArray(searchRes.body.data) ? searchRes.body.data : [];
        const total = searchRes.body.pageObj
          ? Number(searchRes.body.pageObj.totalRecords)
          : list.length;

        if (list.length === 0 || total === 0) {
          results.push({
            rowId: item.rowId,
            queryName,
            weight,
            status: "NOT_FOUND",
            reason: "未搜索到匹配菜品",
            candidates: [],
          });
          continue;
        }

        if (total > 1 || list.length > 1) {
          results.push({
            rowId: item.rowId,
            queryName,
            weight,
            status: "MULTIPLE_MATCH",
            reason: `搜索到 ${total} 个菜品，请调整为精确名称`,
            candidates: mapCandidates(list),
          });
          continue;
        }

        const product = list[0];
        const productName = String(product.pdtname || "").trim();
        if (productName !== queryName) {
          results.push({
            rowId: item.rowId,
            queryName,
            weight,
            status: "NAME_MISMATCH",
            reason: `搜索结果「${productName}」与菜名不一致`,
            candidates: mapCandidates(list),
          });
          continue;
        }

        const format = product.unit || product.pdtUnit || "";
        if (!format) {
          results.push({
            rowId: item.rowId,
            queryName,
            weight,
            status: "ADD_FAILED",
            reason: "商品缺少单位信息",
            candidates: [],
          });
          continue;
        }

        const addRes = await requestWithAutoRenew({
          method: "POST",
          path: "/yb/cart/addcart/v2",
          form: {
            saleCode: product.saleCode,
            format,
            weight: String(weight),
            dlrGuid: session.dlrGuid,
          },
        });

        if (!isApiOk(addRes.body)) {
          results.push({
            rowId: item.rowId,
            queryName,
            weight,
            format,
            status: "ADD_FAILED",
            reason: apiErrMsg(addRes.body, "加入购物车失败"),
            candidates: [],
          });
          continue;
        }

        results.push({
          rowId: item.rowId,
          queryName,
          weight,
          format,
          saleCode: product.saleCode,
          status: "SUCCESS",
          reason: "",
          candidates: [],
        });
      } catch (itemErr) {
        results.push({
          rowId: item.rowId,
          queryName,
          weight,
          status: "ADD_FAILED",
          reason: itemErr.message || "网络异常",
          candidates: [],
        });
      }
    }

    return {
      success: true,
      data: {
        sessionToken: currentToken,
        results,
      },
    };
  } catch (e) {
    return { success: false, errMsg: e.message || "加入购物车处理失败" };
  }
}

module.exports = {
  cartInitGarden,
  cartProcessItems,
};
