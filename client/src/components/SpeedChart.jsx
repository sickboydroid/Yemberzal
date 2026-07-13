import { useEffect, useRef } from 'react';
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler,
} from 'chart.js';
import { speedColor, fmtTime } from '../lib/geo';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

/** Draws the horizontal threshold line + label directly on the canvas. */
const thresholdPlugin = {
  id: 'yzThreshold',
  afterDraw(chart, _args, opts) {
    const limit = opts.limit;
    if (limit == null) return;
    const { ctx, chartArea, scales } = chart;
    if (!scales.y || limit < scales.y.min || limit > scales.y.max) return;
    const y = scales.y.getPixelForValue(limit);
    ctx.save();
    ctx.strokeStyle = '#ba2525';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ba2525';
    ctx.font = '600 11px system-ui';
    ctx.fillText(`${limit} km/h limit`, chartArea.left + 6, y - 5);
    ctx.restore();
  },
};
Chart.register(thresholdPlugin);

/**
 * Speed-over-time chart. Line segments are colored by speed:
 * green (slow) / blue (mid) / red (>= threshold). Threshold is a dashed line.
 * points: [{ts, speed}]
 */
export default function SpeedChart({ points, limit, height = 220 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: { labels: [], datasets: [{
        data: [],
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.3,
        fill: { target: 'origin' },
        backgroundColor: 'rgba(36,69,156,0.07)',
        segment: {
          borderColor: (ctx) => speedColor(Math.max(ctx.p0.parsed.y, ctx.p1.parsed.y), limitRef.current),
        },
      }] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.parsed.y} km/h` } },
          yzThreshold: { limit },
        },
        scales: {
          y: { beginAtZero: true, suggestedMax: 60, title: { display: true, text: 'km/h' }, grid: { color: '#e8ecf3' } },
          x: { ticks: { maxTicksLimit: 8, autoSkip: true }, grid: { display: false } },
        },
      },
    });
    chartRef.current = chart;
    return () => chart.destroy();
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.labels = points.map((p) => fmtTime(p.ts));
    chart.data.datasets[0].data = points.map((p) => p.speed);
    chart.options.plugins.yzThreshold.limit = limit;
    chart.update('none');
  }, [points, limit]);

  return (
    <div style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
