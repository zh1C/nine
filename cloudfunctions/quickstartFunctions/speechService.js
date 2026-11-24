const https = require("https");

let pinyinFn = null;
try {
  const pinyinPro = require("pinyin-pro");
  pinyinFn = typeof pinyinPro.pinyin === "function" ? pinyinPro.pinyin : null;
} catch (e) {
  console.warn("[speechService] pinyin-pro 未安装，降级为纯文本匹配；部署云函数时请选择『云端安装依赖』");
}

let localSecret = {};
try {
  localSecret = require("./secret.local.json");
} catch (e) {
  localSecret = {};
}

const DEFAULT_MODEL = "FunAudioLLM/SenseVoiceSmall";
const TRANSCRIPTION_HOST = "api.siliconflow.cn";
const TRANSCRIPTION_PATH = "/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // 4MB 安全上限
const CONNECT_TIMEOUT_MS = 4500;  // DNS + TCP + TLS 握手最大等待 4.5s，快速熔断死节点
const RESPONSE_TIMEOUT_MS = 12000; // 握手完成后等待识别结果最大 12s（兼容晚高峰推理排队）
const TOTAL_BUDGET_MS = 22000;    // 整体请求预算 22s，匹配云函数 25s 超时并预留 3s 安全返回窗口
const MAX_RETRIES = 2;            // 最多自动重试 2 次（共最多 3 次尝试）

const MIME_BY_FORMAT = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  m4a: "audio/mp4",
  pcm: "audio/pcm",
};

function getApiKey() {
  return (process.env.SILICONFLOW_API_KEY || localSecret.siliconflowApiKey || "").trim();
}

// 清洗 SenseVoice 可能携带的特殊标记，例如 <|zh|><|NEUTRAL|><|Speech|><|withitn|>
function cleanSenseVoiceText(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();
}

// 南北口音模糊音归一化：平翘舌、前后鼻音、鼻边音
function normalizeFuzzySyllable(syllable) {
  let s = String(syllable || "").toLowerCase().trim();
  if (!s) return "";
  s = s.replace(/^(zh|ch|sh)/, (m) => m[0]);
  if (s.startsWith("l")) s = "n" + s.slice(1);
  s = s.replace(/(i|e|a)ng$/, "$1n");
  return s;
}

function toPhonetics(text) {
  if (!pinyinFn || !text || typeof text !== "string") {
    return { _py: "", _pyFuzzy: "", _pyInit: "" };
  }
  const compact = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  if (!compact) return { _py: "", _pyFuzzy: "", _pyInit: "" };
  try {
    const arr = pinyinFn(compact, { toneType: "none", type: "array" });
    if (!Array.isArray(arr) || arr.length === 0) {
      return { _py: "", _pyFuzzy: "", _pyInit: "" };
    }
    const lowerArr = arr.map((item) => String(item || "").toLowerCase().trim()).filter(Boolean);
    return {
      _py: lowerArr.join(" "),
      _pyFuzzy: lowerArr.map(normalizeFuzzySyllable).join(" "),
      _pyInit: lowerArr.map((s) => s[0] || "").join(""),
    };
  } catch (e) {
    console.warn("[speechService] 拼音转换失败:", e.message);
    return { _py: "", _pyFuzzy: "", _pyInit: "" };
  }
}

function attachDishPhonetics(dishes) {
  if (!Array.isArray(dishes)) return [];
  return dishes.map((dish) => {
    if (!dish || !dish.name) return dish;
    const { _py, _pyFuzzy, _pyInit } = toPhonetics(dish.name);
    return { ...dish, _py, _pyFuzzy, _pyInit };
  });
}

function cleanSingleSegment(token) {
  if (!token) return "";
  return token
    .trim()
    .replace(/^(?:第[一二三四五六七八九十\d]+[个道菜是：:]*|嗯+|啊+|呃+|噢+|那个|就是|然后|帮我加个|帮我加|帮我选|来一个|来一道|加一个|加一道|要一个|要一道|选一个|选一道|点一个|点一道|来个|加个|要个|选个|点个)+/g, "")
    .replace(/(?:吧|呢|啊|呀|哦|哈|啦|呗)+$/g, "")
    .trim();
}

