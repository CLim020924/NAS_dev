import os
import json

def get_sidebar_data(target_path):
    """
    실제 사이드바가 백엔드에 요청해서 받아올 데이터를 
    터미널에서 미리 시뮬레이션하는 함수
    """
    if not os.path.exists(target_path):
        return f"❌ 에러: [{target_path}] 경로가 존재하지 않습니다."

    print(f"\n🚀 [루트 설정됨]: {target_path}")
    print("=" * 50)

    def build_tree(current_path, level=0):
        try:
            # 1. 현재 폴더 안의 목록을 가져옴
            items = sorted(os.listdir(current_path))
            
            for item in items:
                full_path = os.path.join(current_path, item)
                
                # 2. 폴더(Folder)만 사이드바 트리에 표시하는 로직 (파일은 제외)
                if os.path.isdir(full_path):
                    indent = "  " * level
                    print(f"{indent}┗━ 📂 {item} (Path: {full_path})")
                    
                    # 3. 재귀(Recursion): 하위 폴더가 있으면 또 들어감
                    build_tree(full_path, level + 1)
                    
        except PermissionError:
            print(f"{indent}  ⚠️ 권한 없음: {current_path}")

    build_tree(target_path)
    print("=" * 50)
    print("✅ 탐색 완료: 이 구조가 사이드바에 그대로 그려져야 합니다.")

# [테스트 실행] 찬영님이 확인하고 싶은 '창의 루트 경로'를 여기에 넣으세요.
test_root = "/home/limchanyoung/my-service-platform/frontend/src"
get_sidebar_data(test_root)
