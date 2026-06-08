#!/bin/bash
CONF_FILE=$(grep -rl "filemanager-nas.com" /etc/nginx/sites-available/ | head -n 1)
if [ -z "$CONF_FILE" ]; then CONF_FILE="/etc/nginx/sites-available/default"; fi

# 기존 찌꺼기 제거
sed -i '/proxy_request_buffering/d' "$CONF_FILE"
sed -i '/proxy_buffering/d' "$CONF_FILE"
sed -i '/sendfile /d' "$CONF_FILE"
sed -i '/tcp_nopush/d' "$CONF_FILE"
sed -i '/tcp_nodelay/d' "$CONF_FILE"

# 속도 극대화 옵션 주입
awk '
/server\s*\{/ && !inserted {
    print
    print "    # 🚀 업로드/다운로드 한계속도 돌파 (Turbo)"
    print "    sendfile on;                  # 커널 공간에서 직접 파일 전송"
    print "    tcp_nopush on;                # 패킷을 꽉 채워서 한번에 전송"
    print "    tcp_nodelay on;               # 딜레이 없이 즉각 전송"
    print "    proxy_request_buffering off;  # 업로드 시 Nginx 디스크 쓰기 생략 (다이렉트 스트리밍)"
    print "    proxy_buffering off;          # 다운로드 즉시 스트리밍"
    print "    client_body_buffer_size 512k; # 메모리 버퍼 확장"
    inserted = 1
    next
}
{ print }
' "$CONF_FILE" > tmp_nginx.conf && mv tmp_nginx.conf "$CONF_FILE"

systemctl restart nginx
echo "✅ Nginx 업로드/다운로드 병목 제거 및 최고속도 패치 완료!"
