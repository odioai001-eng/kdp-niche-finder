// Amazon.co.jp Kindleストアの検索サジェストを集計し data/suggest.json を更新する（依存なし・Node 18+）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const OUT = 'data/suggest.json';
const html = readFileSync('index.html', 'utf8');

// シードキーワード = 既存の検索分析データ + 固定の基本語
const seeds = new Set(['Kindle 本', 'AI 副業', 'FIRE', '睡眠', '更年期', '発達障害', 'ペット', '老後', '腸活', '投資']);
const m = html.match(/const SEARCH_DATA = \[([\s\S]*?)\n\];/);
if (m) for (const x of m[1].matchAll(/kw:"([^"]+)"/g)) seeds.add(x[1]);
const suffixes = ['']; // キーワードそのままの入力に対するAmazonの候補だけを使う
const TOP_PER_SEED = 5; // 各キーワードでAmazonが上位に出した候補のみ採用
const MAX_ITEMS = 50;

const endpoint = (prefix) =>
  'https://completion.amazon.co.jp/api/2017/suggestions?' +
  new URLSearchParams({
    'page-type': 'Gateway',
    lop: 'ja_JP',
    'site-variant': 'desktop',
    'client-info': 'amazon-search-ui',
    mid: 'A1VC38T7YXB528',
    alias: 'digital-text', // Kindleストア
    prefix,
    limit: '10',
  });

// アダルト系の候補は除外（公開ページに載せないため）
const BLOCK = /セックス|まんこ|ちんこ|おっぱい|エロ|ヌード|無修正|モザイク|アダルト|官能|風俗|ポルノ|痴漢|ハメ|レイプ|AV女優|\bav\b|巨乳|熟女|フェラ|オナ|ぬきたし|生徒会にも穴はある/i;
const isOk = (kw) => !BLOCK.test(kw);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function suggest(prefix) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(endpoint(prefix), { headers: { 'user-agent': 'Mozilla/5.0 (kdp-niche-finder daily job)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      return (j.suggestions || []).map((s) => s.value).filter((v) => v && isOk(v));
    } catch (e) {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

const score = new Map(); // keyword -> {score, hits, seeds:Set}
let ok = 0, fail = 0;
for (const seed of seeds) {
  for (const suf of suffixes) {
    const list = await suggest(seed + suf);
    await sleep(400);
    if (!list) { fail++; continue; }
    ok++;
    list.slice(0, TOP_PER_SEED).forEach((kw, idx) => {
      const e = score.get(kw) || { kw, score: 0, hits: 0, seeds: new Set() };
      e.score += 10 - idx; // 上位表示ほど高得点
      e.hits += 1;
      e.seeds.add(seed);
      score.set(kw, e);
    });
  }
}

// ---- Amazonの実際の上位サジェスト（入力語を指定せず、空入力と頭文字だけで取得） ----
const initials = ['', ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ'.split(''), ...'abcdefghijklmnopqrstuvwxyz'.split('')];
const TOP_PER_INITIAL = 3;
const topMap = new Map(); // kw -> {kw, pos, from, order}
let topOk = 0;
for (const [order, ini] of initials.entries()) {
  const list = await suggest(ini);
  await sleep(400);
  if (!list) continue;
  topOk++;
  list.slice(0, TOP_PER_INITIAL).forEach((kw, pos) => {
    const e = topMap.get(kw);
    if (!e || pos < e.pos) topMap.set(kw, { kw, pos: pos + 1, from: ini || '(空入力)', order });
  });
}

if (ok === 0) {
  console.error('サジェストを1件も取得できませんでした。data/suggest.json は更新しません。');
  process.exit(1);
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { items: [], top: [] };
const prevRank = new Map(prev.items.map((x) => [x.kw, x.rank]));
const prevTop = new Map((prev.top || []).map((x) => [x.kw, x.rank]));
const top = [...topMap.values()]
  .sort((a, b) => a.pos - b.pos || a.order - b.order)
  .slice(0, 50)
  .map((e, i) => ({ rank: i + 1, kw: e.kw, pos: e.pos, from: e.from, prev: prevTop.get(e.kw) ?? null }));

const items = [...score.values()]
  .sort((a, b) => b.score - a.score || b.hits - a.hits)
  .slice(0, MAX_ITEMS)
  .map((e, i) => ({
    rank: i + 1,
    kw: e.kw,
    score: e.score,
    hits: e.hits,
    seeds: [...e.seeds].slice(0, 3),
    prev: prevRank.get(e.kw) ?? null, // null = 新登場
  }));

const jst = new Date(Date.now() + 9 * 3600e3);
const updated = `${jst.getUTCFullYear()}年${String(jst.getUTCMonth() + 1).padStart(2, '0')}月${String(jst.getUTCDate()).padStart(2, '0')}日`;

mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated, source: 'Amazon.co.jp Kindleストア サジェスト', requests: { ok, fail, topOk }, top, items }, null, 1) + '\n');
console.log(`done: top=${top.length}, items=${items.length} (requests ok=${ok}, fail=${fail}, topOk=${topOk})`);
