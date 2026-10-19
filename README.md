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
4. **Pages 켜기**: GitHub 저장소 → Settings → Pages → Source를 *GitHub Actions*로.
5. 사이트에서 로그인 → **문항 데이터 올리기**로 `bioquiz-content-….json` 파일을 고른다(따로 받은 비공개 파일).

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
  prepare_app_data.py  검수 결과 → app/public/data, img(그림 압축)
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
새 책 이름은 `extract.py`의 `BOOK_META`에 한 줄 추가한다. 검수에서 flagged된 문항은 앱에서 숨겨진다.
`build/`, `review/fixes.json`, `app/public/data|img`, 묶음 파일은 문항 내용이 들어 있어 `.gitignore`로 빼 두었다.

## 빌드

```bash
cd app && bun install && ./build.sh     # dist/
```

`app/public/data`가 있으면 그 문항으로 로그인 없이도 열린다(비공개 사본용). 없으면 로그인 화면부터 뜬다.
