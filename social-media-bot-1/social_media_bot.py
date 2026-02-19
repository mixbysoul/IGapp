#!/usr/bin/env python3
"""
Compass Ent Social Agent v1
Target: YouTube / Instagram / TikTok content planning and schedule management.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import uuid
import datetime as dt
from typing import Dict, List, Optional

DEFAULT_DB = os.path.join(os.path.dirname(__file__), "social_media.sqlite")
ALLOWED_PLATFORMS = {"youtube", "instagram", "tiktok"}

PLATFORM_GUIDE: Dict[str, Dict[str, str]] = {
    "youtube": {
        "title_limit": "100글자 이하",
        "desc_limit": "5000자 이하",
        "tone": "브랜딩·이벤트·아티스트 하이라이트 중심, 스토리형"
    },
    "instagram": {
        "title_limit": "첫 3줄 훅 + 본문 2200자 이하",
        "desc_limit": "2200자 이하",
        "tone": "비주얼 중심, 짧고 감각적인 문장+해시태그"
    },
    "tiktok": {
        "title_limit": "훅은 150자 이내, 캡션은 짧고 직관적",
        "desc_limit": "1500자 이하",
        "tone": "짧고 리듬감 있는 문구, 참여 유도형"
    },
}


def parse_platforms(value: str) -> List[str]:
    if not value:
        return []
    requested = [p.strip().lower() for p in value.split(",")]
    return [p for p in requested if p in ALLOWED_PLATFORMS]


def now_iso() -> str:
    return dt.datetime.now().replace(microsecond=0).isoformat()


def normalize_hashtags(tags: List[str]) -> str:
    deduped = []
    for raw in tags:
        tag = re.sub(r"\s+", "", raw.strip())
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = "#" + tag
        if tag not in deduped:
            deduped.append(tag)
    return " ".join(deduped)


def fallback_draft(platform: str, inputs: Dict[str, str]) -> Dict[str, str]:
    topic = inputs["topic"]
    style = inputs.get("style", "몰입형 EDM")
    artist = inputs.get("artist", "Compass Ent")
    tone = inputs.get("tone", "트렌디하고 강한")
    goal = inputs.get("goal", "팬과의 연결 강화")
    event = inputs.get("event")
    due = inputs.get("due_date", "")
    hashtag_hint = normalize_hashtags(inputs.get("hashtags", "").split(","))

    base_tag_pool = [
        "#CompassEnt", "#DJ", "#Party", "#Mix", "#Live", "#EDM", "#House",
        f"#{style.replace(' ', '')}", f"#{artist.replace(' ', '')}"
    ]
    base_tag_pool.extend(["#클럽", "#파티", "#뮤직"])
    base_tags = normalize_hashtags(base_tag_pool + hashtag_hint.split()) if hashtag_hint else normalize_hashtags(base_tag_pool)

    if platform == "youtube":
        title = f"{artist} - {topic} | {style} #CompassEnt"
        hook = f"{tone} 무드의 {style} 셋으로 시작하는 이번 주 하이라이트"
        caption = (
            f"{artist}의 최신 콘텐츠: {topic}\n"
            f"무드: {style} / 컨셉: {goal}\n"
            + (f"행사: {event}\n" if event else "")
            + f"공개 예정: {due}\n\n"
            f"영상에서 다룬 사운드 포인트: bassline, 분위기 전환, 피크 빌드\n"
            f"원본 트랙과 무드 구성 카드도 함께 확인해보세요."
        )
        notes = "유튜브 썸네일 16:9, 텍스트는 6단어 이내, 음악/영상 출처 라이선스 확인."
    elif platform == "instagram":
        title = f"[{artist}] {topic} Teaser"
        hook = f"{tone} 감성 {style} 무대 분위기, 1분 안에 빠르게 들어갑니다."
        caption = (
            f"{hook}\n\n"
            f"오늘의 키워드: {style}, 클럽 무드, 피크 타임, 리듬 드롭\n"
            f"{f'📍 {event} ' if event else ''}"
            f"{'🗓 ' + due if due else ''}\n"
            f"오늘 들을 트랙: #NowPlaying / 상세는 영상 고정 댓글에 업데이트\n"
            f"{base_tags}"
        )
        notes = "첫 3줄은 후킹 문구로 구성, 본문 2200자 이내, 스토리 하이라이트 3종."
    else:
        title = f"{topic} · {artist}"
        hook = f"{style} 감각, 3초 안에 몰입! {artist} 하이라이트"
        caption = (
            f"{hook}\n\n"
            f"오늘 vibe: {tone}\n"
            f"{f'📍 ' + event if event else ''}\n"
            + (f"🗓 " + due if due else "") + "\n"
            f"{base_tags}"
        )
        notes = "앞 2~3초 훅 + 자막 강조, 루프 가능한 5~15초 컷 1개 추천."

    return {
        "platform": platform,
        "title": title,
        "hook": hook,
        "caption": caption,
        "hashtags": base_tags,
        "publishing_notes": notes,
        "guide": PLATFORM_GUIDE[platform],
    }


def build_llm_prompt(platform: str, inputs: Dict[str, str]) -> str:
    return f"""
