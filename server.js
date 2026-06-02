// server.js - Sicbo Prediction Server by @sewdangcap
// Deploy on Render.com - Node.js

const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const API_URL =
  "https://demo7892.fun/history/getLastResult?gameId=ktrng_3986&size=100&tableId=398625062021&curPage=1";

// ─── Fetch data from source ───────────────────────────────────────────────────
// Cache lưu data khi được push từ ngoài vào
let cachedData = [];
let lastUpdated = null;

async function fetchData() {
  const { fetch: undiciFetch, Agent } = await import("undici");

  const dispatcher = new Agent({
    connect: { timeout: 10_000 },
    // Giả lập TLS fingerprint như Chrome
    pipelining: 1,
  });

  const headers = {
    ":authority": "demo7892.fun",
    ":method": "GET",
    ":scheme": "https",
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en,vi;q=0.9",
    "authorization": "f03c7ca3baa6561825b10556cbb3ecf8",
    "content-type": "application/json;charset=UTF-8",
    "origin": "https://789clubs.im",
    "priority": "u=1, i",
    "referer": "https://789clubs.im/",
    "sec-ch-ua": '"Chromium";v="148", "Microsoft Edge";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
  };

  try {
    const res = await undiciFetch(API_URL, { headers, dispatcher });
    if (res.ok) {
      const json = await res.json();
      const list = json.data?.resultList || [];
      if (list.length > 0) { cachedData = list; lastUpdated = Date.now(); return list; }
    }
  } catch(e) { console.error("undici fetch lỗi:", e.message); }

  // Dùng cache nếu có
  if (cachedData.length > 0) return cachedData;
  throw new Error("API bị chặn theo IP. Vui lòng POST data lên /push.");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getType(score) {
  if (score >= 3 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 18) return "Tài";
  return "Bão";
}

function viForType(type) {
  const xiuPools = [3,4,5,6,7,8,9,10];
  const taiPools = [11,12,13,14,15,16,17,18];
  const pool = type === "Xỉu" ? xiuPools : taiPools;
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, 3).sort((a,b) => a-b);
  return shuffled.join("-");
}

// ─── ALGORITHMS ───────────────────────────────────────────────────────────────

// 1. Bẻ Cầu / Theo Cầu
function algoStreak(history) {
  if (history.length < 3) return null;
  const types = history.slice(0, 8).map((r) => getType(r.score));
  const streak = types[0];
  let count = 1;
  for (let i = 1; i < types.length; i++) {
    if (types[i] === streak) count++;
    else break;
  }
  if (count >= 4) {
    return { method: "Bẻ Cầu", predict: streak === "Tài" ? "Xỉu" : "Tài", confidence: Math.min(55 + count * 7, 85) };
  }
  if (count >= 2) {
    return { method: "Theo Cầu", predict: streak, confidence: 58 + count * 4 };
  }
  return { method: "Theo Cầu", predict: streak, confidence: 55 };
}

// 2. Markov Chain nâng cao với trọng số phiên gần
function algoMarkov(history) {
  if (history.length < 30) return null;
  const types = history.map((r) => getType(r.score)).filter(t => t !== "Bão");
  const transitions = { Tài: { Tài: 0, Xỉu: 0 }, Xỉu: { Tài: 0, Xỉu: 0 } };
  for (let i = 0; i < types.length - 1; i++) {
    const cur = types[i+1], next = types[i];
    const weight = 1 + (types.length - i) * 0.05;
    if (transitions[cur] && transitions[cur][next] !== undefined) {
      transitions[cur][next] += weight;
    }
  }
  const cur = types[0];
  if (!transitions[cur]) return null;
  const t = transitions[cur];
  const total = t.Tài + t.Xỉu;
  if (total === 0) return null;
  const probTai = t.Tài / total, probXiu = t.Xỉu / total;
  const predict = probTai > probXiu ? "Tài" : "Xỉu";
  return { method: "Markov Nâng Cao", predict, confidence: Math.min(Math.round(Math.max(probTai, probXiu) * 100), 88) };
}

// 3. Tần suất có trọng số theo thời gian
function algoFrequency(history) {
  if (history.length < 15) return null;
  const recent50 = history.slice(0, 50);
  let scoreTai = 0, scoreXiu = 0;
  recent50.forEach((r, i) => {
    const t = getType(r.score);
    const w = 1 / (i + 1);
    if (t === "Tài") scoreTai += w;
    else if (t === "Xỉu") scoreXiu += w;
  });
  const total = scoreTai + scoreXiu;
  if (total === 0) return null;
  const ratioTai = scoreTai / total;
  const predict = ratioTai > 0.58 ? "Xỉu" : ratioTai < 0.42 ? "Tài" : getType(history[0].score);
  const confidence = Math.round(48 + Math.abs(ratioTai - 0.5) * 80);
  return { method: "Tần Suất Trọng Số", predict, confidence: Math.min(confidence, 82) };
}

