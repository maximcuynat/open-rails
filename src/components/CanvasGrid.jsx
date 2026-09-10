import { useRef, useEffect } from 'react';

const DOT_RADIUS = 2;

export default function CanvasGrid({ gridSize, scale, onWheel }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';

      for (let x = 0; x < canvas.width; x += gridSize * scale) {
        for (let y = 0; y < canvas.height; y += gridSize * scale) {
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

    const handleWheelInternal = (e) => {
      e.preventDefault();
      if (onWheel) onWheel(e);
      drawGrid();
    };

    window.addEventListener('resize', handleResize);
    canvas.addEventListener('wheel', handleWheelInternal, { passive: false });
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('wheel', handleWheelInternal);
    };
  }, [gridSize, scale, onWheel]);

  return <canvas ref={canvasRef} className="canvas-main" />;
}
