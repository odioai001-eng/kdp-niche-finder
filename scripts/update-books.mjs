// Amazon.co.jp Kindleストアの検索結果件数（=競合書籍数の目安）を取得し data/books.json を更新する。
// Amazonに拒否された場合は data/books.json を変更せず、ログに理由を残して正常終了する。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const OUT = 'data/books.json';
const html = readFileSync('index.html', 'utf8');
const m = html.match(/const SEARCH_DATA = \[([\s\S]*?)\n\];/);
const kws = m ? [...m[1].matchAll(/kw:"([^"]+)"/g)].map((x) => x[1]) : [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 「1-16件/1,000件以上の検索結果」「432件の検索結果」などから件数を取り出す
function parseCount(body) {
  const t = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  let r = t.match(/([\d,]+)\s*件以上の検索結果/);
  if (r) return { count: +r[1].replace(/,/g, ''), atLeast: true };
  r = t.match(/([\d,]+)\s*件の検索結果/);
  if (r) return { count: +r[1].replace(/,/g, ''), atLeast: false };
  r = t.match(/\d+-\d+件\s*\/\s*([\d,]+)\s*件/);
  if (r) return { count: +r[1].replace(/,/g, ''), atLeast: false };
  return null;
}

async function countFor(kw) {
  const url = 'https://www.amazon.co.jp/s?' + new URLSearchParams({ k: kw, i: 'digital-text' });
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'ja-JP,ja;q=0.9', accept: 'text/html,application/xhtml+xml' },
    });
    const body = await res.text();
    if (!res.ok) return { error: 'HTTP ' + res.status };
    if (/captcha|ロボットでないこと|Robot Check/i.test(body)) return { error: 'captcha' };
    const c = parseCount(body);
    return c || { error: 'parse failed (len=' + body.length + ')' };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { items: {} };
const items = { ...prev.items };
let ok = 0, fail = 0;
for (const kw of kws) {
  const r = await countFor(kw);
  await sleep(2500 + Math.random() * 1500);
  if (r.error) {
    fail++;
    console.log(`NG  ${kw}: ${r.error}`);
    if (fail >= 5 && ok === 0) break; // 最初から全滅なら打ち切り
    continue;
  }
  ok++;
  items[kw] = r;
  console.log(`OK  ${kw}: ${r.count}${r.atLeast ? '+' : ''}`);
}

if (ok === 0) {
  console.log('1件も取得できませんでした。data/books.json は更新しません。');
  process.exit(0);
}

const jst = new Date(Date.now() + 9 * 3600e3);
const updated = `${jst.getUTCFullYear()}年${String(jst.getUTCMonth() + 1).padStart(2, '0')}月${String(jst.getUTCDate()).padStart(2, '0')}日`;
mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated, source: 'Amazon.co.jp Kindleストア 検索結果件数', requests: { ok, fail }, items }, null, 1) + '\n');
console.log(`done: ok=${ok}, fail=${fail}`);