너는 Compass Ent의 소셜 미디어 전담 에이전트이다.
다음 조건으로 {platform} 게시물 초안을 JSON으로 딱 하나만 작성해.
반드시 파싱 가능한 JSON만 출력해.

입력:
- 플랫폼: {platform}
- 주제: {inputs['topic']}
- 아티스트/브랜드: {inputs.get('artist','')}
- 스타일: {inputs.get('style','')}
- 톤: {inputs.get('tone','')}
- 목표: {inputs.get('goal','')}
- 이벤트: {inputs.get('event','')}
- 업로드 예정일: {inputs.get('due_date','')}
- 해시태그 힌트: {inputs.get('hashtags','')}

출력 JSON 스키마:
{{
  "platform": "{platform}",
  "title": "제목",
  "hook": "훅",
  "caption": "본문",
  "hashtags": "#tag1 #tag2 ...",
  "publishing_notes": "업로드 주의/아이디어"
}}
"""


def llm_draft(platform: str, inputs: Dict[str, str]) -> Optional[Dict[str, str]]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "너는 실전형 소셜미디어 마케터다."},
                {"role": "user", "content": build_llm_prompt(platform, inputs)},
            ],
            temperature=0.7,
        )
        raw = response.choices[0].message.content.strip()
    except Exception:
        return None

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and parsed.get("platform"):
            parsed["platform"] = platform
            parsed["guide"] = PLATFORM_GUIDE[platform]
            return parsed
    except Exception:
        return None
    return None


def build_drafts(platforms: List[str], inputs: Dict[str, str], use_llm: bool) -> List[Dict[str, str]]:
    output = []
    for platform in platforms:
        draft = llm_draft(platform, inputs) if use_llm else None
        if not draft:
            draft = fallback_draft(platform, inputs)
        output.append(draft)
    return output


def get_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS social_posts (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            status TEXT NOT NULL,
            due_date TEXT,
            topic TEXT NOT NULL,
            artist TEXT,
            style TEXT,
            tone TEXT,
            goal TEXT,
            event TEXT,
            hashtags TEXT,
            platforms TEXT NOT NULL,
            drafts TEXT NOT NULL
        )
    """)
    conn.commit()


