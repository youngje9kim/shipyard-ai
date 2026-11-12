// out-only.js 표본 입력 시험. 실행: node .claude/hooks/out-only.test.js
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const PROJ = path.resolve(__dirname, '..', '..');
const HOOK = path.join(__dirname, 'out-only.js');

function run(tool, tool_input) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input, cwd: PROJ }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJ },
    encoding: 'utf8',
  });
  return r.status;
}

const W = (p, content) => ['Write', { file_path: p, content: content || 'x' }];
const B = (command) => ['Bash', { command }];
const P = (command) => ['PowerShell', { command }];

const cases = [
  // [기대 종료 코드, 설명, [도구, 입력]]
  [0, 'out/agg-notes.md 쓰기', W('out/agg-notes.md')],
  [0, '절대 경로 out/ 쓰기', W(path.join(PROJ, 'out', 'agg-notes.md'))],
  [0, 'out/agg.py (out/ 저장)', W('out/agg.py', "import pandas as pd\ndf=pd.read_excel('data/a.xlsx')\ndf.to_excel('out/summary.xlsx')\nopen('out/agg-notes.md','w')")],
  [0, 'python out/agg.py 실행', B('python out/agg.py "11/16~11/22"')],
  [0, 'uv run 실행', P('uv run --with openpyxl python out/agg.py 11/16~11/22')],
  [0, 'mkdir out', B('mkdir -p out')],
  [0, '읽기 명령', B('ls data; head -3 data/a.csv')],
  [0, 'python -c 읽기', B('python -c "import openpyxl; print(openpyxl.load_workbook(\'data/a.xlsx\').sheetnames)"')],
  [0, 'git status', B('git status -s')],
  [2, '루트 summary.xlsx 쓰기', W('summary.xlsx')],
  [2, 'CLAUDE.md 고치기', ['Edit', { file_path: 'CLAUDE.md', old_string: 'a', new_string: 'b' }]],
  [2, 'out/../ 우회', W('out/../메모.md')],
  [2, 'outx/ 비슷한 이름', W('outx/a.md')],
  [2, 'data/ 쓰기', W('data/a.xlsx')],
  [2, '스크립트가 루트에 저장', W('out/agg.py', "wb.save('summary.xlsx')")],
  [2, '스크립트가 open w로 루트에', W('out/agg.py', "open('../메모.md', 'w')")],
  [2, '스크립트 Edit로 저장 경로 바꿈', ['Edit', { file_path: 'out/agg.py', old_string: 'a', new_string: "df.to_csv(r'C:/work/x.csv')" }]],
  [2, 'python -c 저장', B('python -c "import pandas as pd; pd.DataFrame().to_excel(\'summary.xlsx\')"')],
  [2, '리다이렉트', B('echo hi > 메모.md')],
  [2, 'cp', B('cp out/summary.xlsx summary.xlsx')],
  [2, 'Copy-Item', P('Copy-Item out\\summary.xlsx .')],
  [2, 'Set-Content', P('Set-Content CLAUDE.md x')],
  [2, 'out/agg.py 뒤에 명령 잇기', B('python out/agg.py x; rm summary.xlsx')],
  [2, 'out 밖 스크립트 실행', B('python agg.py > out/a.txt')],
  [2, 'git commit', B('git commit -am x')],
];

let fail = 0;
for (const [want, name, [tool, input]] of cases) {
  const got = run(tool, input);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${want === 0 ? 'allow' : 'block'} ${name}${ok ? '' : ` (종료 코드 ${got})`}`);
}
const bad = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' }).status;
console.log(`${bad === 2 ? 'PASS' : 'FAIL'} block 깨진 입력`);
if (bad !== 2) fail++;
console.log(fail ? `\nFAIL ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
