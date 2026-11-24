const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/nav-core.js');
const id=n=>'20261123000000-'+String(n).padStart(7,'0');
const book={id:id(900),name:'测试笔记本'};
const doc=(n,title,parent)=>({id:id(n),box:book.id,path:parent?`/${id(parent)}/${id(n)}.sy`:`/${id(n)}.sy`,content:title});
const response=data=>({ok:true,json:async()=>({code:0,data})});

test('真实 ID 推导父级，重名文档不混淆，自然排序',()=>{
  const model=C.buildModel([doc(1,'父文档'),doc(2,'章节 10',1),doc(3,'章节 2',1),doc(4,'章节 2')],[book]);
  assert.equal(model.docs.get(id(2)).parent,id(1));
  assert.deepEqual(model.children.get(id(1)).map(d=>d.id),[id(3),id(2)]);
  assert.deepEqual(C.ancestors(model,id(2)).map(d=>d.id),[id(1),id(2)]);
});
test('改名与移动反映在模型中；旧父级不残留',()=>{
  const moved=doc(2,'新名称',3);
  const model=C.buildModel([doc(1,'原父级'),doc(3,'新父级'),moved],[book]);
  assert.equal(C.descendants(model,id(1)).size,0);
  assert.equal(C.descendants(model,id(3)).size,1);
  assert.match(C.treeHTML(model,id(3),3),/新名称/);
});
test('HTML 转义、深度限制与子级搜索',()=>{
  const x=doc(1,'<img src=x onerror=alert(1)>');
  const y=doc(2,'深层目标',1);const z=doc(3,'更深一层',2);z.path=`/${id(1)}/${id(2)}/${id(3)}.sy`;
  const model=C.buildModel([x,y,z],[book]);
  assert.doesNotMatch(C.treeHTML(model,book.id,3),/<img/);
  assert.match(C.treeHTML(model,book.id,3),/&lt;img/);
  assert.doesNotMatch(C.treeHTML(model,book.id,1),/深层目标/);
  assert.match(C.treeHTML(model,book.id,3,'深层目标'),/深层目标/);
  assert.equal(C.treeHTML(model,book.id,3,'无匹配'), '');
});
test('异常环路不会无限递归',()=>{
  const a=doc(1,'a',2),b=doc(2,'b',1);
  const model=C.buildModel([a,b],[book]);
  assert.equal(C.ancestors(model,id(1)).length,2);
  assert.ok(C.treeHTML(model,id(1),6).length<2000);
});
test('历史导航标题排除，正文标题安全转义',()=>{
  const html=C.outlineHTML([{id:id(1),content:'文档导航（2026-11-23）',subtype:'h2'},{id:id(2),content:'<正文>',subtype:'h3'}]);
  assert.doesNotMatch(html,/文档导航/);assert.match(html,/&lt;正文&gt;/);
});
test('126 篇完整分页，多面板共享一次请求，排除关闭或锁定笔记本',async()=>{
  const rows=Array.from({length:126},(_,i)=>doc(i+1,'文档 '+i));
  let notebookCalls=0,sqlCalls=0;
  const transport=async(url,options)=>{
    if(url.endsWith('lsNotebooks')){notebookCalls++;return response({notebooks:[book,{id:id(901),closed:true},{id:id(902),encrypted:true,unlocked:false}]});}
    const {stmt}=JSON.parse(options.body);sqlCalls++;
    assert.doesNotMatch(stmt,new RegExp(id(901)+'|'+id(902)));
    const cursor=stmt.match(/AND id>'([^']*)'/)[1];
    return response(rows.filter(r=>r.id>cursor).slice(0,50));
  };
  const store=C.createStore(transport);
  const [a,b]=await Promise.all([store.model(),store.model()]);
  assert.strictEqual(a,b);assert.equal(a.docs.size,126);assert.equal(notebookCalls,1);assert.equal(sqlCalls,3);
});
test('API 错误不伪装成空目录，恢复后可以重试',async()=>{
  let fail=true;
  const store=C.createStore(async url=>{
    if(fail)return {ok:true,json:async()=>({code:-1,msg:'认证失败'})};
    return response(url.endsWith('lsNotebooks')?{notebooks:[book]}:[doc(1,'恢复')]);
  });
  await assert.rejects(store.model(),/认证失败/);fail=false;
  assert.equal((await store.model()).docs.size,1);
});
test('正文大纲保持物理顺序与嵌套，超过50项不截断',async()=>{
  const rows=Array.from({length:72},(_,i)=>({id:id(i+1),name:'标题'+i,subType:'h2'}));let calls=0;
  const store=C.createStore(async(url)=>{assert.equal(url,'/api/outline/getDocOutline');calls++;return response(rows);});
  assert.equal((await store.headings(id(100))).length,72);assert.equal(calls,1);
  await store.headings(id(100));assert.equal(calls,1);
  assert.deepEqual(C.outlineRows([{id:id(2),name:'<strong>A</strong> &amp; B',nameIsHTML:true,subType:'h2',blocks:[{id:id(1),name:'&lt;img&gt;',nameIsHTML:true,subType:'h3'}]}]).map(r=>r.content),['A & B','<img>']);
});
test('请求途中失效不会让缓存永久使用旧结构',async()=>{
  let release;const barrier=new Promise(resolve=>release=resolve);let calls=0;
  const store=C.createStore(async url=>{
    if(url.endsWith('lsNotebooks')){calls++;if(calls===1)await barrier;return response({notebooks:[book]});}
    return response([doc(1,'父文档')]);
  });
  const first=store.model();store.invalidate();release();await first;await store.model();assert.equal(calls,2);
});
