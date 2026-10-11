export const SHAPES = Object.freeze(['circle', 'rectangle', 'triangle', 'star', 'arrow', 'heart', 'speech-bubble', 'checkmark', 'diamond', 'hexagon']);
export function graphicCanvas(graphic) {
    if(!SHAPES.includes(graphic.shape))throw new Error('Choose an original element.');
    const canvas = new OffscreenCanvas(512, 512), g = canvas.getContext('2d');
    g.fillStyle = graphic.color; g.beginPath();
    if (graphic.shape === 'circle') g.arc(256, 256, 220, 0, Math.PI * 2);
    else if (graphic.shape === 'rectangle') g.roundRect(32, 96, 448, 320, 24);
    else if (graphic.shape === 'triangle') { g.moveTo(256, 32); g.lineTo(480, 480); g.lineTo(32, 480); }
    else if (graphic.shape === 'arrow') { for (const [i, point] of [[32, 192], [304, 192], [304, 64], [480, 256], [304, 448], [304, 320], [32, 320]].entries()) i ? g.lineTo(...point) : g.moveTo(...point); }
    else if(graphic.shape==='heart'){g.moveTo(256,448);g.bezierCurveTo(200,400,32,270,32,156);g.bezierCurveTo(32,36,192,12,256,132);g.bezierCurveTo(320,12,480,36,480,156);g.bezierCurveTo(480,270,312,400,256,448);}
    else if(graphic.shape==='speech-bubble'){g.roundRect(32,56,448,336,48);g.moveTo(112,376);g.lineTo(88,476);g.lineTo(224,376);}
    else if(graphic.shape==='checkmark'){for(const [i,p] of [[40,248],[112,176],[216,280],[400,96],[472,168],[216,424]].entries())i?g.lineTo(...p):g.moveTo(...p);}
    else if(['diamond','hexagon'].includes(graphic.shape)){const n=graphic.shape==='diamond'?4:6;for(let i=0;i<n;i++){const a=i*Math.PI*2/n-Math.PI/2,p=[256+Math.cos(a)*220,256+Math.sin(a)*220];i?g.lineTo(...p):g.moveTo(...p);}}
    else for (let i = 0; i < 10; i++) { const angle = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? 100 : 220; const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill(); return canvas;
}
