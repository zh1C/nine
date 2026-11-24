// utils/voiceDishMatcher.js
// 单餐别「确定性归一化 Contain + Fuse.js 多字段加权模糊检索」融合引擎
// 规则：
// 1. 仅在当前餐别内匹配，不跨餐别查询；
// 2. 命中原名称时继续通过归一化 contain 召回全部包含变体（原名称默认勾选，包含变体列在下方备选）；
// 3. 无原名称与包含命中时，通过 Fuse.js 在归一化名/原名/模糊音/全拼/首字母上多维加权模糊召回；
// 4. 所有候选均采用完全独立的复选框，互不排斥。

const FuseModule = require("../libs/fuse");
const Fuse = FuseModule.default || FuseModule;

function cleanCompact(str) {
  if (!str || typeof str !== "string") return "";
  return str.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

// 常见食堂食材同义词归一化（仅用于比对索引，不修改展示菜名）
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

// 为菜品补充统一的归一化与拼音衍生索引字段
function enrichDishForSearch(dish) {
  if (!dish) return dish;
  const _compact = cleanCompact(dish.name);
  const _norm = normalizeDishAlias(dish.name);
  const _py = String(dish._py || "").trim();
  const _pyFuzzy = String(dish._pyFuzzy || "").trim();
  const _pyCompact = _py.replace(/\s+/g, "");
  const _pyInit =
    dish._pyInit ||
    (_py
      ? _py
          .split(/\s+/)
          .map((s) => s[0] || "")
          .join("")
      : "");
  return {
    ...dish,
    _compact,
    _norm,
    _py,
    _pyFuzzy,
    _pyCompact,
    _pyInit,
  };
}

function buildCandidateView(dish, gardens = [], checked = false, isPrimary = false) {
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
    isPrimary: !!isPrimary,
  };
}

// 判断是否为等长原名称命中（字面精确 / 同义词精确 / 等长全拼或模糊音）
function getBaseMatchType(seg, dish) {
  const segCompact = cleanCompact(seg.text);
  const segNorm = normalizeDishAlias(seg.text);
  if (!segCompact || !dish._compact) return null;
  if (dish._compact === segCompact) return "精确匹配";
  if (dish._norm === segNorm) return "同义词匹配";
  if (
    dish._compact.length === segCompact.length &&
    seg._py &&
    dish._py &&
    (dish._py === seg._py || (seg._pyFuzzy && dish._pyFuzzy && dish._pyFuzzy === seg._pyFuzzy))
  ) {
    return "同音匹配";
  }
  return null;
}

// 判断归一化后的菜品是否 contain（包含）输入词条（非自身原名项）
function isNormalizedContainVariant(seg, dish) {
  const segCompact = cleanCompact(seg.text);
  const segNorm = normalizeDishAlias(seg.text);

  // 1. 去标点原名包含（例如说「鸡蛋」命中「番茄炒鸡蛋」、说「炒青菜」命中「蒜蓉炒青菜」「炒青菜(隔天送)」）
  if (segCompact.length >= 2 && dish._compact.length > segCompact.length && dish._compact.includes(segCompact)) {
    return true;
  }

  // 2. 同义词归一化包含（例如说「西红柿」归一为「番茄」，命中「番茄炒蛋」「番茄牛腩」）
  if (segNorm.length >= 2 && dish._norm.length > segNorm.length && dish._norm.includes(segNorm)) {
    return true;
  }

  // 3. 连续拼音/模糊音音节包含（例如说「宫爆鸡丁」命中「特色宫保鸡丁」「宫保鸡丁(隔天送)」）
  const segFuzzy = String(seg._pyFuzzy || seg._py || "").trim();
  const dishFuzzy = String(dish._pyFuzzy || dish._py || "").trim();
  if (segFuzzy && dishFuzzy) {
    const segSyls = segFuzzy.split(/\s+/).filter(Boolean);
    const dishSyls = dishFuzzy.split(/\s+/).filter(Boolean);
    if (segSyls.length >= 2 && dishSyls.length > segSyls.length) {
      const needle = ` ${segSyls.join(" ")} `;
      const haystack = ` ${dishSyls.join(" ")} `;
      if (haystack.includes(needle)) return true;
    }
  }

  return false;
}

