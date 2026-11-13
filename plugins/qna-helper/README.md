# qna-helper

사내 기술 QnA 게시판을 Claude Code에서 쓰게 해 주는 플러그인입니다. 도면, 공정, 품질, 안전 절차 질문에 게시판 글만 근거로 답하고, 근거로 쓴 질문의 링크를 붙입니다.

## 들어 있는 것

| 구성 | 위치 | 하는 일 |
|---|---|---|
| MCP 서버 `qna` | `server/qna-mcp.js` | 게시판 API를 부르는 도구 두 개를 제공합니다. |
| 스킬 `ask` | `skills/ask/SKILL.md` | 게시판만 근거로 답하는 규칙입니다. |

MCP 서버 도구:

- `search_questions(query)`: 제목, 본문, 호선으로 질문을 찾습니다(`GET /search?q=`). 채택된 질문이 먼저 나옵니다.
- `get_question(id)`: 질문 본문과 답변 목록을 가져옵니다(`GET /questions/:id`).

두 도구 모두 결과에 질문 링크(`<게시판 주소>/q/<번호>`)를 넣습니다.

## 필요한 것

- Node.js 18 이상 (내장 `fetch` 사용). 외부 패키지는 없어서 `npm install`이 필요 없습니다.
- 사내 QnA 게시판 주소

## 설치

플러그인을 설치하면 게시판 주소(`qna_api`)를 묻습니다. `http://localhost:3001`처럼 끝에 `/` 없이 넣습니다. 이 값은 MCP 서버의 환경 변수 `QNA_API`로 전달됩니다.

설치한 뒤 `/mcp`에서 `qna`가 connected로 보이는지 확인합니다.

## 쓰는 법

평소처럼 물어보면 됩니다.

```
H2701 필릿 용접 기준 게시판에서 찾아 줘
```

`ask` 스킬은 이렇게 답합니다.

- 검색어를 바꿔 가며 세 번까지 찾습니다.
- 채택 답변은 표현을 바꾸지 않고 그대로 옮깁니다. 원문에 없는 숫자, 기한, 문서 번호는 더하지 않습니다.
- 채택되지 않은 답변은 그렇다고 밝힙니다.
- 끝에 질문 번호, 제목, 링크를 붙입니다.
- 관련 글이 없으면 찾아본 검색어를 보여 주고 게시판에 질문을 올리라고 안내합니다.

## 서버만 따로 확인하기

MCP 서버는 표준 입출력으로 JSON-RPC 메시지를 한 줄에 하나씩 주고받습니다.

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_questions","arguments":{"query":"용접"}}}' \
  | QNA_API=http://localhost:3001 node server/qna-mcp.js
```

게시판 API 문서는 [board-api.md](./board-api.md)에 있습니다.
