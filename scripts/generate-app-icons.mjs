import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = process.argv[2];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!source) {
  throw new Error("Usage: node scripts/generate-app-icons.mjs <master-icon.png>");
}

const webRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(webRoot, "..");
const androidRes = path.join(
  workspaceRoot,
  "bajeti6",
  "app",
  "src",
  "main",
  "res"
);

const androidSizes = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

async function resize(output, size, format = "png") {
  const pipeline = sharp(source).resize(size, size, {
    fit: "cover",
    kernel: sharp.kernel.lanczos3,
  });

  if (format === "webp") {
    await pipeline.webp({ quality: 100, lossless: true }).toFile(output);
    return;
  }

  await pipeline.png({ compressionLevel: 9 }).toFile(output);
}

async function main() {
  fs.mkdirSync(path.join(webRoot, "public"), { recursive: true });
  fs.mkdirSync(path.join(androidRes, "drawable-nodpi"), { recursive: true });

  await Promise.all([
    resize(path.join(webRoot, "public", "bajeti-app-icon.png"), 512),
    resize(path.join(webRoot, "app", "icon.png"), 512),
    resize(path.join(webRoot, "app", "apple-icon.png"), 180),
    resize(
      path.join(androidRes, "drawable-nodpi", "ic_launcher_adaptive.png"),
      432
    ),
    ...Object.entries(androidSizes).flatMap(([directory, size]) => {
      const target = path.join(androidRes, directory);
      fs.mkdirSync(target, { recursive: true });
      return [
        resize(path.join(target, "ic_launcher.webp"), size, "webp"),
        resize(path.join(target, "ic_launcher_round.webp"), size, "webp"),
      ];
    }),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
