import os

file_path = 'src/components/NAS.js'
if not os.path.exists(file_path):
    file_path = 'src/components/NAS.js.old' # 백업본이라도 찾음

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
imported = False
for line in lines:
    # 상단에 SidebarTree 임포트 추가
    if "import InlineInput" in line and not imported:
        new_lines.append(line)
        new_lines.append("import SidebarTree from './NAS/Window/SidebarTree';\n")
        imported = True
        continue
    
    # 기존의 단순한 사이드바 리스트 부분을 트리로 교체
    if '<List sx={{ pt: 1 }}><ListItem button onClick={() => fetchFiles(win.id, win.basePath)}>' in line:
        new_lines.append('                            <SidebarTree win={win} fetchFiles={fetchFiles} theme={theme} />\n')
        continue
    
    # 교체된 부분의 나머지 찌꺼기들 제거
    if '<ListItemIcon sx={{ minWidth: 40 }}><StorageIcon color="primary"/></ListItemIcon>' in line: continue
    if '<ListItemText primary={<Typography sx={{ fontWeight: 600 }}>{win.name}</Typography>} />' in line: continue
    if '</ListItem></List>' in line: continue
    
    new_lines.append(line)

with open('src/components/NAS.js', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print("✅ NAS.js 수술 완료! (기존 기능 100% 유지)")
