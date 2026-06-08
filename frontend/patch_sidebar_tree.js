const fs = require('fs');
const path = require('path');

// ==========================================
// 1. 새로운 SidebarTree.js 컴포넌트 생성
// ==========================================
const sidebarTreePath = './src/components/NAS/Window/SidebarTree.js';
const sidebarTreeCode = `import React, { useState, useEffect, useRef } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Collapse, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import StorageIcon from '@mui/icons-material/Storage';
import axios from 'axios';

const ensureSlash = (p) => p.startsWith('/') ? p : '/' + p;

const TreeNode = ({ itemPath, itemName, isFolder, level, currentPath, fetchFiles, winId, openFileWindow, theme }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const itemRef = useRef(null);

  const safeItemPath = ensureSlash(itemPath);
  const safeCurrentPath = ensureSlash(currentPath);
  const isSelected = safeCurrentPath === safeItemPath;
  
  // 🔥 하위 경로로 이동하면 부모 폴더들은 자동으로 열리도록(Expand) 스마트하게 감지!
  const isAncestor = safeItemPath === '/' 
    ? safeCurrentPath !== '/' 
    : safeCurrentPath.startsWith(safeItemPath + '/');

  useEffect(() => {
    if (isAncestor && !expanded) setExpanded(true);
  }, [isAncestor, expanded]);

  // 🔥 경로 이동 시 해당 노드를 화면 중앙으로 부드럽게 스크롤!
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }, [isSelected]);

  // 🔥 폴더를 열 때만 API를 호출하여 서버 부하 방지 (Lazy Loading)
  useEffect(() => {
    if (expanded && isFolder && !loaded) {
      let isMounted = true;
      setLoading(true);
      axios.get(\`/api/files?path=\${encodeURIComponent(safeItemPath)}&t=\${Date.now()}\`, { withCredentials: true })
        .then(res => {
          if (isMounted) {
            // 폴더를 먼저, 그 다음 파일을 오름차순 정렬
            const sorted = (res.data || []).sort((a, b) => {
              if (a.type === 'folder' && b.type !== 'folder') return -1;
              if (a.type !== 'folder' && b.type === 'folder') return 1;
              return a.name.localeCompare(b.name);
            });
            setChildren(sorted);
            setLoaded(true);
            setLoading(false);
          }
        }).catch(() => { if (isMounted) setLoading(false); });
      return () => { isMounted = false; };
    }
  }, [expanded, isFolder, loaded, safeItemPath]);

  const handleToggle = (e) => {
    e.stopPropagation();
    if (isFolder) setExpanded(!expanded);
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (isFolder) {
      setExpanded(true);
      fetchFiles(winId, safeItemPath);
    } else {
      openFileWindow({ name: itemName, fullPath: safeItemPath, type: 'file' }, false);
    }
  };

  return (
    <Box>
      <ListItem
        ref={itemRef}
        button
        onClick={handleClick}
        sx={{
          pl: level * 2 + 1, pr: 2, py: 0.5, minHeight: 32,
          backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.15) : 'transparent',
          borderLeft: isSelected ? \`4px solid \${theme.palette.primary.main}\` : '4px solid transparent',
          '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.08) },
          display: 'flex', alignItems: 'center', transition: 'all 0.1s ease',
        }}
      >
        <Box onClick={handleToggle} sx={{ display: 'flex', alignItems: 'center', width: 24, justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {isFolder ? (loading ? <CircularProgress size={12} /> : (expanded ? <KeyboardArrowDownIcon fontSize="small" color="action" /> : <KeyboardArrowRightIcon fontSize="small" color="action" />)) : <Box sx={{ width: 20 }} />}
        </Box>
        <ListItemIcon sx={{ minWidth: 28, color: isFolder ? (level === 0 ? theme.palette.primary.main : '#fbbf24') : theme.palette.text.secondary }}>
          {level === 0 ? <StorageIcon fontSize="small" /> : (isFolder ? (expanded ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />) : <InsertDriveFileIcon fontSize="small" />)}
        </ListItemIcon>
        <ListItemText
          primary={itemName}
          primaryTypographyProps={{
            variant: 'body2',
            sx: { 
              fontWeight: isSelected ? 800 : 500, 
              color: isSelected ? theme.palette.primary.main : theme.palette.text.primary,
              whiteSpace: 'nowrap', // 최악의 상황: 글씨가 영역을 넘어가면 밀리지 않게 강제 1줄 유지
            }
          }}
        />
      </ListItem>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        {children.map(child => (
          <TreeNode
            key={child.fullPath} itemPath={child.fullPath} itemName={child.name} isFolder={child.type === 'folder'}
            level={level + 1} currentPath={currentPath} fetchFiles={fetchFiles} winId={winId} openFileWindow={openFileWindow} theme={theme}
          />
        ))}
      </Collapse>
    </Box>
  );
};

const SidebarTree = ({ win, fetchFiles, openFileWindow, theme }) => {
  return (
    // 🔥 최악의 상황 대비: 하위 폴더가 깊어지면 가로로 예쁘게 스크롤 되도록 max-content 처리
    <Box sx={{ width: '100%', height: '100%', overflow: 'auto', backgroundColor: theme.palette.background.default }}>
      <List sx={{ p: 0, pt: 1, minWidth: 'max-content' }}>
        <TreeNode
          itemPath={win.basePath}
          itemName={win.name}
          isFolder={true}
          level={0}
          currentPath={win.currentPath}
          fetchFiles={fetchFiles}
          winId={win.id}
          openFileWindow={openFileWindow}
          theme={theme}
        />
      </List>
    </Box>
  );
};

export default SidebarTree;
`;
fs.writeFileSync(sidebarTreePath, sidebarTreeCode);
console.log("✅ SidebarTree.js 컴포넌트 생성 완료!");

// ==========================================
// 2. NASWindow.js 에 사이드바 교체 패치 적용
// ==========================================
const windowPath = './src/components/NAS/Window/NASWindow.js';
if (fs.existsSync(windowPath)) {
    let code = fs.readFileSync(windowPath, 'utf8');

    // SidebarTree 임포트 추가
    if (!code.includes("import SidebarTree")) {
        code = code.replace(
            "import FolderView from './FolderView';", 
            "import FolderView from './FolderView';\nimport SidebarTree from './SidebarTree';"
        );
    }

    // 껍데기만 있던 기존 List를 SidebarTree 로 교체
    const oldListRegex = /<List sx=\{\{ pt: 1 \}\}>[\s\S]*?<\/List>/;
    const newTreeComponent = `<SidebarTree win={win} fetchFiles={fetchFiles} openFileWindow={openFileWindow} theme={theme} />`;
    
    if (oldListRegex.test(code)) {
        code = code.replace(oldListRegex, newTreeComponent);
        fs.writeFileSync(windowPath, code);
        console.log("✅ NASWindow.js: 껍데기 사이드바를 동적 트리뷰로 완벽 교체 완료!");
    } else {
        console.log("⚡ NASWindow.js 에서 교체할 기존 사이드바 코드를 찾지 못했습니다.");
    }
}
