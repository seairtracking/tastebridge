// Browser script for moments, served at /moments.js: post a photo or a few words for every accepted friend
// (like Locket), see theirs at the top of the app and react. Builds on the page's helpers (el, text, T).
const client = String.raw`
var strip=el('moments'),dialog=el('momentDialog'),feed=[],unseen=0,REACTIONS=['❤️','😂','😮','🔥','👍','😢'],poll=null,draft=null;
function me(){return window.tbMe}
function api(path,opts){opts=opts||{};return fetch(path,{method:opts.method||'GET',headers:{'content-type':'application/json'},body:opts.body?JSON.stringify(opts.body):undefined,credentials:'same-origin'}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(T(d.error||'Request failed.'));return d})})}
function btn(label,cls,onClick){var b=text('button',cls||'btn',label);b.type='button';b.addEventListener('click',onClick);return b}
function ago(t){var s=Math.round((t-Date.now())/1000),a=Math.abs(s);var f;try{f=new Intl.RelativeTimeFormat(window.tbLang||undefined,{numeric:'auto'})}catch(e){f=new Intl.RelativeTimeFormat('en',{numeric:'auto'})}
  return a<60?f.format(0,'second'):a<3600?f.format(Math.round(s/60),'minute'):a<86400?f.format(Math.round(s/3600),'hour'):f.format(Math.round(s/86400),'day')}
function load(){if(!me()){strip.hidden=true;return Promise.resolve()}return api('/api/account/moments').then(function(d){feed=d.moments||[];unseen=d.unseen||0;REACTIONS=d.reactions||REACTIONS;drawStrip();if(dialog.open&&dialog.dataset.view==='feed')drawFeed();if(navigator.setAppBadge)(unseen?navigator.setAppBadge(unseen):navigator.clearAppBadge()).catch(function(){})}).catch(function(){})}

// ---- the strip at the top of the app ----
function drawStrip(){strip.hidden=false;strip.replaceChildren();var head=text('div','moments-head');head.append(text('span','step',T('Moments')));
  var all=btn(unseen?T('See all ({n} new)',{n:unseen}):T('See all'),'vote',openFeed);head.append(all);strip.append(head);
  var row=text('div','moments-row');var add=btn('','moment-add',openPost);add.setAttribute('aria-label',T('Post a moment'));add.append(text('span','plus','📸'),text('small',null,T('Post')));row.append(add);
  if(!feed.length)row.append(text('p','muted',T('Share a photo or a few words with your friends. They see it at the top of their app.')));
  feed.slice(0,12).forEach(function(m){var c=document.createElement('button');c.type='button';c.className='moment-thumb';c.addEventListener('click',function(){openFeed(m.id)});
    if(m.photo){var im=document.createElement('img');im.src=m.photo;im.alt='';im.loading='lazy';c.append(im)}else c.append(text('span','cap',m.caption));
    c.append(text('small',null,(m.mine?T('You'):m.display)+' · '+ago(m.created)));row.append(c)});strip.append(row)}

// ---- posting ----
function shrink(file){return new Promise(function(ok,bad){var img=new Image();img.onload=function(){var max=1600,k=Math.min(1,max/Math.max(img.width,img.height));var c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(img.src);c.toBlob(function(b){b?ok(b):bad(new Error(T('Could not read that photo.')))},'image/jpeg',.82)};img.onerror=function(){bad(new Error(T('Could not read that photo.')))};img.src=URL.createObjectURL(file)})}
function places(){var out=[],seen={};var plan=window.tbLastPlan;var add=function(p,group){if(!p||!p.id||seen[p.id])return;seen[p.id]=1;out.push({p:p,group:group})};
  if(plan)(plan.places||[]).concat((plan.stops||[]).reduce(function(a,s){return a.concat(s.options)},[])).forEach(function(p){add(p,'plan')});
  (window.tbVisits||[]).slice(0,15).forEach(function(v){add({id:v.placeId,name:v.name,lat:v.lat,lon:v.lon},'been')});return out}
function openPost(){draft={file:null};dialog.dataset.view='post';dialog.classList.add('wide');dialog.replaceChildren();var box=text('div','in');dialog.append(box);
  box.append(text('h3',null,T('Post a moment')),text('p','muted',T('Every friend who accepted you sees it right away. Photos lose hidden location data before they are saved.')));
  var preview=text('div','moment-preview');preview.hidden=true;var pick=function(capture){var i=document.createElement('input');i.type='file';i.accept='image/*';if(capture)i.setAttribute('capture','environment');
    i.addEventListener('change',function(){var f=i.files&&i.files[0];if(!f)return;draft.file=f;preview.replaceChildren();var im=document.createElement('img');im.src=URL.createObjectURL(f);im.alt='';preview.append(im,btn(T('Remove photo'),'vote',function(){draft.file=null;preview.hidden=true}));preview.hidden=false});i.click()};
  var row=text('div','bar-row');row.style.justifyContent='flex-start';row.append(btn('📷 '+T('Take a photo'),'btn',function(){pick(true)}),btn('🖼️ '+T('Choose a photo'),'btn',function(){pick(false)}));box.append(row,preview);
  var cap=document.createElement('textarea');cap.maxLength=140;cap.placeholder=T('What are you up to?');cap.className='moment-caption';box.append(cap);
  var sel=document.createElement('select');var none=document.createElement('option');none.value='';none.textContent=T('No place');sel.append(none);var list=places();
  [['plan','From your plan'],['been','Places you’ve been']].forEach(function(g){var items=list.filter(function(x){return x.group===g[0]});if(!items.length)return;var og=document.createElement('optgroup');og.label=T(g[1]);items.forEach(function(x){var o=document.createElement('option');o.value=x.p.id;o.textContent=x.p.name;og.append(o)});sel.append(og)});
  box.append(text('div','taste-label','📍 '+T('Check in at')),sel);
  var err=text('p','err','');var bar=text('div','bar-row');var go=btn(T('Send to friends'),'btn primary',function(){
    var place=null;list.forEach(function(x){if(x.p.id===sel.value)place=x.p});if(!draft.file&&!cap.value.trim()){err.textContent=T('Add a photo or a few words.');return}
    go.disabled=true;go.textContent=T('Saving…');var id=null;
    api('/api/account/moments',{method:'POST',body:{caption:cap.value,place:place&&{id:place.id,name:place.name,address:place.address,category:place.category,lat:place.lat,lon:place.lon},photo:!!draft.file}}).then(function(r){id=r.id;if(!draft.file)return;
      return shrink(draft.file).then(function(blob){return fetch('/api/account/moments/'+id+'/photo',{method:'POST',headers:{'content-type':'image/jpeg'},body:blob,credentials:'same-origin'}).then(function(res){return res.json().then(function(j){if(!res.ok)throw new Error(T(j.error||'Upload failed.'))})})})
        .catch(function(e){return api('/api/account/moments/'+id+'/remove',{method:'POST',body:{}}).then(function(){throw e},function(){throw e})})})
    .then(function(){dialog.close();return load()}).catch(function(e){err.textContent=e.message;go.disabled=false;go.textContent=T('Send to friends')})});
  bar.append(btn(T('Cancel'),'btn',function(){dialog.close()}),go);box.append(err,bar);if(!dialog.open)dialog.showModal()}

// ---- the feed ----
var focus=null;
function openFeed(id){focus=typeof id==='number'?id:null;dialog.dataset.view='feed';dialog.classList.add('wide');drawFeed();if(!dialog.open)dialog.showModal();
  if(unseen)api('/api/account/moments/seen',{method:'POST',body:{}}).then(function(){unseen=0;drawStrip();if(navigator.clearAppBadge)navigator.clearAppBadge().catch(function(){})}).catch(function(){})}
function drawFeed(){dialog.replaceChildren();var box=text('div','in');dialog.append(box);var head=text('div','bar-row');head.style.cssText='justify-content:space-between;margin:0 0 8px';
  head.append(text('h3',null,T('Moments')),btn('📸 '+T('Post'),'btn primary',openPost));box.append(head);
  if(!feed.length)box.append(text('p','muted',T('No moments yet. Add friends by username, then post the first one.')));
  feed.forEach(function(m){var c=text('article','moment');c.dataset.id=m.id;var h=text('div','moment-meta');h.append(text('b',null,m.mine?T('You'):m.display),text('span','muted',' · '+ago(m.created)+(m.place?' · 📍 '+m.place:'')));c.append(h);
    if(m.photo){var im=document.createElement('img');im.src=m.photo;im.alt=m.caption||T('Photo');im.loading='lazy';c.append(im)}
    if(m.caption)c.append(text('p','moment-text',m.caption));
    var r=text('div','votes');REACTIONS.forEach(function(e){var n=(m.reactions||[]).filter(function(x){return x.emoji===e})[0];var b=btn(e+(n?' '+n.count:''),'vote',function(){api('/api/account/moments/'+m.id+'/react',{method:'POST',body:{emoji:m.myReaction===e?'':e}}).then(load).catch(function(){})});b.setAttribute('aria-pressed',String(m.myReaction===e));r.append(b)});c.append(r);
    if(m.mine){if((m.reactedBy||[]).length)c.append(text('p','muted',m.reactedBy.map(function(x){return x.display+' '+x.emoji}).join(' · ')));
      var del=btn(T('Delete'),'vote',function(){if(!confirm(T('Delete this moment?')))return;api('/api/account/moments/'+m.id+'/remove',{method:'POST',body:{}}).then(load).catch(function(){})});del.style.marginTop='6px';c.append(del)}
    box.append(c)});
  box.append((function(){var b=text('div','bar-row');b.append(btn(T('Close'),'btn',function(){dialog.close()}));return b})());
  if(focus!=null){var t=box.querySelector('[data-id="'+focus+'"]');if(t)setTimeout(function(){t.scrollIntoView({block:'start'})},50)}}

document.addEventListener('tb:account',function(){clearInterval(poll);load();if(me())poll=setInterval(function(){if(!document.hidden)load()},30000)});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&me())load()});
document.addEventListener('tb:lang',function(){if(me())drawStrip();if(dialog.open&&dialog.dataset.view==='feed')drawFeed()});`;

export const momentsScript = '(function(){\'use strict\';' + client + '})();';
