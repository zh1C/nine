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
const REQUEST_TIMEOUT_MS = 15000;

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

function postMultipartTranscription({ apiKey, audioBuffer, format = "mp3", model = DEFAULT_MODEL }) {
  return new Promise((resolve, reject) => {
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

    const req = https.request(
      {
        hostname: TRANSCRIPTION_HOST,
        port: 443,
        path: TRANSCRIPTION_PATH,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(responseText);
          } catch (e) {
            parsed = null;
          }

          if (res.statusCode >= 200 && res.statusCode < 300 && parsed && typeof parsed.text === "string") {
            resolve(parsed.text);
            return;
          }

          const detail =
            (parsed && (parsed.message || (parsed.error && parsed.error.message))) ||
            responseText.slice(0, 200) ||
            `HTTP ${res.statusCode}`;
          reject(new Error(`语音识别服务异常(${res.statusCode}): ${detail}`));
        });
      }
    );

    req.on("error", (err) => {
      reject(new Error(`请求语音识别服务失败: ${err.message}`));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("语音识别请求超时，请稍后重试"));
    });

    req.write(body);
    req.end();
  });
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
