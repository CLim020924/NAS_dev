#!/bin/bash
CONF_FILE=$(grep -rl "filemanager-nas.com" /etc/nginx/sites-available/ | head -n 1)
if [ -z "$CONF_FILE" ]; then CONF_FILE="/etc/nginx/sites-available/default"; fi

# 기존 설정 제거
sed -i '/proxy_request_buffering/d' "$CONF_FILE"
sed -i '/proxy_buffering/d' "$CONF_FILE"
sed -i '/client_max_body_size/d' "$CONF_FILE"
sed -i '/client_body_timeout/d' "$CONF_FILE"
sed -i '/send_timeout/d' "$CONF_FILE"
sed -i '/keepalive_timeout/d' "$CONF_FILE"
sed -i '/proxy_read_timeout/d' "$CONF_FILE"
sed -i '/proxy_connect_timeout/d' "$CONF_FILE"
sed -i '/proxy_send_timeout/d' "$CONF_FILE"

# 안정성 최우선 옵션 주입
awk '
/server\s*\{/ && !inserted {
    print
    print "    # 🛡️ 대용량 파일 안정성 최우선 세팅 (공유기 기절 방지)"
    print "    client_max_body_size 0;       # 파일 용량 무제한"
    print "    client_body_timeout 86400s;   # 업로드 중 끊김 방지 (24시간 보장)"
    print "    send_timeout 86400s;          # 다운로드 중 끊김 방지"
    print "    keepalive_timeout 86400s;     # 소켓 유지"
    print "    proxy_read_timeout 86400s;    # 백엔드 응답 대기 시간"
    print "    proxy_connect_timeout 86400s;"
    print "    proxy_send_timeout 86400s;"
    inserted = 1
    next
}
{ print }
' "$CONF_FILE" > tmp_nginx.conf && mv tmp_nginx.conf "$CONF_FILE"

systemctl restart nginx
echo "✅ Nginx 대용량 안정성 철벽 방어 세팅 및 재시작 완료!"