// 4. Xu hướng điểm tuyến tính
function algoScoreTrend(history) {
  if (history.length < 15) return null;
  const scores = history.slice(0, 15).map((r) => r.score);
  const n = scores.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  scores.forEach((s, i) => {
    const x = n - i;
    sumX += x; sumY += s; sumXY += x * s; sumX2 += x * x;
  });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avg = sumY / n;
  let predict, confidence;
  if (slope > 0.3) { predict = "Tài"; confidence = Math.min(60 + Math.round(slope * 10), 82); }
  else if (slope < -0.3) { predict = "Xỉu"; confidence = Math.min(60 + Math.round(Math.abs(slope) * 10), 82); }
  else { predict = avg >= 10.5 ? "Tài" : "Xỉu"; confidence = 54; }
  return { method: "Xu Hướng Tuyến Tính", predict, confidence };
}

// 5. Fibonacci vị trí
function algoFibonacci(history) {
  if (history.length < 15) return null;
  const types = history.map((r) => getType(r.score));
  const fibIdx = [0, 1, 2, 3, 5, 8, 13];
  const fibTypes = fibIdx.filter((i) => i < types.length).map((i) => types[i]);
  let tai = 0, xiu = 0;
  fibTypes.forEach((t, i) => {
    const w = fibTypes.length - i;
    if (t === "Tài") tai += w;
    else if (t === "Xỉu") xiu += w;
  });
  const total = tai + xiu;
  return { method: "Fibonacci", predict: tai >= xiu ? "Tài" : "Xỉu", confidence: Math.round(50 + (Math.abs(tai - xiu) / total) * 35) };
}

// 6. Cầu xen kẽ (1-1)
function algoAlternating(history) {
  if (history.length < 6) return null;
  const types = history.slice(0, 8).map((r) => getType(r.score));
  let altCount = 0;
  for (let i = 0; i < types.length - 1; i++) {
    if (types[i] !== types[i+1]) altCount++;
  }
  if (altCount >= 6) {
    return { method: "Cầu Xen Kẽ", predict: types[0] === "Tài" ? "Xỉu" : "Tài", confidence: 80 };
  }
  return null;
}

// 7. Pattern nhóm 2-2, 3-3
function algoPairGroup(history) {
  if (history.length < 10) return null;
  const types = history.slice(0, 12).map((r) => getType(r.score));
  const groups = [];
  let cur = types[0], cnt = 1;
  for (let i = 1; i < types.length; i++) {
    if (types[i] === cur) cnt++;
    else { groups.push({ type: cur, count: cnt }); cur = types[i]; cnt = 1; }
  }
  groups.push({ type: cur, count: cnt });
  if (groups.length < 3) return null;
  const g = groups.slice(0, 3);
  if (g[0].count === g[1].count && g[1].count === g[2].count) {
    return { method: "Cầu Nhóm Đều", predict: g[0].type, confidence: 74 };
  }
  if (g[0].count === 1 && g[1].count >= 2) {
    return { method: "Đổi Chiều", predict: g[0].type === "Tài" ? "Xỉu" : "Tài", confidence: 70 };
  }
  return null;
}

// 8. Entropy Shannon
function algoEntropy(history) {
  if (history.length < 20) return null;
  const recent = history.slice(0, 30);
  let tai = 0, xiu = 0;
  recent.forEach(r => { const t = getType(r.score); if (t === "Tài") tai++; else if (t === "Xỉu") xiu++; });
  const total = tai + xiu;
  const pT = tai / total, pX = xiu / total;
  const entropy = -(pT > 0 ? pT * Math.log2(pT) : 0) - (pX > 0 ? pX * Math.log2(pX) : 0);
  const predict = pT > pX ? (entropy > 0.9 ? "Xỉu" : "Tài") : (entropy > 0.9 ? "Tài" : "Xỉu");
  const confidence = Math.round(50 + (1 - entropy) * 30 + Math.abs(pT - pX) * 20);
  return { method: "Entropy Shannon", predict, confidence: Math.min(confidence, 80) };
}

