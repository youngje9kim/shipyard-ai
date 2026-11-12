# shipyard-ai

팀에서 함께 쓰는 Claude Code 플러그인 마켓플레이스입니다.

## 설치

Claude Code에서 다음을 실행합니다.

```
/plugin marketplace add youngje9kim/shipyard-ai
/plugin install example-plugin@shipyard-ai
```

설치한 뒤 `/example-plugin:hello`를 실행해 동작을 확인합니다.

## 구조

```
.claude-plugin/marketplace.json   마켓플레이스 목록
plugins/<플러그인>/
  .claude-plugin/plugin.json      플러그인 정보
  commands/                       슬래시 명령
  skills/                         스킬
  agents/                         서브에이전트
  hooks/                          훅
```

## 플러그인 추가하기

1. `plugins/` 아래에 새 폴더를 만들고 `.claude-plugin/plugin.json`을 넣습니다.
2. `.claude-plugin/marketplace.json`의 `plugins` 배열에 항목을 추가합니다.
3. `claude plugin validate .`로 검사한 뒤 PR을 올립니다.
