#!/usr/bin/env node
// PreToolUse 훅: data/ 아래 원본 파일을 고치거나 지우는 도구 호출을 막는다.
// - Write / Edit / MultiEdit / NotebookEdit: 대상 경로가 data/ 안이면 차단한다.
// - Bash / PowerShell: 명령에 data 경로가 있고, 쓰기가 될 수 있는 말(save, write, to_excel,
//   Copy-Item, Set-Content, >, rm, git checkout 등)이 함께 있으면 차단한다.
//   변수에 경로를 담았다가 저장하는 형태(p='data/..'; wb.save(p))도 막기 위해
//   경로와 쓰기 말의 위치 관계는 보지 않는다.
// - 차단할 때는 stderr에 이유를 쓰고 종료 코드 2로 끝낸다. 입력을 해석하지 못해도 차단한다.
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(process.env.CLAUDE_PROJECT_DIR || path.join(__dirname, '..', '..'));
const DATA_DIR = path.join(PROJECT_DIR, 'data');
const IS_WIN = process.platform === 'win32';

function block(reason) {
  process.stderr.write(`[protect-data] ${reason}\n`);
  process.exit(2);
}

function norm(p) {
  let r = path.resolve(p);
  // Windows는 경로 조각 끝의 점·공백을 무시한다(data./a.xlsx == data/a.xlsx).
  if (IS_WIN) {
    const root = path.parse(r).root;
    r = root + r.slice(root.length).split(path.sep).map((s) => s.replace(/[. ]+$/, '') || s).join(path.sep);
  }
  // 존재하는 가장 가까운 상위 경로까지 실제 경로로 풀어 링크 우회를 막는다.
  let probe = r;
  const rest = [];
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) {
    rest.unshift(path.basename(probe));
    probe = path.dirname(probe);
  }
  try { r = path.join(fs.realpathSync.native(probe), ...rest); } catch { /* 그대로 둔다 */ }
  return IS_WIN ? r.toLowerCase() : r;
}

const DATA_REAL = norm(DATA_DIR);

function isInData(p, cwd) {
  if (!p || typeof p !== 'string') return false;
  // Git Bash 형식(/c/work/...)을 Windows 경로로 바꾼다.
  if (IS_WIN) p = p.replace(/^\/([a-zA-Z])\//, '$1:/');
  const abs = path.isAbsolute(p) ? p : path.join(cwd || PROJECT_DIR, p);
  const n = norm(abs);
  return n === DATA_REAL || n.startsWith(DATA_REAL + path.sep);
}

// 명령 안의 data 경로: 앞이 경계 문자이고 뒤가 구분자·따옴표·공백·끝인 "data"
// (metadata, database 같은 단어는 걸리지 않는다)
const DATA_REF = /(?:^|[\s'"`=(,;|&])(?:\.{1,2}[\\/])?data\.*(?=[\\/\s'"`),;|&*]|$)/i;

// 쓰기가 될 수 있는 말
const WRITE_WORDS = [
  // 프로그램 안 저장·쓰기
  /\b(?:save\w*|write\w*|to_(?:excel|csv|parquet|json|pickle|feather|sql)|dump|copyfile|copy2?|copytree|move|rename|replace|remove|unlink|rmtree|makedirs|mkdir|truncate)\b/i,
  /\bopen\s*\([^)]*['"][^'"]*[wax+][^'"]*['"]/i, // open(..., 'w'/'a'/'x'/'+')
  /\bWriteAll\w*\b/i,
  // 유닉스 셸
  /(?:^|[\s;|&(])(?:rm|rmdir|mv|cp|touch|truncate|tee|install|ln|chmod|chown|unlink|shred|dd|rsync|scp|mkdir)(?=\s|$)/i,
  /\b(?:sed|perl)\b[^|;&]*\s-i/i,
  // PowerShell / cmd
  /\b(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Clear-Content|Out-File|New-Item|Export-Csv|Export-Excel|Export-Clixml|Set-ItemProperty|Clear-Item)\b/i,
  /(?:^|[\s;|&(])(?:del|erase|ren|rename|move|copy|xcopy|robocopy|rd|md|ri|mi|cpi|rni|sc|ac|ni)(?=\s|$)/i,
  // git: 작업 트리를 바꾸는 하위 명령
  /\bgit\b[^|;&]*\s(?:checkout|restore|rm|mv|clean|reset|stash|switch|merge|rebase|pull|apply|am|cherry-pick|revert)\b/i,
];

// 리다이렉트(>, >>). 2>&1, >&2, 2>/dev/null, >$null, 2>nul 처럼 파일을 만들지 않는 것은 뺀다.
function hasRedirect(cmd) {
  const s = cmd
    .replace(/\d*>>?\s*&\s*\d+/g, ' ')
    .replace(/\d*>>?\s*(?:\/dev\/null|\$null|nul)(?=[\s;|&)]|$)/gi, ' ')
    .replace(/-[a-z]?[gl]t\b|=>|->/gi, ' '); // 비교·화살표 연산자
  return />/.test(s);
}

function shellTouchesData(cmd) {
  // 절대경로로 data 를 가리키는 경우도 상대 형식으로 바꿔서 검사한다.
  const projFwd = PROJECT_DIR.replace(/\\/g, '/');
  const variants = [projFwd, PROJECT_DIR, projFwd.replace(/^([a-zA-Z]):/, (_, d) => '/' + d.toLowerCase())];
  let flat = cmd;
  for (const v of variants) {
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + String.raw`[\\/]+data`, IS_WIN ? 'gi' : 'g');
    flat = flat.replace(re, ' data');
  }
  if (!DATA_REF.test(flat)) return null;
  if (hasRedirect(flat)) return '>';
  for (const re of WRITE_WORDS) {
    const m = flat.match(re);
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

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const target = ti.file_path || ti.notebook_path;
    if (isInData(target, cwd)) {
      block(`data/ 아래 원본 파일은 수정할 수 없습니다: ${target}\n결과는 data/ 밖의 새 파일로 만드세요(CLAUDE.md 9항).`);
    }
    process.exit(0);
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '');
    const word = shellTouchesData(cmd);
    if (word) {
      block(`data 경로와 쓰기가 될 수 있는 말("${word}")이 같은 명령에 있어 차단했습니다.\n명령: ${cmd}\n읽기만 하거나, 결과를 data/ 밖에 저장하세요(CLAUDE.md 9항).`);
    }
    process.exit(0);
  }

  process.exit(0);
});
