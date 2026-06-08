import React, { useState, useEffect, useRef } from 'react';

const InlineInput = ({ defaultValue, onSubmit, onCancel, isDesktop }) => {
  const [val, setVal] = useState(defaultValue);
  const inputRef = useRef(null);
  const isSubmitted = useRef(false);

  const handleSubmit = () => {
    if (isSubmitted.current) return;
    isSubmitted.current = true;
    onSubmit(val);
  };

  const handleCancel = () => {
    if (isSubmitted.current) return;
    isSubmitted.current = true;
    onCancel();
  };

  useEffect(() => {
    let isMounted = true;
    setTimeout(() => {
      if (isMounted && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 100); 
    return () => { isMounted = false; };
  }, []);

  return (
    <input
      ref={inputRef}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={handleSubmit}
      onKeyDown={e => {
        if (e.key === 'Enter') handleSubmit();
        if (e.key === 'Escape') handleCancel();
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
      onDragStart={e => e.preventDefault()}
      style={{
        width: isDesktop ? '100px' : '100%',
        textAlign: isDesktop ? 'center' : 'left',
        padding: '2px 4px',
        border: `2px solid #3b82f6`,
        outline: 'none',
        backgroundColor: '#fff',
        color: '#000',
        borderRadius: '4px',
        marginTop: isDesktop ? '4px' : '0',
        fontSize: '0.85rem',
        fontWeight: 'bold',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
      }}
    />
  );
};

export default InlineInput;
