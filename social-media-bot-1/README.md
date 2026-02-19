# Compass Ent 소셜 미디어 운영 봇 v1 (유튜브/인스타/틱톡)

이 스크립트는 **1번 봇**(유튜브 / 인스타그램 / 틱톡 콘텐츠 운영)용 최소 실행 버전입니다.

## 기능

- 주제/스타일/목표 기반으로 플랫폼별 초안 생성
- 플랫폼별 포맷 가이드(길이/톤/해시태그 톤) 반영
- 콘텐츠 캘린더(`SQLite`)에 일정 저장
- 초안 상태(`draft`, `approved`, `posted`, `archived`) 관리
- 승인된 항목만 JSON으로 추출하여 n8n/슬랙/웹훅 연동용으로 사용
- OpenAI API 키가 있으면 LLM 생성 모드 지원(없으면 규칙 기반 fallback)

## 폴더 구조

- `social_media_bot.py`: CLI 실행본
- `requirements.txt`: 선택적 의존성
- `.env.example`: 환경변수 예시
- `social_media.sqlite`: 실행 시 자동 생성되는 로컬 DB

## 설치

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# 필요 시 .env에 OPENAI_API_KEY 입력
```

## 사용 예시

```bash
# 초안 생성 + 저장
python social_media_bot.py create \
  --topic "브레이크다운 파티 하이라이트 클립" \
  --platforms youtube,instagram,tiktok \
  --due-date "2026-02-20" \
  --artist "DJ Nova" \
  --style "하우스 / 감성 EDM" \
  --tone "뜨거운 파티 무드" \
  --goal "팔로워 유입과 이벤트 티켓 안내"

# 대기 목록 조회
python social_media_bot.py list

# 상세 확인
python social_media_bot.py show --id <uuid>

# 승인 처리
python social_media_bot.py status --id <uuid> --status approved

# 승인된 콘텐츠만 export (자동화 도구 입력용)
python social_media_bot.py export --status approved
```

## 상태 변경 규칙

- 운영에서는 항상 `draft` 생성 후 사람 승인(`approved`) → 게시/전송.
- `posted`는 실제 발행 후 수동 변경 추천.

