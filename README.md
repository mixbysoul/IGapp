# IG Organizer Studio by SoUL

Instagram 저장글(북마크)과 팔로워 정보를 정리하기 위한 Chrome 확장 + 로컬 뷰어 프로젝트입니다.

- Chrome 확장: 수집 페이지에서 데이터 크롤링
- 로컬 뷰어: 수집 JSON을 브라우저에서 바로 불러와 카테고리/메모를 관리

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
- 브라우저에서 `local-viewer/index.html` 열기
- 확장 수집 JSON 업로드 또는 붙여넣기
- 저장글/팔로워 탭에서 카테고리/검색/메모 정리

## 배포

`local-viewer`는 정적 페이지이므로 별도 빌드 없이 GitHub Pages/Netlify/Firebase에 바로 배포 가능합니다.
