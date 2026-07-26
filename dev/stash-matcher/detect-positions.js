// Auto-detect number cluster positions + values in a tab screenshot.
const { app, nativeImage } = require('electron');
const path = require('path');
const REPO = 'C:/Users/dbatc/Documents/Overlay App';
const DR = require(REPO + '/renderer/stash/digit-reader');
const TEMPLATES = require(REPO + '/renderer/stash/digit-templates.json');
const IMG = process.env.IMG || (REPO + '/screenshots/abyss tab.png');

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(IMG);
  const { width: W, height: H } = img.getSize();
  const b = img.toBitmap();
  const R=(i)=>b[i*4+2],G=(i)=>b[i*4+1],B=(i)=>b[i*4+0];
  const V = DR.valueChannelDesatMax(b, W, H);
  const T = DR.templatesFromJSON(TEMPLATES);
  // whiteness + dark-outline text mask over the left panel region
  const X0=20,X1=600,Y0=195,Y1=760;
  const dark=(x,y)=>{const i=y*W+x;return Math.max(R(i),G(i),B(i))<=80;};
  const mask=new Uint8Array(W*H);
  for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){const i=y*W+x,r=R(i),g=G(i),bb=B(i),mn=Math.min(r,g,bb);
    if(mn<150||(Math.max(r,g,bb)-mn)>60)continue;
    let near=false;for(let dy=-2;dy<=2&&!near;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(dark(xx,yy)){near=true;break;}}
    if(near)mask[i]=1;}
  // horizontal-dilate to join a number's digits, then connected components
  const dil=new Uint8Array(W*H);
  for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){if(!mask[y*W+x])continue;for(let dx=-5;dx<=5;dx++){const xx=x+dx;if(xx>=X0&&xx<X1)dil[y*W+xx]=1;}}
  const lbl=new Int32Array(W*H);const st=[];let n=0;const boxes=[];
  for(let y=Y0;y<Y1;y++)for(let x=X0;x<X1;x++){const i0=y*W+x;if(!dil[i0]||lbl[i0])continue;n++;lbl[i0]=n;st.length=0;st.push(i0);
    let x0=x,x1=x,y0=y,y1=y,cnt=0;
    while(st.length){const p=st.pop();const px=p%W,py=(p-px)/W;cnt++;if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;
      const nb=[p-1,p+1,p-W,p+W];for(const q of nb){if(q>=0&&q<W*H&&dil[q]&&!lbl[q]){lbl[q]=n;st.push(q);}}}
    const w=x1-x0+1,h=y1-y0+1;if(h>=7&&h<=16&&w>=4&&w<=48&&cnt>=10)boxes.push({x0,x1,y0,y1,cx:Math.round((x0+x1)/2),cy:Math.round((y0+y1)/2)});}
  boxes.sort((a,b)=>(Math.round(a.cy/20)-Math.round(b.cy/20))||(a.cx-b.cx));
  console.log(`detected ${boxes.length} number clusters:`);
  for(const bx of boxes){const val=DR.readCell(V,W,H,bx.cx,bx.cy,T,DR.DEFAULTS);console.log(`  cx:${String(bx.cx).padStart(3)}, cy:${String(bx.cy).padStart(3)}  = ${val}`);}
  app.exit(0);
});
