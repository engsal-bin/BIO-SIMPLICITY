#!/usr/bin/env bash
# 앱 빌드: dist/ 에 그대로 올리면 되는 정적 파일을 만든다.
# 필요: bun (bun install 로 react, react-dom 설치)
# public/data, public/img 가 있으면 같이 들어간다(비공개 사본용). 공개 저장소에는 없다.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
bun build src/main.tsx --outfile dist/app.js --minify --target browser \
  --define 'process.env.NODE_ENV="production"'
cp -r public/* dist/
VER=$(date +%Y%m%d%H%M%S)
sed -i "s/__VERSION__/$VER/" dist/sw.js
echo "built dist/ (version $VER)"
du -sh dist
# 비공개 링크(아티팩트)용 페이지: 문서 골격 없이 본문만
cat > dist/artifact.html <<'HTML'
<title>생물 미니</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css">
<div id="root"></div>
<script type="module" src="app.js"></script>
HTML
