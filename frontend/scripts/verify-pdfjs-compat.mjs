import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
const packages = packageLock.packages || {};
const reactPdf = packages['node_modules/react-pdf'];
const pdfjs = packages['node_modules/pdfjs-dist'];

const fail = (message) => {
  console.error(`[pdfjs compatibility] ${message}`);
  process.exitCode = 1;
};

if (!reactPdf?.version || !pdfjs?.version) {
  fail('package-lock.json에서 react-pdf 또는 pdfjs-dist 버전을 찾지 못했습니다.');
} else {
  const directPdfjs = packageJson.dependencies?.['pdfjs-dist'];
  const directReactPdf = packageJson.dependencies?.['react-pdf'];
  const requiredPdfjs = reactPdf.dependencies?.['pdfjs-dist'];

  if (directPdfjs !== pdfjs.version) {
    fail(`pdfjs-dist는 정확한 버전으로 고정해야 합니다: package=${directPdfjs}, lock=${pdfjs.version}`);
  }
  if (directReactPdf !== reactPdf.version) {
    fail(`react-pdf는 정확한 버전으로 고정해야 합니다: package=${directReactPdf}, lock=${reactPdf.version}`);
  }
  if (requiredPdfjs !== pdfjs.version) {
    fail(`react-pdf API와 Worker 의존성이 다릅니다: react-pdf requires=${requiredPdfjs}, pdfjs=${pdfjs.version}`);
  }

  const buildIndex = process.argv.indexOf('--build-dir');
  if (buildIndex >= 0) {
    const buildArg = process.argv[buildIndex + 1];
    if (!buildArg) {
      fail('--build-dir 뒤에 경로가 필요합니다.');
    } else {
      const mediaDir = path.resolve(projectRoot, buildArg, 'static', 'media');
      const workers = fs.existsSync(mediaDir)
        ? fs.readdirSync(mediaDir).filter((name) => /^pdf\.worker(?:\.min)?\..+\.mjs$/.test(name))
        : [];
      if (workers.length !== 1) {
        fail(`빌드된 PDF Worker는 정확히 하나여야 합니다: ${workers.join(', ') || '없음'}`);
      } else {
        const workerText = fs.readFileSync(path.join(mediaDir, workers[0]), 'utf8');
        if (!workerText.includes(pdfjs.version)) {
          fail(`빌드 Worker가 PDF.js API ${pdfjs.version}과 일치하지 않습니다: ${workers[0]}`);
        }
      }
    }
  }

  if (!process.exitCode) {
    console.log(`[pdfjs compatibility] react-pdf ${reactPdf.version} / PDF.js API+Worker ${pdfjs.version}`);
  }
}
