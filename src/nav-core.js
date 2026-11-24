/* Original implementation, MIT license. No document writes or external requests. */
const AutoNavCore = (() => {
  'use strict';
  const ID = /^\d{14}-[a-z0-9]{7}$/;
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
  const parentOf = row => {
    const parts = String(row.path || '').split('/').filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : row.box;
  };
  function buildModel(rows, notebooks) {
    const docs = new Map(), children = new Map();
    const books = new Map(notebooks.map(n => [n.id, n]));
    for (const row of rows) {
      if (!ID.test(row.id) || !books.has(row.box)) continue;
      docs.set(row.id, {...row, content:String(row.content || '未命名文档'), parent:parentOf(row)});
    }
    for (const doc of docs.values()) {
      if (!children.has(doc.parent)) children.set(doc.parent, []);
      children.get(doc.parent).push(doc);
    }
    for (const list of children.values()) list.sort((a,b) => collator.compare(a.content,b.content) || a.id.localeCompare(b.id));
    return {docs, books, children};
  }
  function ancestors(model, id) {
    const result=[], seen=new Set();
    let doc=model.docs.get(id);
    while (doc && !seen.has(doc.id)) {
      seen.add(doc.id); result.unshift(doc); doc=model.docs.get(doc.parent);
    }
    return result;
  }
  function descendants(model, id) {
    const stack=[...(model.children.get(id)||[])], seen=new Set();
    while(stack.length) {
      const doc=stack.pop();
      if(seen.has(doc.id)) continue;
      seen.add(doc.id); stack.push(...(model.children.get(doc.id)||[]));
    }
    return seen;
  }
  function link(doc, label=doc.content) {
    return `<a href="siyuan://blocks/${doc.id}" data-nav-id="${doc.id}" title="${escapeHTML(label)}">${escapeHTML(label)}</a>`;
  }
  function treeHTML(model, root, depth, query='') {
    const needle=query.trim().toLocaleLowerCase();
    const matches=new Map();
    const match=(doc, seen=new Set()) => {
      if(matches.has(doc.id)) return matches.get(doc.id);
      if(seen.has(doc.id)) return false;
      const next=new Set(seen);next.add(doc.id);
      const yes=!needle || doc.content.toLocaleLowerCase().includes(needle) || (model.children.get(doc.id)||[]).some(d=>match(d,next));
      matches.set(doc.id,yes);return yes;
    };
    const render=(id,level,seen) => {
      if(level>depth) return '';
      const nodes=(model.children.get(id)||[]).filter(d=>!seen.has(d.id)&&match(d));
      if(!nodes.length) return '';
      return '<ul class="an-tree">'+nodes.map(doc=>{
        const next=new Set(seen);next.add(doc.id);
        const sub=render(doc.id,level+1,next);
        return sub ? `<li><details data-tree-id="${doc.id}"${level===1||needle?' open':''}><summary>${link(doc)}</summary>${sub}</details></li>` : `<li class="an-leaf">${link(doc)}</li>`;
      }).join('')+'</ul>';
    };
    return render(root,1,new Set([root]));
  }
  function outlineHTML(headings) {
    const visible=headings.filter(h=>ID.test(h.id) && !/^文档导航（\d{4}-\d{2}-\d{2}）$/.test(h.content));
    if(!visible.length) return '<p class="an-empty">正文尚无标题；添加标题后会自动列出。</p>';
    const minimum=Math.min(...visible.map(h=>Number((h.subtype||'h1').slice(1))||1));
    return '<ul class="an-outline">'+visible.map(h=>`<li style="--level:${Math.max(0,(Number((h.subtype||'h1').slice(1))||1)-minimum)}">${link(h)}</li>`).join('')+'</ul>';
  }
  function outlineRows(nodes) {
    const rows=[],seen=new Set();
    const text=html=>String(html||'').replace(/<[^>]*>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(entity,value)=>{
      if(value[0]==='#') {const n=value[1].toLowerCase()==='x'?parseInt(value.slice(2),16):Number(value.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):entity;}
      return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[value.toLowerCase()]||entity;
    });
    const walk=list=>{for(const node of list||[]){
      if(ID.test(node.id)&&!seen.has(node.id)){
        seen.add(node.id);rows.push({id:node.id,content:node.nameIsHTML?text(node.name):String(node.name||''),subtype:node.subType||'h1'});
      }
      walk(node.blocks||node.children);
    }};
    walk(nodes);return rows;
  }
  async function api(endpoint, body, transport=fetch) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await transport(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),signal:controller.signal});
      if(!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
      const result=await response.json();
      if(result.code!==0) throw new Error(result.msg || '思源 API 返回错误');
      return result.data;
    } finally {clearTimeout(timer);}
  }
  function createStore(transport=fetch) {
    let model=null, time=0, pending=null, generation=0;
    const headingCache=new Map();
    async function query(stmt) {
      const data=await api('/api/query/sql',{stmt},transport);
      if(!Array.isArray(data)) throw new Error('文档索引尚不可用');
      return data;
    }
    return {
      invalidate(structure=true) {if(structure){time=0;generation++;}headingCache.clear();},
      async model(force=false) {
        if(!force&&model&&Date.now()-time<4500) return model;
        if(pending) return pending;
        const version=generation;
        pending=(async()=>{
          const data=await api('/api/notebook/lsNotebooks',{},transport);
          const notebooks=(data?.notebooks||[]).filter(n=>!n.closed&&(!n.encrypted||n.unlocked));
          let rows=[],cursor='';
          if(notebooks.length) {
            const boxes=notebooks.map(n=>quote(n.id)).join(',');
            for(let page=0;page<2000;page++) {
              const batch=await query(`SELECT id,box,path,content FROM blocks WHERE type='d' AND box IN (${boxes}) AND id>${quote(cursor)} ORDER BY id LIMIT 50`);
              rows.push(...batch);
              if(batch.length<50) break;
              const next=batch.at(-1).id;
              if(next<=cursor) throw new Error('目录分页未推进，请刷新');
              cursor=next;
              if(page===1999) throw new Error('文档超过 100000 篇，请缩小导航范围');
            }
          }
          model=buildModel(rows,notebooks);time=version===generation?Date.now():0;return model;
        })();
        try{return await pending;}finally{pending=null;}
      },
      async headings(id,force=false) {
        if(!ID.test(id)) return [];
        const cached=headingCache.get(id);
        if(!force&&cached&&Date.now()-cached.time<4500) return cached.rows;
        // Index `sort` is not guaranteed to represent physical heading order.
        // The outline API returns the actual document order and hierarchy.
        const outline=await api('/api/outline/getDocOutline',{id},transport);
        if(outline!==null&&!Array.isArray(outline))throw new Error('标题目录格式不正确');
        const rows=outlineRows(outline||[]);
        headingCache.set(id,{rows,time:Date.now()});return rows;
      },
      query
    };
  }
  function mount(host, options) {
    const {store,openLink}=options;
    const settings=options.settings||{};
    const state={root:options.root,scope:settings.scope||'document',depth:Math.min(6,Math.max(1,Number(settings.depth)||3)),query:'',disposed:false,running:false,again:false,signature:'',expanded:null};
    host.classList.add('siyuan-auto-nav');host.contentEditable='false';
    host.innerHTML=`<div class="an-toolbar"><strong>自动导航</strong><span class="an-live">动态</span><span class="an-spacer"></span><select class="an-scope" aria-label="目录范围"><option value="document">当前文档</option><option value="notebook">当前笔记本</option><option value="workspace">全部笔记本</option></select><select class="an-depth" aria-label="目录层级">${[1,2,3,4,5,6].map(n=>`<option value="${n}">${n} 级</option>`).join('')}</select><button type="button" class="an-refresh" title="立即刷新">刷新</button><button type="button" class="an-fold" title="展开或折叠导航" aria-expanded="true">收起</button></div><div class="an-body"><div class="an-crumbs"></div><div class="an-filter"><input type="search" placeholder="筛选子文档…" aria-label="筛选子文档"></div><div class="an-columns"><section><h3 class="an-tree-caption">子文档目录</h3><div class="an-tree-content"></div></section><section><h3>正文标题目录</h3><div class="an-outline-content"></div></section></div></div><div class="an-status" role="status">正在读取目录…</div>`;
    const scope=host.querySelector('.an-scope'), depth=host.querySelector('.an-depth'), search=host.querySelector('input'), status=host.querySelector('.an-status');
    scope.value=state.scope;depth.value=String(state.depth);
    const persist=()=>options.saveSettings?.({scope:state.scope,depth:state.depth});
    const refresh=async(force=false)=>{
      if(state.disposed) return;
      if(state.running){state.again=true;return;}
      state.running=true;
      const requestRoot=state.root;
      try {
        const [model,headings]=await Promise.all([store.model(force),store.headings(requestRoot,force)]);
        if(state.disposed||state.root!==requestRoot) return;
        const doc=model.docs.get(requestRoot);
        if(!doc) throw new Error('当前文档未入索引、已关闭或已删除；稍后自动重试');
        const book=model.books.get(doc.box);
        const crumbs=`<button class="an-book" type="button" title="查看当前笔记本">${escapeHTML(book?.name||'笔记本')}</button>`+ancestors(model,doc.id).map(d=>'<span class="an-separator">›</span>'+link(d)).join('');
        const depthValue=state.query.trim()?6:state.depth;
        let tree='', count=0;
        if(state.scope==='workspace') {
          for(const n of model.books.values()) {
            const subtree=treeHTML(model,n.id,depthValue,state.query);
            if(subtree) tree+=`<div class="an-book-group"><h4>${escapeHTML(n.name)}</h4>${subtree}</div>`;
          }
          count=model.docs.size;
        } else {
          const root=state.scope==='notebook'?doc.box:doc.id;
          tree=treeHTML(model,root,depthValue,state.query);count=descendants(model,root).size;
        }
        const outline=outlineHTML(headings),signature=JSON.stringify([crumbs,tree,outline,state.scope,count]);
        if(signature!==state.signature) {
          const expanded=state.query?null:new Map([...host.querySelectorAll('details[data-tree-id]')].map(d=>[d.dataset.treeId,d.open]));
          host.querySelector('.an-crumbs').innerHTML=crumbs;
          host.querySelector('.an-tree-content').innerHTML=tree||`<p class="an-empty">${state.query?'没有匹配的文档。':'暂无子文档；新建后会自动出现在这里。'}</p>`;
          host.querySelector('.an-outline-content').innerHTML=outline;
          if(expanded) for(const d of host.querySelectorAll('details[data-tree-id]'))if(expanded.has(d.dataset.treeId))d.open=expanded.get(d.dataset.treeId);
          const label={document:'子文档',notebook:'笔记本内文档',workspace:'全部文档'}[state.scope];
          host.querySelector('.an-tree-caption').textContent=`${label}（${count}）`;
          state.signature=signature;
        }
        status.textContent='已更新 '+new Date().toLocaleTimeString('zh-CN',{hour12:false})+' · 自动刷新 · 按名称排序';status.classList.remove('an-error');
      } catch(error) {
        if(!state.disposed){status.textContent='更新失败，保留上次结果：'+error.message;status.classList.add('an-error');}
      } finally {
        state.running=false;
        if(state.again&&!state.disposed){state.again=false;queueMicrotask(()=>refresh());}
      }
    };
    scope.addEventListener('change',()=>{state.scope=scope.value;persist();refresh();});
    depth.addEventListener('change',()=>{state.depth=Number(depth.value);persist();refresh();});
    search.addEventListener('input',()=>{state.query=search.value;refresh();});
    host.querySelector('.an-refresh').addEventListener('click',()=>{store.invalidate();refresh(true);});
    host.querySelector('.an-fold').addEventListener('click',e=>{
      const body=host.querySelector('.an-body');body.hidden=!body.hidden;e.currentTarget.textContent=body.hidden?'展开':'收起';e.currentTarget.setAttribute('aria-expanded',String(!body.hidden));options.onResize?.();
    });
    host.addEventListener('click',e=>{
      if(e.target.closest('.an-book')){state.scope='notebook';scope.value=state.scope;persist();refresh();return;}
      const anchor=e.target.closest('a[data-nav-id]');
      if(anchor&&openLink){e.preventDefault();e.stopPropagation();openLink(anchor.dataset.navId);}
    });
    refresh();
    return {refresh,setRoot(id){if(id!==state.root){state.root=id;state.signature='';refresh();}},dispose(){state.disposed=true;host.remove();}};
  }
  return {ID,escapeHTML,parentOf,buildModel,ancestors,descendants,treeHTML,outlineHTML,outlineRows,createStore,mount,api};
})();
if(typeof module==='object'&&module.exports) module.exports=AutoNavCore;
if(typeof window!=='undefined') window.SiyuanAutoNav=AutoNavCore;
