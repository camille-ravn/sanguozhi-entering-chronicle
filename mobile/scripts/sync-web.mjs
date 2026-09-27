// 把仓库根目录的静态站点同步到 mobile/www，供 Capacitor 打包。
// 根目录是唯一的事实来源，本目录的 www 是构建产物（已 gitignore）。
import { mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");          // 仓库根
const dest = join(here, "..", "www");         // mobile/www

// 需要打进 App 的全部静态资源（与 index.html 里的 <script>/<link> 对应）
const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "data.js",
  "wiki-bios.js",
  "reading.js",
  "reading-texts.js",
  "cloud-config.js"
];

const missing = FILES.filter((f) => !existsSync(join(root, f)));
if (missing.length) {
  console.error("缺少源文件，请确认在仓库根运行：", missing.join(", "));
  process.exit(1);
}

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of FILES) copyFileSync(join(root, f), join(dest, f));

console.log(`已同步 ${FILES.length} 个文件 → ${dest}`);
