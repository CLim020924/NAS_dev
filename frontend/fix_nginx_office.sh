#!/bin/bash

# 1. Nginx 설정 파일 찾기
CONF_FILE=$(grep -rl "filemanager-nas.com" /etc/nginx/sites-available/ | head -n 1)
if [ -z "$CONF_FILE" ]; then CONF_FILE="/etc/nginx/sites-available/default"; fi

echo "🎯 타겟 Nginx 파일: $CONF_FILE"

# 2. 이전에 잘못 들어간 통로(/ds/)나 실패한 찌꺼기들 싹 청소하기
sed -i '/location \/ds\//,/}/d' "$CONF_FILE"
sed -i '/ONLYOFFICE VIP ROUTE/,/}/d' "$CONF_FILE"
sed -i '/location ~\* \^\/\(web-apps/,/}/d' "$CONF_FILE"

# 3. 리액트(location /) 설정 바로 위에 ONLYOFFICE 전용 하이패스 통로 개설하기
awk '
/location\s+\/\s*\{/ && !inserted {
    print "    # ONLYOFFICE VIP ROUTE"
    print "    location ~* ^/(web-apps|coauthoring|hosting|cache|fonts|sdkjs|ConvertService\\.ashx|Preloader\\.ashx|info\\.json|spellchecker) {"
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
echo "✅ Nginx ONLYOFFICE 라우팅 완벽 적용 및 서버 재시작 완료!"
