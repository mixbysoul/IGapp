# IG Organizer Studio by SoUL

Instagram 저장글(북마크)과 팔로워 정보를 정리하기 위한 Chrome 확장 + 로컬 뷰어 프로젝트입니다.

- Chrome 확장: 인스타그램 저장글/팔로워 페이지에서 JSON 수집
- 로컬 뷰어: 수집 JSON을 브라우저에서 바로 불러와 카테고리/메모/썸네일 정렬 관리

## 현재 기능

- 저장글 수집
  - `saved` 폴더 기반 수집(폴더별 순회 + `all-posts` 마지막 수집)
  - 게시글 썸네일 정렬/표시 크기 조절(작게/보통/크게)
  - 중단 요청 시 해당 시점까지 누적 저장 (중복 병합 방지)
- 팔로워 수집
  - 팔로워 목록 다이얼로그/인스타그램 컨텍스트 대응
  - 팔로워도 앨범형 카드 뷰(작게/보통/크게)
  - 카테고리, 메모, 메모 검색 필터 지원
- 로컬 뷰어
  - 저장글/팔로워 각각 개별 탭 정리
  - 단일/복수 JSON 파일 로드 및 병합 로드
  - 항목 다중 선택 후 일괄 분류
  - 현재 상태 복사/다운로드/초기화

## 폴더 구조

- `instagram-crawler-mvp/manifest.json`
- `instagram-crawler-mvp/background.js`, `instagram-crawler-mvp/content.js`
- `instagram-crawler-mvp/index.html` (확장 메인/옵션 인터페이스)
- `instagram-crawler-mvp/popup/` (팝업 UI)
- `instagram-crawler-mvp/local-viewer/` (브라우저 기반 정리 뷰어)

## 구조

- `manifest.json`
- `background.js`, `content.js`
- `index.html` (확장 메인)
- `popup/` (팝업 UI)
- `local-viewer/` (브라우저 기반 정리 뷰어)

## 실행 방법

### 1) 크롬 확장 로드
1. `chrome://extensions` 열기
2. 개발자 모드 ON
3. **압축 해제된 확장 프로그램 로드** 클릭
4. 이 저장소 루트(`instagram-crawler-mvp`) 선택

### 2) 로컬 뷰어 사용
- 브라우저에서 `instagram-crawler-mvp/local-viewer/index.html` 열기
- 확장 수집 JSON 업로드 또는 붙여넣기
- 저장글/팔로워 탭에서 카테고리/검색/메모 정리

## 배포

`local-viewer`는 정적 페이지이므로 별도 빌드 없이 GitHub Pages/Netlify/Firebase에 바로 배포 가능합니다.

## 크레딧

- 개발: SoUL
- Threads: https://www.threads.com/@mixbysoul
- Instagram: https://www.instagram.com/mixbysoul
