#!/bin/bash

# 1. Nginx 설정 파일 찾기
CONF_FILE=$(grep -rl "filemanager-nas.com" /etc/nginx/sites-available/ | head -n 1)
if [ -z "$CONF_FILE" ]; then CONF_FILE="/etc/nginx/sites-available/default"; fi

# 2. 정규식에 'doc' 경로 추가 (소켓 통신 허용)
sed -i 's/|info\\.json|spellchecker)/|info\\.json|spellchecker|doc)/g' "$CONF_FILE"

# 3. Nginx 재시작
systemctl restart nginx
echo "✅ 웹소켓(WebSocket) 전용 통로 추가 완료!"
