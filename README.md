# 생물 미니

SIMPLICITY Mini 생물 문제집(2022·2024·2025, 850문항)을 회차별로 풀고 복습하는 개인용 학습 웹앱(PWA).

- 공개 사이트: GitHub Pages (이 저장소의 `app/`을 빌드). **저장소와 사이트에는 코드만 있다.**
- 문항·그림: 저작물(©SIMPLICITY Mini)이라 Supabase `content` 표에만 두고, 로그인한 본인만 받는다.
- 학습 기록: 기기에 저장하고, 로그인하면 Supabase `user_state` 표와 합쳐서 동기화한다(폰 ↔ 컴퓨터).

## 처음 설정 (한 번)

1. **Supabase 표 만들기**: 대시보드 → SQL Editor → `supabase/schema.sql` 전체를 붙여 넣고 Run.
2. **가입 막기**: Authentication → Sign In / Providers → *Allow new users to sign up* 끄기.
3. **내 계정 만들기**: Authentication → Users → Add user → Create new user (이메일·비밀번호, *Auto Confirm User* 켜기).
   처음 만든 계정 하나만 `members`에 자동으로 들어가고, 그 계정만 문항을 읽고 쓸 수 있다.
4. **배포**: main에 올리면 Actions가 빌드해 `gh-pages` 브랜치에 올리고, GitHub Pages가 그 브랜치를 보여 준다.
5. **문항 올리기**: 문항이 들어 있는 비공개 사본에서 로그인 → 기록 → *이 문항을 클라우드에 올리기*. (또는 공개 사이트에서 묶음 파일을 골라 올린다.)

앱에 들어 있는 Supabase 키는 공개용(publishable) 키다. 서비스 키(service_role / secret)는 어디에도 넣지 않는다.

## 폴더

```
app/
  src/       lib.ts(데이터·기록·채점·합치기) cloud.ts(로그인·문항 받기/올리기·동기화)
             ui.tsx(문항 화면) Runner.tsx(풀이 모드) App.tsx(화면)
  public/    index.html, styles.css, sw.js(오프라인), manifest
  build.sh   bun으로 dist/ 생성
extract/
  extract.py           PDF → questions.json + 그림
  review.py            검수(규칙 검사 + review/fixes.json 수정 적용, --ai 선택)
  prepare_app_data.py  검수 결과 → app/public/data, img(그림 압축), 단원 태그
  topic_classify.py    새 문항 단원 추정(키워드)
  gen_topics_ts.py     review/topics.json → app/src/topics.ts
  make_bundle.py       app/public → 업로드용 묶음 파일(그림 포함 JSON)
supabase/schema.sql    표·접근 규칙(RLS)
.github/workflows/pages.yml
```

## 문항 추가하기

```bash
pip install pypdfium2 pillow
python3 extract/extract.py build b2022=…pdf b2024=…pdf s2025=…pdf b2026=새파일.pdf
python3 extract/review.py build                 # 규칙 검사 + fixes.json 적용
python3 extract/prepare_app_data.py build app/public
python3 extract/make_bundle.py app/public bioquiz-content.json
```

만든 `bioquiz-content.json`을 앱의 기록 → 계정·동기화 → *문항 데이터 바꾸기*로 올린다. 책 단위로 나뉘어 있어 다른 기기는 바뀐 책만 다시 받는다.
새 책 이름은 `extract.py`의 `BOOK_META`에 한 줄 추가한다.
단원: `review/topics.json`(문항 id → 단원, 검수한 것)에 없는 새 문항은 `prepare_app_data.py`가 키워드로 추정해 데이터에 `topic`으로 넣는다.
확인한 뒤 `review/topics.json`에 넣고 `python3 extract/gen_topics_ts.py review/topics.json app/public/data/questions.json app/src/topics.ts`로 앱의 단원표를 다시 만든다. 검수에서 flagged된 문항은 앱에서 숨겨진다.
`build/`, `review/fixes.json`, `app/public/data|img`, 묶음 파일은 문항 내용이 들어 있어 `.gitignore`로 빼 두었다.

## 카드 탭

컨닝페이퍼(마크다운 표)를 카드 덱으로 바꿔 넘기며 외운다. 오른쪽으로 밀면 알아요, 왼쪽은 몰라요, 탭하면 뒤집기. 미니 퀴즈는 4지선다.

- 기본 덱: `app/src/decks/*.md` (`deckdata.ts`의 `BUILT_IN`에 등록)
- 형식: `# 덱 이름`, `## 묶음 이름`, `| 항목 | 내용 |` 표의 각 줄이 카드 한 장
- 앱의 카드 탭 → '붙여 넣어 만들기'로 새 덱을 만들 수 있고, 카드별 기억 상태와 함께 로그인하면 동기화된다.

## 채점

- 빈칸형: 칸마다 채점하고, 일부만 맞으면 부분 점수(맞힌 칸 비율)를 기록한다. 문항 정답은 모든 칸이 맞을 때만.
- 띄어쓰기·문장부호 무시, 같은 뜻의 다른 표기(`lib.ts`의 `SYNONYMS`, -에이스/-아제) 인정, 낱말 단위로 더 길게/짧게 쓴 답 인정.
- 오타: 첫 글자가 같고 모음 하나만 다르거나, 긴 말에서 자모 1~2개만 다르면 정답(＋'철자 확인' 표시). 영문·숫자가 다르면(DNA/RNA, I/II) 틀림.
- 단원별 정답률은 처음 풀었을 때 점수 기준, 문항이 적은 단원은 전체 평균 쪽으로 보정해서 약한 단원을 고른다.

## 빌드

```bash
cd app && bun install && ./build.sh     # dist/
```

`app/public/data`가 있으면 그 문항으로 로그인 없이도 열린다(비공개 사본용). 없으면 로그인 화면부터 뜬다.
