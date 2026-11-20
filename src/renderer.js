// @ts-nocheck
import {Plugin,ItemView,Modal,Notice,Menu,MarkdownRenderer,MarkdownRenderChild,TFile,normalizePath,parseYaml,stringifyYaml,setIcon,Platform} from 'obsidian';
import { restrictIndexToImports } from "./core/import-index";
import {columnLabel,openWorkbook} from './core/xlsx-preview';
const VIEW='wolai-migration-pages';
class NameModal extends Modal {
  constructor(app,label,submit){super(app);this.label=label;this.submit=submit;}
  onOpen(){
    this.contentEl.createEl('h3',{text:this.label});
    const input=this.contentEl.createEl('input',{type:'text',attr:{placeholder:'页面名称','aria-label':'页面名称'}});
    const button=this.contentEl.createEl('button',{text:'创建',cls:'mod-cta'});
    const run=async()=>{const title=input.value.trim();if(!title){input.focus();return;}button.disabled=true;try{await this.submit(title);this.close();}catch(e){new Notice('创建失败：'+e.message);button.disabled=false;}};
    input.addEventListener('keydown',e=>{if(e.key==='Enter')run();});button.onclick=run;input.focus();
  }
  onClose(){this.contentEl.empty();}
}
class MarkdownEditModal extends Modal {
  constructor(app,title,value,save){super(app);this.title=title;this.value=value;this.save=save;}
  onOpen(){this.contentEl.createEl('h3',{text:this.title});const input=this.contentEl.createEl('textarea',{cls:'wolai-edit-text'});input.value=this.value;const button=this.contentEl.createEl('button',{text:'保存',cls:'mod-cta'});button.onclick=async()=>{button.disabled=true;try{await this.save(input.value);this.close();}catch(e){new Notice('保存失败：'+e.message);button.disabled=false;}};input.focus();}
  onClose(){this.contentEl.empty();}
}
const EMOJI_GROUPS=[
  {name:'常用',list:['📄','📝','📌','📎','🗂️','📁','🏠','⭐','✅','❗','🔥','💡','🎯','📊','📈','💰','🛒','📚','🧠','❤️','🌱','🍀','☕','🍜','✈️','🚗','🩺','💊','🐱','🐶','🌙','☀️','🌈','⚙️','🔧','🔑','🔒','⏰','📅','🗓️','🎂','🏆','🎮','🎨','🧾','📦','🔍','🧩']},
  {name:'标记 / 序号',list:['🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','▶️','⏸️','⏹️','🔖','🏷️','📍','🧭','🕐','🕒','🕕','🕘','♻️','➕','➖','✔️','❌','⚠️','❓','💤','🎵','🎶']},
];
const ICON_DATE_FORMATS=['YYYY/MM/DD','YYYY-MM-DD','M月D日','YYYY年M月','M/D','MMMM D, YYYY','YYYY/MM/DD dddd'];
const ICON_IMAGE_EXTS=['png','jpg','jpeg','gif','svg','webp','bmp','avif'];
class IconPickerModal extends Modal{
  constructor(app,plugin,pagePath){
    super(app);this.plugin=plugin;this.pagePath=pagePath;
    const cur=plugin.data?.nodes[pagePath]?.icon;
    this.icon=cur?JSON.parse(JSON.stringify(cur)):null;
    this.tab=plugin.iconType(cur)||'emoji';
  }
  onOpen(){
    const root=this.contentEl;root.addClass('wolai-icon-picker');
    root.createEl('h3',{text:'页面图标'});
    const bar=root.createDiv({cls:'wolai-icon-tabs'});this.tabEls={};
    for(const [key,label] of [['emoji','表情'],['image','图片'],['date','日期'],['elapsed','距今 / 倒计时']]){
      const b=bar.createEl('button',{text:label,cls:'wolai-icon-tab'});
      b.onclick=()=>{this.tab=key;this.draw();};this.tabEls[key]=b;
    }
    this.bodyEl=root.createDiv({cls:'wolai-icon-body'});
    const foot=root.createDiv({cls:'wolai-icon-footer'});
    const save=foot.createEl('button',{text:'保存',cls:'mod-cta'});
    save.onclick=async()=>{if(!this.plugin.iconType(this.icon)){new Notice('请先选择一个图标');return;}save.disabled=true;try{await this.plugin.setIcon(this.pagePath,this.icon);this.close();}catch(e){new Notice('保存失败：'+e.message);save.disabled=false;}};
    const rm=foot.createEl('button',{text:'移除图标'});
    rm.onclick=async()=>{try{await this.plugin.setIcon(this.pagePath,null);this.close();}catch(e){new Notice('移除失败：'+e.message);}};
    this.draw();
  }
  onClose(){this.contentEl.empty();}
  draw(){
    for(const [key,el] of Object.entries(this.tabEls))el.toggleClass('is-active',key===this.tab);
    const b=this.bodyEl;b.empty();
    this.previewEl=b.createDiv({cls:'wolai-icon-preview'});
    if(this.tab==='emoji')this.drawEmoji(b);
    else if(this.tab==='image')this.drawImage(b);
    else if(this.tab==='date')this.drawDate(b);
    else this.drawElapsed(b);
    this.updatePreview();
  }
  updatePreview(){
    const el=this.previewEl;el.empty();
    if(!this.plugin.iconType(this.icon)){el.createSpan({text:'（未选择）',cls:'wolai-color-gray'});return;}
    this.plugin.renderIcon(el,this.icon,'file-text');
  }
  drawEmoji(b){
    if(this.plugin.iconType(this.icon)!=='emoji')this.icon={type:'emoji',emoji:'📄'};
    const row=b.createDiv({cls:'wolai-icon-custom'});
    row.createSpan({text:'自定义：'});
    const input=row.createEl('input',{type:'text',attr:{placeholder:'粘贴任意 emoji'}});
    input.value=this.icon.emoji||'';
    input.oninput=()=>{const v=input.value.trim();this.icon={type:'emoji',emoji:v||'📄'};this.updatePreview();};
    for(const g of EMOJI_GROUPS){
      b.createDiv({text:g.name,cls:'wolai-icon-group-title'});
      const grid=b.createDiv({cls:'wolai-icon-grid'});
      for(const e of g.list){const c=grid.createEl('button',{text:e,cls:'wolai-icon-cell'});c.onclick=()=>{this.icon={type:'emoji',emoji:e};input.value=e;this.updatePreview();};}
    }
  }
  drawImage(b){
    const imgs=this.app.vault.getFiles().filter(f=>ICON_IMAGE_EXTS.includes((f.extension||'').toLowerCase()));
    imgs.sort((x,y)=>(y.path.includes('_wolai/assets')?1:0)-(x.path.includes('_wolai/assets')?1:0)||x.path.localeCompare(y.path));
    const row=b.createDiv({cls:'wolai-icon-custom'});
    row.createSpan({text:'路径 / URL：'});
    const input=row.createEl('input',{type:'text',attr:{placeholder:'_wolai/assets/x.svg 或 https://…'}});
    input.value=this.plugin.iconType(this.icon)==='image'?(this.icon.path||''):'';
    input.oninput=()=>{const v=input.value.trim();this.icon=v?{type:'image',path:v}:null;this.updatePreview();};
    b.createDiv({text:'vault 内图片（共 '+imgs.length+' 张，显示前 300）',cls:'wolai-icon-group-title'});
    const grid=b.createDiv({cls:'wolai-icon-grid wolai-icon-grid-img'});
    for(const f of imgs.slice(0,300)){
      const c=grid.createEl('button',{cls:'wolai-icon-cell wolai-icon-cell-img'});
      c.createEl('img',{attr:{src:this.app.vault.getResourcePath(f),alt:''}});
      c.title=f.path;
      c.onclick=()=>{this.icon={type:'image',path:f.path};input.value=f.path;this.updatePreview();};
    }
  }
  drawDate(b){
    const prev=this.plugin.iconType(this.icon)==='date'?this.icon:{};
    const isToday=!prev.date||prev.date==='today';
    const row1=b.createDiv({cls:'wolai-icon-custom'});
    const mk=(v,label)=>{const l=row1.createEl('label',{cls:'wolai-icon-radio'});const r=l.createEl('input',{type:'radio'});r.name='wolai-date-mode';r.checked=(v==='today')===isToday;l.createSpan({text:label});return r;};
    const rToday=mk('today','今天（每天自动变）'),rFixed=mk('fixed','指定日期');
    const row2=b.createDiv({cls:'wolai-icon-custom'});
    row2.createSpan({text:'日期：'});
    const dateInput=row2.createEl('input',{type:'date'});
    dateInput.value=isToday?window.moment().format('YYYY-MM-DD'):(prev.date||'');
    row2.createSpan({text:'格式：'});
    const sel=row2.createEl('select');
    for(const f of ICON_DATE_FORMATS){const o=sel.createEl('option',{text:f});o.value=f;}
    const oCustom=sel.createEl('option',{text:'自定义…'});oCustom.value='';
    const known=ICON_DATE_FORMATS.includes(prev.format);
    sel.value=known?prev.format:'YYYY/MM/DD';
    const custom=row2.createEl('input',{type:'text',attr:{placeholder:'moment 格式'}});
    custom.value=known?'':(prev.format||'');
    custom.toggleClass('is-hidden',known);
    const sync=()=>{
      const mode=rToday.checked?'today':'fixed';
      const fmt=sel.value||custom.value.trim()||'YYYY/MM/DD';
      this.icon={type:'date',date:mode==='today'?'today':dateInput.value,format:fmt};
      dateInput.toggleClass('is-hidden',mode==='today');
      this.updatePreview();
    };
    rToday.onchange=sync;rFixed.onchange=sync;dateInput.onchange=sync;
    sel.onchange=()=>{custom.toggleClass('is-hidden',!!sel.value);sync();};
    custom.oninput=sync;
    sync();
  }
  drawElapsed(b){
    const prev=this.plugin.iconType(this.icon)==='elapsed'?this.icon:{};
    const row1=b.createDiv({cls:'wolai-icon-custom'});
    row1.createSpan({text:'锚点日期：'});
    const dateInput=row1.createEl('input',{type:'date'});
    dateInput.value=prev.date||window.moment().format('YYYY-MM-DD');
    row1.createSpan({text:'单位：'});
    const unitSel=row1.createEl('select');
    for(const [v,t] of [['day','天'],['month','个月'],['year','年']]){const o=unitSel.createEl('option',{text:t});o.value=v;}
    unitSel.value=prev.unit||'day';
    const row2=b.createDiv({cls:'wolai-icon-custom'});
    row2.createSpan({text:'方向：'});
    const dirSel=row2.createEl('select');
    for(const [v,t] of [['auto','自动（未来→还有／过去→已过）'],['since','距今（已过）'],['until','倒计时（还有）']]){const o=dirSel.createEl('option',{text:t});o.value=v;}
    dirSel.value=prev.direction||'auto';
    const row3=b.createDiv({cls:'wolai-icon-custom'});
    row3.createSpan({text:'前缀：'});
    const pIn=row3.createEl('input',{type:'text',attr:{placeholder:'默认：已过 / 还有'}});
    pIn.value=typeof prev.prefix==='string'?prev.prefix:'';
    row3.createSpan({text:'后缀：'});
    const sIn=row3.createEl('input',{type:'text',attr:{placeholder:'默认：天 / 个月 / 年'}});
    sIn.value=typeof prev.suffix==='string'?prev.suffix:'';
    const sync=()=>{
      this.icon={type:'elapsed',date:dateInput.value,unit:unitSel.value,direction:dirSel.value};
      if(pIn.value!=='')this.icon.prefix=pIn.value;
      if(sIn.value!=='')this.icon.suffix=sIn.value;
      this.updatePreview();
    };
    dateInput.onchange=sync;unitSel.onchange=sync;dirSel.onchange=sync;pIn.oninput=sync;sIn.oninput=sync;
    sync();
  }
}
class ButtonBuilderModal extends Modal{
  constructor(app,plugin,pagePath){
    super(app);this.plugin=plugin;this.pagePath=pagePath;
    this.name='';this.source='existing';
    this.templates=plugin.listTemplates();
    this.templatePath=this.templates[0]||'';
    this.newTemplateName='';this.body='';
  }
  onOpen(){
    const root=this.contentEl;root.addClass('wolai-button-builder');
    root.createEl('h3',{text:'新建按钮'});
    root.createDiv({cls:'wolai-modal-hint',text:'按钮会插入到当前页面末尾；点击按钮即按所选动作执行。'});
    const f1=root.createDiv({cls:'wolai-field'});
    f1.createEl('label',{text:'按钮名称'});
    const nameIn=f1.createEl('input',{type:'text',attr:{placeholder:'例如：日记记录'}});
    f1.createDiv({cls:'wolai-modal-hint',text:'名称会显示在按钮文字里；用「新建页面」动作时，模板里的 # 标题 决定新页面名。'});
    const f2=root.createDiv({cls:'wolai-field'});
    f2.createEl('label',{text:'点击动作'});
    const modeSel=f2.createEl('select');
    for(const [v,t,dis] of [['page','新建页面（用模板生成新页面）',false],['inline','插入内容到折叠块（暂未开放）',true]]){
      const o=modeSel.createEl('option',{text:t});o.value=v;o.disabled=dis;
    }
    modeSel.value='page';
    const f3=root.createDiv({cls:'wolai-field'});
    f3.createEl('label',{text:'模板来源'});
    const srcSel=f3.createEl('select');
    for(const [v,t] of [['existing','使用已有模板文件'],['new','新建模板文件'],['inline','按钮内直接写内容（不依赖文件）']]){
      const o=srcSel.createEl('option',{text:t});o.value=v;
    }
    srcSel.value=this.source;
    const holder=root.createDiv({cls:'wolai-button-source'});
    const buildName=()=>{
      const t=this.newTemplateName.trim()||this.name.trim();
      if(!t)throw new Error('请填写按钮名称，或为模板起个名字');
      return t;
    };
    const drawSource=()=>{
      holder.empty();
      if(this.source==='existing'){
        if(!this.templates.length){holder.createDiv({cls:'wolai-error',text:'_wolai/templates 下还没有模板文件，请改用「新建模板文件」或「按钮内直接写内容」。'});return;}
        const r=holder.createDiv({cls:'wolai-field'});
        r.createEl('label',{text:'选择模板'});
        const sel=r.createEl('select');
        for(const p of this.templates){const o=sel.createEl('option',{text:p});o.value=p;}
        sel.value=this.templatePath&&this.templates.includes(this.templatePath)?this.templatePath:this.templates[0];
        this.templatePath=sel.value;
        sel.onchange=()=>{this.templatePath=sel.value;};
        const view=holder.createEl('button',{text:'查看模板内容'});
        const pre=holder.createEl('pre',{cls:'wolai-template-preview'});
        pre.addClass('is-hidden');
        view.onclick=async()=>{
          if(!pre.hasClass('is-hidden')){pre.addClass('is-hidden');return;}
          const f=this.app.vault.getAbstractFileByPath(this.templatePath);
          pre.setText(f instanceof TFile?await this.app.vault.read(f):'（文件缺失）');
          pre.removeClass('is-hidden');
        };
      }else if(this.source==='new'){
        const r=holder.createDiv({cls:'wolai-field'});
        r.createEl('label',{text:'模板文件名'});
        const nIn=r.createEl('input',{type:'text',attr:{placeholder:'留空则用按钮名称'}});
        nIn.value=this.newTemplateName;
        nIn.oninput=()=>{this.newTemplateName=nIn.value;};
        const r2=holder.createDiv({cls:'wolai-field'});
        r2.createEl('label',{text:'模板内容（支持 %DATE% %YEAR% %MONTH% %DAY% %WEEK% %DAYOFWEEK% %TIME% 变量，必须以 # 标题 开头）'});
        const ta=r2.createEl('textarea');
        ta.value=this.body||'# 新页面\n\n';
        ta.oninput=()=>{this.body=ta.value;};
      }else{
        const r=holder.createDiv({cls:'wolai-field'});
        r.createEl('label',{text:'按钮内容（直接写在按钮配置里，跨端不依赖模板文件）'});
        const ta=r.createEl('textarea');
        ta.value=this.body||'# 新页面\n\n';
        ta.oninput=()=>{this.body=ta.value;};
      }
    };
    srcSel.onchange=()=>{this.source=srcSel.value;
      if(this.source==='new'&&!this.newTemplateName)this.newTemplateName=this.name;
      if(!this.body)this.body='# 新页面\n\n';
      drawSource();};
    nameIn.oninput=()=>{this.name=nameIn.value.trim();};
    const foot=root.createDiv({cls:'wolai-icon-footer'});
    const cancel=foot.createEl('button',{text:'取消'});
    cancel.onclick=()=>this.close();
    const ok=foot.createEl('button',{text:'插入按钮',cls:'mod-cta'});
    ok.onclick=async()=>{
      ok.disabled=true;
      try{
        const cfg={name:this.name.trim()};
        if(!cfg.name)throw new Error('请填写按钮名称');
        if(this.source==='existing'){
          if(!this.templatePath)throw new Error('请选择模板文件');
          cfg.template=this.templatePath;
        }else if(this.source==='new'){
          const text=(this.body||'').trim();
          if(!text)throw new Error('模板内容不能为空');
          if(!/^#\s+.+/m.test(text))throw new Error('模板必须以「# 标题」开头（新页面用它命名）');
          cfg.template=await this.plugin.createTemplate(buildName(),this.body);
        }else{
          const text=(this.body||'').trim();
          if(!text)throw new Error('按钮内容不能为空');
          if(!/^#\s+.+/m.test(text))throw new Error('内容必须以「# 标题」开头（新页面用它命名）');
          cfg.body=this.body;
        }
        await this.plugin.newButton(this.pagePath,cfg);
        new Notice('按钮已插入');
        this.close();
      }catch(e){new Notice('插入失败：'+e.message);ok.disabled=false;}
    };
    drawSource();
    nameIn.focus();
  }
  onClose(){this.contentEl.empty();}
}
class PagesView extends ItemView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.expanded=new Set((plugin.data&&plugin.data.roots)||[]);this.query='';}
  getViewType(){return VIEW;}
  getDisplayText(){return '页面';}
  getIcon(){return 'panels-top-left';}
  async onOpen(){await this.render();}
  async render(){
    const revision=this.renderRevision=(this.renderRevision||0)+1,data=this.plugin.data;
    await this.plugin.refreshBodyChildOrders();
    if(revision!==this.renderRevision||data!==this.plugin.data)return;
    const c=this.contentEl;c.empty();c.addClass('wolai-pages');
    c.createEl('h4',{text:'我的页面'});
    const search=c.createEl('input',{attr:{placeholder:'搜索页面…','aria-label':'搜索页面'},cls:'wolai-search'});search.value=this.query;
    const body=c.createDiv({cls:'wolai-tree'});
    search.oninput=()=>{this.query=search.value;draw();};
    const draw=()=>{
      body.empty();
      if(this.plugin.error){this.plugin.errorBox(body,this.plugin.error,()=>this.plugin.reloadIndex());return;}
      if(!this.plugin.data){body.createDiv({text:'正在读取页面…',cls:'wolai-loading'});return;}
      if(!this.plugin.data.roots.length){body.createDiv({text:'还没有导入页面。',cls:'wolai-loading'});const b=body.createEl('button',{text:'导入 wolai HTML 导出…',cls:'mod-cta'});b.onclick=()=>{if(this.plugin.openImport)this.plugin.openImport();};return;}
      const all=this.plugin.data.nodes;const q=this.query.toLocaleLowerCase();
      const visible=(n)=>n.title.toLocaleLowerCase().includes(q)||this.plugin.visiblePagePaths(n.children||[]).some(p=>visible(all[p]));
      const render=(path,depth)=>{
        const n=all[path];if(!n||q&&!visible(n))return;
        const row=body.createDiv({cls:'wolai-tree-row'});row.style.paddingLeft=(depth*15)+'px';
        const children=this.plugin.visiblePagePaths(n.children||[]);
        const toggle=row.createEl('button',{cls:'wolai-expand',attr:{'aria-label':this.expanded.has(path)?'收起 '+n.title:'展开 '+n.title}});
        if(children.length){setIcon(toggle,this.expanded.has(path)||q?'chevron-down':'chevron-right');toggle.onclick=()=>{this.expanded.has(path)?this.expanded.delete(path):this.expanded.add(path);draw();};}else{toggle.addClass('wolai-expand-placeholder');toggle.disabled=true;}
        const open=row.createEl('button',{cls:'wolai-page-open',attr:{title:n.title}});
        const icon=open.createSpan({cls:'wolai-page-icon'});this.plugin.renderIcon(icon,n.icon,n.type==='database'?'table-2':'file-text',{compact:true});
        open.createSpan({text:n.title,cls:'wolai-page-label'});open.onclick=()=>this.plugin.open(path);
        row.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();this.contextMenu(path,e);};
        if(this.app.workspace.getActiveFile()?.path===path)row.addClass('is-active');
        if(n.type==='page' || n.type==='database'){
          const plus=row.createEl('button',{cls:'wolai-page-add',attr:{'aria-label':n.type==='database'?'新增记录：'+n.title:'新建子页面：'+n.title}});setIcon(plus,'plus');
          if(n.type==='database'&&!n.schema){plus.disabled=true;plus.title='原始字段定义尚未核验，暂不能创建记录';}
          plus.onclick=()=>n.type==='database'?this.plugin.newRecord(path):this.plugin.newChild(path);
        }
        if(this.expanded.has(path)||q)for(const p of children)render(p,depth+1);
      };
      for(const root of this.plugin.visiblePagePaths(this.plugin.data.roots))render(root,0);
      if(q&&!body.childElementCount)body.createDiv({text:'没有匹配的页面'});
    };
    draw();
  }
  contextMenu(path,event){
    const n=this.plugin.data?.nodes[path];if(!n)return;
    const menu=new Menu();
    menu.addItem(i=>i.setTitle(n.icon?'修改图标':'设置图标').setIcon('image-plus').onClick(()=>this.plugin.openIconPicker(path)));
    if(n.icon)menu.addItem(i=>i.setTitle('移除图标').setIcon('trash').onClick(()=>this.plugin.setIcon(path,null).catch(e=>new Notice('移除失败：'+e.message))));
    menu.addSeparator();
    if(n.type==='page'||n.type==='record')menu.addItem(i=>i.setTitle('新建按钮').setIcon('mouse-pointer-click').onClick(()=>this.plugin.openButtonBuilder(path)));
    if(n.type==='page')menu.addItem(i=>i.setTitle('新建子页面').setIcon('plus').onClick(()=>this.plugin.newChild(path)));
    if(n.type==='database')menu.addItem(i=>i.setTitle('新增记录').setIcon('plus').onClick(()=>this.plugin.newRecord(path)));
    menu.addItem(i=>i.setTitle('打开页面').setIcon('file-text').onClick(()=>this.plugin.open(path)));
    menu.showAtMouseEvent(event);
  }
}
export class RendererPlugin extends Plugin {
  async onload(){
    this.data = null;
    this.error = null;
    if(!Platform.isMobile)this.registerDomEvent(this.app.workspace.containerEl,'click',event=>{this.onBreadcrumbClick(event).catch(e=>{console.error('[wolai-local] 面包屑跳转失败',e);new Notice('页面跳转失败：'+e.message);});},true);
    this.registerView(VIEW,leaf=>new PagesView(leaf,this));
    this.addRibbonIcon('panels-top-left','页面导航',()=>this.reveal());
    this.addCommand({id:'open-pages',name:'打开页面导航',callback:()=>this.reveal()});
    this.addCommand({id:'new-child',name:'新建子页面',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!f||!['page','record'].includes(this.data?.nodes[f.path]?.type))return false;if(!checking)this.newChild(f.path);return true;}});
    this.addCommand({id:'new-record',name:'新增表格记录',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!f||this.data?.nodes[f.path]?.type!=='database')return false;if(!checking)this.newRecord(f.path);return true;}});
    this.addCommand({id:'reload-index',name:'重新读取页面导航',callback:()=>this.reloadIndex()});
    this.addCommand({id:'set-icon',name:'设置当前页面图标',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!f||!this.data?.nodes[f.path])return false;if(!checking)this.openIconPicker(f.path);return true;}});
    this.addCommand({id:'new-button',name:'新建按钮',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!f||!['page','record'].includes(this.data?.nodes[f.path]?.type))return false;if(!checking)this.openButtonBuilder(f.path);return true;}});
    this.registerInterval(window.setInterval(()=>this.refreshDynamicIcons(),600000));
    this.registerMarkdownCodeBlockProcessor('wolai-columns',async(source,el,ctx)=>{
      try{const columns=JSON.parse(source);if(!Array.isArray(columns)||columns.some(x=>!x||typeof x.markdown!=='string'||!Number.isFinite(x.weight)||x.weight<=0))throw new Error('分栏数据无效');
        const row=el.createDiv({cls:'wolai-columns'});const child=new MarkdownRenderChild(row);ctx.addChild(child);
        for(const [index,item] of columns.entries()){const col=row.createDiv({cls:'wolai-column'});col.style.flexGrow=String(item.weight);const edit=col.createEl('button',{text:'编辑此栏',cls:'wolai-block-edit'});edit.onclick=()=>new MarkdownEditModal(this.app,'编辑分栏',item.markdown,async value=>{const next=JSON.parse(source);next[index].markdown=value;await this.replaceBlock(ctx,'wolai-columns',source,next);}).open();const content=col.createDiv();await MarkdownRenderer.render(this.app,item.markdown,content,ctx.sourcePath,child);this.wireTasks(content,item.markdown,async value=>{const next=JSON.parse(source);next[index].markdown=value;await this.replaceBlock(ctx,'wolai-columns',source,next);});}
      }catch(e){this.errorBox(el,'无法读取分栏：'+e.message,()=>this.open(ctx.sourcePath));}
    });
    this.registerMarkdownCodeBlockProcessor('wolai-toggle',async(source,el,ctx)=>{
      try{const item=JSON.parse(source);if(typeof item.title!=='string'||typeof item.markdown!=='string')throw new Error('折叠内容无效');
        const detail=el.createEl('details',{cls:'wolai-toggle'});detail.open=item.open===true;const summary=detail.createEl('summary');const content=detail.createDiv({cls:'wolai-toggle-body'});const child=new MarkdownRenderChild(detail);ctx.addChild(child);
        await MarkdownRenderer.render(this.app,item.title,summary,ctx.sourcePath,child);await MarkdownRenderer.render(this.app,item.markdown,content,ctx.sourcePath,child);this.wireTasks(content,item.markdown,async value=>{const next=JSON.parse(source);next.markdown=value;await this.replaceBlock(ctx,'wolai-toggle',source,next);});
      }catch(e){this.errorBox(el,'无法读取折叠内容：'+e.message,()=>this.open(ctx.sourcePath));}
    });
    this.registerMarkdownCodeBlockProcessor('wolai-styled',async(source,el,ctx)=>{
      try{const item=JSON.parse(source);if(typeof item.markdown!=='string'||!Array.isArray(item.classes)||item.classes.some(c=>typeof c!=='string'||!/^wolai-export-[a-z0-9_-]+$/.test(c)))throw new Error('段落样式无效');
        const content=el.createDiv({cls:item.classes.join(' ')});const child=new MarkdownRenderChild(content);ctx.addChild(child);await MarkdownRenderer.render(this.app,item.markdown,content,ctx.sourcePath,child);this.wireTasks(content,item.markdown,async value=>{const next=JSON.parse(source);next.markdown=value;await this.replaceBlock(ctx,'wolai-styled',source,next);});
      }catch(e){this.errorBox(el,'无法读取段落：'+e.message,()=>this.open(ctx.sourcePath));}
    });
    this.registerMarkdownCodeBlockProcessor('wolai-image',async (source, el, ctx) => {
      try {
        const item = JSON.parse(source);
        if (typeof item.markdown !== 'string' || typeof item.caption !== 'string' || !['left', 'center', 'right'].includes(item.align)
          || (item.width !== undefined && !/^\d+(?:\.\d+)?(?:px|%)$/.test(item.width))) throw new Error('图片版式无效');
        const figure = el.createEl('figure', { cls: `wolai-imported-figure wolai-figure-${item.align}` });
        if (item.width) figure.style.width = item.width;
        const child = new MarkdownRenderChild(figure);
        ctx.addChild(child);
        await MarkdownRenderer.render(this.app, item.markdown, figure.createDiv({ cls: 'wolai-figure-media' }), ctx.sourcePath, child);
        if (item.caption) await MarkdownRenderer.render(this.app, item.caption, figure.createEl('figcaption'), ctx.sourcePath, child);
      } catch (error) {
        this.errorBox(el, '无法读取图片：' + error.message, () => this.open(ctx.sourcePath));
      }
    });
    this.registerMarkdownCodeBlockProcessor('wolai-progress', (source, el) => {
      try {
        const { value, max } = JSON.parse(source);
        if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(value) || value < 0 || value > max) throw new Error('无效的进度值');
        const percentage = Math.round((100 * value / max) * 10) / 10;
        const progress = el.createDiv({ cls: 'wolai-export-progress', attr: {
          role: 'progressbar', 'aria-label': '完成进度', 'aria-valuemin': '0',
          'aria-valuemax': String(max), 'aria-valuenow': String(value),
        } });
        const track = progress.createDiv({ cls: 'wolai-export-progress-track' });
        track.createDiv({ cls: 'wolai-export-progress-fill' }).style.width = `${percentage}%`;
        progress.createSpan({ text: `${percentage}%`, cls: 'wolai-export-progress-value', attr: { 'aria-hidden': 'true' } });
      } catch (error) {
        el.createDiv({ cls: 'wolai-error', text: error.message });
      }
    });
    this.registerMarkdownCodeBlockProcessor('wolai-table',async(source,el,ctx)=>{
      try{
        const item=JSON.parse(source);
        if(!Array.isArray(item.rows)||item.rows.some(row=>!Array.isArray(row)||row.some(cell=>!cell||typeof cell.markdown!=='string'||(cell.classes!==undefined&&(!Array.isArray(cell.classes)||cell.classes.some(c=>typeof c!=='string'||!/^wolai-export-[a-z0-9_-]+$/.test(c))))||(cell.width!==undefined&&(!Number.isFinite(cell.width)||cell.width<=0))||(cell.header!==undefined&&![true,false,'row','col'].includes(cell.header)))))throw new Error('表格单元格无效');
        const scroll=el.createDiv({cls:'wolai-content-table-scroll'});const table=scroll.createEl('table',{cls:'wolai-content-table'});const child=new MarkdownRenderChild(scroll);ctx.addChild(child);
        let leadingHeaders = 0;
        for (const row of item.rows) {
          if (!row.length || !row.every((cell) => cell.header === true || cell.header === 'col')) break;
          leadingHeaders++;
        }
        if (item.rows.slice(0, leadingHeaders).some((row, i) => row.some((cell) => cell.rowspan > leadingHeaders - i))) leadingHeaders = 0;
        const head = leadingHeaders ? table.createEl('thead') : null;
        const body = table.createEl('tbody');
        for(const [rowIndex,row] of item.rows.entries()){
          const tr=(rowIndex < leadingHeaders ? head : body).createEl('tr');
          for(const [columnIndex,cell] of row.entries()){
            const td=tr.createEl(cell.header?'th':'td');
            if(cell.classes)td.addClasses(cell.classes);
            if(cell.header)td.scope=cell.header==='row'?'row':'col';
            if(cell.width!==undefined)td.style.minWidth=td.style.width=cell.width+'px';
            if(['left','center','right','justify'].includes(cell.align))td.style.textAlign=cell.align;
            if(Number.isInteger(cell.colspan)&&cell.colspan>1)td.colSpan=Math.min(cell.colspan,1000);
            if(Number.isInteger(cell.rowspan)&&cell.rowspan>1)td.rowSpan=Math.min(cell.rowspan,65534);
            const content=td.createDiv({cls:'wolai-content-table-cell'});await MarkdownRenderer.render(this.app,cell.markdown,content,ctx.sourcePath,child);
            this.wireTasks(content,cell.markdown,async value=>{const next=JSON.parse(source);next.rows[rowIndex][columnIndex].markdown=value;await this.replaceBlock(ctx,'wolai-table',source,next);});
          }
        }
      }catch(e){this.errorBox(el,'无法读取内容表格：'+e.message,()=>this.open(ctx.sourcePath));}
    });
    this.registerMarkdownCodeBlockProcessor('wolai-table-source', (source, el) => {
      try {
        const { url } = JSON.parse(source);
        if (typeof url !== 'string' || !/^https?:\/\/www\.wolai\.com\/[a-z0-9]+(?:#\w+)?\/?$/i.test(url)) throw new Error('链接无效');
        const card = el.createDiv({ cls: 'wolai-workbook' });
        card.createEl('strong', { text: 'wolai 多维表格' });
        card.createEl('p', { cls: 'wolai-workbook-note', text: '这份 HTML 只包含原表链接。' });
        card.createEl('a', { text: '在 wolai 打开原表', href: url, cls: 'external-link', attr: { rel: 'noopener' } });
      } catch (error) {
        el.createDiv({ cls: 'wolai-error', text: '无法显示原表链接：' + error.message });
      }
    });
    this.registerMarkdownCodeBlockProcessor('wolai-workbook', (source, el, ctx) => this.renderWorkbook(source, el, ctx));
    this.registerMarkdownCodeBlockProcessor('wolai-database',async(source,el,ctx)=>{
      try{const item=JSON.parse(source);const node=this.data?.nodes[item.base];if(!node||node.type!=='database'||!node.schema)throw new Error('原始表格字段尚未核验');
        const toolbar=el.createDiv({cls:'wolai-database-tabs'});const content=el.createDiv();const child=new MarkdownRenderChild(content);ctx.addChild(child);const formTab=toolbar.createEl('button',{text:item.form.name});const tableTab=toolbar.createEl('button',{text:'表格视图'});
        const draw=async view=>{content.empty();formTab.toggleClass('is-active',view==='form');tableTab.toggleClass('is-active',view==='table');if(view==='table'){await MarkdownRenderer.render(this.app,'![[ '+item.base+' ]]'.replace('![[ ','![[').replace(' ]]',']]'),content,ctx.sourcePath,child);return;}
          const form=content.createEl('form',{cls:'wolai-record-form'});form.createEl('h2',{text:item.form.name});const inputs={};
          for(const name of item.form.fields){const col=node.schema.find(c=>c.name===name);if(!col||!['number','date','text','primary','phone','url'].includes(col.type))throw new Error('表单字段定义无效：'+name);const label=form.createEl('label',{text:name});const input=label.createEl('input',{type:col.type==='number'?'number':col.type==='date'?'date':'text'});if(col.type==='number')input.step='any';inputs[name]={input,type:col.type};}
          const submit=form.createEl('button',{text:'提交表单',cls:'mod-cta',type:'submit'});const error=form.createDiv({cls:'wolai-form-status'});
          form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;error.setText('正在保存…');try{const values={};for(const [name,{input,type}] of Object.entries(inputs)){if(!input.value)values[name]=null;else if(type==='number'){const number=Number(input.value);if(!Number.isFinite(number))throw new Error(name+'需要有效数字');values[name]=number;}else values[name]=input.value;}
            await this.createFormRecord(node,values);form.reset();error.setText('已保存到本地表格');new Notice('记录已保存');}catch(e){error.setText('保存失败：'+e.message);}finally{submit.disabled=false;}};
        };formTab.onclick=()=>draw('form').catch(e=>this.errorBox(content,e.message,()=>draw('form')));tableTab.onclick=()=>draw('table').catch(e=>this.errorBox(content,e.message,()=>draw('table')));await draw(item.defaultView);
      }catch(e){this.errorBox(el,'无法读取表格：'+e.message,()=>this.reloadIndex());}
    });
    this.registerMarkdownCodeBlockProcessor('wolai-template',async(source,el,ctx)=>{
      try{const t=JSON.parse(source);if(typeof t.name!=='string'||typeof t.template!=='string')throw new Error('模板定义无效');
        const btn=el.createEl('button',{text:t.name,cls:'wolai-template-button'});
        btn.onclick=async()=>{btn.disabled=true;try{await this.applyTemplate(t,ctx);}catch(e){new Notice('模板创建失败：'+e.message);}finally{btn.disabled=false;}};
      }catch(e){this.errorBox(el,e.message,()=>this.reloadIndex());}
    });
    this.registerMarkdownPostProcessor((el,ctx)=>this.decorateSection(el,ctx));
    this.registerEvent(this.app.workspace.on('file-open',()=>{this.refreshViews();this.decorateOpenViews();}));
    this.registerEvent(this.app.vault.on('modify',file=>{const node=this.data?.nodes[file.path];if(node?.type==='database'&&node.computedView)this.syncComputedView(node).catch(e=>new Notice(e.message));}));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.handleRename(file.path, oldPath).catch((error) => new Notice('页面目录保存失败：' + error.message));
    }));
    this.registerEvent(this.app.vault.on('delete',file=>{
      if(!this.data)return;
      const deleted=new Set(Object.keys(this.data.nodes).filter(p=>p===file.path||p.startsWith(file.path+'/')));
      if(!deleted.size)return;
      const parents=Object.values(this.data.nodes).filter(n=>n.children?.some(p=>deleted.has(p))&&!deleted.has(n.path)).map(n=>n.path);
      for(const path of deleted)this.removeIndexNode(path);
      this.saveData(this.data).catch(e=>new Notice('页面目录保存失败：'+e.message));this.refreshViews();
      if(file instanceof TFile)this.cleanupDeletedPage(file,parents).catch(e=>console.error('[wolai-local] 删除后清理失败',e));
    }));
    this.registerEvent(this.app.metadataCache.on('changed',(file,text,cache)=>{
      this.bodyOrderCache?.delete(file.path);
      const node=this.data?.nodes[file.path];if(!node)return;
      const db=this.data.nodes[node.databasePath];const primary=db?.schema?.find(c=>c.type==='primary');
      const value=node.type==='record'&&primary?cache.frontmatter?.[primary.name]:text.match(/^# (.+)$/m)?.[1];
      let changed=this.syncBodyChildOrder(file.path,text);
      if(typeof value==='string'&&value.trim()&&value!==node.title){node.title=value;changed=true;}
      if(changed)this.saveData(this.data).then(()=>this.refreshViews()).catch(e=>new Notice('页面目录保存失败：'+e.message));
    }));
    await this.reloadIndex();
    this.app.workspace.onLayoutReady(() => {
      this.decorateOpenViews();
      this.redrawOpenViews();
    });
  }
  onunload(){this.clearPageDrag();for(const leaf of this.app.workspace.getLeavesOfType('markdown')){leaf.view.containerEl.removeClass('wolai-view','wolai-record','wolai-full-width','wolai-small-text','wolai-export-layout');leaf.view.containerEl.querySelectorAll('.wolai-header,.wolai-actions,.wolai-insert-page,.wolai-page-drag-handle,.wolai-page-drop-zone').forEach(el=>el.remove());leaf.view.containerEl.querySelectorAll('.wolai-page-block').forEach(el=>{el.removeClass('wolai-page-block');delete el.dataset.wolaiPositions;});}}
  async handleRename(newPath, oldPath) {
    if (!this.data) return;
    const moved = (path) => typeof path === 'string' && (path === oldPath || path.startsWith(oldPath + '/'))
      ? newPath + path.slice(oldPath.length) : path;
    let changed = false;
    const nodes = {};
    for (const [path, node] of Object.entries(this.data.nodes)) {
      const next = { ...node, path: moved(path), children: node.children?.map(moved) };
      changed ||= next.path !== path;
      for (const key of ['databasePath', 'computedView', 'recordsFolder', 'cover']) {
        if (node[key]) {
          next[key] = moved(node[key]);
          changed ||= next[key] !== node[key];
        }
      }
      if (node.icon?.path && moved(node.icon.path) !== node.icon.path) {
        next.icon = { ...node.icon, path: moved(node.icon.path) };
        changed = true;
      }
      nodes[next.path] = next;
    }
    if (!changed) return;
    const blockPaths = Object.fromEntries(Object.entries(this.data.blockPaths).map(([id, path]) => [id, moved(path)]));
    const index = restrictIndexToImports({ ...this.data, nodes, roots: this.data.roots.map(moved), blockPaths });
    this.data = index;
    await this.saveData(index);
    this.refreshViews();
    this.decorateOpenViews();
  }

  removeIndexNode(path) {
    delete this.data.nodes[path];
    for (const node of Object.values(this.data.nodes)) {
      if (Array.isArray(node.children)) node.children = node.children.filter((child) => child !== path);
    }
    this.data.roots = this.data.roots.filter((root) => root !== path);
    for (const [id, owner] of Object.entries(this.data.blockPaths)) {
      if (owner === path) delete this.data.blockPaths[id];
    }
  }

  onExternalSettingsChange() {
    if (!this.activeImport) return this.reloadIndex();
  }

  async reloadIndex() {
    try {
      const saved = await this.loadData();
      const index = saved ?? { version: 1, roots: [], nodes: {}, blockPaths: {} };
      this.validateIndex(index);
      this.data = restrictIndexToImports(index);
      this.error = null;
    } catch (error) {
      this.error = '无法读取页面目录：' + error.message;
      new Notice(this.error);
    }
    this.refreshViews();
    this.decorateOpenViews();
    this.refreshMissingPageLinks();
  }

  expandRoot(path) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      if (leaf.view instanceof PagesView) leaf.view.expanded.add(path);
    }
  }

  validateIndex(data){
    if(!data||data.version!==1||!Array.isArray(data.roots)||!data.nodes||typeof data.nodes!=='object'||Array.isArray(data.nodes))throw new Error('页面索引缺失或格式错误');
    const hasNode=p=>typeof p==='string'&&Object.prototype.hasOwnProperty.call(data.nodes,p);
    for(const [path,n] of Object.entries(data.nodes)){
      if(!n||n.path!==path||typeof n.title!=='string'||n.children!=null&&!Array.isArray(n.children))throw new Error('页面定义不完整：'+path);
      for(const child of n.children||[])if(!hasNode(child))throw new Error('子页面定义缺失：'+child);
    }
    for(const root of data.roots)if(!hasNode(root))throw new Error('根页面定义缺失：'+root);
  }
  async saveData(data){
    this.validateIndex(data);
    await super.saveData(data);
  }
  errorBox(el,message,retry){el.empty();el.createDiv({text:message,cls:'wolai-error'});const b=el.createEl('button',{text:'重试'});b.onclick=retry;}
  refreshViews(){for(const leaf of this.app.workspace.getLeavesOfType(VIEW))if(leaf.view instanceof PagesView)leaf.view.render().catch(e=>{console.error('Wolai 页面导航刷新失败',e);new Notice('页面导航刷新失败：'+e.message+'。请重新打开页面导航后重试。');});}
  async reveal(focus=true){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeftLeaf(false);if(!leaf)return;await leaf.setViewState({type:VIEW,active:focus});}if(focus){if(typeof leaf.loadIfDeferred==='function')await leaf.loadIfDeferred();await this.app.workspace.revealLeaf(leaf);}}
  async renderWorkbook(source, el, ctx) {
    const card = el.createDiv({ cls: 'wolai-workbook' });
    try {
      const { path, name } = JSON.parse(source);
      if (typeof path !== 'string' || !/\.xlsx$/i.test(path) || typeof name !== 'string') throw new Error('Excel 附件定义无效');
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error('Excel 附件未找到');
      const heading = card.createDiv({ cls: 'wolai-workbook-controls' });
      heading.createEl('strong', { text: name });
      const preview = heading.createEl('button', { text: '预览表格' });
      const attachment = heading.createEl('a', { text: '打开附件', cls: 'internal-link', attr: { 'data-href': path, href: path } });
      attachment.onclick = (event) => {
        event.preventDefault();
        this.app.workspace.openLinkText(path, ctx.sourcePath, false);
      };
      const content = card.createDiv();
      let workbook;
      preview.onclick = async () => {
        if (!content.hidden && workbook) {
          content.hidden = true;
          preview.setText('预览表格');
          return;
        }
        content.hidden = false;
        preview.disabled = true;
        try {
          if (!workbook) {
            content.setText('正在读取 Excel…');
            const bytes = new Uint8Array(await this.app.vault.readBinary(file));
            const parser = new DOMParser();
            workbook = openWorkbook(bytes, (xml) => parser.parseFromString(xml, 'application/xml'));
            this.drawWorkbook(workbook, content);
          }
          preview.setText('收起预览');
        } catch (error) {
          workbook = undefined;
          content.setText('Excel 预览失败：' + error.message);
        } finally {
          preview.disabled = false;
        }
      };
    } catch (error) {
      card.createDiv({ cls: 'wolai-error', text: error.message });
    }
  }
  drawWorkbook(workbook, content) {
    content.empty();
    const toolbar = content.createDiv({ cls: 'wolai-workbook-controls' });
    const select = toolbar.createEl('select', { attr: { 'aria-label': 'Excel 工作表' } });
    workbook.sheets.forEach((name, index) => select.createEl('option', { text: name, value: String(index) }));
    const status = toolbar.createSpan({ cls: 'wolai-workbook-note', attr: { 'aria-live': 'polite' } });
    const grid = content.createDiv({ cls: 'wolai-content-table-scroll' });
    const paging = content.createDiv({ cls: 'wolai-workbook-controls' });
    const previous = paging.createEl('button', { text: '上一页' });
    const next = paging.createEl('button', { text: '下一页' });
    const pageSize = 40;
    let page = 0;
    const render = () => {
      grid.empty();
      try {
        const { rows, columns, truncatedColumns } = workbook.readSheet(Number(select.value));
        const first = page * pageSize;
        const last = Math.min(first + pageSize, rows.length);
        previous.disabled = !page;
        next.disabled = last >= rows.length;
        if (!rows.length) {
          status.setText('此工作表没有内容');
          return;
        }
        status.setText(`第 ${first + 1}–${last} 条，共 ${rows.length} 条${truncatedColumns ? ' · 仅预览前 64 列' : ''}`);
        const table = grid.createEl('table', { cls: 'wolai-content-table wolai-sheet-preview' });
        const header = table.createEl('thead').createEl('tr');
        header.createEl('th', { text: '行号', attr: { scope: 'col' } });
        for (let column = 1; column <= columns; column++) header.createEl('th', { text: columnLabel(column), attr: { scope: 'col' } });
        const body = table.createEl('tbody');
        for (const { number, cells } of rows.slice(first, last)) {
          const row = body.createEl('tr');
          row.createEl('th', { text: String(number), attr: { scope: 'row' } });
          for (let column = 1; column <= columns; column++) row.createEl('td', { text: cells.get(column) ?? '' });
        }
      } catch (error) {
        status.setText(error.message);
        previous.disabled = next.disabled = true;
      }
    };
    select.onchange = () => { page = 0; render(); };
    previous.onclick = () => { page--; render(); };
    next.onclick = () => { page++; render(); };
    content.createEl('p', { cls: 'wolai-workbook-note', text: '只读预览使用文件中已保存的值。完整格式和公式请查看原附件。' });
    render();
  }
  wireTasks(container,markdown,save){
    container.setAttribute('data-wolai-task-scope', '');
    const matches=[...markdown.matchAll(/^\s*[-*+] \[([ xX])\]/gm)];
    const inputs=[...container.querySelectorAll('input.task-list-item-checkbox')]
      .filter((input) => input.closest('[data-wolai-task-scope]') === container);
    if(!inputs.length)return;if(matches.length!==inputs.length){for(const input of inputs){input.disabled=true;input.title='任务位置无法唯一核验，请在编辑模式修改';}return;}
    inputs.forEach((input,index)=>{input.disabled=false;input.addEventListener('click',async event=>{event.preventDefault();event.stopImmediatePropagation();const checked=input.checked;input.disabled=true;const match=matches[index];const at=match.index+match[0].lastIndexOf('[')+1;const next=markdown.slice(0,at)+(checked?'x':' ')+markdown.slice(at+1);try{await save(next);input.checked=checked;}catch(e){new Notice('任务保存失败：'+e.message);}finally{input.disabled=false;}},true);});
  }
  async replaceBlock(ctx, kind, source, value) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) throw new Error('页面文件缺失');
    await this.app.vault.process(file, (text) => {
      let matches = 0;
      const replace = (markdown) => markdown.replace(/^([ \t]*)```(wolai-[a-z-]+)[ \t]*\r?\n([\s\S]*?)^\1```[ \t]*(?=\r?$)/gm, (fence, spaces, block, raw) => {
        const body = raw.split(/\r?\n/).map((line) => line.startsWith(spaces) ? line.slice(spaces.length) : line).join('\n').trimEnd();
        const format = (data) => `${spaces}\`\`\`${block}\n${spaces}${JSON.stringify(data)}\n${spaces}\`\`\``;
        if (block === kind && body === source.trimEnd()) {
          matches++;
          return format(value);
        }
        if (!['wolai-toggle', 'wolai-columns', 'wolai-table', 'wolai-styled'].includes(block)) return fence;
        const previous = matches;
        try {
          const data = JSON.parse(body, (key, item) => key === 'markdown' && typeof item === 'string' ? replace(item) : item);
          return matches === previous ? fence : format(data);
        } catch {
          return fence;
        }
      });
      const modified = replace(text);
      if (matches !== 1) throw new Error('页面内容已变化，请关闭编辑框后重试');
      return modified;
    });
  }
  async open(path,leaf){const f=this.app.vault.getAbstractFileByPath(path);if(!(f instanceof TFile)){new Notice('页面文件缺失，无法打开：'+path);return;}leaf??=this.app.workspace.getLeaf(false);await leaf.openFile(f);if(f.extension==='md')await leaf.setViewState({type:'markdown',state:{file:f.path,mode:'preview'}});}
  async onBreadcrumbClick(event){
    if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const crumb=event.target?.closest?.('.view-header-breadcrumb');if(!crumb)return;
    const leaf=this.app.workspace.getLeavesOfType('markdown').find(leaf=>leaf.view.headerEl.contains(crumb));if(!leaf)return;
    const view=leaf.view,file=view.file;if(!this.data?.nodes[file?.path])return;
    const crumbs=Array.from(view.titleParentEl.querySelectorAll('.view-header-breadcrumb'));const index=crumbs.indexOf(crumb);if(index<0)return;
    const folder=file.parent.path.split('/').slice(0,index+1).join('/');
    const pages=Object.values(this.data.nodes).filter(node=>node.type==='page'&&node.path.slice(0,node.path.lastIndexOf('/'))===folder);
    const page=pages.find(node=>node.path===folder+'/'+folder.split('/').pop()+'.md')||(pages.length===1?pages[0]:null);if(!page)return;
    event.preventDefault();event.stopImmediatePropagation();
    await this.open(page.path,leaf);await this.reveal();this.app.workspace.setActiveLeaf(leaf,{focus:true});this.refreshViews();
  }
  iconType(icon){
    if(!icon||typeof icon!=='object')return null;
    if(['emoji','image','date','elapsed'].includes(icon.type))return icon.type;
    if(icon.emoji)return 'emoji';
    if(icon.path)return 'image';
    return null;
  }
  iconImageSrc(icon){
    const p=icon?.path;if(!p)return null;
    if(/^https?:\/\//i.test(p))return p;
    const f=this.app.vault.getAbstractFileByPath(p)||this.app.vault.getAbstractFileByPath(p.replace(/^\//,''));
    return f instanceof TFile?this.app.vault.getResourcePath(f):null;
  }
  iconDynamicText(icon,opts){
    const m=window.moment,compact=!!(opts&&opts.compact);
    if(icon.type==='date'){
      const d=(!icon.date||icon.date==='today')?m():m(icon.date,'YYYY-MM-DD',true);
      if(!d.isValid())return '⚠';
      return d.format(compact?'M/D':(icon.format||'YYYY/MM/DD'));
    }
    if(icon.type!=='elapsed')return '';
    const d=m(icon.date,'YYYY-MM-DD',true);if(!d.isValid())return '⚠';
    const unit=icon.unit||'day';
    const today=m().startOf('day'),target=d.clone().startOf('day');
    const delta=unit==='day'?Math.round(target.diff(today,'days')):target.diff(today,unit);
    let dir=icon.direction||'auto';
    if(dir==='auto')dir=delta>0?'until':'since';
    const value=dir==='until'?Math.max(delta,0):Math.max(-delta,0);
    if(compact)return String(value);
    const prefix=typeof icon.prefix==='string'?icon.prefix:(dir==='until'?'还有 ':'已过 ');
    const suffix=typeof icon.suffix==='string'?icon.suffix:({day:'天',month:'个月',year:'年'}[unit]||'');
    return prefix+value+suffix;
  }
  iconCalendarModel(icon){
    const m=window.moment;
    if(icon.type==='date'){
      const d=(!icon.date||icon.date==='today')?m():m(icon.date,'YYYY-MM-DD',true);
      if(!d.isValid())return null;
      return {year:d.format('YYYY'),monthDay:d.format('MM-DD'),big:d.format('D'),desc:'周'+['日','一','二','三','四','五','六'][d.day()]};
    }
    if(icon.type!=='elapsed')return null;
    const d=m(icon.date,'YYYY-MM-DD',true);if(!d.isValid())return null;
    const unit=icon.unit||'day';
    const today=m().startOf('day'),target=d.clone().startOf('day');
    const delta=unit==='day'?Math.round(target.diff(today,'days')):target.diff(today,unit);
    let dir=icon.direction||'auto';
    if(dir==='auto')dir=delta>0?'until':'since';
    const value=dir==='until'?Math.max(delta,0):Math.max(-delta,0);
    const unitWord={day:'',month:'个月',year:'年'}[unit]||'';
    const prefix=typeof icon.prefix==='string'?icon.prefix:(dir==='until'?'还有':'已过');
    const suffix=typeof icon.suffix==='string'?icon.suffix:unitWord;
    return {year:d.format('YYYY'),monthDay:d.format('MM-DD'),big:String(value),desc:(prefix.trim()+suffix).trim()};
  }
  calendarSvg(model){
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const big=String(model.big==null?'':model.big);
    const bigSize=big.length>4?Math.max(96,Math.round(200*4/big.length)):200;
    const font="font-family=\"-apple-system, BlinkMacSystemFont, 'Noto Sans', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif, 'Segoe UI', Roboto, 'Helvetica Neue', Arial\"";
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Calendar">'
      +'<path d="M512,454.847248 C512,486.933004 487,512 455,512 L57,512 C25,512 0,486.933004 0,454.847248 L0,126.970934 C0,95.8878582 25,69.8181818 57,69.8181818 L455,69.8181818 C487,69.8181818 512,95.8878582 512,126.970934 L512,454.847248 Z" fill="#EFEFEF" fill-rule="nonzero"></path>'
      +'<path d="M484,0 L437,0 L28,0 C13,0 0,13.0830467 0,28.1788698 L0,186.181818 L512,186.181818 L512,28.1788698 C512,13.0830467 499,0 484,0 Z" fill="#cf5659" fill-rule="nonzero"></path>'
      +'<text id="days" x="256" y="420" fill="#66757F" fill-rule="nonzero" '+font+' font-size="'+bigSize+'" font-weight="normal" text-anchor="middle">'+esc(big)+'</text>'
      +'<text id="year" x="54.3030303" y="81.5151515" fill="#FFFFFF" fill-rule="nonzero" '+font+' font-size="62.0606061" font-weight="normal">'+esc(model.year)+'</text>'
      +'<text id="month-day" x="54.3030303" y="159.575758" fill="#FFFFFF" '+font+' font-size="77.5757576" font-weight="normal">'+esc(model.monthDay)+'</text>'
      +'<text id="desc" x="458" y="153.090909" fill="#FFFFFF" '+font+' font-size="62.0606061" font-weight="normal" text-anchor="end">'+esc(model.desc)+'</text>'
      +'</svg>';
    try{return document.importNode(new DOMParser().parseFromString(svg,'image/svg+xml').documentElement,true);}catch(e){return null;}
  }
  renderIcon(el,icon,fallback,opts){
    const type=this.iconType(icon);
    if(type==='emoji'){el.setText(icon.emoji);return;}
    if(type==='image'){
      const src=this.iconImageSrc(icon);
      if(src){el.createEl('img',{attr:{src,alt:''}});return;}
      el.setText('⚠');el.title='图标文件缺失';return;
    }
    if(type==='date'||type==='elapsed'){
      const compact=!!(opts&&opts.compact);
      el.dataset.wolaiIcon=JSON.stringify(icon);
      el.dataset.wolaiIconCompact=compact?'1':'0';
      el.addClass('wolai-icon-dynamic');
      this.paintDynamicIcon(el,icon,compact);
      return;
    }
    setIcon(el,fallback);
  }
  paintDynamicIcon(el,icon,compact){
    const text=this.iconDynamicText(icon,{compact});
    const model=icon.style==='text'?null:this.iconCalendarModel(icon);
    const svg=model?this.calendarSvg(model):null;
    el.empty();
    el.title=this.iconDynamicText(icon);
    el.toggleClass('wolai-icon-calendar',!!svg);
    if(svg){el.appendChild(svg);return;}
    el.setText(text||'⚠');
  }
  refreshDynamicIcons(){
    for(const el of document.querySelectorAll('[data-wolai-icon]')){
      try{
        const icon=JSON.parse(el.dataset.wolaiIcon);
        const compact=el.dataset.wolaiIconCompact==='1';
        const model=icon.style==='text'?null:this.iconCalendarModel(icon);
        const sig=JSON.stringify(model||this.iconDynamicText(icon,{compact}));
        if(el.dataset.wolaiIconPainted===sig)continue;
        el.dataset.wolaiIconPainted=sig;
        this.paintDynamicIcon(el,icon,compact);
      }catch(e){}
    }
  }
  redrawOpenViews(){
    for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
      const view=leaf.view;if(!view)continue;
      try{
        view.containerEl.querySelectorAll('.wolai-header,.wolai-actions').forEach(el=>el.remove());
        view.containerEl.querySelectorAll('h1').forEach(h=>{delete h.dataset.wolaiHeader;});
        if(view.previewMode&&typeof view.previewMode.rerender==='function')view.previewMode.rerender(true);
      }catch(e){console.error('[wolai-local] 页面重绘失败',e);}
    }
  }
  openIconPicker(pagePath){
    if(!this.data?.nodes[pagePath]){new Notice('页面定义缺失，请重新读取页面导航');return;}
    new IconPickerModal(this.app,this,pagePath).open();
  }
  openButtonBuilder(pagePath){
    if(!this.data?.nodes[pagePath]){new Notice('页面定义缺失，请重新读取页面导航');return;}
    new ButtonBuilderModal(this.app,this,pagePath).open();
  }
  async setIcon(pagePath,icon){
    const node=this.data?.nodes[pagePath];if(!node)throw new Error('页面定义缺失');
    const before=JSON.stringify(node.icon||null);
    if(icon)node.icon=icon;else delete node.icon;
    if(JSON.stringify(node.icon||null)===before)return;
    await this.saveData(this.data);
    this.refreshViews();this.decorateOpenViews();this.redrawOpenViews();
  }
  listTemplates(){
    return this.app.vault.getFiles().filter(f=>f.extension==='md'&&normalizePath(f.path).startsWith('_wolai/templates/')).map(f=>f.path).sort();
  }
  async createTemplate(name,content){
    const folder='_wolai/templates';
    if(!this.app.vault.getAbstractFileByPath(folder))await this.app.vault.createFolder(folder);
    let path=normalizePath(folder+'/'+this.safeName(name)+'.md'),i=2;
    while(this.app.vault.getAbstractFileByPath(path))path=normalizePath(folder+'/'+this.safeName(name)+' '+(i++)+'.md');
    await this.app.vault.create(path,content);
    return path;
  }
  async newButton(pagePath,cfg){
    const node=this.data?.nodes[pagePath];if(!node)throw new Error('页面定义缺失');
    if(!['page','record'].includes(node.type))throw new Error('该类型页面暂不支持插入按钮');
    const file=this.app.vault.getAbstractFileByPath(pagePath);if(!(file instanceof TFile))throw new Error('页面文件缺失');
    if(!cfg||!cfg.name)throw new Error('按钮名称不能为空');
    const block='```wolai-template\n'+JSON.stringify(cfg)+'\n```';
    await this.app.vault.process(file,body=>body.trimEnd()+'\n\n'+block+'\n');
    this.refreshViews();this.redrawOpenViews();
  }
  visiblePagePaths(paths,seen=new Set()){
    const visible=[];
    for(const path of paths){
      const node=this.data?.nodes[path];if(!node||seen.has(path))continue;seen.add(path);
      if(this.app.vault.getAbstractFileByPath(path) instanceof TFile)visible.push(path);
      else visible.push(...this.visiblePagePaths(node.children||[],seen));
    }
    return visible;
  }
  isMissingChildPageLink(sourcePath,href){
    const parent=this.data?.nodes[sourcePath];
    if(!parent||!['page','record'].includes(parent.type)||typeof href!=='string')return false;
    const target=href.split('#')[0].trim();
    if(!target||/^[a-z][a-z0-9+.-]*:/i.test(target))return false;
    if(this.app.metadataCache.getFirstLinkpathDest(target,sourcePath) instanceof TFile)return false;
    const dir=sourcePath.includes('/')?sourcePath.slice(0,sourcePath.lastIndexOf('/')):'';
    const pageName=sourcePath.split('/').pop().replace(/\.md$/i,'');
    const base=parent.type==='record'?[dir,pageName].filter(Boolean).join('/'):dir;
    const canonical=p=>{
      const parts=[];
      for(const part of p.replace(/\\/g,'/').split('/')){
        if(!part||part==='.')continue;
        if(part==='..'){if(!parts.length)return null;parts.pop();}else parts.push(part);
      }
      const path=parts.join('/');return /\.(md|base)$/i.test(path)?path:path+'.md';
    };
    const candidates=[canonical(target),canonical([dir,target].filter(Boolean).join('/'))].filter(Boolean);
    if(candidates.some(p=>this.app.vault.getAbstractFileByPath(p) instanceof TFile))return false;
    return candidates.some(path=>{
      if(parent.children?.includes(path))return true;
      if(base&&!path.startsWith(base+'/'))return false;
      const relative=base?path.slice(base.length+1):path;
      const parts=relative.split('/');
      // A standalone <child>/<child>.md link is a Wolai child-page entry,
      // including when an offline deletion has already removed its index node.
      return parts.length===2&&parts[1]===parts[0]+'.md';
    });
  }
  updateMissingPageLinks(el,sourcePath){
    el.classList.remove('wolai-missing-page-block');
    el.querySelectorAll('.wolai-missing-page-link,.wolai-missing-page-block').forEach(item=>item.classList.remove('wolai-missing-page-link','wolai-missing-page-block'));
    for(const link of el.querySelectorAll('a.internal-link')){
      const paragraph=link.parentElement;
      if(paragraph?.tagName!=='P')continue;
      const standalone=[...paragraph.childNodes].every(node=>node===link||(node.nodeType===3&&!node.textContent.trim())||(node.nodeType===1&&node.classList.contains('passage-ai-badge')));
      if(!standalone||!this.isMissingChildPageLink(sourcePath,link.getAttribute('data-href')))continue;
      paragraph.classList.add('wolai-missing-page-link');
      if(paragraph.parentElement?.classList.contains('el-p'))paragraph.parentElement.classList.add('wolai-missing-page-block');
    }
  }
  refreshMissingPageLinks(){
    for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
      const view=leaf.view;if(!view?.file)continue;
      const preview=view.containerEl.querySelector('.markdown-preview-view');
      if(preview)this.updateMissingPageLinks(preview,view.file.path);
    }
  }
  async decorateSection(el,ctx){
    const n=this.data?.nodes[ctx.sourcePath];if(!n||n.type==='database')return;
    this.updateMissingPageLinks(el,ctx.sourcePath);
    if(el.classList.contains('wolai-missing-page-block'))return;
    await this.decoratePagePositions(el,ctx);
    for(const a of el.querySelectorAll('a.internal-link')){const target=a.getAttribute('data-href')?.split('#')[0];const file=this.app.metadataCache.getFirstLinkpathDest(target||'',ctx.sourcePath);const child=this.data.nodes[file?.path]||this.data.nodes[target];if(child&&n.children?.includes(child.path)&&!a.dataset.wolaiPage){a.dataset.wolaiPage='1';a.addClass('wolai-child-link');const icon=document.createElement('span');icon.className='wolai-page-icon';this.renderIcon(icon,child.icon,child.type==='database'?'table-2':'file-text',{compact:true});a.prepend(icon);}}
    const h=el.querySelector('h1');if(!h||h.dataset.wolaiHeader)return;if(n.type==='record'){const db=this.data.nodes[n.databasePath];const primary=db?.schema?.find(c=>c.type==='primary');const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);const title=file&&primary?this.app.metadataCache.getFileCache(file)?.frontmatter?.[primary.name]:null;if(typeof title==='string'&&title.trim())h.setText(title);}
    const info=ctx.getSectionInfo(el);
    if(n.type==='page'&&(n.settings?.wolai_export_layout ? info?.lineStart!==0 : info&&info.lineStart>30))return;
    h.dataset.wolaiHeader='1';
    const host=el.createDiv({cls:'wolai-header'});h.before(host);
    if(n.cover){
      const file=this.app.vault.getAbstractFileByPath(n.cover);
      const url=file instanceof TFile?this.app.vault.getResourcePath(file):(/^https?:\/\//.test(n.cover)?n.cover:null);
      const slot=host.createDiv();
      const renderCover=()=>{
        slot.empty();
        const cover=slot.createEl('img',{cls:'wolai-cover',attr:{alt:''}});
        if(n.settings?.cover_position)cover.style.objectPosition='center '+n.settings.cover_position;
        cover.onerror=()=>this.errorBox(slot,'封面无法加载',renderCover);
        cover.src=url;
      };
      if(url)renderCover();
      else slot.createDiv({text:'封面文件缺失',cls:'wolai-error'});
    }
    if(n.icon){const i=host.createDiv({cls:'wolai-heading-icon'});this.renderIcon(i,n.icon,'file-text');i.title='点击修改图标';i.onclick=()=>this.openIconPicker(ctx.sourcePath);}
    else{const i=host.createDiv({cls:'wolai-heading-icon is-empty'});setIcon(i.createSpan({cls:'wolai-icon-blank'}),'image-plus');i.title='点击添加图标';i.onclick=()=>this.openIconPicker(ctx.sourcePath);}
    const actions=el.createDiv({cls:'wolai-actions'});h.after(actions);
    const newChild=actions.createEl('button',{text:'+ 子页面'});newChild.onclick=()=>this.newChild(ctx.sourcePath);
    if(n.type==='page'||n.type==='record'){const newBtn=actions.createEl('button',{text:'+ 按钮'});newBtn.onclick=()=>this.openButtonBuilder(ctx.sourcePath);}
    if(n.type==='record'){
      actions.remove();const db=this.data.nodes[n.databasePath];
      for(const issue of n.dataErrors||[])el.createDiv({text:issue.message,cls:'wolai-error'});
      if(db?.formulaError){el.createDiv({text:db.formulaError,cls:'wolai-error'});}else if(db?.computedView){const computed=el.createDiv({cls:'wolai-record-computed'});h.after(computed);const child=new MarkdownRenderChild(computed);ctx.addChild(child);if(db.snapshotColumns?.length)computed.createDiv({text:'以下字段保留迁移时的 wolai 计算结果，修改输入不会自动重算。',cls:'wolai-snapshot-warning'});try{await MarkdownRenderer.render(this.app,'![[ '+db.computedView+' ]]'.replace('![[ ','![[').replace(' ]]',']]'),computed,ctx.sourcePath,child);}catch(e){this.errorBox(computed,'计算字段加载失败：'+e.message,()=>this.open(ctx.sourcePath));}}
      if(n.databasePath){const back=el.createEl('a',{text:'← 返回表格',cls:'wolai-record-back'});back.onclick=()=>this.open(n.databasePath);h.before(back);}}
  }
  decorateOpenViews(){for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
    const view=leaf.view,n=this.data?.nodes[view.file?.path];view.containerEl.dataset.wolaiDatabase=n?.databasePath?this.data.nodes[n.databasePath]?.sourceId||'':'';view.containerEl.toggleClass('wolai-view',!!n);view.containerEl.toggleClass('wolai-record',n?.type==='record');view.containerEl.toggleClass('wolai-full-width',!!n?.settings?.is_full_width);view.containerEl.toggleClass('wolai-small-text',!!n?.settings?.is_small_text);view.containerEl.toggleClass('wolai-export-layout',!!n?.settings?.wolai_export_layout);
  }}
  async syncComputedView(node){
    try{const source=this.app.vault.getAbstractFileByPath(node.path),target=this.app.vault.getAbstractFileByPath(node.computedView);if(!(source instanceof TFile)||!(target instanceof TFile))throw new Error('原表或计算视图文件缺失');const cfg=parseYaml(await this.app.vault.read(source));if(!cfg?.formulas||typeof cfg.formulas!=='object'||Object.values(cfg.formulas).some(v=>typeof v!=='string'))throw new Error('原表公式定义无效');const order=cfg.views?.[0]?.order;if(!Array.isArray(order)||order.some(k=>typeof k!=='string'))throw new Error('原表列顺序缺失或无效');const visible=order.filter(k=>k.startsWith('formula.'));if(visible.some(k=>!Object.prototype.hasOwnProperty.call(cfg.formulas,k.slice(8))))throw new Error('原表包含未定义的计算字段');const properties={};for(const [name,value] of Object.entries(cfg.properties||{}))if(name.startsWith('formula.'))properties[name]=value;const next=stringifyYaml({filters:{and:['file.path == this.file.path']},formulas:cfg.formulas,properties,views:[{type:'table',name:'计算字段',order:visible}]});if(next!==await this.app.vault.read(target))await this.app.vault.modify(target,next);delete node.formulaError;}
    catch(e){node.formulaError='计算字段更新失败：'+e.message+'。请修复原表后重试。';await this.saveData(this.data);throw e;}
  }
  safeName(title){const s=title.replace(/[\\/:*?"<>|#^\[\]\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();if(!s)throw new Error('页面名称没有可用的文件名字符');return s;}
  async ensureFolder(path){if(!path)return;const pieces=path.split('/');let current='';for(const piece of pieces){current=current?current+'/'+piece:piece;if(!this.app.vault.getAbstractFileByPath(current))await this.app.vault.createFolder(current);}}
  newChild(parentPath,position=null){const modal=new NameModal(this.app,'新建子页面',title=>this.createChild(parentPath,title,position));modal.open();return modal;}
  async createChild(parentPath,title,position=null){
    const parent=this.data?.nodes[parentPath];if(!parent)throw new Error('父页面定义缺失');if(!['page','record'].includes(parent.type))throw new Error('请使用表格的新增记录操作');
    const file=this.app.vault.getAbstractFileByPath(parentPath);if(!(file instanceof TFile))throw new Error('父页面文件缺失');
    if(position)this.checkPagePosition(await this.app.vault.read(file),position);
    const baseFolder=parent.type==='record'?normalizePath(file.parent.path+'/'+file.basename):file.parent.path;
    let folder=normalizePath(baseFolder+'/'+this.safeName(title)),i=2;while(this.app.vault.getAbstractFileByPath(folder))folder=normalizePath(baseFolder+'/'+this.safeName(title)+' '+i++);
    const path=folder+'/'+folder.split('/').pop()+'.md';await this.ensureFolder(folder);const n=await this.app.vault.create(path,'# '+title+'\n\n');
    let nextBody;
    try{await this.app.vault.process(file,text=>{
      const link='[['+path.slice(0,-3)+'|'+title.replace(/[\]|]/g,' ')+']]';
      if(position)this.checkPagePosition(text,position);
      nextBody=position?this.insertPageBlock(text,link,position.at):this.insertChildLink(text,link,parentPath);return nextBody;
    });}catch(e){
      // Only undo the new, unindexed file if the parent changed while the modal was open.
      await this.app.vault.delete(n,true);const createdFolder=this.app.vault.getAbstractFileByPath(folder);
      if(createdFolder?.children?.length===0)await this.app.vault.delete(createdFolder,true);throw e;
    }
    this.data.nodes[path]={path,title,type:'page',children:[]};parent.children??=[];parent.children.unshift(path);
    if(position)this.syncBodyChildOrder(parentPath,nextBody);
    await this.saveData(this.data);await this.open(n.path);this.refreshViews();return n;
  }
  pageBlockRange(info){
    if(!info||typeof info.text!=='string'||!Number.isInteger(info.lineStart)||!Number.isInteger(info.lineEnd)||info.lineStart<0||info.lineEnd<info.lineStart)return null;
    const lines=info.text.split('\n');if(info.lineEnd>=lines.length)return null;
    let start=0;for(let i=0;i<info.lineStart;i++)start+=lines[i].length+1;
    let end=start;for(let i=info.lineStart;i<info.lineEnd;i++)end+=lines[i].length+1;
    end+=lines[info.lineEnd].replace(/\r$/,'').length;
    // Obsidian excludes the trailing block ID from a section's source range.
    const id=/^(?:\r?\n)[\t \r\n]*\^[A-Za-z0-9-]+[\t ]*(?=\r?\n|$)/.exec(info.text.slice(end));
    if(id)end+=id[0].length;
    return {expected:info.text,start,end};
  }
  checkPagePosition(body,position){
    if(body!==position.expected)throw new Error('页面内容已变化，请回到父页面重新选择位置');
    if(!Number.isInteger(position.at)||position.at<0||position.at>body.length)throw new Error('插入位置无效');
  }
  insertPageBlock(body,block,at){
    const newline=body.includes('\r\n')?'\r\n':'\n',left=body.slice(0,at),right=body.slice(at);
    const before=(left.match(/(?:\r?\n)*$/)?.[0].match(/\n/g)||[]).length;
    const after=(right.match(/^(?:\r?\n)*/)?.[0].match(/\n/g)||[]).length;
    return left+(left?newline.repeat(Math.max(0,2-before)):'')+block+(right?newline.repeat(Math.max(0,2-after)):newline)+right;
  }
  pageLinkPath(body,range,parentPath){
    const source=body.slice(range.start,range.end).replace(/\r/g,'');
    const m=/^\[\[([^\]|#]+)(?:\|[^\]\n]*)?\]\](?:[\t ]+\^[A-Za-z0-9-]+)?(?:\n[\t \n]*\^[A-Za-z0-9-]+[\t ]*)?$/.exec(source);
    if(!m)return null;
    const file=this.app.metadataCache.getFirstLinkpathDest(m[1].trim(),parentPath);
    const path=file?.path||normalizePath(m[1].trim().replace(/\.md$/i,'')+'.md');
    return this.data?.nodes[parentPath]?.children?.includes(path)&&this.data.nodes[path]?.type==='page'?path:null;
  }
  async refreshBodyChildOrders(){
    const data=this.data;if(!data)return;
    const cache=this.bodyOrderCache??=new Map();
    const parents=Object.values(data.nodes).filter(n=>['page','record'].includes(n.type)&&n.children?.length);
    const signature=file=>file.stat.mtime+':'+file.stat.size;
    // Cache reads, not the derived order: newly synced children and a reloaded
    // shared index must be reconciled against the same authoritative body again.
    const refresh=async parent=>{
      const file=this.app.vault.getAbstractFileByPath(parent.path);
      if(!(file instanceof TFile))return;
      const stamp=signature(file);let entry=cache.get(file.path);
      if(!entry||entry.file!==file||entry.stamp!==stamp){
        entry={file,stamp};cache.set(file.path,entry);
        entry.read=this.app.vault.cachedRead(file).catch(error=>{
          if(cache.get(file.path)===entry)cache.delete(file.path);
          console.warn('[wolai-local] 页面顺序读取暂不可用',file.path,error);return null;
        });
      }
      const body=await entry.read;
      if(this.data!==data||cache.get(file.path)!==entry||signature(file)!==stamp||this.app.vault.getAbstractFileByPath(file.path)!==file||typeof body!=='string')return;
      this.syncBodyChildOrder(parent.path,body);
    };
    for(let i=0;i<parents.length;i+=8){
      if(this.data!==data)return;
      await Promise.all(parents.slice(i,i+8).map(refresh));
    }
    // This is a local navigation repair; never save a partially synced index.
  }
  childLinkTarget(target,parentPath,children){
    const file=this.app.metadataCache.getFirstLinkpathDest(target,parentPath);
    if(file&&children.has(file.path))return file.path;
    const dir=parentPath.includes('/')?parentPath.slice(0,parentPath.lastIndexOf('/')):'';
    for(const candidate of [target,[dir,target].filter(Boolean).join('/')]){
      const parts=[];let invalid=false;
      for(const part of candidate.replace(/\\/g,'/').split('/')){
        if(!part||part==='.')continue;
        if(part==='..'){if(!parts.length){invalid=true;break;}parts.pop();}else parts.push(part);
      }
      if(invalid)continue;
      let path=parts.join('/');if(!/\.(md|base)$/i.test(path))path+='.md';
      if(children.has(path))return path;
    }
    return null;
  }
  syncBodyChildOrder(parentPath,body){
    const parent=this.data?.nodes[parentPath];if(!parent||!['page','record'].includes(parent.type)||!parent.children?.length)return false;
    const children=new Set(parent.children),ordered=[];let fence=null,frontmatter=false;
    for(const [index,line] of body.split(/\r?\n/).entries()){
      if(index===0&&line==='---'){frontmatter=true;continue;}
      if(frontmatter){if(line==='---'||line==='...')frontmatter=false;continue;}
      const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;continue;}
      if(marker){fence=marker[1];continue;}
      const link=/^ {0,3}(?:[-*+] )?\[\[([^\]|#]+)(?:\|[^\]]*)?\]\](?:[\t ]+\^[A-Za-z0-9-]+)?[\t ]*$/.exec(line);
      if(!link)continue;
      const path=this.childLinkTarget(link[1].trim(),parentPath,children);
      if(children.has(path)&&!ordered.includes(path))ordered.push(path);
    }
    const next=[...ordered,...parent.children.filter(path=>!ordered.includes(path))];
    if(next.every((path,index)=>path===parent.children[index]))return false;
    parent.children.splice(0,parent.children.length,...next);return true;
  }
  async movePageLink(parentPath,dragged,destination){
    const parent=this.data?.nodes[parentPath],file=this.app.vault.getAbstractFileByPath(parentPath);
    if(dragged.parentPath!==parentPath||!parent?.children?.includes(dragged.childPath)||!(file instanceof TFile))throw new Error('父页面或子页面已变化');
    let nextBody;
    await this.app.vault.process(file,body=>{
      this.checkPagePosition(body,destination);
      if(dragged.expected!==body||this.pageLinkPath(body,dragged,parentPath)!==dragged.childPath)throw new Error('子页面入口已变化，请重新拖动');
      const end=dragged.end+(/^(?:[\t ]*\r?\n)+/.exec(body.slice(dragged.end))?.[0].length||0);
      if(destination.at>=dragged.start&&destination.at<=end){nextBody=body;return body;}
      const block=body.slice(dragged.start,dragged.end),rest=body.slice(0,dragged.start)+body.slice(end);
      const at=destination.at>end?destination.at-(end-dragged.start):destination.at;
      nextBody=this.insertPageBlock(rest,block,at);return nextBody;
    });
    if(this.syncBodyChildOrder(parentPath,nextBody))await this.saveData(this.data);
    this.refreshViews();
  }
  clearPageDrag(){
    this.pageDrag=null;this.app.workspace.containerEl.removeClass('wolai-page-moving');this.app.workspace.containerEl.querySelectorAll('.wolai-drop-before,.wolai-drop-after,.wolai-page-dragging').forEach(el=>el.removeClass('wolai-drop-before','wolai-drop-after','wolai-page-dragging'));
  }
  async decoratePagePositions(el,ctx){
    if(el.dataset.wolaiPositions||!['page','record'].includes(this.data?.nodes[ctx.sourcePath]?.type))return;
    if(![...el.classList].some(name=>name.startsWith('el-'))||el.closest('.markdown-embed'))return;
    const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);if(!(file instanceof TFile))return;
    const body=await this.app.vault.cachedRead(file);
    const initial=this.pageBlockRange(ctx.getSectionInfo(el));if(!initial||!initial.expected.slice(initial.start,initial.end).trim()||el.classList.contains('mod-ui'))return;
    // Nested renderers use a fragment, not the file's source line coordinates.
    if(initial.expected!==body)return;
    el.dataset.wolaiPositions='1';el.addClass('wolai-page-block');
    const controls=new MarkdownRenderChild(el);ctx.addChild(controls);
    el.createDiv({cls:'wolai-page-drop-zone',attr:{'aria-hidden':'true'}});
    const location=()=>{
      if(!el.isConnected||!el.parentElement?.classList.contains('markdown-preview-sizer'))throw new Error('页面视图已变化，请重新选择位置');
      const range=this.pageBlockRange(ctx.getSectionInfo(el));if(!range)throw new Error('无法读取正文位置');return range;
    };
    const insert=el.createEl('button',{cls:'wolai-insert-page',attr:{type:'button',title:'在此处新建子页面','aria-label':'在此处新建子页面'}});setIcon(insert,'plus');
    insert.onclick=event=>{event.preventDefault();event.stopPropagation();try{const range=location();this.newChild(ctx.sourcePath,{expected:range.expected,at:range.end});}catch(e){new Notice(e.message);}};
    const childPath=this.pageLinkPath(initial.expected,initial,ctx.sourcePath);
    if(childPath){
      const handle=el.createEl('button',{cls:'wolai-page-drag-handle',attr:{type:'button',draggable:'true',title:'拖动调整子页面位置','aria-label':'拖动调整子页面位置'}});setIcon(handle,'grip-vertical');
      handle.onclick=event=>{event.preventDefault();event.stopPropagation();};
      handle.ondragstart=event=>{try{const range=location();if(this.pageLinkPath(range.expected,range,ctx.sourcePath)!==childPath)throw new Error('子页面入口已变化，请重新拖动');this.pageDrag={...range,childPath,parentPath:ctx.sourcePath};event.dataTransfer.setData('application/x-wolai-page-link',childPath);event.dataTransfer.effectAllowed='move';this.app.workspace.containerEl.addClass('wolai-page-moving');el.addClass('wolai-page-dragging');event.stopPropagation();}catch(e){event.preventDefault();new Notice(e.message);}};
      handle.ondragend=()=>this.clearPageDrag();
    }
    const dropSide=event=>el.querySelector('h1[data-wolai-header]')?'after':event.clientY<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2?'before':'after';
    controls.registerDomEvent(el,'dragover',event=>{
      if(this.pageDrag?.parentPath!==ctx.sourcePath)return;
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';
      this.app.workspace.containerEl.querySelectorAll('.wolai-drop-before,.wolai-drop-after').forEach(other=>other.removeClass('wolai-drop-before','wolai-drop-after'));
      el.addClass('wolai-drop-'+dropSide(event));
    });
    controls.registerDomEvent(el,'dragleave',event=>{if(!el.contains(event.relatedTarget))el.removeClass('wolai-drop-before','wolai-drop-after');});
    controls.registerDomEvent(el,'drop',event=>{
      if(this.pageDrag?.parentPath!==ctx.sourcePath)return;
      event.preventDefault();event.stopPropagation();const dragged=this.pageDrag;
      try{const range=location(),at=dropSide(event)==='before'?range.start:range.end;this.movePageLink(ctx.sourcePath,dragged,{expected:range.expected,at}).catch(e=>new Notice('移动失败：'+e.message));}
      catch(e){new Notice('移动失败：'+e.message);}finally{this.clearPageDrag();}
    });
  }
  newRecord(basePath){const node=this.data?.nodes[basePath];if(!node?.schema||!node.recordsFolder){new Notice('原始表格字段尚未核验，暂不能创建记录');return;}
    new NameModal(this.app,'新增 '+node.title+' 记录',async title=>{
      if(this.error||!this.data||this.data.nodes[basePath]!==node)throw new Error('页面目录已变化或读取失败，请关闭后重新打开新增记录');
      const primary=node.schema.find(c=>c.type==='primary');if(!primary)throw new Error('表格缺少主字段定义');
      const props={_wolai_database:node.sourceId,_wolai_order:Date.now()};for(const c of node.schema){if(['created_time','last_edited_time'].includes(c.type)){props[c.name]=new Date().toISOString();continue;}if(['formula','rollup','created_by','last_edited_by'].includes(c.type))continue;props[c.name]=c.name===primary.name?title:null;}
      let path=normalizePath(node.recordsFolder+'/'+this.safeName(title)+'.md'),i=2;while(this.app.vault.getAbstractFileByPath(path))path=normalizePath(node.recordsFolder+'/'+this.safeName(title)+' '+(i++)+'.md');
      await this.ensureFolder(node.recordsFolder);const f=await this.app.vault.create(path,'---\n'+stringifyYaml(props)+'---\n\n# '+title+'\n\n');
      this.data.nodes[path]={path,title,type:'record',databasePath:basePath,children:[]};node.children??=[];node.children.push(path);await this.saveData(this.data);await this.open(f.path);this.refreshViews();
    }).open();
  }
  async createFormRecord(node,values){
    if(this.error||!this.data||this.data.nodes[node.path]!==node)throw new Error('页面目录已变化或读取失败，请重新读取页面导航后重试');
    if(!node.schema||!node.recordsFolder)throw new Error('表格字段定义缺失');const props={_wolai_database:node.sourceId,_wolai_order:Date.now()};for(const col of node.schema){if(['created_time','last_edited_time'].includes(col.type)){props[col.name]=new Date().toISOString();continue;}if(['formula','rollup','created_by','last_edited_by'].includes(col.type))continue;props[col.name]=Object.prototype.hasOwnProperty.call(values,col.name)?values[col.name]:null;}
    const primary=node.schema.find(c=>c.type==='primary');if(!primary)throw new Error('主字段定义缺失');const title=props[primary.name];const filename=title?this.safeName(title):'记录 '+window.moment().format('YYYYMMDD-HHmmss');let path=normalizePath(node.recordsFolder+'/'+filename+'.md'),i=2;while(this.app.vault.getAbstractFileByPath(path))path=normalizePath(node.recordsFolder+'/'+filename+' '+(i++)+'.md');
    await this.ensureFolder(node.recordsFolder);const file=await this.app.vault.create(path,'---\n'+stringifyYaml(props)+'---\n\n# '+(title||'新页面')+'\n\n');this.data.nodes[path]={path,title:title||'新页面',type:'record',databasePath:node.path,children:[]};node.children??=[];node.children.push(path);await this.saveData(this.data);this.refreshViews();return file;
  }
  childLinkInsertIndex(body,parentPath){
    const parent=this.data?.nodes[parentPath];
    if(!parent)return -1;
    const kids=new Set(parent.children||[]);
    // 子页面固定放在父页面同名目录下。即使索引里暂时没有（例如刚在别的设备建好、
    // 配置还没同步过来），只要链接落在该目录内就仍按子页面条目处理，
    // 否则新的子页面会插到这些链接「下面」，看起来就不在最前了。
    const dir=parentPath.includes('/')?parentPath.slice(0,parentPath.lastIndexOf('/')):'';
    for(const m of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)){
      const target=m[1].trim();
      const cand=target.toLowerCase().endsWith('.md')?normalizePath(target):normalizePath(target+'.md');
      if(kids.has(cand)||kids.has(target))return m.index;
      if(dir&&cand.startsWith(dir+'/'))return m.index;
    }
    return -1;
  }
  // 新建子页面时把链接插到子页面列表**最前面**（wolai 行为：由近到远）
  insertChildLink(body,link,parentPath){
    const at=this.childLinkInsertIndex(body,parentPath);
    if(at<0)return body.trimEnd()+'\n\n'+link+'\n';
    let start=at;
    const head=body.slice(0,at);
    // 子页面条目形如「^w-<id>\n\n[[链接]]」；插入点提到块 ID 之前，
    // 但若该 ID 属于 wolai-toggle 容器（内嵌按钮），则不能插在它前面。
    const im=/(^|\n)\^w-[A-Za-z0-9]+\n+$/.exec(head);
    if(im){
      const cut=im.index+(im[1]?1:0);
      if(!/```wolai-toggle\n[^\n]+\n```\n\n$/.test(head.slice(0,cut)))start=cut;
    }
    return body.slice(0,start)+link+'\n\n'+body.slice(start);
  }
  // 删掉子页面后：移除父页面正文里的链接 + 清理空的页面目录（wolai 行为）
  async cleanupDeletedPage(file,parents){
    for(const parentPath of parents||[]){
      try{await this.removeChildLink(parentPath,file.path);}
      catch(e){console.warn('[wolai-local] 移除父页面链接失败',parentPath,e);}
    }
    // 注意：delete 事件触发时 file.parent 已是 null（文件已从目录树摘除），
    // 必须用路径反推目录，否则判断永远短路。
    try{
      const at=file.path.lastIndexOf('/');
      if(at<=0)return;
      const folderPath=file.path.slice(0,at);
      if(folderPath.includes('/')===false)return;
      for(let attempt=0;attempt<3;attempt++){
        const folder=this.app.vault.getAbstractFileByPath(folderPath);
        if(!folder||!Array.isArray(folder.children))return;
        if(folder.children.length){if(attempt<2){await new Promise(r=>setTimeout(r,400));continue;}return;}
        if(folder.name!==file.basename)return;   // 只清理 wolai 结构：<目录>/<同名>.md
        await this.app.vault.delete(folder,true);
        return;
      }
    }catch(e){console.warn('[wolai-local] 清理空页面目录失败',e);}
  }
  async removeChildLink(parentPath,childPath){
    const f=this.app.vault.getAbstractFileByPath(parentPath);
    if(!(f instanceof TFile))return 0;
    let removed=0;
    await this.app.vault.process(f,body=>{
      const keep=[];
      for(const l of body.split('\n')){
        const m=/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(l.trim());
        if(m){
          const t=m[1].trim();
          const norm=normalizePath(t.toLowerCase().endsWith('.md')?t:t+'.md');
          if(norm===childPath){removed++;continue;}
        }
        keep.push(l);
      }
      return removed?keep.join('\n').replace(/\n{3,}/g,'\n\n'):body;
    });
    return removed;
  }
  async applyTemplate(t,ctx){
    if(this.error||!this.data||!this.data.nodes[ctx.sourcePath])throw new Error('页面目录读取失败，请重新读取页面导航后重试');
    const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath);if(!(file instanceof TFile))throw new Error('父页面文件缺失');
    const now=window.moment();const replacements={'%YEAR%':now.format('YYYY'),'%MONTH%':now.format('M'),'%MONTH2%':now.format('MM'),'%DAY%':now.format('D'),'%DAY2%':now.format('DD'),'%WEEK%':now.format('w'),'%WEEK2%':now.format('ww'),'%DAYOFWEEK%':['日','一','二','三','四','五','六'][now.day()],'%DATE%':now.format('YYYY/MM/DD'),'%TIME%':now.format('HH:mm')};
    let text;
    if(typeof t.body==='string'){text=t.body;}
    else{const template=this.app.vault.getAbstractFileByPath(t.template);if(!(template instanceof TFile))throw new Error('模板文件缺失');text=await this.app.vault.read(template);}
    for(const [a,b] of Object.entries(replacements))text=text.replace(new RegExp(a,'gi'),b);
    if(/%[A-Z0-9]+%/i.test(text))throw new Error('模板含未支持的日期变量');
    if(t.mode==='inline'){
      if(typeof t.containerBlockId!=='string'||!t.containerBlockId||!['bottom','top'].includes(t.addPosition))throw new Error('内嵌模板位置定义无效');
      if(!text.trim())throw new Error('模板内容为空');
      await this.app.vault.process(file,body=>{
        const pattern=/```wolai-toggle\n([^\n]+)\n```\n\n\^w-([A-Za-z0-9]+)(?=\n|$)/g;
        const blocks=[...body.matchAll(pattern)].filter(m=>m[2]===t.containerBlockId);
        if(blocks.length!==1)throw new Error(blocks.length===0?'未找到按钮所在的折叠块（inline 模式按钮必须放在折叠块内部）':'模板所在折叠块已变化，请重新打开页面');
        const block=blocks[0],item=JSON.parse(block[1]);if(typeof item.markdown!=='string')throw new Error('折叠块内容无效');
        const buttons=[...item.markdown.matchAll(/```wolai-template\n([^\n]+)\n```/g)].filter(m=>{
          const config=JSON.parse(m[1]);return config.sourceId===t.sourceId;
        });
        if(buttons.length!==1||JSON.stringify(JSON.parse(buttons[0][1]))!==JSON.stringify(t))throw new Error('模板按钮配置已变化，请重新打开页面');
        const button=buttons[0],offset=button.index+(t.addPosition==='bottom'?button[0].length:0);
        item.markdown=item.markdown.slice(0,offset).trimEnd()+'\n\n'+text.trim()+'\n\n'+item.markdown.slice(offset).trimStart();
        const replacement='```wolai-toggle\n'+JSON.stringify(item)+'\n```\n\n^w-'+t.containerBlockId;
        return body.slice(0,block.index)+replacement+body.slice(block.index+block[0].length);
      });
      new Notice('已添加'+t.name);return;
    }
    if(t.mode&&t.mode!=='page')throw new Error('模板模式无效');
    const title=text.match(/^# (.+)$/m)?.[1];if(!title)throw new Error('模板缺少页面标题');
    let folder=normalizePath(file.parent.path+'/'+this.safeName(title)),i=2;while(this.app.vault.getAbstractFileByPath(folder))folder=normalizePath(file.parent.path+'/'+this.safeName(title)+' '+i++);
    await this.ensureFolder(folder);const path=folder+'/'+folder.split('/').pop()+'.md';await this.app.vault.create(path,text);
    await this.app.vault.process(file,body=>this.insertChildLink(body,'[['+path.slice(0,-3)+'|'+title+']]',file.path));
    const parent=this.data?.nodes[file.path];this.data.nodes[path]={path,title,type:'page',children:[]};if(parent){parent.children??=[];parent.children.unshift(path);}await this.saveData(this.data);await this.open(path);this.refreshViews();
  }
};
