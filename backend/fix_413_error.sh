#!/bin/bash

# 1. Nginx 글로벌 설정 파일 경로
NGINX_CONF="/etc/nginx/nginx.conf"

echo "🎯 Nginx 글로벌 설정 파일 수정 중..."

# 기존에 어설프게 들어가 있던 용량 제한 찌꺼기 싹 삭제
sed -i '/client_max_body_size/d' "$NGINX_CONF"

# http 블록 바로 밑에 '용량 무제한(0)' 강제 주입
sed -i '/http {/a \ \ \ \ client_max_body_size 0;' "$NGINX_CONF"

# 2. 개별 도메인 설정 파일에도 쐐기 박기
CONF_FILE=$(grep -rl "filemanager-nas.com" /etc/nginx/sites-available/ | head -n 1)
if [ ! -z "$CONF_FILE" ]; then
    sed -i '/client_max_body_size/d' "$CONF_FILE"
    # server 블록을 찾아서 그 아래에 무제한 설정 추가
    awk '/server\s*\{/ && !inserted {print; print "    client_max_body_size 0;"; inserted=1; next} 1' "$CONF_FILE" > tmp.conf && mv tmp.conf "$CONF_FILE"
fi

# 3. Nginx 재시작으로 설정 완벽 적용
systemctl restart nginx
echo "✅ Nginx 413 Payload Too Large (용량 제한) 에러 영구 박멸 완료!"
