# 강화 부수기 — 앱인토스 미니앱

무기를 강화하고 건물을 부수는 방치형 철거 게임을 **앱인토스(Apps in Toss) WebView 미니앱**으로 옮긴 프로젝트예요.
원본 HTML 한 장짜리 게임의 로직·디자인·사운드를 그대로 살리고, 아래 세 가지만 미니앱에 맞게 바꿨어요.

| 바뀐 점 | 내용 |
| --- | --- |
| 보상형 광고 | 토스 SDK(`loadFullScreenAd` / `showFullScreenAd`) 연동. `userEarnedReward` 일 때만 보상 지급 |
| 랭킹 | 클로드 아티팩트 전용 DB → **기기 저장(localStorage) 최고 기록 + 명예의 전당** |
| 빌드 | Vite + TypeScript, GitHub Actions에서 `.ait` 자동 생성 |

```
ganghwa-break/
├─ index.html                  화면 뼈대(원본 마크업 유지)
├─ src/
│  ├─ main.ts                  진입점
│  ├─ game.ts                  게임 본체(강화·전투·렌더링·사운드·랭킹 UI)
│  ├─ tossAds.ts               토스 보상형 광고 연동 + 미지원 환경 fallback
│  ├─ ranking.ts               로컬 최고 기록 저장(명예의 전당 기준값)
│  └─ style.css                원본 디자인(밤하늘·등급색)
├─ apps-in-toss.config.ts      미니앱 설정(appName, webBundleDir …)
├─ .github/workflows/build-ait.yml   푸시하면 자동 빌드 + .ait 아티팩트
└─ dist/                       `npm run build` 결과(웹 번들, git 제외)
```

---

## 1. 로컬에서 실행

Node.js 20 이상에서 아래 순서대로 실행하면 돼요.

```bash
npm install
npm run dev          # http://localhost:5173 (일반 브라우저 미리보기)
npm run build        # dist/ 웹 번들 만들기
npm run build:ait    # dist/ + ganghwa-break.ait 번들까지 한 번에
```

> 일반 브라우저에서는 토스 광고 SDK가 동작하지 않아서, `광고 보고 방지권 +1` 버튼을 누르면
> **3초 테스트 오버레이**가 대신 뜹니다. 실제 토스 앱(샌드박스)에서 열면 진짜 보상형 광고가 떠요.

---

## 2. 앱인토스 콘솔에서 발급받을 것 (2개)

### (1) 앱 이름(appName)

