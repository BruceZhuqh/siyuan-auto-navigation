const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const id=n=>'20261123000000-'+String(n).padStart(7,'0');
let docs=[{id:id(1),box:id(900),path:`/${id(1)}.sy`,content:'父文档'},{id:id(2),box:id(900),path:`/${id(1)}/${id(2)}.sy`,content:'已有子文档'},{id:id(3),box:id(900),path:`/${id(3)}.sy`,content:'另一个父文档'}];
let headings=[{id:id(101),content:'正文概述',subtype:'h2',sort:1}];
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/')) {
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      const input=JSON.parse(body||'{}');let data;
      if(req.url.endsWith('lsNotebooks'))data={notebooks:[{id:id(900),name:'测试笔记本'}]};
      else if(req.url.endsWith('getDocOutline'))data=headings.map(h=>({id:h.id,name:h.content,subType:h.subtype}));
      else if(input.stmt.includes("type='h'")){const offset=Number(input.stmt.match(/OFFSET (\d+)/)[1]);data=headings.slice(offset,offset+50);}
      else if(input.stmt.includes('SELECT root_id'))data=[{root_id:id(1)}];
      else {const cursor=input.stmt.match(/AND id>'([^']*)'/)[1];data=docs.filter(d=>d.id>cursor).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,50);}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:0,data}));
    });return;
  }
  if(req.url==='/'||req.url==='/harness.html') {
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/nav.css"><style>body{font-family:system-ui;background:#fff;padding:20px;max-width:1100px;margin:auto}.protyle-title{font-size:30px;font-weight:bold}.protyle-wysiwyg{padding:20px;border:1px dashed #ddd;min-height:100px}iframe{width:100%;border:0;height:500px}</style><div id="editor"><div class="protyle-title">父文档</div><div class="protyle-wysiwyg" contenteditable="true"><h2 data-node-id="${id(101)}">正文概述</h2><p>这段原正文不应被插件改写。</p></div></div><script>window.siyuan={};window.testEvents=new Map();window.testEditor={protyle:{element:document.getElementById('editor'),block:{rootID:'${id(1)}'}}};window.require=()=>({Plugin:class{constructor(){this.app={};this.eventBus={on:(n,f)=>{if(!testEvents.has(n))testEvents.set(n,new Set());testEvents.get(n).add(f)},off:(n,f)=>testEvents.get(n)?.delete(f)}}addTopBar(){}},getAllEditor:()=>[testEditor],openTab:o=>{window.lastOpened=o.doc.id},showMessage:()=>{}});window.module={exports:{}};window.emit=(n,detail={})=>{for(const f of testEvents.get(n)||[])f({detail})};</script><script src="/dist/index.js"></script><script>window.plugin=new module.exports();plugin.onload();plugin.onLayoutReady();</script>`);return;
  }
  const relative=decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'');
  const file=path.resolve(ROOT,relative);
  if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html;charset=utf-8':'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.AUTO_NAV_CHROME ? {channel:'chrome'} : {})});
  try {
    const page=await browser.newPage({viewport:{width:1200,height:900}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    // Reproduce the nested rich-title editor found in the real 3.8.11 frontend.
    await page.route('**/dist/index.js',route=>route.fulfill({contentType:'application/javascript',body:`document.querySelector('.protyle-title').innerHTML='<div class="protyle-title__rich"><div class="protyle-wysiwyg">父文档</div></div>';\n`+fs.readFileSync(path.join(ROOT,'dist/index.js'),'utf8')}));
    await page.goto(url);
    const before=await page.locator('.protyle-wysiwyg[contenteditable=true]').innerHTML();
    await page.locator('.an-tree-content').getByText('已有子文档',{exact:true}).waitFor();
    // New child creation followed by a kernel event.
    docs.push({id:id(4),box:id(900),path:`/${id(1)}/${id(4)}.sy`,content:'自动出现的新子文档'});
    await page.evaluate(()=>emit('ws-main',{cmd:'createDoc'}));
    await page.locator('.an-tree-content').getByText('自动出现的新子文档',{exact:true}).waitFor();
    // Rename, then move away. No persistent body writes.
    docs.find(d=>d.id===id(4)).content='改名后的文档';await page.evaluate(()=>emit('ws-main',{cmd:'renameDoc'}));
    await page.locator('.an-tree-content').getByText('改名后的文档',{exact:true}).waitFor();
    docs.find(d=>d.id===id(4)).path=`/${id(3)}/${id(4)}.sy`;await page.evaluate(()=>emit('ws-main',{cmd:'moveDoc'}));
    await page.waitForFunction(()=>!document.querySelector('.an-tree-content').textContent.includes('改名后的文档'));
    // Heading edits and link activation.
    headings.push({id:id(102),content:'新标题目录项',subtype:'h3',sort:2});await page.evaluate(()=>emit('ws-main',{cmd:'transactions'}));
    await page.getByText('新标题目录项',{exact:true}).waitFor();await page.getByText('新标题目录项',{exact:true}).click();
    assert.equal(await page.evaluate(()=>lastOpened),id(102));
    await page.selectOption('.an-scope','workspace');
    await page.locator('.an-tree-content').getByText('改名后的文档',{exact:true}).waitFor();
    docs=docs.filter(d=>d.id!==id(4));await page.evaluate(()=>emit('ws-main',{cmd:'removeDoc'}));
    await page.waitForFunction(()=>!document.querySelector('.an-tree-content').textContent.includes('改名后的文档'));
    // A future new parent document gets a panel on open, without insertion.
    docs.push({id:id(5),box:id(900),path:`/${id(5)}.sy`,content:'新建父文档'});
    await page.evaluate(newRoot=>{testEditor.protyle.block.rootID=newRoot;emit('ws-main',{cmd:'createDoc'});emit('switch-protyle');},id(5));
    await page.locator('.an-crumbs').getByText('新建父文档',{exact:true}).waitFor();
    assert.equal(await page.locator('.siyuan-auto-nav').count(),1);
    assert.equal(await page.locator('.protyle-title .siyuan-auto-nav').count(),0);
    assert.equal(await page.locator('.protyle-wysiwyg[contenteditable=true]').innerHTML(),before);
    await page.evaluate(()=>plugin.onunload());assert.equal(await page.locator('.siyuan-auto-nav').count(),0);
    assert.equal(await page.locator('.protyle-wysiwyg[contenteditable=true]').innerHTML(),before);
    await page.screenshot({path:path.join(ROOT,'test-preview.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: auto-mount, creation, rename, move, deletion, outline edits, navigation, scopes, rich-title isolation, unload and body preservation.');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
