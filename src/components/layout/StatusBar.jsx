import { useState } from 'react';

export default function StatusBar({ 
  currentTool, 
  mousePosition, 
  zoomLevel, 
  messages 
}) {
  const [currentMessage, setCurrentMessage] = useState(null);
  
  // Simulate messages if not provided
  const displayMessages = messages || [];

  return (
    <div className="status-bar">
      <div className="status-section">
        <span className="status-label">Tool:</span>
        <span className="status-value">{currentTool || 'Select'}</span>
      </div>
      
      <div className="status-section">
        <span className="status-label">Position:</span>
        <span className="status-value">
          X: {Math.round(mousePosition?.x || 0)}, Y: {Math.round(mousePosition?.y || 0)}
        </span>
      </div>
      
      <div className="status-section">
        <span className="status-label">Zoom:</span>
        <span className="status-value">{Math.round(zoomLevel * 100)}%</span>
      </div>
      
      <div className="status-section status-messages">
        {displayMessages.length > 0 ? (
          <span className="status-message">{displayMessages[0]}</span>
        ) : (
          <span className="status-message">Ready</span>
        )}
      </div>
      
      <div className="status-section status-shortcuts">
        <span className="status-label">Shortcuts:</span>
        <span className="status-value">Ctrl+S Save | Ctrl+Z Undo | Del Delete</span>
      </div>
    </div>
  );
}