// 9. Ensemble nâng cao với trọng số thuật toán
function algoEnsemble(history) {
  const algos = [
    { result: algoStreak(history),      weight: 2.0 },
    { result: algoMarkov(history),      weight: 2.5 },
    { result: algoFrequency(history),   weight: 1.5 },
    { result: algoScoreTrend(history),  weight: 1.5 },
    { result: algoFibonacci(history),   weight: 1.0 },
    { result: algoAlternating(history), weight: 2.0 },
    { result: algoPairGroup(history),   weight: 1.8 },
    { result: algoEntropy(history),     weight: 1.2 },
  ].filter(a => a.result !== null);

  if (algos.length === 0) return null;

  let scoreTai = 0, scoreXiu = 0;
  algos.forEach(({ result, weight }) => {
    const w = (result.confidence / 100) * weight;
    if (result.predict === "Tài") scoreTai += w;
    else scoreXiu += w;
  });

  const predict = scoreTai >= scoreXiu ? "Tài" : "Xỉu";
  const totalWeight = scoreTai + scoreXiu;
  const rawConf = Math.round((Math.max(scoreTai, scoreXiu) / totalWeight) * 100);
  const confidence = Math.min(Math.max(rawConf, 51), 89);
  const dominantAlgo = [...algos].sort((a,b) => (b.result.confidence * b.weight) - (a.result.confidence * a.weight))[0];
  return { method: "Tổng Hợp AI v2", predict, confidence, thuatToanChinhYeu: dominantAlgo.result.method };
}

// ─── Build pattern string ─────────────────────────────────────────────────────
function buildPattern(history) {
  return history
    .slice(0, 50)
    .map((r) => (getType(r.score) === "Tài" ? "t" : "x"))
    .reverse()
    .join("");
}

// ─── Build prediction response ────────────────────────────────────────────────
function buildPrediction(history) {
  if (!history || history.length === 0) return null;
  const current = history[0];
  const currentNum = parseInt(current.gameNum.replace("#", ""));

  const ensemble = algoEnsemble(history);
  const du_doan = ensemble ? ensemble.predict : getType(current.score) === "Tài" ? "Xỉu" : "Tài";
  const confidence = ensemble ? ensemble.confidence : 55;

  const vi = viForType(du_doan);

  return {
    phien_hien_tai: currentNum,
    ket_qua: getType(current.score),
    xuc_xac: current.facesList,
    phien_du_doan: currentNum + 1,
    du_doan,
    vi,
    do_tin_cay: confidence + "%",
    pattern: buildPattern(history),
    id: "@sewdangcap",
  };
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ status: "online", author: "@sewdangcap", endpoints: ["/sicbo789", "/history", "/algorithms"] });
});

app.get("/sicbo789", async (req, res) => {
  try {
    const history = await fetchData();
    const prediction = buildPrediction(history);
    if (!prediction) return res.status(500).json({ loi: "Không có dữ liệu" });
    res.json(prediction);
  } catch (err) {
    res.status(500).json({ loi: err.message });
  }
});

app.get("/history", async (req, res) => {
  try {
    const history = await fetchData();
    const size = parseInt(req.query.size) || 20;
    const danh_sach = history.slice(0, size).map((r) => ({
      phien: parseInt(r.gameNum.replace("#", "")),
      ket_qua: getType(r.score),
      xuc_xac: r.facesList,
      tong: r.score,
      thoi_gian: r.timeMilli,
    }));
    res.json({ tong_phien: danh_sach.length, danh_sach, id: "@sewdangcap" });
  } catch (err) {
    res.status(500).json({ loi: err.message });
  }
});

app.get("/algorithms", async (req, res) => {
  try {
    const history = await fetchData();
    res.json({
      be_cau: algoStreak(history),
      markov_nang_cao: algoMarkov(history),
      tan_suat_trong_so: algoFrequency(history),
      xu_huong_tuyen_tinh: algoScoreTrend(history),
      fibonacci: algoFibonacci(history),
      cau_xen_ke: algoAlternating(history),
      cau_nhom: algoPairGroup(history),
      entropy: algoEntropy(history),
      tong_hop: algoEnsemble(history),
      id: "@sewdangcap",
    });
  } catch (err) {
    res.status(500).json({ loi: err.message });
  }
});

// POST /push - nhận data từ browser gửi lên (bypass 403)
app.post("/push", (req, res) => {
  try {
    const list = req.body?.data?.resultList || req.body?.resultList || [];
    if (!Array.isArray(list) || list.length === 0)
      return res.status(400).json({ loi: "Không có resultList" });
    cachedData = list;
    lastUpdated = Date.now();
    res.json({ ok: true, da_luu: list.length, thoi_gian: new Date(lastUpdated).toISOString() });
  } catch (err) {
    res.status(500).json({ loi: err.message });
  }
});

// GET /status - kiểm tra cache
app.get("/status", (req, res) => {
  res.json({
    cache: cachedData.length > 0,
    so_phien: cachedData.length,
    cap_nhat_luc: lastUpdated ? new Date(lastUpdated).toISOString() : null,
    api_url: API_URL,
    id: "@sewdangcap",
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Sicbo Server by @sewdangcap running on port ${PORT}`);
});
