# IG Organizer Studio by SoUL (로컬 뷰어)

`local-viewer`는 확장 프로그램에서 내려받은 JSON을 별도 크롬 확장 없이 브라우저에서 바로 확인/정리할 수 있는 페이지입니다.

## 열기

1. `social-media-bot-1/instagram-crawler-mvp/index.html`에서 “로컬 뷰어 열기” 클릭
2. 또는 `local-viewer/index.html` 파일을 브라우저에서 직접 열기

## 사용 가이드

- `파일 열기`: 확장 또는 수집 JSON 파일을 선택해 즉시 로드
- `클립보드 붙여넣기`: 클립보드 텍스트를 읽어 textarea에 넣기
- `붙여넣기 적용`: textarea의 JSON을 파싱해 리스트 반영
- `현재 상태 복사`: 편집(카테고리/메모 포함)한 데이터를 클립보드 JSON으로 복사
- `현재 상태 저장`: 편집 데이터를 JSON 파일로 저장
- `초기화`: 로컬에 쌓인 모든 목록/카테고리/메모 데이터를 삭제

## 정리 기능

- 저장글 / 팔로워 탭 분리
- 검색, 카테고리 필터, 정렬
- 저장글 썸네일/링크/저장시간 보기 + 카테고리 지정
- 팔로워 썸네일/소개 + 카테고리 지정 + 메모 입력
- 저장 상태는 브라우저 로컬스토리지에 보존되어 다음에 재오픈해도 유지

## 데이터 구조(지원 형식)

아래 키를 가진 JSON이면 대부분 바로 인식됩니다.

- `savedPosts`: 저장글 배열
- `friends`: 팔로워 배열
- `postCategories`: 저장글 카테고리 맵
- `friendCategoryAssignments` 또는 `friendCategories`: 팔로워 카테고리 맵
- `friendMemos`: 팔로워 메모
- 그 외 `savedPosts`, `friends` 키가 단일로 있는 단순 배열 형태

## 배포 가이드

### 1) 로컬 뷰어(정적 사이트) 배포 — 즉시 가능

`local-viewer`는 별도 빌드 없이 배포 가능한 정적 페이지라 아래 중 하나로 바로 배포할 수 있습니다.

- GitHub Pages
  1. `local-viewer` 폴더를 웹 호스팅 루트로 사용
  2. `index.html` 을 공개 엔트리로 설정
  3. 정적 호스팅 배포
- Netlify / Vercel / Firebase Hosting
  1. 배포 대상 디렉터리를 `local-viewer`로 지정
  2. 배포 후 `https://.../local-viewer/index.html` 또는 해당 호스팅 루트 확인

### 2) 크롬 확장 배포

- 지금 상태는 파일 기반 동작 및 개발용 패키지 기준이라, 배포하려면 다음이 필요합니다.
  1. `manifest.json` 최신 버전 정합성 확인
  2. 확장 아이콘/설명/설정 항목(메타 정보) 검수
  3. `manifest.json` + `background.js` + `content.js` + `popup/*` + `local-viewer/*` 압축 후 `.crx` 또는 ZIP 패키징
  4. Chrome Web Store 스토어 심사 제출(개인정보/수집 항목 명시 포함)

> 빠르게 바로 쓸 땐 GitHub Pages로 `local-viewer` 공개 후, 확장에서는 해당 링크로 이동해 정렬/검수 작업을 하는 형태를 추천합니다.