function splitSpokenDishes(rawText, knownDishNames = []) {
  const cleaned = cleanSenseVoiceText(rawText);
  if (!cleaned) return [];

  const knownSet = new Set(
    Array.isArray(knownDishNames) ? knownDishNames.map((n) => String(n || "").trim()).filter(Boolean) : []
  );

  const roughTokens = cleaned
    .replace(/[,，、。；;！!?？\n\r\t/\\|]+/g, "|")
    .replace(/(?:再来一个|再来一道|再加一个|再加一道|加上一个|加上一道|还有一个|还有一道|外加一个|外加一道|还有|以及|再来|再加|外加)/g, "|")
    .replace(/\s+(?:和|跟|与|加)\s+/g, "|")
    .replace(/\s+/g, "|")
    .split("|");

  const finalTokens = [];
  const seen = new Set();

  for (const rawToken of roughTokens) {
    const seg = cleanSingleSegment(rawToken);
    if (!seg) continue;

    // 若整词不在已知菜品中，且形如「XX和YY / XX跟YY」（两侧均 >=2 字），继续切分
    if (!knownSet.has(seg) && seg.length >= 5 && /^.{2,}(?:和|跟).{2,}$/.test(seg)) {
      const subParts = seg.split(/(?:和|跟)/);
      for (const sub of subParts) {
        const subSeg = cleanSingleSegment(sub);
        if (subSeg && !seen.has(subSeg)) {
          seen.add(subSeg);
          finalTokens.push(subSeg);
        }
      }
      continue;
    }

    if (!seen.has(seg)) {
      seen.add(seg);
      finalTokens.push(seg);
    }
  }

  return finalTokens;
}

function buildTextSegments(rawText, knownDishNames = []) {
  const tokens = splitSpokenDishes(rawText, knownDishNames);
  return tokens.map((text) => ({
    text,
    ...toPhonetics(text),
  }));
}

function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t && typeof t.unref === "function") t.unref();
  });
}

function createHttpError(message, { statusCode = 0, retryable = false } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.retryable = retryable;
  return err;
}

function buildMultipartPayload({ audioBuffer, format = "mp3", model = DEFAULT_MODEL }) {
  const ext = String(format || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const contentType = MIME_BY_FORMAT[ext] || "audio/mpeg";
  const boundary = "----NineVoiceBoundary" + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);

  const modelPart = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `${model}\r\n`,
    "utf8"
  );

  const fileHeader = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="speech.${ext}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
    "utf8"
  );

  const closingPart = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([modelPart, fileHeader, audioBuffer, closingPart]);
  return { boundary, body };
}

