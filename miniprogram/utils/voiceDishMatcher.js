// utils/voiceDishMatcher.js
// 单餐别语音报菜分词与多级匹配器（不跨餐别检索，所有结果均进入确认弹窗由用户手动确认）

function cleanCompact(str) {
  if (!str || typeof str !== "string") return "";
  return str.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

// 常见食堂同义词归一化（仅用于内部比对，不改变展示菜名）
function normalizeDishAlias(str) {
  const s = cleanCompact(str);
  if (!s) return "";
  return s
    .replace(/西红柿/g, "番茄")
    .replace(/马铃薯|洋芋/g, "土豆")
    .replace(/菜花/g, "花菜")
    .replace(/圆白菜|卷心菜|包心菜/g, "包菜")
    .replace(/凤爪/g, "鸡爪")
    .replace(/鸡翅中/g, "鸡中翅")
    .replace(/(炒|煎|蒸|煮|卤|炖)鸡蛋/g, "$1蛋");
}

function cleanSingleSegment(token) {
  if (!token) return "";
  return String(token)
    .trim()
    .replace(/^(?:第[一二三四五六七八九十\d]+[个道菜是：:]*|嗯+|啊+|呃+|噢+|那个|就是|然后|帮我加个|帮我加|帮我选|来一个|来一道|加一个|加一道|要一个|要一道|选一个|选一道|点一个|点一道|来个|加个|要个|选个|点个)+/g, "")
    .replace(/(?:吧|呢|啊|呀|哦|哈|啦|呗)+$/g, "")
    .trim();
}

// 本地口语切分（当用户在弹窗中编辑识别原文并点击重新匹配时可直接使用）
function splitSpokenDishes(rawText, knownDishNames = []) {
  if (!rawText || typeof rawText !== "string") return [];
  const cleaned = rawText.replace(/<\|[^>]+?\|>/g, " ").replace(/\s+/g, " ").trim();
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

  const result = [];
  const seen = new Set();

  for (const raw of roughTokens) {
    const seg = cleanSingleSegment(raw);
    if (!seg) continue;

    if (!knownSet.has(seg) && seg.length >= 5 && /^.{2,}(?:和|跟).{2,}$/.test(seg)) {
      const subParts = seg.split(/(?:和|跟)/);
      for (const sub of subParts) {
        const subSeg = cleanSingleSegment(sub);
        if (subSeg && !seen.has(subSeg)) {
          seen.add(subSeg);
          result.push(subSeg);
        }
      }
      continue;
    }

    if (!seen.has(seg)) {
      seen.add(seg);
      result.push(seg);
    }
  }

  return result;
}

// 计算两个数组或字符串的编辑距离相似度 [0, 1]
function editSimilarity(seqA, seqB) {
  const m = seqA.length;
  const n = seqB.length;
  if (!m || !n) return 0;
  if (m === n) {
    let same = true;
    for (let i = 0; i < m; i++) {
      if (seqA[i] !== seqB[i]) {
        same = false;
        break;
      }
    }
    if (same) return 1;
  }

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = seqA[i - 1] === seqB[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  const maxLen = Math.max(m, n);
  return (maxLen - dp[n]) / maxLen;
}

function buildCandidateView(dish, gardens = [], checked = false) {
  const ingCount = (dish.ingredients || []).length;
  let summary = `${ingCount}种配料`;
  if (Array.isArray(gardens) && gardens.length > 0) {
    let configuredCount = 0;
    gardens.forEach((g) => {
      const ratioArr = (dish.ratios || {})[String(g.gardenId)] || [];
      if (ratioArr.some((r) => r !== undefined && r !== null && r !== "" && parseFloat(r) > 0)) {
        configuredCount++;
      }
    });
    summary = `${ingCount}种配料 · ${configuredCount}/${gardens.length}园区已配`;
  }
  return {
    _id: dish._id,
    name: dish.name,
    imageFileID: dish.imageFileID || "",
    summary,
    checked: !!checked,
  };
}

function isExactOrPhoneticSame(seg, dish) {
  const segCompact = cleanCompact(seg.text);
  const dishCompact = cleanCompact(dish.name);
  if (!segCompact || !dishCompact) return false;
  if (segCompact === dishCompact) return true;
  if (normalizeDishAlias(seg.text) === normalizeDishAlias(dish.name)) return true;
  if (
    segCompact.length === dishCompact.length &&
    seg._py &&
    dish._py &&
    (seg._py === dish._py || (seg._pyFuzzy && dish._pyFuzzy && seg._pyFuzzy === dish._pyFuzzy))
  ) {
    return true;
  }
  return false;
}

function scoreFuzzyCandidate(seg, dish) {
  const segNorm = normalizeDishAlias(seg.text);
  const dishNorm = normalizeDishAlias(dish.name);
  if (!segNorm || !dishNorm) return 0;

  let best = 0;
  const minLen = Math.min(segNorm.length, dishNorm.length);
  const maxLen = Math.max(segNorm.length, dishNorm.length);

  // 1. 字面或同义词归一化后的父子串包含（至少 2 个有效字符，如「土豆丝」->「酸辣土豆丝」）
  if (minLen >= 2 && (dishNorm.includes(segNorm) || segNorm.includes(dishNorm))) {
    best = Math.max(best, 0.82 + (minLen / maxLen) * 0.15);
  }

  // 2. 拼音音节子串或编辑相似度（解决同音简称或个别错音字，如「红烧排古」->「红烧排骨」）
  if (seg._pyFuzzy && dish._pyFuzzy) {
    const segSyls = seg._pyFuzzy.split(" ").filter(Boolean);
    const dishSyls = dish._pyFuzzy.split(" ").filter(Boolean);
    const minSyl = Math.min(segSyls.length, dishSyls.length);
    const maxSyl = Math.max(segSyls.length, dishSyls.length);

    if (minSyl >= 2) {
      const segJoined = ` ${segSyls.join(" ")} `;
      const dishJoined = ` ${dishSyls.join(" ")} `;
      if (dishJoined.includes(segJoined) || segJoined.includes(dishJoined)) {
        best = Math.max(best, 0.78 + (minSyl / maxSyl) * 0.14);
      }
      const pySim = editSimilarity(segSyls, dishSyls);
      if (pySim >= 0.72) {
        best = Math.max(best, pySim * 0.92);
      }
    }
  }

  // 3. 字符级编辑距离相似度
  if (maxLen >= 2) {
    const charSim = editSimilarity(segNorm, dishNorm);
    if (charSim >= 0.65) {
      best = Math.max(best, charSim * 0.9);
    }
  }

  return best;
}

/**
 * 仅在当前餐别的候选池中匹配识别词条
 * @param {Object} params
 * @param {Array<{text: string, _py?: string, _pyFuzzy?: string}>} params.segments
 * @param {Array} params.candidateDishes 当前餐别全量菜品 (filteredDishes)
 * @param {Array} params.selectedDishes 当前日期+餐别已选菜品 (currentCategoryDishes)
 * @param {Array} params.gardens 园区列表（用于生成配料摘要）
 */
function matchDishesInCategory({ segments = [], candidateDishes = [], selectedDishes = [], gardens = [] }) {
  const selectedIdSet = new Set((selectedDishes || []).map((d) => d._id));
  // 补齐已选菜品的拼音信息（从 candidateDishes 关联）
  const candidateById = {};
  (candidateDishes || []).forEach((d) => {
    candidateById[d._id] = d;
  });
  const enrichedSelected = (selectedDishes || []).map((d) => candidateById[d._id] || d);
  const availableDishes = (candidateDishes || []).filter((d) => !selectedIdSet.has(d._id));

  return (segments || []).map((rawSeg, idx) => {
    const seg = typeof rawSeg === "string" ? { text: rawSeg, _py: "", _pyFuzzy: "" } : rawSeg;
    const spokenText = String(seg.text || "").trim();
    const id = `vseg_${idx}`;
    const segCompact = cleanCompact(spokenText);
    const segNorm = normalizeDishAlias(spokenText);

    // L2: 在未选菜品中检查字面精确或同义词精确匹配
    const exactHits = availableDishes.filter(
      (d) => cleanCompact(d.name) === segCompact || normalizeDishAlias(d.name) === segNorm
    );
    if (exactHits.length === 1) {
      const hit = exactHits[0];
      const isLiteral = cleanCompact(hit.name) === segCompact;
      return {
        id,
        spokenText,
        status: "matched",
        matchTag: isLiteral ? "精确匹配" : "同义词匹配",
        candidates: [buildCandidateView(hit, gardens, true)],
        selectedIds: [hit._id],
      };
    }
    if (exactHits.length > 1) {
      return {
        id,
        spokenText,
        status: "multiple",
        matchTag: `命中 ${exactHits.length} 道候选`,
        candidates: exactHits.map((d) => buildCandidateView(d, gardens, false)),
        selectedIds: [],
      };
    }

    // L3: 在未选菜品中检查等长全拼 / 南北模糊音匹配
    if (seg._py) {
      const phoneticHits = availableDishes.filter((d) => {
        if (cleanCompact(d.name).length !== segCompact.length || !d._py) return false;
        return d._py === seg._py || (seg._pyFuzzy && d._pyFuzzy && d._pyFuzzy === seg._pyFuzzy);
      });
      if (phoneticHits.length === 1) {
        const hit = phoneticHits[0];
        return {
          id,
          spokenText,
          status: "matched",
          matchTag: "同音匹配",
          candidates: [buildCandidateView(hit, gardens, true)],
          selectedIds: [hit._id],
        };
      }
      if (phoneticHits.length > 1) {
        return {
          id,
          spokenText,
          status: "multiple",
          matchTag: `同音候选 ${phoneticHits.length} 道`,
          candidates: phoneticHits.map((d) => buildCandidateView(d, gardens, false)),
          selectedIds: [],
        };
      }
    }

    // L1: 若未命中可用新菜，检查是否已在当天菜单中
    const existingHit = enrichedSelected.find((d) => isExactOrPhoneticSame(seg, d));
    if (existingHit) {
      return {
        id,
        spokenText,
        status: "already_selected",
        matchTag: "已在当天菜单中",
        matchedDishName: existingHit.name,
        candidates: [],
        selectedIds: [],
      };
    }

    // L4: 子串包含与近似编辑距离召回（一律进入 multiple，默认不勾选，由用户手动点选）
    const scored = [];
    for (const dish of availableDishes) {
      const score = scoreFuzzyCandidate(seg, dish);
      if (score >= 0.65) {
        scored.push({ dish, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.dish.name.length - b.dish.name.length);
    const topCandidates = scored.slice(0, 6).map((item) => buildCandidateView(item.dish, gardens, false));

    if (topCandidates.length > 0) {
      return {
        id,
        spokenText,
        status: "multiple",
        matchTag: topCandidates.length === 1 ? "近似菜品（请确认）" : `匹配 ${topCandidates.length} 道候选`,
        candidates: topCandidates,
        selectedIds: [],
      };
    }

    // L5: 当前餐别未找到
    return {
      id,
      spokenText,
      status: "unmatched",
      matchTag: "未找到匹配菜品",
      candidates: [],
      selectedIds: [],
    };
  });
}

// 切换某个词条下候选菜品的选中状态（保持 candidates[].checked 与 selectedIds 一致）
function toggleVoiceCandidate(voiceItems = [], itemIdx, dishId) {
  return voiceItems.map((item, idx) => {
    if (idx !== itemIdx) return item;
    const candidates = (item.candidates || []).map((cand) =>
      cand._id === dishId ? { ...cand, checked: !cand.checked } : cand
    );
    const selectedIds = candidates.filter((c) => c.checked).map((c) => c._id);
    return { ...item, candidates, selectedIds };
  });
}

// 汇总弹窗内所有已勾选的菜品 _id（去重保序）
function collectSelectedDishIds(voiceItems = []) {
  const ids = [];
  const seen = new Set();
  for (const item of voiceItems) {
    for (const cand of item.candidates || []) {
      if (cand.checked && cand._id && !seen.has(cand._id)) {
        seen.add(cand._id);
        ids.push(cand._id);
      }
    }
  }
  return ids;
}

module.exports = {
  cleanCompact,
  normalizeDishAlias,
  splitSpokenDishes,
  matchDishesInCategory,
  toggleVoiceCandidate,
  collectSelectedDishIds,
};
