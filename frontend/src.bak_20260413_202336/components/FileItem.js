// FileItem.js
import React from 'react';
import { useDrag, useDrop } from 'react-dnd';

export const ITEM_TYPE = 'FILE_ITEM';

function FileItem({ file, index, moveFile, moveIntoFolder, children }) {
  // 드래그 설정: 파일 항목의 정보를 item으로 전달합니다.
  const [{ isDragging }, drag] = useDrag({
    type: ITEM_TYPE,
    item: { file, index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  // 드롭 설정: 같은 폴더 내 순서 변경과 폴더로 이동하는 두 경우로 구분합니다.
  // hover 시 순서 변경, drop 시 폴더로 이동.
  const [, drop] = useDrop({
    accept: ITEM_TYPE,
    hover: (draggedItem) => {
      if (draggedItem.index !== index) {
        // 같은 폴더 내 순서 변경
        moveFile(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
    drop: (draggedItem, monitor) => {
      // 만약 드롭된 대상이 폴더라면 (예: file.isFolder === true)
      // draggedItem.file를 해당 폴더 안으로 이동시키도록 호출
      if (file.isFolder && draggedItem.file.fullPath !== file.fullPath) {
        moveIntoFolder(draggedItem.file, file);
      }
    },
  });

  return (
    <div
      ref={(node) => drag(drop(node))}
      style={{
        opacity: isDragging ? 0.5 : 1,
        padding: '8px',
        border: '1px solid #ccc',
        margin: '4px',
        backgroundColor: file.isFolder ? '#f0f8ff' : '#fff',
        cursor: 'move'
      }}
    >
      {children ? children : file.name}
    </div>
  );
}

export default FileItem;
