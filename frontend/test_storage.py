import os

# [확인] 찬영님의 실제 NAS 데이터가 들어있는 '절대 경로'를 아래에 넣으세요
target = "/home/limchanyoung/my-service-platform/backend/storage" 

print(f"\n🔍 탐색 경로: {target}")
if not os.path.exists(target):
    print("❌ 에러: 경로가 존재하지 않습니다!")
else:
    print("✅ 경로 존재 확인")
    for root, dirs, files in os.walk(target):
        level = root.replace(target, '').count(os.sep)
        indent = ' ' * 4 * (level)
        print(f"{indent}📂 {os.path.basename(root)}/")
        sub_indent = ' ' * 4 * (level + 1)
        for f in files:
            print(f"{sub_indent}📄 {f}")
