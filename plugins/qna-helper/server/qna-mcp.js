#!/usr/bin/env node
// 사내 QnA 게시판 MCP 서버 (stdio, 줄 단위 JSON-RPC 2.0). 외부 패키지 없음.
// 환경 변수 QNA_API: 게시판 주소 (예: http://localhost:3001)
'use strict';

const readline = require('node:readline');

const BASE = (process.env.QNA_API || '').replace(/\/+$/, '');
const SERVER_INFO = { name: 'qna-board', version: '1.0.0' };
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const TIMEOUT_MS = 10000;

const TOOLS = [
  {
    name: 'search_questions',
    description:
      '사내 QnA 게시판에서 질문을 검색한다(제목, 본문, 호선). 채택된 질문이 먼저 나온다. ' +
      '검색어는 핵심 용어 1~3개로 짧게 준다(예: "필릿 용접", "H2701 소조립"). 문장 전체를 넣지 않는다. ' +
      '검색 결과는 제목뿐이므로, 답하기 전에 get_question으로 원문과 답변을 읽는다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '핵심 용어 1~3개 (공백으로 구분)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_question',
    description:
      '질문 번호로 질문 본문과 답변 목록(채택 여부 포함)을 가져온다. ' +
      '사용자에게 답하기 전에 반드시 이 도구로 원문을 읽고, 답변에 질문 링크를 함께 적는다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, description: '질문 번호 (search_questions 결과의 id)' },
      },
      required: ['id'],
    },
  },
];

const link = (id) => `${BASE}/q/${id}`;

async function callApi(path) {
  if (!BASE) throw new Error('환경 변수 QNA_API가 설정되지 않았습니다');
  const res = await fetch(BASE + path, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`게시판 응답을 읽을 수 없습니다 (HTTP ${res.status})`);
  }
  if (!res.ok || body.error) {
    const e = body.error || {};
    throw new Error(`${e.message || '요청 실패'} (HTTP ${res.status}${e.code ? ', ' + e.code : ''})`);
  }
  return body.data;
}

async function searchQuestions({ query }) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query가 비어 있습니다');
  const data = await callApi('/search?q=' + encodeURIComponent(query.trim()));
  const items = (data.items || []).map((q) => ({
    id: q.id,
    title: q.title,
    dept: q.dept,
    hullNo: q.hullNo,
    stage: q.stage,
    answerCount: q.answerCount,
    hasAccepted: q.hasAccepted,
    createdAt: q.createdAt,
    url: link(q.id),
  }));
  return { query: data.query, count: items.length, items };
}

async function getQuestion({ id }) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new Error('id는 1 이상의 정수여야 합니다');
  const q = await callApi('/questions/' + n);
  return {
    id: q.id,
    url: link(q.id),
    title: q.title,
    dept: q.dept,
    hullNo: q.hullNo,
    stage: q.stage,
    authorName: q.authorName,
    createdAt: q.createdAt,
    body: q.body,
    acceptedAnswerId: q.acceptedAnswerId,
    answers: (q.answers || []).map((a) => ({
      id: a.id,
      authorName: a.authorName,
      accepted: a.accepted,
      createdAt: a.createdAt,
      body: a.body,
    })),
  };
}

const HANDLERS = { search_questions: searchQuestions, get_question: getQuestion };

async function handle(msg) {
  const { method, params = {} } = msg;
  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const fn = HANDLERS[params.name];
      if (!fn) throw Object.assign(new Error('알 수 없는 도구: ' + params.name), { code: -32602 });
      try {
        const out = await fn(params.arguments || {});
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
      } catch (e) {
        // 도구 실행 오류는 isError로 돌려줘서 모델이 읽고 대응하게 한다.
        return { content: [{ type: 'text', text: '오류: ' + e.message }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error('지원하지 않는 메서드: ' + method), { code: -32601 });
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const isRequest = msg.id !== undefined && msg.id !== null;
  try {
    const result = await handle(msg);
    if (isRequest) send({ jsonrpc: '2.0', id: msg.id, result });
  } catch (e) {
    // 알림(notifications/*)에는 응답하지 않는다.
    if (isRequest) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
});

process.on('uncaughtException', (e) => process.stderr.write('[qna-mcp] ' + e.stack + '\n'));