function isPrefixContain(seg, dish) {
  const segCompact = cleanCompact(seg.text);
  const segNorm = normalizeDishAlias(seg.text);
  if (segCompact && dish._compact.startsWith(segCompact)) return true;
  if (segNorm && dish._norm.startsWith(segNorm)) return true;
  const segFuzzy = String(seg._pyFuzzy || seg._py || "").trim();
  const dishFuzzy = String(dish._pyFuzzy || dish._py || "").trim();
  if (segFuzzy && dishFuzzy && (` ${dishFuzzy} `).startsWith(` ${segFuzzy} `)) return true;
  return false;
}

function sortContainVariants(seg, dishes) {
  return [...dishes].sort((a, b) => {
    const aPrefix = isPrefixContain(seg, a) ? 0 : 1;
    const bPrefix = isPrefixContain(seg, b) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    if (a._compact.length !== b._compact.length) return a._compact.length - b._compact.length;
    return a.name.localeCompare(b.name);
  });
}

// 第 3 层：利用 Fuse.js 对汉字归一化名与拼音特征进行多维加权模糊召回（处理跳字、错音字、语序微调）
function recallFuzzyByFuse(seg, availableDishes, maxResults = 6) {
  if (!availableDishes.length) return [];
  const segNorm = normalizeDishAlias(seg.text);
  const segCompact = cleanCompact(seg.text);
  const segPy = String(seg._py || "").trim();
  const segPyFuzzy = String(seg._pyFuzzy || "").trim();

  if (segNorm.length < 2 && segCompact.length < 2) return [];

  const bestScoreById = new Map();
  const dishById = new Map();
  availableDishes.forEach((d) => dishById.set(d._id, d));

  const recordHits = (hits, weightScale = 1) => {
    for (const h of hits) {
      const adjusted = (typeof h.score === "number" ? h.score : 0.5) * weightScale;
      const prev = bestScoreById.get(h.item._id);
      if (prev === undefined || adjusted < prev) {
        bestScoreById.set(h.item._id, adjusted);
      }
    }
  };

  // 1. 汉字维度 Bitap 检索（开启 ignoreLocation + ignoreFieldNorm，解决「番茄蛋」跳字、「紫菜花蛋汤」乱序等）
  const zhFuse = new Fuse(availableDishes, {
    includeScore: true,
    ignoreLocation: true,
    ignoreFieldNorm: true,
    threshold: 0.36,
    minMatchCharLength: 2,
    keys: [
      { name: "_norm", weight: 0.65 },
      { name: "_compact", weight: 0.35 },
    ],
  });
  if (segNorm.length >= 2) {
    recordHits(zhFuse.search(segNorm), 1);
  }
  if (segCompact.length >= 2 && segCompact !== segNorm) {
    recordHits(zhFuse.search(segCompact), 1.02);
  }

  // 2. 拼音维度 Bitap 检索（解决「红烧白骨 hon sao bai gu」vs「红烧排骨 hon sao pai gu」等近音声韵母偏差）
  if (segPyFuzzy && segPyFuzzy.length >= 5) {
    const pyFuse = new Fuse(availableDishes, {
      includeScore: true,
      ignoreLocation: true,
      ignoreFieldNorm: true,
      threshold: 0.25,
      minMatchCharLength: 4,
      keys: [
        { name: "_pyFuzzy", weight: 0.7 },
        { name: "_py", weight: 0.3 },
      ],
    });
    recordHits(pyFuse.search(segPyFuzzy), 0.95);
    if (segPy && segPy !== segPyFuzzy) {
      recordHits(pyFuse.search(segPy), 0.98);
    }
  }

  const ranked = Array.from(bestScoreById.entries())
    .filter(([, score]) => score <= 0.38)
    .sort((a, b) => {
      if (Math.abs(a[1] - b[1]) > 0.02) return a[1] - b[1];
      return dishById.get(a[0])._compact.length - dishById.get(b[0])._compact.length;
    })
    .slice(0, maxResults)
    .map(([id]) => dishById.get(id));

  return ranked;
}

/**
 * 单餐别融合匹配主函数
 */
