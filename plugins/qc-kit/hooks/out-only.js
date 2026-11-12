#!/usr/bin/env node
// PreToolUse 훅 (qc-aggregator 전용, 에이전트 frontmatter에서 건다)
// 집계 담당의 쓰기를 out/ 아래로 가둔다.
// - Write / Edit / MultiEdit / NotebookEdit: 대상 경로가 out/ 밖이면 차단한다.
//   out/*.py 를 쓸 때는 내용에서 저장 호출(save, to_excel, open(...,'w') 등)의
//   문자열 경로를 찾아 out/ 밖이면 차단한다. 변수에 담은 경로는 보이지 않는다(알려진 빈틈).
// - Bash / PowerShell: 쓰기가 될 수 있는 말이나 리다이렉트가 있으면 차단한다.
//   예외는 out/ 아래 스크립트 실행(python out/agg.py ...)과 out 폴더 만들기뿐이다.
// - 차단할 때는 stderr에 이유를 쓰고 종료 코드 2로 끝낸다. 입력을 해석하지 못해도 차단한다.
'use strict';

const path = require('path');

const PROJECT_DIR = path.resolve(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'));
const IS_WIN = process.platform === 'win32';

function block(reason) {
  process.stderr.write(`[out-only] ${reason}\n`);
  process.exit(2);
}

function norm(p) {
  let r = path.resolve(p);
  if (IS_WIN) {
    const root = path.parse(r).root;
    r = root + r.slice(root.length).split(path.sep).map((s) => s.replace(/[. ]+$/, '') || s).join(path.sep);
    r = r.toLowerCase();
  }
  return r;
}

const OUT_REAL = norm(path.join(PROJECT_DIR, 'out'));

function isInOut(p, cwd) {
  if (!p || typeof p !== 'string') return false;
  if (IS_WIN) p = p.replace(/^\/([a-zA-Z])\//, '$1:/');
  const abs = path.isAbsolute(p) ? p : path.join(cwd || PROJECT_DIR, p);
  return norm(abs).startsWith(OUT_REAL + path.sep);
}

// 스크립트 안의 저장 호출과 첫 번째 문자열 인자
const SAVE_CALLS = [
  /\.(?:save|to_excel|to_csv|to_json|to_parquet|to_pickle|write_text|write_bytes)\s*\(\s*(?:r|f|rf|fr)?(['"])([^'"]*)\1/gi,
  /\b(?:ExcelWriter|copyfile|copy2?|move|rename|replace)\s*\(\s*(?:[^,()]*,\s*)?(?:r|f|rf|fr)?(['"])([^'"]*)\1/gi,
  /\bopen\s*\(\s*(?:r|f|rf|fr)?(['"])([^'"]*)\1\s*,\s*(['"])[^'"]*[wax+][^'"]*\3/gi,
  /\bPath\s*\(\s*(?:r|f|rf|fr)?(['"])([^'"]*)\1\s*\)\s*\.\s*(?:write_text|write_bytes|unlink|touch|mkdir)/gi,
];

function badSaveTargets(code, cwd) {
  const bad = [];
  for (const re of SAVE_CALLS) {
    for (const m of code.matchAll(re)) {
      const target = m[2];
      if (!target || target.includes('{')) continue; // f-문자열 조각은 판단하지 않는다
      if (!isInOut(target, PROJECT_DIR) && !isInOut(target, cwd)) bad.push(target);
    }
  }
  return bad;
}

const SHELL_WRITE = [
  /(?:^|[\s;|&(])(?:rm|rmdir|mv|cp|touch|truncate|tee|install|ln|chmod|chown|unlink|shred|dd|rsync|scp)(?=\s|$)/i,
  /\b(?:sed|perl)\b[^|;&]*\s-i/i,
  /\b(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Clear-Content|Out-File|New-Item|Export-Csv|Export-Excel|Set-ItemProperty)\b/i,
  /(?:^|[\s;|&(])(?:del|erase|ren|move|copy|xcopy|robocopy|rd|ri|mi|cpi|rni|sc|ac|ni)(?=\s|$)/i,
  /\b(?:save\w*|write\w*|to_(?:excel|csv|parquet|json|pickle)|dump|copyfile|copy2?|rmtree|unlink|remove|rename)\b/i,
  /\bopen\s*\([^)]*['"][^'"]*[wax+][^'"]*['"]/i,
  /\bgit\b[^|;&]*\s(?:add|commit|push|checkout|restore|rm|mv|clean|reset|stash|switch|merge|rebase|pull|apply)\b/i,
];

function hasRedirect(cmd) {
  const s = cmd
    .replace(/\d*>>?\s*&\s*\d+/g, ' ')
    .replace(/\d*>>?\s*(?:\/dev\/null|\$null|nul)(?=[\s;|&)]|$)/gi, ' ')
    .replace(/-[a-z]?[gl]t\b|=>|->/gi, ' ');
  return />/.test(s);
}

// 허용하는 쓰기 명령: out/ 아래 스크립트 실행, out 폴더 만들기
const ALLOWED_SHELL = [
  /^\s*(?:uv\s+run\s+(?:--with\s+\S+\s+)*)?(?:python3?|py)\s+(?:\.[\\/])?out[\\/][\w.\-가-힣]+\.py(?:\s+(?:"[^"]*"|'[^']*'|[^\s;|&><`$]+))*\s*$/i,
  /^\s*mkdir\s+(?:-p\s+)?(?:\.[\\/])?out[\\/]?\s*$/i,
  /^\s*New-Item\s+-ItemType\s+Directory\s+(?:-Force\s+)?(?:-Path\s+)?(?:\.[\\/])?out[\\/]?(?:\s+-Force)?(?:\s*\|\s*Out-Null)?\s*$/i,
];

function shellWrites(cmd) {
  if (ALLOWED_SHELL.some((re) => re.test(cmd))) return null;
  if (hasRedirect(cmd)) return '>';
  for (const re of SHELL_WRITE) {
    const m = cmd.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    block('훅 입력(JSON)을 해석하지 못해 안전하게 차단했습니다.');
  }
  if (!input || typeof input !== 'object') block('훅 입력이 비어 있거나 형식이 맞지 않아 차단했습니다.');

  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const cwd = input.cwd || PROJECT_DIR;

  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const target = ti.file_path || ti.notebook_path;
    if (!isInOut(target, cwd)) {
      block(`qc-aggregator는 out/ 아래에만 쓸 수 있습니다: ${target}`);
    }
    if (/\.py$/i.test(target)) {
      const code = [ti.content, ti.new_string, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e && e.new_string) : [])]
        .filter((s) => typeof s === 'string').join('\n');
      const bad = badSaveTargets(code, cwd);
      if (bad.length) {
        block(`스크립트가 out/ 밖에 저장하려 합니다: ${bad.join(', ')}\n저장 경로는 out/ 아래로 하세요.`);
      }
    }
    process.exit(0);
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '');
    const word = shellWrites(cmd);
    if (word) {
      block(`qc-aggregator의 셸 명령에 쓰기가 될 수 있는 말("${word}")이 있어 차단했습니다.\n명령: ${cmd}\n계산 코드는 Write로 out/agg.py에 저장하고 "python out/agg.py <기간>"으로 실행하세요.`);
    }
    process.exit(0);
  }

  process.exit(0);
});
