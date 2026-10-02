import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(frontendRoot, 'src');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

const failures = [];
const requireText = (relativePath, fragment, purpose) => {
  if (!read(relativePath).includes(fragment)) {
    failures.push(`${relativePath}: ${purpose}`);
  }
};

// These are platform-wide invariants. Keep this verifier narrow enough to avoid
// false positives while making accidental removal of the shared safeguards fail CI.
requireText('src/contexts/ThemeContext.js', "whiteSpace: 'nowrap'", 'button labels must stay on one line');
requireText('src/contexts/ThemeContext.js', 'MuiDialogActions', 'dialog action groups must use the shared responsive contract');
requireText('src/contexts/ThemeContext.js', "flexWrap: 'wrap'", 'action groups must wrap by whole controls');
requireText('src/contexts/ThemeContext.js', 'MuiTabs', 'tabs must remain horizontally scrollable on narrow screens');
requireText('src/contexts/ThemeContext.js', "textOverflow: 'ellipsis'", 'dynamic compact labels must truncate safely');
requireText('src/contexts/ThemeContext.js', "'.nas-dynamic-label'", 'dynamic label utility must remain available');
requireText('src/components/GlobalAppWindowLayer.js', 'className="nas-dynamic-label"', 'app window titles must not displace window controls');
requireText('src/components/NAS/Window/NASWindow.js', 'className="nas-dynamic-label"', 'file and folder window titles must not displace window controls');
requireText('src/components/AiAgentPanel.js', 'item.selectionFrame?.options?.length > 0', 'AI selectable results must render through the shared selection frame');
requireText('src/components/AiAgentPanel.js', 'aria-multiselectable={frame.multiple !== false}', 'AI selection frames must retain keyboard and assistive-technology semantics');
requireText('src/components/AiAgentPanel.js', 'sourceMessageId: item.messageId', 'AI selections must bind to the exact server-stored assistant message');
requireText('src/components/AiAgentPanel.js', "frame.sourceTool === 'list_trash'", 'trash choices must use the verified restore-selection flow');
requireText('src/components/AiAgentPanel.js', 'sendMessage(reply, isTrashRestore ?', 'only verified trash selections may enter the structured restore route');
requireText('src/components/AiAgentPanel.js', '복구 준비', 'trash choices must clearly distinguish preparation from completed restoration');
requireText('src/components/AiAgentPanel.js', "action.actionType === 'restore_trash_items'", 'batch restore approval must show the exact bound paths');
requireText('src/components/AiAgentPanel.js', 'aria-label="AI 상단바 표시"', 'AI panel must keep a narrow top-edge reveal target');
requireText('src/components/AiAgentPanel.js', '&:hover .AiAgentHeader, &:has(.AiAgentHeader :focus-visible)', 'AI header must reveal for pointer and keyboard-visible focus without sticking after a mouse click');
requireText('src/components/AiAgentPanel.js', 'data-pinned={settingsOpen', 'AI header must remain operable while settings are open');
requireText('src/components/AiAgentPanel.js', "transform: 'translateY(calc(-100% - 1px))'", 'AI header must stay outside the content area while idle');
requireText('src/components/AiAgentPanel.js', 'item.billing?.estimatedUsd', 'AI assistant messages must retain their per-response token cost metadata');
requireText('src/components/AiAgentPanel.js', ".toFixed(4)}$", 'AI token cost must render in compact four-decimal USD format');
requireText('src/components/TopBar.js', "display: { xs: 'none', md: 'inline-flex' }", 'minimized-task chips must not overflow the mobile top bar');
const topBar = read('src/components/TopBar.js');
const fileButton = topBar.indexOf('aria-label="파일 관리자 열기"');
const accessButton = topBar.indexOf('aria-label="접근 기록 열기"');
const settingsButton = topBar.indexOf('aria-label="설정 열기"');
if (!(fileButton >= 0 && fileButton < accessButton && accessButton < settingsButton)) {
  failures.push('src/components/TopBar.js: file manager, access history, and settings buttons must remain adjacent in that order');
}

const sourceFiles = walk(sourceRoot).filter((file) => /\.[jt]sx?$/.test(file));
const longStaticLabels = [];
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const buttonPattern = /<Button\b[^>]*>\s*([^<{][^<]{15,80}?)\s*<\/Button>/gms;
  let match;
  while ((match = buttonPattern.exec(source))) {
    const label = match[1].replace(/\s+/g, ' ').trim();
    // Arrow functions and JSX expressions may contain `>` before the actual tag
    // boundary; ignore those conservative parser ambiguities instead of emitting noise.
    if (label.length < 16 || /[{}=>]/.test(label)) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    longStaticLabels.push(`${path.relative(frontendRoot, file)}:${line} “${label}”`);
  }
}

if (failures.length > 0) {
  console.error('UI contract verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`UI contract verified across ${sourceFiles.length} source files.`);
if (longStaticLabels.length > 0) {
  console.log(`Review-only long button labels (${longStaticLabels.length}); descriptive/full-width actions may be valid:`);
  longStaticLabels.forEach((item) => console.log(`- ${item}`));
}
