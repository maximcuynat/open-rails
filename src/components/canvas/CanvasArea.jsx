import { useRef, useEffect, useState } from 'react';

const DOT_RADIUS = 2;
const GRID_SIZE = 20;

export default function CanvasArea({ scale, panOffset, setPanOffset, showGrid, snapToGrid }) {
  const canvasRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (showGrid) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        const startX = panOffset.x % (GRID_SIZE * scale);
        const startY = panOffset.y % (GRID_SIZE * scale);

        for (let x = startX; x < canvas.width; x += GRID_SIZE * scale) {
          for (let y = startY; y < canvas.height; y += GRID_SIZE * scale) {
            ctx.beginPath();
            ctx.arc(x, y, DOT_RADIUS * scale, 0, Math.PI * 2);
            ctx.fill();
          }
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
      // This will be handled by parent component
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
  }, [scale, panOffset, showGrid, isDragging, lastPos]);

  return (
    <canvas
      ref={canvasRef}
      className="canvas-main"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    />
  );
}