def create_entry(conn: sqlite3.Connection, row: Dict[str, str], drafts: List[Dict[str, str]]) -> str:
    row_id = str(uuid.uuid4())
    now = now_iso()
    conn.execute(
        """
        INSERT INTO social_posts (
            id, created_at, updated_at, status, due_date, topic, artist, style, tone,
            goal, event, hashtags, platforms, drafts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            row_id,
            now,
            now,
            "draft",
            row.get("due_date"),
            row["topic"],
            row.get("artist"),
            row.get("style"),
            row.get("tone"),
            row.get("goal"),
            row.get("event"),
            row.get("hashtags"),
            ",".join(parse_platforms(row["platforms"])),
            json.dumps(drafts, ensure_ascii=False),
        ),
    )
    conn.commit()
    return row_id


def list_entries(conn: sqlite3.Connection, status: Optional[str] = None, limit: int = 20) -> List[sqlite3.Row]:
    query = "SELECT * FROM social_posts"
    params: List[str] = []
    if status:
        query += " WHERE status = ?"
        params.append(status)
    query += " ORDER BY due_date IS NULL, due_date ASC, created_at DESC LIMIT ?"
    params.append(limit)
    return conn.execute(query, params).fetchall()


def get_entry(conn: sqlite3.Connection, post_id: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM social_posts WHERE id = ?",
        (post_id,),
    ).fetchone()


def set_status(conn: sqlite3.Connection, post_id: str, status: str) -> bool:
    if status not in {"draft", "approved", "posted", "archived"}:
        return False
    cur = conn.execute(
        "UPDATE social_posts SET status = ?, updated_at = ? WHERE id = ?",
        (status, now_iso(), post_id),
    )
    conn.commit()
    return cur.rowcount > 0


def export_json(conn: sqlite3.Connection, status: str = "approved", platform: Optional[str] = None) -> List[Dict[str, str]]:
    rows = list_entries(conn, status=status, limit=999)
    payload = []
    for row in rows:
        drafts = json.loads(row["drafts"])
        if platform:
            drafts = [d for d in drafts if d["platform"] == platform]
            if not drafts:
                continue
        payload.append({
            "id": row["id"],
            "topic": row["topic"],
            "due_date": row["due_date"],
            "status": row["status"],
            "artist": row["artist"],
            "style": row["style"],
            "platforms": row["platforms"].split(","),
            "drafts": drafts,
        })
    return payload


def cmd_create(args: argparse.Namespace, conn: sqlite3.Connection) -> None:
    if not args.platforms:
        print("오류: --platforms 는 youtube,instagram,tiktok 중 1개 이상 필요합니다.")
        return
    inputs = {
        "topic": args.topic,
        "artist": args.artist,
        "style": args.style,
        "tone": args.tone,
        "goal": args.goal,
        "event": args.event,
        "hashtags": args.hashtags,
        "due_date": args.due_date,
        "platforms": ",".join(args.platforms),
    }
    platforms = parse_platforms(inputs["platforms"])
    if not platforms:
        print("오류: 지원되는 플랫폼(youtube/instagram/tiktok) 중 최소 1개를 입력하세요.")
        return
    drafts = build_drafts(platforms, inputs, use_llm=args.use_llm)
    post_id = create_entry(conn, inputs, drafts)
    print(f"saved_id={post_id}")
    print(json.dumps({"id": post_id, "platforms": platforms, "drafts": drafts}, ensure_ascii=False, indent=2))


def cmd_list(args: argparse.Namespace, conn: sqlite3.Connection) -> None:
    rows = list_entries(conn, status=args.status, limit=args.limit)
    for row in rows:
        print(
            f"[{row['status']}] {row['id']} | {row['due_date'] or '-'} | "
            f"{row['topic']} | {row['platforms']}"
        )


def cmd_show(args: argparse.Namespace, conn: sqlite3.Connection) -> None:
    row = get_entry(conn, args.id)
    if not row:
        print("해당 ID를 찾지 못했습니다.")
        return
    print(json.dumps({k: row[k] for k in row.keys()}, ensure_ascii=False, indent=2))


def cmd_status(args: argparse.Namespace, conn: sqlite3.Connection) -> None:
    if set_status(conn, args.id, args.status):
        print(f"updated={args.id}, status={args.status}")
    else:
        print("status 변경 실패(잘못된 id 또는 상태값)")


def cmd_export(args: argparse.Namespace, conn: sqlite3.Connection) -> None:
    payload = export_json(conn, status=args.status, platform=args.platform)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def load_env_file(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key and key not in os.environ:
                os.environ[key.strip()] = value.strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compass Ent Social Bot v1")
    parser.add_argument("--db", default=os.getenv("SOCIAL_MEDIA_DB", DEFAULT_DB), help="sqlite db path")

    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create", help="콘텐츠 초안 생성")
    create.add_argument("--topic", required=True, help="콘텐츠 주제")
    create.add_argument("--platforms", required=True, help="youtube,instagram,tiktok (comma-separated)")
    create.add_argument("--due-date", required=False, default="", help="YYYY-MM-DD")
    create.add_argument("--artist", default="", help="아티스트/브랜드")
    create.add_argument("--style", default="", help="음악 스타일")
    create.add_argument("--tone", default="", help="톤앤매너")
    create.add_argument("--goal", default="", help="운영 목표")
    create.add_argument("--event", default="", help="행사명/캠페인명")
    create.add_argument("--hashtags", default="", help="tag1,tag2 형태")
    create.add_argument("--use-llm", action="store_true", help="OPENAI API 사용해 초안 생성")

    lst = sub.add_parser("list", help="목록 조회")
    lst.add_argument("--status", default=None, choices=["draft", "approved", "posted", "archived"], help="상태 필터")
    lst.add_argument("--limit", type=int, default=20)

    show = sub.add_parser("show", help="상세 보기")
    show.add_argument("--id", required=True)

    status = sub.add_parser("status", help="상태 변경")
    status.add_argument("--id", required=True)
    status.add_argument("--status", required=True, choices=["draft", "approved", "posted", "archived"])

    export = sub.add_parser("export", help="자동화 연동용 추출")
    export.add_argument("--status", default="approved", choices=["draft", "approved", "posted", "archived"])
    export.add_argument("--platform", default=None, choices=["youtube", "instagram", "tiktok"])
    return parser.parse_args()


def main() -> None:
    load_env_file(os.path.join(os.path.dirname(__file__), ".env"))
    args = parse_args()

    conn = get_db(args.db)
    ensure_schema(conn)

    if args.command == "create":
        cmd_create(args, conn)
    elif args.command == "list":
        cmd_list(args, conn)
    elif args.command == "show":
        cmd_show(args, conn)
    elif args.command == "status":
        cmd_status(args, conn)
    elif args.command == "export":
        cmd_export(args, conn)


if __name__ == "__main__":
    main()
