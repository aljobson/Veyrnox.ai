export const SHAPES = Object.freeze(['circle', 'rectangle', 'triangle', 'star', 'arrow', 'heart', 'speech-bubble', 'checkmark', 'diamond', 'hexagon', 'line', 'ring', 'cross', 'lightning', 'burst', 'bracket', 'underline', 'play', 'location', 'sparkle']);
export function graphicCanvas(graphic) {
    if(!SHAPES.includes(graphic.shape))throw new Error('Choose an original element.');
    const canvas = new OffscreenCanvas(512, 512), g = canvas.getContext('2d');
    g.fillStyle = graphic.color; g.strokeStyle=graphic.color;g.lineWidth=40;g.lineCap='round';g.lineJoin='round'; g.beginPath();
    if (graphic.shape === 'circle') g.arc(256, 256, 220, 0, Math.PI * 2);
    else if (graphic.shape === 'rectangle') g.roundRect(32, 96, 448, 320, 24);
    else if (graphic.shape === 'triangle') { g.moveTo(256, 32); g.lineTo(480, 480); g.lineTo(32, 480); }
    else if (graphic.shape === 'arrow') { for (const [i, point] of [[32, 192], [304, 192], [304, 64], [480, 256], [304, 448], [304, 320], [32, 320]].entries()) i ? g.lineTo(...point) : g.moveTo(...point); }
    else if(graphic.shape==='heart'){g.moveTo(256,448);g.bezierCurveTo(200,400,32,270,32,156);g.bezierCurveTo(32,36,192,12,256,132);g.bezierCurveTo(320,12,480,36,480,156);g.bezierCurveTo(480,270,312,400,256,448);}
    else if(graphic.shape==='speech-bubble'){g.roundRect(32,56,448,336,48);g.moveTo(112,376);g.lineTo(88,476);g.lineTo(224,376);}
    else if(graphic.shape==='checkmark'){for(const [i,p] of [[40,248],[112,176],[216,280],[400,96],[472,168],[216,424]].entries())i?g.lineTo(...p):g.moveTo(...p);}
    else if(['diamond','hexagon'].includes(graphic.shape)){const n=graphic.shape==='diamond'?4:6;for(let i=0;i<n;i++){const a=i*Math.PI*2/n-Math.PI/2,p=[256+Math.cos(a)*220,256+Math.sin(a)*220];i?g.lineTo(...p):g.moveTo(...p);}}
    else if(graphic.shape==='line'||graphic.shape==='underline'){g.roundRect(graphic.shape==='line'?48:80,graphic.shape==='line'?236:360,graphic.shape==='line'?416:352,graphic.shape==='line'?40:24,20);}
    else if(graphic.shape==='ring'){g.arc(256,256,190,0,Math.PI*2);g.stroke();return canvas;}
    else if(graphic.shape==='cross'){g.moveTo(216,48);g.lineTo(296,48);g.lineTo(296,216);g.lineTo(464,216);g.lineTo(464,296);g.lineTo(296,296);g.lineTo(296,464);g.lineTo(216,464);g.lineTo(216,296);g.lineTo(48,296);g.lineTo(48,216);g.lineTo(216,216);}
    else if(graphic.shape==='lightning'){for(const [i,p] of [[292,24],[100,292],[228,292],[184,488],[412,212],[276,212]].entries())i?g.lineTo(...p):g.moveTo(...p);}
    else if(graphic.shape==='burst'||graphic.shape==='sparkle'){const points=graphic.shape==='burst'?24:8;for(let i=0;i<points;i++){const a=i*Math.PI*2/points-Math.PI/2,r=i%2?(graphic.shape==='burst'?125:65):220,p=[256+Math.cos(a)*r,256+Math.sin(a)*r];i?g.lineTo(...p):g.moveTo(...p);}}
    else if(graphic.shape==='bracket'){g.moveTo(192,48);g.lineTo(96,48);g.lineTo(96,464);g.lineTo(192,464);g.moveTo(320,48);g.lineTo(416,48);g.lineTo(416,464);g.lineTo(320,464);g.stroke();return canvas;}
    else if(graphic.shape==='play'){g.moveTo(128,64);g.lineTo(448,256);g.lineTo(128,448);}
    else if(graphic.shape==='location'){g.moveTo(256,480);g.bezierCurveTo(220,416,96,304,96,192);g.bezierCurveTo(96,80,168,32,256,32);g.bezierCurveTo(344,32,416,80,416,192);g.bezierCurveTo(416,304,292,416,256,480);g.moveTo(256,248);g.arc(256,184,64,Math.PI/2,Math.PI*2+Math.PI/2);}
    else for (let i = 0; i < 10; i++) { const angle = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? 100 : 220; const x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill(); return canvas;
}
