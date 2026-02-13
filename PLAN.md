# Claude Code Hub — PLAN.md

## 한 줄 목표

Claude Code 멀티 프로젝트를 한 화면에서 관리하고, 에이전트 팀 tmux 세션을 통합 제어하며, hooks 자동 셋업으로 네이티브 알림을 받는 데스크톱 앱

## 기술 스택

- **프레임워크**: Tauri 2.0 (Rust + WebView)
- **프론트엔드**: React + TypeScript + Vite
- **스타일링**: Tailwind CSS
- **상태관리**: Zustand
- **터미널 통합**: node-pty 또는 Tauri shell API로 tmux CLI 래핑
- **데이터 저장**: 로컬 JSON 파일 (프로젝트 목록, 설정)
- **알림**: Tauri notification API (macOS 네이티브)

## 핵심 기능 (3개)

### 1. 프로젝트 등록/관리

- 프로젝트 추가: 폴더 경로 선택 → 이름 지정 → 등록
- 사이드바에 프로젝트 목록 표시
- 프로젝트 선택 시 해당 프로젝트 상세 화면으로 이동
- 프로젝트 삭제/편집
- 프로젝트별 상태 표시 (세션 활성/비활성)

### 2. tmux 세션 통합 (에이전트 팀)

- 프로젝트별 tmux 세션 목록 조회 (`tmux list-sessions`, `tmux list-panes`)
- 에이전트 팀 세션 모니터링 (팀 리드 + 팀메이트 상태)
- 세션/pane 선택 시 해당 pane으로 포커스 전환
- 세션 정보 표시: pane ID, 활성 상태, 마지막 활동 시간
- tmux 세션 관련 config 경로: `~/.claude/teams/{team}/config.json`

### 3. 자동 Hooks 셋업 + 네이티브 알림

프로젝트 추가 시 해당 프로젝트의 `.claude/settings.json`에 아래 3개 hooks를 자동 등록:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "프로젝트명과 함께 앱으로 이벤트 전달하는 스크립트"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "태스크 완료 이벤트를 앱으로 전달하는 스크립트"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "승인 필요 이벤트를 앱으로 전달하는 스크립트"
          }
        ]
      }
    ]
  }
}
```

hooks → 앱 통신 방식:
- hooks 스크립트가 로컬 HTTP 또는 Unix socket으로 앱의 백그라운드 서버에 이벤트 전송
- 앱이 이벤트 수신 → Tauri notification API로 macOS 네이티브 알림 표시
- 알림에 프로젝트명 + 이벤트 종류 포함 (예: "iWedding — 태스크 완료", "BeryChat — 승인 필요")

## 사용자 흐름

```
앱 실행 → 프로젝트 추가 (폴더 선택)
  → .claude/settings.json에 hooks 자동 주입
  → 사이드바에 프로젝트 표시

프로젝트 선택 → 해당 프로젝트의 tmux 세션/pane 목록 표시
  → pane 클릭 시 터미널로 포커스 전환

Claude Code 작업 중 → hooks 이벤트 발생
  → 앱 백그라운드 서버가 수신
  → macOS 네이티브 알림 표시
  → 알림 클릭 시 해당 프로젝트 화면으로 이동
```

## UI 구조

```
┌───────────────────────────────────────────────────┐
│  Claude Code Hub                          [설정]   │
├────────┬──────────────────────────────────────────┤
│ 프로젝트 │  프로젝트: iWedding                       │
│        │  경로: ~/projects/iwedding                │
│ iWed 🟢│                                          │
│ iCol 🔴│  ── tmux 세션 ──                          │
│ Bery 🟢│  [팀 리드: %1] [Agent-1: %2] [Agent-2: %3]│
│ ERD  🔴│                                          │
│        │  ── 최근 알림 ──                           │
│ + 추가  │  🔔 10:32 태스크 완료                      │
│        │  🔔 10:28 승인 필요                        │
└────────┴──────────────────────────────────────────┘
```

## 구현 순서

1. **Tauri 프로젝트 초기화** — Tauri 2.0 + React + TypeScript + Vite 셋업
2. **프로젝트 CRUD** — 프로젝트 등록/목록/삭제, 로컬 JSON 저장
3. **hooks 자동 주입** — 프로젝트 추가 시 .claude/settings.json 읽기/쓰기
4. **이벤트 수신 서버** — Tauri 사이드카 또는 로컬 HTTP 서버로 hooks 이벤트 수신
5. **네이티브 알림** — 이벤트 수신 → Tauri notification API 호출
6. **tmux 세션 조회** — tmux CLI 래핑하여 세션/pane 목록 표시
7. **UI 마무리** — 사이드바, 프로젝트 상세, 알림 내역

## 스코프 밖 (나중에 추가)

- 앱 내 터미널 에뮬레이터 (xterm.js 등)
- 개발 중인 서비스 UI 프리뷰
- Claude Code 직접 실행 (앱에서 claude 명령어 호출)
- 멀티 유저 / 클라우드 동기화
