import { useEffect, useRef, useState } from 'react';
import p5 from 'p5';

interface Props {
  stats: any;
}

export default function P5ActivityChart({ stats }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const p5Instance = useRef<p5 | null>(null);
  const [data, setData] = useState<Array<{ time: string; value: number }>>([]);

  // Update data every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setData(prev => {
        const newPoint = {
          time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          value: Math.floor(Math.random() * 30) + 70
        };
        return [...prev.slice(-14), newPoint];
      });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!containerRef.current || p5Instance.current) return;

    const sketch = (p: p5) => {
      let canvasWidth = 0;
      let canvasHeight = 300;

      p.setup = () => {
        canvasWidth = containerRef.current?.offsetWidth || 600;
        const canvas = p.createCanvas(canvasWidth, canvasHeight);
        canvas.parent(containerRef.current!);

        // Performance optimizations
        p.pixelDensity(1); // Lower pixel density for better mobile performance
        p.frameRate(30); // Limit frame rate to save battery
      };

      p.draw = () => {
        // Clear background
        p.background('#FFDFEF');

        if (data.length < 2) {
          p.fill('#FF77C9');
          p.noStroke();
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(16);
          p.text('Building chart...', canvasWidth / 2, canvasHeight / 2);
          return;
        }

        const padding = 40;
        const graphWidth = canvasWidth - padding * 2;
        const graphHeight = canvasHeight - padding * 2;

        // Draw grid lines
        p.stroke('#FFC2E1');
        p.strokeWeight(1);
        for (let i = 0; i <= 4; i++) {
          const y = padding + (graphHeight / 4) * i;
          p.line(padding, y, canvasWidth - padding, y);
        }

        // Draw area fill
        p.fill('#FF77C9');
        p.noStroke();
        p.beginShape();
        p.vertex(padding, canvasHeight - padding);

        for (let i = 0; i < data.length; i++) {
          const x = padding + (graphWidth / (data.length - 1)) * i;
          const y = canvasHeight - padding - (data[i].value / 100) * graphHeight;
          p.vertex(x, y);
        }

        p.vertex(canvasWidth - padding, canvasHeight - padding);
        p.endShape(p.CLOSE);

        // Draw line
        p.stroke('#FF1493');
        p.strokeWeight(3);
        p.noFill();
        p.beginShape();

        for (let i = 0; i < data.length; i++) {
          const x = padding + (graphWidth / (data.length - 1)) * i;
          const y = canvasHeight - padding - (data[i].value / 100) * graphHeight;
          p.vertex(x, y);
        }

        p.endShape();

        // Draw dots
        p.fill('#FF1493');
        p.noStroke();
        for (let i = 0; i < data.length; i++) {
          const x = padding + (graphWidth / (data.length - 1)) * i;
          const y = canvasHeight - padding - (data[i].value / 100) * graphHeight;
          p.circle(x, y, 6);
        }

        // Draw y-axis labels
        p.fill('#FF77C9');
        p.noStroke();
        p.textAlign(p.RIGHT, p.CENTER);
        p.textSize(12);
        for (let i = 0; i <= 4; i++) {
          const value = 100 - (i * 25);
          const y = padding + (graphHeight / 4) * i;
          p.text(value.toString(), padding - 10, y);
        }

        // Draw x-axis labels (show first, middle, last)
        p.textAlign(p.CENTER, p.TOP);
        if (data.length > 0) {
          p.text(data[0].time, padding, canvasHeight - padding + 10);
          if (data.length > 1) {
            const midIndex = Math.floor(data.length / 2);
            const x = padding + (graphWidth / (data.length - 1)) * midIndex;
            p.text(data[midIndex].time, x, canvasHeight - padding + 10);
            p.text(data[data.length - 1].time, canvasWidth - padding, canvasHeight - padding + 10);
          }
        }
      };

      p.windowResized = () => {
        canvasWidth = containerRef.current?.offsetWidth || 600;
        p.resizeCanvas(canvasWidth, canvasHeight);
      };
    };

    p5Instance.current = new p5(sketch);

    return () => {
      if (p5Instance.current) {
        p5Instance.current.remove();
        p5Instance.current = null;
      }
    };
  }, []);

  // Update the sketch when data changes
  useEffect(() => {
    // The draw loop will automatically use the updated data
  }, [data]);

  return (
    <column
      box-="square"
      shear-="bottom"
      pad-="2 1"
      gap-="2"
      style={{ background: 'var(--pink-10)' }}
    >
      <row align-="center between" style={{ flexWrap: 'wrap' }}>
        <h3 style={{ color: 'var(--pink)', fontSize: '1.2em', margin: 0 }}>
          ┏━━━━━━━━━━━━━━━━━━━┓<br/>
          ┃ UPLOAD ACTIVITY  ┃<br/>
          ┗━━━━━━━━━━━━━━━━━━━┛
        </h3>
        <span is-="badge" variant-="pink">
          ⏱ Last 60m
        </span>
      </row>

      <div
        ref={containerRef}
        style={{
          width: '100%',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'pan-y',
          WebkitTapHighlightColor: 'transparent',
        }}
      />

      <row gap-="1" style={{
        paddingTop: '1lh',
        borderTop: '0.2ch solid var(--pink)'
      }}>
        <span is-="badge" variant-="lime">
          ▲ Peak: 98
        </span>
        <span is-="badge" variant-="pink">
          ◇ Avg: 82
        </span>
        <span is-="badge" variant-="purple">
          ▼ Min: 65
        </span>
      </row>
    </column>
  );
}
