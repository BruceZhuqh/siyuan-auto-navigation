/* Bundled after nav-core.js. */
(() => {
  'use strict';
  const {Plugin, getAllEditor, openTab, showMessage} = require('siyuan');
  module.exports = class AutoNavigationPlugin extends Plugin {
    onload() {
      this.disposed=false;this.panels=new Map();this.bindings=[];this.store=AutoNavCore.createStore();this.pendingTimer=null;
      if(document.body.classList.contains('body--settings')||window.siyuan?.isPublish) return;
      this.queue=()=>{
        if(this.disposed) return;
        clearTimeout(this.pendingTimer);
        this.pendingTimer=setTimeout(()=>this.scan(),650);
      };
      const listen=(name,handler)=>{this.eventBus.on(name,handler);this.bindings.push([name,handler]);};
      for(const name of ['loaded-protyle-static','loaded-protyle-dynamic','switch-protyle','destroy-protyle'])listen(name,this.queue);
      listen('ws-main',event=>{
        const cmd=String(event.detail?.cmd||'');
        if(/create|rename|move|remove|delete|notebook|sync/i.test(cmd)){this.store.invalidate();this.queue();}
        else if(cmd==='transactions'){this.store.invalidate(false);this.queue();}
      });
      listen('sync-end',()=>{this.store.invalidate();this.queue();});
      this.onVisibility=()=>{if(!document.hidden){this.store.invalidate();this.queue();}};
      document.addEventListener('visibilitychange',this.onVisibility);
      // A fallback also covers API changes whose event names differ across versions.
      this.timer=setInterval(()=>{if(!document.hidden)this.scan();},5000);
      this.addTopBar({icon:'iconList',title:'刷新自动导航',position:'right',callback:()=>{this.store.invalidate();this.scan(true);showMessage('自动导航已请求刷新',1800);}});
    }
    onLayoutReady(){if(this.queue)this.queue();}
    async scan(force=false) {
      if(this.disposed) return;
      const active=new Set();
      for(const editor of getAllEditor()) {
        const protyle=editor?.protyle||editor;
        const element=protyle?.element, root=protyle?.block?.rootID;
        if(!element?.isConnected||!AutoNavCore.ID.test(root||'')||!element.getClientRects().length) continue;
        if(element.closest('.protyle-title')) continue;
        // Rich document titles contain their own nested editor in SiYuan 3.8.11.
        // Mount against the BODY editor, not the first nested wysiwyg element.
        const wysiwyg=[...element.querySelectorAll('.protyle-wysiwyg')].find(node=>!node.closest('.protyle-title'));
        if(!wysiwyg?.parentElement) continue;
        active.add(element);
        let entry=this.panels.get(element);
        if(entry&&entry.root!==root){entry.controller.dispose();this.panels.delete(element);entry=null;}
        if(!entry||!entry.host.isConnected) {
          if(entry)entry.controller.dispose();
          const host=document.createElement('aside');host.setAttribute('aria-label','自动文档导航');
          // Sibling of the editable body: never a block and never serialized into notes.
          wysiwyg.parentElement.insertBefore(host,wysiwyg);
          const key='siyuan-auto-nav:'+root;
          let settings={};try{settings=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
          const controller=AutoNavCore.mount(host,{root,store:this.store,settings,
            saveSettings:value=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}},
            openLink:id=>openTab({app:this.app,doc:{id}})
          });
          entry={host,controller,root};this.panels.set(element,entry);
        } else entry.controller.refresh(force);
        const bodyStyle=getComputedStyle(wysiwyg);
        entry.host.style.marginLeft=bodyStyle.paddingLeft;
        entry.host.style.marginRight=bodyStyle.paddingRight;
      }
      for(const [element,entry] of this.panels)if(!active.has(element)||!element.isConnected){entry.controller.dispose();this.panels.delete(element);}
    }
    onunload() {
      this.disposed=true;clearInterval(this.timer);clearTimeout(this.pendingTimer);
      for(const [name,fn] of this.bindings||[])this.eventBus.off(name,fn);
      if(this.onVisibility)document.removeEventListener('visibilitychange',this.onVisibility);
      for(const entry of this.panels?.values()||[])entry.controller.dispose();
      this.panels?.clear();
    }
  };
})();
