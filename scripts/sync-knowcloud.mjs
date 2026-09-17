// 方案D同步脚本：拉取知晓云 7 张表 -> 用 kcGen.buildKcDataJs 生成 kc-data.js
// 被 .github/workflows/sync-knowcloud.yml 每小时调用（workflow_dispatch 手动触发）
// 注意：必须复用 _lib/kcGen.js 的 buildKcDataJs，它生成完整 ESM 格式
//   （export const KC_DATA / KC_TABLES / onRequest handler），
//   保证 functions/api/kc/[table].js 的 `import { onRequest }` 能正常工作。
// choearth_notice（轮播图）走独立数据源链：微博 -> 知晓云 -> 报错（见 sync-weibo-carousel.mjs）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { KC_TABLES, fetchKnowCloudTable, buildKcDataJs } from '../functions/api/_lib/kcGen.js';
import { fetchCarouselRows } from './sync-weibo-carousel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'functions', 'api', 'kc-data.js');

async function main() {
  const results = {};
  let carouselSource = '';
  for (const t of KC_TABLES) {
    process.stdout.write('Fetching ' + t + '... ');
    try {
      if (t === 'choearth_notice') {
        // 轮播图：微博 -> 知晓云 -> 报错
        const { source, rows } = await fetchCarouselRows();
        carouselSource = source;
        results[t] = rows;
        console.log('OK from ' + source + ' (' + rows.length + ' records)');
        continue;
      }
      const rows = await fetchKnowCloudTable(t);
      if (rows === null) throw new Error('null response from knowcloud');
      results[t] = rows;
      console.log('OK (' + rows.length + ' records)');
    } catch (e) {
      console.error('FAIL: ' + e.message);
      process.exit(1);
    }
  }
  const content = buildKcDataJs(results);
  writeFileSync(OUT, content, 'utf8');
  console.log('\nCarousel source: ' + (carouselSource || 'unknown'));
  console.log('kc-data.js written. Size:', content.length, 'bytes');
  console.log('Format OK: export const KC_DATA / KC_TABLES / onRequest (ESM)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
