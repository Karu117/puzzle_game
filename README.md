# O/X 퀴즈 배틀

최대 30명이 닉네임으로 입장해 라운드별 O/X 문제를 맞추는 실시간 웹 게임입니다.
귀여운 SVG 아바타가 O/X 구역으로 이동하는 모습을 모두가 함께 보고, 마지막 1인에게는 시상식이 열립니다.
경품을 받을 수 있는 등수도 진행자가 세팅할 수 있어야 합니다.

- 참가자: `/` · 진행자: `/host` (PIN 입력)
- 모바일 세로 화면 최적화

## 구조
- `public/` 정적 화면 (HTML/CSS/JS, SVG 아바타)
- `api/game.js` Vercel 서버리스 함수 (`/api/game?action=...`)
- `lib/game.js` 게임 규칙, `lib/store.js` 저장소 (Upstash Redis, 환경변수가 없으면 메모리)
- `server.js` 로컬 실행용 (`npm start`)

서버리스는 메모리 상태와 SSE를 유지할 수 없어서 상태는 Redis에 저장하고 화면은 0.8초 간격 폴링으로 갱신합니다.

## 로컬 실행
```
npm start            # http://localhost:3000  (진행자 PIN 기본값 1234)
HOST_PIN=5678 npm start   # 진행자 PIN 변경
```

## Vercel 배포
1. Vercel에서 이 저장소를 Import (Framework: Other, 빌드 설정 없음)
2. Storage(Marketplace)에서 **Upstash Redis** 생성 후 프로젝트에 연결 → `KV_REST_API_URL`, `KV_REST_API_TOKEN`(또는 `UPSTASH_REDIS_REST_URL/TOKEN`)이 자동 주입됩니다
3. Settings > Environment Variables 에 `HOST_PIN` 추가 (진행자 PIN, 반드시 변경)
4. Redeploy

Redis는 같은 리전에 두는 편이 응답이 빠릅니다. 폴링은 접속자당 약 1.2회/초이므로 대규모 행사에는 Upstash 사용량을 확인하세요.