1. [앱인토스 콘솔](https://apps-in-toss.toss.im/) → **앱 만들기**
2. 앱 이름을 kebab-case로 입력 (예: `ganghwa-break`)
3. 콘솔에 등록한 이름과 **`apps-in-toss.config.ts`의 `appName`** 을 똑같이 맞춰주세요.

```ts
// apps-in-toss.config.ts
export default {
  appName: 'ganghwa-break',   // ← 콘솔 앱 이름과 같아야 해요
  ...
};
```

### (2) 보상형 광고 그룹 ID(adGroupId)

1. 콘솔 → **인앱 광고(IAA)** → 광고 그룹 만들기 → **보상형(Rewarded)** 선택
2. 발급된 ID(`ait.v2.live....`)를 아래 **둘 중 한 곳**에 넣으면 돼요.
   (현재 발급받은 실제 ID `ait.v2.live.a3b6ece2fba24488` 가 코드 기본값·`.env.example` 에 반영돼 있어요.)

**방법 A — 코드에 직접 (가장 간단)**

```ts
// src/tossAds.ts
export const AD_GROUP_ID: string =
  ((import.meta.env?.VITE_AIT_AD_GROUP_ID as string | undefined) ?? '').trim() ||
  'ait.v2.live.a3b6ece2fba24488';   // ← 발급받은 ID (테스트로 돌릴 땐 ait-ad-test-rewarded-id)
```

**방법 B — 환경변수/저장소 변수 (코드는 그대로)**

`.env` 파일에 넣고 빌드하면 돼요. GitHub Actions에서 쓰려면 저장소
**Settings → Secrets and variables → Actions → Variables** 에
`VITE_AIT_AD_GROUP_ID` 를 추가하면 됩니다.

```bash
# .env
VITE_AIT_AD_GROUP_ID=ait.v2.live.a3b6ece2fba24488
```

> `VITE_AIT_AD_GROUP_ID=ait-ad-test-rewarded-id` 로 테스트 광고도 띄울 수 있어요. 테스트 광고는
> `event.data.unitType`/`unitAmount` 값이 비어 있을 수 있지만, 보상 지급 자체는
> `userEarnedReward` 이벤트로 판단하므로 그대로 동작해요.

---

## 3. GitHub Actions로 자동 빌드 (`.ait` 받기)

`main` 브랜치에 푸시할 때마다 아래가 자동으로 돌아요.

1. `npm ci`
2. `npm run build` → `dist/` 생성
3. `npx ait build` → **`ganghwa-break.ait`** 생성
4. 아티팩트 업로드 + `dist/` 를 GitHub Pages(`gh-pages` 브랜치)로 배포

### `.ait` 파일 내려받는 순서

1. GitHub 저장소 → **Actions** 탭
2. 가장 위의 **Build Apps in Toss bundle** → 초록 체크(성공) 실행 클릭
3. 페이지 아래 **Artifacts** 섹션에서 **`ganghwa-break-ait`** 클릭 → zip 다운로드
4. zip을 풀면 `ganghwa-break.ait` — 이 파일을 콘솔에 올리거나 `ait deploy` 로 배포하면 돼요.

### 콘솔에 올리기(배포)

```bash
# 콘솔 → 워크스페이스 → API 키 → 콘솔 API 키 발급
npx ait token add --api-key <발급받은-키>     # 한 번만
npm run build:ait
npx ait deploy -m "첫 배포"
```

### 웹 미리보기(GitHub Pages)

저장소 **Settings → Pages → Build and deployment → Source** 를
**Deploy from a branch** → 브랜치 **`gh-pages`** / 폴더 **`/ (root)`** 로 한 번만 설정하면
`https://rudalsao03-ops.github.io/ganghwa-break/` 에서 바로 플레이할 수 있어요.
(이 미리보기에서는 광고가 3초 테스트 오버레이로 대체됩니다.)

---

## 4. 동작 확인 (로컬 E2E)

`npm run build` 후 `dist/` 를 정적 서버로 띄우고 Playwright로 아래를 확인했어요.

- 메인 화면 렌더링(야경·건물·무기·HUD) 및 콘솔 에러 없음
- 건물 연타 → 철거 → 골드 획득
- 강화 성공/실패 연출, 판매, 용병 고용, 무기 도감
- 출석 보상 모달 → 방지권 지급
- 보상형 광고 fallback(3초 오버레이) → 방지권 +1
- 랭킹 모달: 내 최고 층수/강화, 명예의 전당 진행도, 닉네임 저장, 새로고침 후 유지
- 360×640 작은 화면 레이아웃

광고 로직은 SDK를 스텁으로 바꿔 18개 케이스를 따로 검증했어요
(`load → show → load` 순서, `userEarnedReward` 에서만 보상, `dismissed` 무보상, 실패 시 재로드).

---

## 5. 자주 막히는 곳

| 증상 | 해결 |
| --- | --- |
| `ait build` 가 `Config 파일을 찾을 수 없습니다` | 프로젝트 루트(`package.json` 있는 곳)에서 실행했는지 확인 |
| `웹 빌드 디렉토리(dist)가 존재하지 않습니다` | `npm run build` 를 먼저 실행 (`npm run build:ait` 는 자동) |
| Actions에서 `npm ci` 실패 | `package-lock.json` 이 커밋되어 있는지 확인 |
| Pages가 404 | Settings → Pages 의 브랜치가 `gh-pages` 인지 확인 (첫 성공 실행 후 생김) |
| 광고가 안 뜸 | 토스 앱 5.227.0 이상인지, `adGroupId` 가 콘솔 값과 같은지 확인 |
| 광고는 뜨는데 보상이 안 들어옴 | 끝까지 시청해야 `userEarnedReward` 가 와요(중간에 닫으면 보상 없음) |