function postMultipartOnce({ apiKey, boundary, body, remainingBudgetMs }) {
  return new Promise((resolve, reject) => {
    const reqStartTs = Date.now();
    let settled = false;
    let connectTimer = null;
    let responseTimer = null;

    const clearTimers = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
    };

    const finishResolve = (val) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(val);
    };

    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(err);
    };

    const connectBudget = Math.min(CONNECT_TIMEOUT_MS, Math.max(1500, remainingBudgetMs));

    const req = https.request(
      {
        hostname: TRANSCRIPTION_HOST,
        port: 443,
        path: TRANSCRIPTION_PATH,
        method: "POST",
        family: 4,    // 强制走 IPv4，规避云函数双栈 DNS 命中 IPv6 路由黑洞
        agent: false, // 每次独立建连，避免容器冻结/解冻复用残留半开连接
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Connection: "close",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", (streamErr) => {
          finishReject(
            createHttpError(`读取语音识别响应失败: ${streamErr.message}`, { retryable: true })
          );
        });
        res.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(responseText);
          } catch (e) {
            parsed = null;
          }

          if (res.statusCode >= 200 && res.statusCode < 300 && parsed && typeof parsed.text === "string") {
            finishResolve(parsed.text);
            return;
          }

          const detail =
            (parsed && (parsed.message || (parsed.error && parsed.error.message))) ||
            responseText.slice(0, 200) ||
            `HTTP ${res.statusCode}`;
          // 429 限流与 5xx 服务端抖动可重试；400/401/403 等客户端错误不重试
          const retryable = res.statusCode === 408 || res.statusCode === 429 || res.statusCode >= 500;
          finishReject(
            createHttpError(`语音识别服务异常(${res.statusCode}): ${detail}`, {
              statusCode: res.statusCode,
              retryable,
            })
          );
        });
      }
    );

    const startResponsePhaseTimer = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      const leftAfterConnect = remainingBudgetMs - (Date.now() - reqStartTs);
      const respBudget = Math.min(RESPONSE_TIMEOUT_MS, Math.max(1500, leftAfterConnect));
      responseTimer = setTimeout(() => {
        req.destroy(
          createHttpError("语音识别服务响应超时，请稍后重试", { retryable: true })
        );
      }, respBudget);
      if (responseTimer && typeof responseTimer.unref === "function") responseTimer.unref();
    };

    // 阶段 1：DNS + TCP + TLS 握手限时保护（3.5s 未完成握手立即切断重连）
    connectTimer = setTimeout(() => {
      req.destroy(
        createHttpError("连接语音识别服务握手超时", { retryable: true })
      );
    }, connectBudget);
    if (connectTimer && typeof connectTimer.unref === "function") connectTimer.unref();

    req.on("socket", (socket) => {
      if (socket.secureConnecting === false && !socket.connecting) {
        startResponsePhaseTimer();
      } else {
        socket.once("secureConnect", startResponsePhaseTimer);
      }
    });

    req.on("error", (err) => {
      const isRetryable = err.retryable !== undefined ? err.retryable : true;
      const prefix = err.message && err.message.startsWith("语音识别") ? err.message : `请求语音识别服务失败: ${err.message}`;
      finishReject(createHttpError(prefix, { statusCode: err.statusCode || 0, retryable: isRetryable }));
    });

    req.write(body);
    req.end();
  });
}

async function postMultipartTranscription({ apiKey, audioBuffer, format = "mp3", model = DEFAULT_MODEL }) {
  const { boundary, body } = buildMultipartPayload({ audioBuffer, format, model });
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt > 1 && remaining < 2200) {
      break;
    }

    const attemptStart = Date.now();
    try {
      return await postMultipartOnce({
        apiKey,
        boundary,
        body,
        remainingBudgetMs: Math.max(2000, remaining),
      });
    } catch (err) {
      lastError = err;
      const elapsed = Date.now() - attemptStart;
      const canRetry = err.retryable && attempt <= MAX_RETRIES && deadline - Date.now() >= 2500;
      console.warn(
        `[speechService] 第 ${attempt} 次识别请求失败 (${elapsed}ms, retry=${canRetry}): ${err.message}`
      );
      if (!canRetry) {
        throw err;
      }
      await sleep(200 * attempt);
    }
  }

  throw lastError || new Error("语音识别请求超时，请稍后重试");
}

async function transcribeAudio({ audioBase64, format = "mp3", knownDishNames = [] }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("未配置语音识别 API Key");
  }
  if (!audioBase64 || typeof audioBase64 !== "string") {
    throw new Error("未接收到录音数据");
  }

  const normalizedBase64 = audioBase64.replace(/^data:audio\/[^;]+;base64,/, "").trim();
  if (!normalizedBase64) {
    throw new Error("录音数据为空");
  }

  const audioBuffer = Buffer.from(normalizedBase64, "base64");
  if (audioBuffer.length < 200) {
    throw new Error("录音时长过短或无有效音频");
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    throw new Error("单次录音文件过大，请控制在 30 秒以内");
  }

  const model = (process.env.SILICONFLOW_ASR_MODEL || DEFAULT_MODEL).trim();
  const rawOutput = await postMultipartTranscription({
    apiKey,
    audioBuffer,
    format,
    model,
  });

  const rawText = cleanSenseVoiceText(rawOutput);
  const segments = buildTextSegments(rawText, knownDishNames);
  return { rawText, segments };
}

module.exports = {
  cleanSenseVoiceText,
  toPhonetics,
  attachDishPhonetics,
  splitSpokenDishes,
  buildTextSegments,
  transcribeAudio,
};
