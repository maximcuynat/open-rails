import { useRef, useEffect, useState } from 'react';
import './App.css';

const DOT_RADIUS = 2;

function App() {
  const canvasRef = useRef(null);
  const [gridSize, setGridSize] = useState(35);
  const [scale, setScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  const gridSizes = [10, 15, 20, 25, 30, 35, 40, 45, 50];

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';

      const startX = panOffset.x % (gridSize * scale);
      const startY = panOffset.y % (gridSize * scale);

      for (let x = startX; x < canvas.width; x += gridSize * scale) {
        for (let y = startY; y < canvas.height; y += gridSize * scale) {
          ctx.beginPath();
          ctx.arc(x, y, DOT_RADIUS * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawGrid();
    };

    const handleMouseDown = (e) => {
      setIsDragging(true);
      setLastPos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e) => {
      if (isDragging) {
        const dx = e.clientX - lastPos.x;
        const dy = e.clientY - lastPos.y;
        setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        setLastPos({ x: e.clientX, y: e.clientY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.5, Math.min(3, scale * delta));
      setScale(newScale);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [gridSize, scale, panOffset, isDragging, lastPos]);

  const zoomIn = () => setScale(prev => Math.min(3, prev * 1.2));
  const zoomOut = () => setScale(prev => Math.max(0.5, prev / 1.2));
  const moveUp = () => setPanOffset(prev => ({ x: prev.x, y: prev.y + 20 }));
  const moveDown = () => setPanOffset(prev => ({ x: prev.x, y: prev.y - 20 }));
  const moveLeft = () => setPanOffset(prev => ({ x: prev.x + 20, y: prev.y }));
  const moveRight = () => setPanOffset(prev => ({ x: prev.x - 20, y: prev.y }));

  return (
    <div className="app-container">
      <canvas
        ref={canvasRef}
        className="canvas-main"
      />
      
      <div className="control-panel">
        <select
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          className="grid-select"
        >
          {gridSizes.map(size => (
            <option key={size} value={size}>{size}px</option>
          ))}
        </select>
        
        <div className="nav-buttons">
          <button onClick={zoomIn} className="nav-btn" title="Zoom In">+</button>
          <button onClick={zoomOut} className="nav-btn" title="Zoom Out">-</button>
        </div>
        
        <div className="nav-arrows">
          <button onClick={moveUp} className="nav-btn arrow" title="Up">&uarr;</button>
          <div className="arrow-row">
            <button onClick={moveLeft} className="nav-btn arrow" title="Left">&larr;</button>
            <button onClick={moveRight} className="nav-btn arrow" title="Right">&rarr;</button>
          </div>
          <button onClick={moveDown} className="nav-btn arrow" title="Down">&darr;</button>
        </div>
      </div>
      
      <div className={`drag-overlay ${isDragging ? 'dragging' : ''}`}></div>
    </div>
  );
}

export default App;
