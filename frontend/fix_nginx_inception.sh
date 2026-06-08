#!/bin/bash

# 1. Nginx 설정 파일 찾기
CONF_FILE=$(grep -rl "filemanager-nas.com" /etc/nginx/sites-available/ | head -n 1)
if [ -z "$CONF_FILE" ]; then CONF_FILE="/etc/nginx/sites-available/default"; fi

echo "🎯 타겟 Nginx 파일: $CONF_FILE"

# 2. 이전에 만든 잘못된 VIP 통로 지우기
sed -i '/ONLYOFFICE VIP ROUTE/,/}/d' "$CONF_FILE"
sed -i '/location ~\* \^\/\(web-apps/,/}/d' "$CONF_FILE"

# 3. 버전 정보(9.3.1-어쩌구)까지 포함하는 완벽한 하이패스 개통
awk '
/location\s+\/\s*\{/ && !inserted {
    print "    # 🔥 ONLYOFFICE VIP ROUTE (Inception Fix)"
    print "    location ~* ^/([0-9]+\\.[0-9]+\\.[0-9]+-|web-apps|coauthoring|hosting|cache|fonts|sdkjs|ConvertService|Preloader|info\\.json|spellchecker) {"
    print "        proxy_pass http://127.0.0.1:8080;"
    print "        proxy_http_version 1.1;"
    print "        proxy_set_header Upgrade $http_upgrade;"
    print "        proxy_set_header Connection \"upgrade\";"
    print "        proxy_set_header Host $http_host;"
    print "        proxy_set_header X-Real-IP $remote_addr;"
    print "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    print "        proxy_set_header X-Forwarded-Proto https;"
    print "    }"
    print ""
    inserted = 1
}
{ print }
' "$CONF_FILE" > tmp_nginx.conf && mv tmp_nginx.conf "$CONF_FILE"

# 4. Nginx 재시작
systemctl restart nginx
echo "✅ 인셉션 현상 해결! Nginx 재시작 완료!"
