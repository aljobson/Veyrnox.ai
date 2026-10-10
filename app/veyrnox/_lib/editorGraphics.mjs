export const SHAPES = Object.freeze(['circle', 'rectangle', 'triangle', 'star', 'arrow']);
export function graphicCanvas(graphic) {
    const canvas = new OffscreenCanvas(512, 512), g = canvas.getContext('2d');
    g.fillStyle = graphic.color; g.beginPath();
    if (graphic.shape === 'circle') g.arc(256, 256, 220, 0, Math.PI * 2);
    else if (graphic.shape === 'rectangle') g.roundRect(32, 96, 448, 320, 24);
    else if (graphic.shape === 'triangle') { g.moveTo(256, 32); g.lineTo(480, 480); g.lineTo(32, 480); }
    else if (graphic.shape === 'arrow') { for (const [i, point] of [[32, 192], [304, 192], [304, 64], [480, 256], [304, 448], [304, 320], [32, 320]].entries()) i ? g.lineTo(...point) : g.moveTo(...point); }
    else for (let i = 0; i < 10; i++) { const angle = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? 100 : 220; const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill(); return canvas;
}