function matchDishesInCategory({ segments = [], candidateDishes = [], selectedDishes = [], gardens = [] }) {
  const indexedCandidates = (candidateDishes || []).map(enrichDishForSearch);
  const candidateById = {};
  indexedCandidates.forEach((d) => {
    candidateById[d._id] = d;
  });

  const selectedIdSet = new Set((selectedDishes || []).map((d) => d._id));
  const enrichedSelected = (selectedDishes || []).map((d) => candidateById[d._id] || enrichDishForSearch(d));
  const availableDishes = indexedCandidates.filter((d) => !selectedIdSet.has(d._id));

  return (segments || []).map((rawSeg, idx) => {
    const seg = typeof rawSeg === "string" ? { text: rawSeg, _py: "", _pyFuzzy: "" } : rawSeg;
    const spokenText = String(seg.text || "").trim();
    const id = `vseg_${idx}`;

    // 第 1 层：未选池中检索等长原名称命中
    const baseHits = [];
    let firstBaseTag = "精确匹配";
    for (const d of availableDishes) {
      const mType = getBaseMatchType(seg, d);
      if (mType) {
        if (baseHits.length === 0) firstBaseTag = mType;
        baseHits.push(d);
      }
    }
    const baseIdSet = new Set(baseHits.map((d) => d._id));

    // 第 2 层：其余未选池中检索归一化 Contain 关联备选（不因原名命中而截断！）
    const rawContainHits = availableDishes.filter(
      (d) => !baseIdSet.has(d._id) && isNormalizedContainVariant(seg, d)
    );
    const containHits = sortContainVariants(seg, rawContainHits);

    // 分支 A：唯一原名称命中 + 无其他包含变体
    if (baseHits.length === 1 && containHits.length === 0) {
      const primary = buildCandidateView(baseHits[0], gardens, true, true);
      return {
        id,
        spokenText,
        status: "matched",
        matchTag: firstBaseTag,
        candidates: [primary],
        selectedIds: [primary._id],
      };
    }

    // 分支 B：唯一原名称命中 + 存在包含（Contain）备选变体 -> 原名置顶默认勾选，其余列在下方备选（独立复选框）
    if (baseHits.length === 1 && containHits.length > 0) {
      const primary = buildCandidateView(baseHits[0], gardens, true, true);
      const variants = containHits.map((d) => buildCandidateView(d, gardens, false, false));
      return {
        id,
        spokenText,
        status: "matched_variants",
        matchTag: `默认原名 · 含 ${variants.length} 道备选`,
        candidates: [primary, ...variants],
        selectedIds: [primary._id],
      };
    }

    // 分支 C：多个原名称命中（例如同音重名菜）
    if (baseHits.length > 1) {
      const combined = [...baseHits, ...containHits].map((d) =>
        buildCandidateView(d, gardens, false, false)
      );
      return {
        id,
        spokenText,
        status: "multiple",
        matchTag: `命中 ${combined.length} 道候选`,
        candidates: combined,
        selectedIds: [],
      };
    }

    // 分支 D：未选池无原名称，检查是否当天菜单中已选过原名称菜品
    const existingHit = enrichedSelected.find((d) => !!getBaseMatchType(seg, d));
    if (existingHit) {
      // 若仍有未选的包含变体（例如「炒青菜」已选，但「蒜蓉炒青菜」「炒青菜(隔天送)」未选），穿透展示备选！
      if (containHits.length > 0) {
        return {
          id,
          spokenText,
          status: "multiple",
          matchTag: `原同名菜已选 · 含 ${containHits.length} 道备选`,
          candidates: containHits.map((d) => buildCandidateView(d, gardens, false, false)),
          selectedIds: [],
        };
      }
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

    // 分支 E：无原名但有归一化 Contain 包含命中（例如说「西红柿」召回「番茄炒蛋」「番茄牛腩」）
    if (containHits.length > 0) {
      return {
        id,
        spokenText,
        status: "multiple",
        matchTag: containHits.length === 1 ? "包含匹配（请勾选）" : `包含匹配 ${containHits.length} 道候选`,
        candidates: containHits.map((d) => buildCandidateView(d, gardens, false, false)),
        selectedIds: [],
      };
    }

    // 第 3 层（分支 F）：Fuse.js 多字段加权近似兜底（跳字「番茄蛋」、近音错字「红烧白骨」等）
    const fuseHits = recallFuzzyByFuse(seg, availableDishes, 6);
    if (fuseHits.length > 0) {
      return {
        id,
        spokenText,
        status: "multiple",
        matchTag: fuseHits.length === 1 ? "模糊匹配（请勾选）" : `模糊匹配 ${fuseHits.length} 道候选`,
        candidates: fuseHits.map((d) => buildCandidateView(d, gardens, false, false)),
        selectedIds: [],
      };
    }

    // 分支 G：未找到匹配
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

/**
 * 供 dishPicker 手动搜索框复用的混合搜索引擎：
 * 1. 先返回精确/归一化包含/全拼包含/首字母包含的确定性结果（支持 1 字搜索、首字母 fqcd、同义词「西红柿」）；
 * 2. 若输入长度 >= 2，再补充 Fuse.js 模糊跳字/错别字结果（如输入「番茄蛋」搜出「番茄炒鸡蛋」）。
 */
function searchDishesForPicker(allDishes = [], selectedDishes = [], keyword = "") {
  const excluded = new Set((selectedDishes || []).map((d) => d._id));
  const available = (allDishes || []).filter((d) => !excluded.has(d._id));
  const rawQuery = String(keyword || "").trim();
  if (!rawQuery) return available;

  const indexed = available.map(enrichDishForSearch);
  const qLower = rawQuery.toLowerCase();
  const qCompact = cleanCompact(rawQuery);
  const qNorm = normalizeDishAlias(rawQuery);

  const directHits = [];
  const directIds = new Set();

  for (const d of indexed) {
    const matchedDirect =
      d.name.toLowerCase().includes(qLower) ||
      (qCompact && d._compact.includes(qCompact)) ||
      (qNorm && d._norm.includes(qNorm)) ||
      (qCompact && d._pyCompact && d._pyCompact.includes(qCompact)) ||
      (qCompact && d._pyInit && d._pyInit.includes(qCompact));
    if (matchedDirect) {
      directIds.add(d._id);
      directHits.push(d);
    }
  }

  directHits.sort((a, b) => {
    const aExact = a._norm === qNorm || a._compact === qCompact ? 0 : 1;
    const bExact = b._norm === qNorm || b._compact === qCompact ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aPre = a._norm.startsWith(qNorm) || (qCompact && a._pyInit.startsWith(qCompact)) ? 0 : 1;
    const bPre = b._norm.startsWith(qNorm) || (qCompact && b._pyInit.startsWith(qCompact)) ? 0 : 1;
    if (aPre !== bPre) return aPre - bPre;
    return a._compact.length - b._compact.length;
  });

  let fuzzyAppended = [];
  if (qCompact.length >= 2) {
    const remaining = indexed.filter((d) => !directIds.has(d._id));
    if (remaining.length > 0) {
      const isAsciiQuery = /^[a-z0-9]+$/.test(qCompact);
      const pickerFuse = new Fuse(remaining, {
        includeScore: true,
        ignoreLocation: true,
        ignoreFieldNorm: true,
        threshold: isAsciiQuery ? 0.28 : 0.36,
        minMatchCharLength: 2,
        keys: isAsciiQuery
          ? [
              { name: "_pyCompact", weight: 0.6 },
              { name: "_pyInit", weight: 0.4 },
            ]
          : [
              { name: "_norm", weight: 0.65 },
              { name: "_compact", weight: 0.35 },
            ],
      });
      fuzzyAppended = pickerFuse
        .search(isAsciiQuery ? qCompact : qNorm)
        .filter((r) => (typeof r.score === "number" ? r.score <= 0.36 : true))
        .map((r) => r.item);
    }
  }

  // 还原原始菜品引用返回给 dishPicker 渲染
  const origById = new Map(available.map((d) => [d._id, d]));
  return [...directHits, ...fuzzyAppended].map((d) => origById.get(d._id) || d);
}

// 独立复选框切换：仅翻转当前点击的 dishId，绝不排斥同词条下的其他候选菜品
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
  enrichDishForSearch,
  matchDishesInCategory,
  searchDishesForPicker,
  toggleVoiceCandidate,
  collectSelectedDishIds,
};
