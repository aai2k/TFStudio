import { readFileSync, writeFileSync } from 'fs';
const PASS=[[437,467],[512,543],[593,648],[700,763]], STOP=[[400,430],[473,507],[550,587],[655,693],[770,812]];
const read = tag => readFileSync(`tests/out/merit_${tag}.csv`,'utf8').trim().split('\n').slice(1).map(r=>r.split(',').map(Number));
const W=900,H=380,mL=50,mR=15,mT=20,mB=40, x0=400,x1=815;
const X=l=>mL+(l-x0)/(x1-x0)*(W-mL-mR), Y=t=>mT+(1-t)*(H-mT-mB);
const path=(d,col)=>`<path fill="none" stroke="${col}" stroke-width="1.6" d="${d.map((p,i)=>(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ')}"/>`;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="white"/>`;
for(const[a,b]of PASS) svg+=`<rect x="${X(a)}" y="${Y(1)}" width="${X(b)-X(a)}" height="6" fill="#2e7d32"/>`;
for(const[a,b]of STOP) svg+=`<rect x="${X(a)}" y="${Y(0)-6}" width="${X(b)-X(a)}" height="6" fill="#c62828"/>`;
for(let t=0;t<=1.0001;t+=0.25){svg+=`<line x1="${mL}" y1="${Y(t)}" x2="${W-mR}" y2="${Y(t)}" stroke="#eee"/><text x="${mL-6}" y="${Y(t)+4}" text-anchor="end">${(t*100)|0}</text>`;}
for(let l=400;l<=800;l+=100){svg+=`<line x1="${X(l)}" y1="${mT}" x2="${X(l)}" y2="${H-mB}" stroke="#eee"/><text x="${X(l)}" y="${H-mB+16}" text-anchor="middle">${l}</text>`;}
svg+=path(read('D'),'#1565c0')+path(read('L2_w10'),'#ef6c00');
svg+=`<text x="${mL+10}" y="${mT+14}" fill="#1565c0">D — your stall (worst pass 51%)</text>`;
svg+=`<text x="${mL+10}" y="${mT+30}" fill="#ef6c00">passband ×10 (worst pass 78%)</text>`;
svg+=`<text x="${W/2}" y="${H-4}" text-anchor="middle">Wavelength (nm)  —  T(%)</text></svg>`;
writeFileSync('tests/out/merit_plot.svg',svg);
console.log('wrote tests/out/merit_plot.svg');
