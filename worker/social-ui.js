// Browser script for optional accounts and two-phone plans, served at /social.js. It builds on the page's
// own helpers (el, text, show, addStep, notice...) and never uses innerHTML for data.
export const socialScript = String.raw`(function(){
'use strict';
var me=null,friends=[],roomId=null,roomToken=null,roomView=null,poll=null,planning=false;
var store={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
var dialog=el('accountDialog'),roomBox=el('room');
function api(path,opts){opts=opts||{};var headers={'content-type':'application/json'};if(roomToken)headers['x-room-token']=roomToken;return fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined,credentials:'same-origin'}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(T(d.error||"Request failed."));return d})})}
function btn(label,cls,onClick){var b=text('button',cls||'btn',label);b.type='button';b.addEventListener('click',onClick);return b}
function field(label,input){var l=text('label',null,label);var w=document.createElement('div');w.append(l,input);return w}
function input(type,value,attrs){var i=document.createElement('input');i.type=type;i.value=value||'';Object.keys(attrs||{}).forEach(function(k){i.setAttribute(k,attrs[k])});return i}
function choose(options,value){var s=document.createElement('select');options.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];if(o[0]===(value||''))op.selected=true;s.append(op)});return s}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
function CUISINES(){return[['',T("Anything")]].concat(['vietnamese','japanese','korean','chinese','thai','indian','italian','french','mexican','american','mediterranean','vegetarian'].map(function(c){return[c,cap(T('cuisine.'+c))]}))}
function MOODS(){return[['',T("Any")]].concat(['romantic','cozy','lively','quiet','chill'].map(function(m){return[m,cap(T('mood.'+m))]}))}
function day(t){try{return new Date(t).toLocaleDateString(window.tbLang||undefined)}catch(e){return new Date(t).toLocaleDateString()}}
function mins(n){return n>=60?T("{h} h {m} min",{h:Math.floor(n/60),m:n%60}):T("{min} min",{min:n})}

// ---------- header + profile defaults ----------
function refreshAccount(){return api('/api/account').then(function(d){me=d.user;friends=d.friends||[];el('accountBtn').textContent=me?me.display+' ▾':T('Sign in');el('memoriesBtn').hidden=!me;if(me){el('firstLabel').textContent=T("You ({name}) love",{name:me.display});if(!el('first').value&&me.favorite)el('first').value=me.favorite;if(!el('city').value&&me.city)el('city').value=me.city;if(me.cuisine&&!el('cuisine').value)el('cuisine').value=me.cuisine}else el('firstLabel').textContent=T('You love');return d}).catch(function(){el('accountBtn').hidden=true;return{}})}

// ---------- account sheet ----------
function sheet(build){dialog.classList.remove('wide');dialog.replaceChildren();var box=text('div','in');build(box);dialog.append(box);if(!dialog.open)dialog.showModal()}
function errorLine(){return text('p','err','')}
function authSheet(tab){sheet(function(box){box.append(text('h3',null,tab==='signup'?T('Create your account'):T('Sign in')),text('p','muted',T('Optional: TasteBridge works without an account. An account remembers your favorite and lets friends plan with you.')));
  var tabs=text('div','tabs');var a=btn(T('Sign in'),'mode',function(){authSheet('login')}),b=btn(T('Create account'),'mode',function(){authSheet('signup')});a.setAttribute('aria-pressed',String(tab!=='signup'));b.setAttribute('aria-pressed',String(tab==='signup'));tabs.append(a,b);box.append(tabs);
  var f=document.createElement('form');var u=input('text','',{autocomplete:'username',maxlength:'20',required:''}),p=input('password','',{autocomplete:tab==='signup'?'new-password':'current-password',minlength:'8',required:''}),d=input('text','',{maxlength:'40'});
  f.append(field(T('Username'),u));if(tab==='signup')f.append(field(T('Display name'),d));f.append(field(T('Password'),p));var err=errorLine();f.append(err);
  var row=text('div','bar-row');row.append(btn(T('Cancel'),'btn',function(){dialog.close()}));var go=text('button','btn primary',tab==='signup'?T('Create account'):T('Sign in'));go.type='submit';row.append(go);f.append(row);
  f.addEventListener('submit',function(e){e.preventDefault();go.disabled=true;var code=null;api('/api/account/'+(tab==='signup'?'signup':'login'),{method:'POST',body:{username:u.value,password:p.value,display:d.value}}).then(function(r){code=r.recoveryCode;return refreshAccount()}).then(function(){if(code)codeSheet(code,true);else dialog.close()}).catch(function(x){err.textContent=x.message}).finally(function(){go.disabled=false})});
  box.append(f);if(tab!=='signup'){var forgot=btn(T('Forgot password?'),'vote',function(){recoverSheet()});forgot.style.marginTop='8px';box.append(forgot)}setTimeout(function(){u.focus()},50)})}

function codeSheet(code,fresh){sheet(function(box){box.append(text('h3',null,T('Save your recovery code')),text('p','muted',T('If you forget your password, this code lets you set a new one. It is shown only once. Keep it in your notes, a screenshot or a password manager.')));
  var c=text('p','link',code);c.style.fontSize='20px';c.style.textAlign='center';c.style.letterSpacing='.08em';box.append(c);
  var row=text('div','bar-row');row.append(btn(T('Copy code'),'btn',function(e){navigator.clipboard&&navigator.clipboard.writeText(code).then(function(){e.target.textContent=T('Copied ✓')})}),btn(T('I saved it'),'btn primary',function(){fresh?profileSheet():dialog.close()}));box.append(row)})}

function recoverSheet(){sheet(function(box){box.append(text('h3',null,T('Forgot password')),text('p','muted',T('Enter your username, the recovery code you saved when you signed up, and a new password. Every other device will be signed out.')));
  var f=document.createElement('form');var u=input('text','',{autocomplete:'username',maxlength:'20',required:''}),c=input('text','',{placeholder:'XXXX-XXXX-XXXX-XXXX',maxlength:'40',required:'',autocomplete:'off'}),p=input('password','',{autocomplete:'new-password',minlength:'8',required:''});
  f.append(field(T('Username'),u),field(T('Recovery code'),c),field(T('New password'),p));var err=errorLine();f.append(err);var row=text('div','bar-row');row.append(btn(T('Back'),'btn',function(){authSheet('login')}));var go=text('button','btn primary',T('Set new password'));go.type='submit';row.append(go);f.append(row);
  f.addEventListener('submit',function(e){e.preventDefault();go.disabled=true;var code;api('/api/account/recover',{method:'POST',body:{username:u.value,code:c.value,password:p.value}}).then(function(r){code=r.recoveryCode;return refreshAccount()}).then(function(){codeSheet(code,false)}).catch(function(x){err.textContent=x.message}).finally(function(){go.disabled=false})});
  box.append(f)})}

function profileSheet(){refreshAccount().then(function(d){if(!me)return authSheet('login');sheet(function(box){
  box.append(text('h3',null,T("Hi, {name}",{name:me.display})),text('p','muted','@'+me.username+' · '+T("Your favorite is shared only with friends who accept you.")));
  var f=document.createElement('form');var dn=input('text',me.display,{maxlength:'40'}),fav=input('text',me.favorite,{maxlength:'70',placeholder:T('e.g. Spirited Away')}),city=input('text',me.city,{maxlength:'70',placeholder:T('e.g. Ho Chi Minh City')}),cu=choose(CUISINES(),me.cuisine),mo=choose(MOODS(),me.mood);
  f.append(field(T('Display name'),dn),field(T('Your favorite (artist, film, book, show or game)'),fav),field(T('Home city'),city),field(T('Usual food'),cu),field(T('Usual mood'),mo));var err=errorLine();f.append(err);
  var row=text('div','bar-row');var save=text('button','btn primary',T('Save profile'));save.type='submit';row.append(save);f.append(row);
  f.addEventListener('submit',function(e){e.preventDefault();api('/api/account/profile',{method:'PUT',body:{display:dn.value,favorite:fav.value,city:city.value,cuisine:cu.value,mood:mo.value}}).then(function(){el('first').value=fav.value;return refreshAccount()}).then(function(){err.textContent=T('Saved.')}).catch(function(x){err.textContent=x.message})});
  box.append(f);
  // friends
  var fs=text('section');fs.append(text('h4',null,T('Friends')));var add=document.createElement('form');add.className='row';var un=input('text','',{placeholder:T('Friend’s username'),maxlength:'20'});var ab=text('button','btn',T('Add'));ab.type='submit';var row2=text('div','bar-row');row2.append(un,ab);add.append(row2);var ferr=errorLine();
  add.addEventListener('submit',function(e){e.preventDefault();api('/api/account/friends',{method:'POST',body:{username:un.value}}).then(function(r){ferr.textContent=r.status==='accepted'?T('You are now friends.'):T('Request sent. They need to accept.');un.value='';profileSheet()}).catch(function(x){ferr.textContent=x.message})});
  fs.append(add,ferr);var ul=text('ul','list');
  (d.friends||[]).forEach(function(fr){var li=text('li');var who=text('span',null,fr.display+' @'+fr.username+(fr.status==='friend'&&fr.favorite?' · '+T("loves {fav}",{fav:fr.favorite}):''));li.append(who);var act=text('span');
    if(fr.status==='received')act.append(btn(T('Accept'),'vote',function(){api('/api/account/friends/accept',{method:'POST',body:{username:fr.username}}).then(profileSheet)}));
    if(fr.status==='friend')act.append(btn(T('Plan tonight'),'vote',function(){dialog.close();startRoom(fr.username)}));
    act.append(btn(fr.status==='friend'?T('Remove'):fr.status==='sent'?T('Cancel'):T('Decline'),'vote',function(){api('/api/account/friends/remove',{method:'POST',body:{username:fr.username}}).then(profileSheet)}));
    if(fr.status==='sent')who.append(text('span','muted',' · '+T("waiting")));li.append(act);ul.append(li)});
  if(!(d.friends||[]).length)ul.append(text('li','muted',T('No friends yet. Add someone by their username.')));fs.append(ul);box.append(fs);
  // invites and plans
  var ps=text('section');ps.append(text('h4',null,T('Your plans')));var pl=text('ul','list');
  (d.invites||[]).forEach(function(r){var li=text('li');li.append(text('span',null,T("{name} invited you",{name:r.host})),btn(T('Open'),'vote',function(){location.href='/r/'+r.id}));pl.append(li)});
  (d.rooms||[]).forEach(function(r){var li=text('li');li.append(text('span',null,(r.other?T("With {name}",{name:r.other}):T("Waiting for your friend"))+(r.planned?' · '+T("planned"):'')),btn(T('Open'),'vote',function(){location.href='/r/'+r.id}));pl.append(li)});
  if(!pl.childNodes.length)pl.append(text('li','muted',T('Plans you make on two phones appear here for 48 hours.')));ps.append(pl);box.append(ps);
  // places you've been
  var vs=text('section');var nt=document.createElement('label');nt.style.cssText='display:flex;gap:10px;align-items:flex-start;text-transform:none;letter-spacing:0;font-size:14px;color:var(--dark);font-weight:600';var cb=document.createElement('input');cb.type='checkbox';cb.style.cssText='width:auto;margin-top:3px';cb.checked=noticer.on;
  cb.addEventListener('change',function(){noticer.on=cb.checked;store.set('tb-notice',cb.checked?'1':'0');cb.checked?startNotice():stopNotice()});
  nt.append(cb,text('span',null,T('Notice where I go. While TasteBridge is open, it asks “Are you at …?” when you are at a place from your plan, and notes how long you stay. Your location stays on this phone; only the place you confirm is saved.')));vs.append(nt);
  vs.append(text('h4',null,T('Places you’ve been')),text('p','muted',T('Tap “Been here ✓” on a plan, or answer “How was it?” after a night out. TasteBridge then suggests somewhere new first and never suggests places you marked 👎 again.')));var vl=text('ul','list');
  (d.visits||[]).forEach(function(v){var li=text('li');var info=text('span',null,v.name);info.append(text('span','muted',' · '+day(v.visited)+(v.withName?' · '+T("with {name}",{name:v.withName}):'')+(v.minutes?' · '+mins(v.minutes):'')));li.append(info);var act=text('span');
    [[1,'❤️'],[-1,'👎']].forEach(function(o){var b=btn(o[1],'vote',function(){api('/api/account/visits/rate',{method:'POST',body:{id:v.id,rating:v.rating===o[0]?0:o[0]}}).then(profileSheet)});b.setAttribute('aria-pressed',String(v.rating===o[0]));b.setAttribute('aria-label',o[0]>0?T('Loved it'):T('Not for us'));act.append(b)});
    act.append(btn('✕','vote',function(){api('/api/account/visits/remove',{method:'POST',body:{id:v.id}}).then(profileSheet)}));li.append(act);vl.append(li)});
  if(!(d.visits||[]).length)vl.append(text('li','muted',T('Nothing yet.')));vs.append(vl);box.append(vs);
  // saved plans
  var sp=text('section');sp.append(text('h4',null,T('Saved plans')));var sl=text('ul','list');
  (d.plans||[]).forEach(function(pl){var li=text('li');li.append(text('span',null,pl.title+' · '+day(pl.created)));var act=text('span');act.append(btn(T('Open'),'vote',function(){api('/api/account/plans/'+pl.id).then(function(r){dialog.close();show(r.plan)})}),btn('✕','vote',function(){api('/api/account/plans/remove',{method:'POST',body:{id:pl.id}}).then(profileSheet)}));li.append(act);sl.append(li)});
  if(!(d.plans||[]).length)sl.append(text('li','muted',T('Plans you make while signed in are kept here (the latest 30).')));sp.append(sl);box.append(sp);
  // password and recovery
  var sec=text('section');sec.append(text('h4',null,T('Password')));var pf=document.createElement('form');var cur=input('password','',{autocomplete:'current-password',placeholder:T('Current password')}),nxt=input('password','',{autocomplete:'new-password',minlength:'8',placeholder:T('New password')});var perr=errorLine();var prow=text('div','bar-row');var pgo=text('button','btn',T('Change password'));pgo.type='submit';
  prow.append(btn(T('New recovery code'),'btn',function(){var pw=prompt(T('Type your password to get a new recovery code.'));if(!pw)return;api('/api/account/recovery-code',{method:'POST',body:{password:pw}}).then(function(r){codeSheet(r.recoveryCode,false)}).catch(function(x){perr.textContent=x.message})}),pgo);
  pf.append(cur,nxt,perr,prow);cur.style.marginBottom='8px';pf.addEventListener('submit',function(e){e.preventDefault();api('/api/account/password',{method:'POST',body:{current:cur.value,password:nxt.value}}).then(function(){perr.textContent=T('Password changed. Other devices were signed out.');cur.value='';nxt.value=''}).catch(function(x){perr.textContent=x.message})});
  sec.append(pf);box.append(sec);
  // sign out, delete
  var end=text('section');var row3=text('div','bar-row');
  row3.append(btn(T('Delete account'),'btn',function(){var pw=prompt(T('Type your password to delete your account and all its data.'));if(!pw)return;api('/api/account/delete',{method:'POST',body:{password:pw}}).then(function(){dialog.close();location.reload()}).catch(function(x){alert(x.message)})}));
  row3.append(btn(T('Sign out'),'btn',function(){api('/api/account/logout',{method:'POST'}).then(function(){dialog.close();location.reload()})}),btn(T('Close'),'btn primary',function(){dialog.close()}));end.append(row3);box.append(end)})})}
el('accountBtn').addEventListener('click',function(){me?profileSheet():authSheet('login')});
el('memoriesBtn').addEventListener('click',function(){memoriesSheet('all')});

// ---------- memories: every place you have been on a map, with photos, notes and sharing ----------
function shrink(file){return new Promise(function(ok,bad){var img=new Image();img.onload=function(){var max=1600,k=Math.min(1,max/Math.max(img.width,img.height));var c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(img.src);c.toBlob(function(b){b?ok(b):bad(new Error(T('Could not read that photo.')))},'image/jpeg',.82)};img.onerror=function(){bad(new Error(T('Could not read that photo.')))};img.src=URL.createObjectURL(file)})}
var memMap=null;
function memoriesSheet(filter){api('/api/account/memories').then(function(d){sheet(function(box){dialog.classList.add('wide');
  box.append(text('h3',null,T('Memories')),text('p','muted',T('Every place you have been. Add a photo and a note, and share a memory with friends who accepted you. Photos are stripped of hidden location data before they are saved.')));
  var tabs=text('div','tabs');[['all',T('All')],['mine',T('Mine')],['friends',T('Friends')]].forEach(function(t){var b=btn(t[1],'mode',function(){memoriesSheet(t[0])});b.setAttribute('aria-pressed',String(filter===t[0]));tabs.append(b)});box.append(tabs);
  var items=(filter!=='friends'?d.mine.map(function(x){x.mine=true;return x}):[]).concat(filter!=='mine'?d.friends:[]);
  var mapBox=text('div','mem-map');box.append(mapBox);var list=text('div','mem-list');box.append(list);
  if(!items.length)list.append(text('p','muted',filter==='friends'?T('No shared memories from friends yet.'):T('No check-ins yet. Tap “Been here” on a plan, or answer “How was it?” after a night out.')));
  items.forEach(function(x){list.append(memoryCard(x,filter))});
  var pts=items.filter(function(x){return x.lat!=null});
  if(!pts.length){mapBox.replaceChildren(text('p','muted',T('Places with a location will appear on this map.')));mapBox.style.display='grid';mapBox.style.placeItems='center';return}
  loadLeaflet().then(function(L){if(memMap){memMap.remove();memMap=null}memMap=L.map(mapBox,{scrollWheelZoom:false});L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors (tiles: openstreetmap.de)'}).addTo(memMap);
    pts.forEach(function(x){var pop=document.createElement('div');pop.append(text('b',null,x.name));if(!x.mine)pop.append(text('div',null,T("via {name}",{name:x.friend})));if(x.note)pop.append(text('div',null,x.note));if(x.photo){var im=document.createElement('img');im.src=x.photo;im.alt='';im.style.cssText='width:160px;border-radius:8px;margin-top:6px;display:block';pop.append(im)}
      L.marker([x.lat,x.lon],{title:x.name,icon:L.divIcon({className:'',html:'<span class="pin '+(x.mine?'mine':'friend')+'">'+(x.rating>0?'♥':'')+'</span>',iconSize:[28,28],iconAnchor:[14,14]})}).addTo(memMap).bindPopup(pop)});
    var b=pts.map(function(x){return[x.lat,x.lon]});if(b.length>1)memMap.fitBounds(b,{padding:[30,30],maxZoom:15});else memMap.setView(b[0],15)}).catch(function(){mapBox.replaceChildren(text('p','muted',T('Map unavailable right now.')))})})}).catch(function(x){alert(x.message)})}
function memoryCard(x,filter){var c=text('article','mem');if(x.photo){var im=document.createElement('img');im.src=x.photo;im.alt=T("Photo at {name}",{name:x.name});im.loading='lazy';c.append(im)}
  var b=text('div','body');b.append(text('b',null,x.name));if(!x.mine)b.append(text('span','who',T("Shared by {name}",{name:x.friend})));
  b.append(text('span','muted',day(x.visited)+(x.withName?' · '+T("with {name}",{name:x.withName}):'')+(x.minutes?' · '+mins(x.minutes):'')+(x.rating>0?' · ❤️':x.rating<0?' · 👎':'')));
  if(!x.mine){if(x.note)b.append(text('p',null,x.note));c.append(b);return c}
  var note=document.createElement('textarea');note.maxLength=280;note.placeholder=T('A note about this night…');note.value=x.note||'';
  var share=document.createElement('label');share.style.cssText='display:flex;gap:6px;align-items:center;font-size:12px;text-transform:none;letter-spacing:0;color:var(--dark);margin:0';var cb=document.createElement('input');cb.type='checkbox';cb.style.width='auto';cb.checked=!!x.shared;share.append(cb,document.createTextNode(T('Share with friends')));
  var file=document.createElement('input');file.type='file';file.accept='image/*';file.style.fontSize='12px';
  var msg=text('span','muted','');var row=text('div','bar-row');row.style.marginTop='4px';
  row.append(btn(T('Save'),'vote',function(){msg.textContent=T('Saving…');api('/api/account/visits/'+x.id+'/memory',{method:'POST',body:{note:note.value,shared:cb.checked}}).then(function(){var f=file.files&&file.files[0];if(!f)return;return shrink(f).then(function(blob){return fetch('/api/account/visits/'+x.id+'/photo',{method:'POST',headers:{'content-type':'image/jpeg'},body:blob,credentials:'same-origin'}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(T(j.error||"Upload failed."))})})})}).then(function(){memoriesSheet(filter)}).catch(function(e){msg.textContent=e.message})}));
  if(x.photo)row.append(btn(T('Remove photo'),'vote',function(){api('/api/account/visits/'+x.id+'/photo/remove',{method:'POST'}).then(function(){memoriesSheet(filter)})}));
  b.append(note,file,share,row,msg);c.append(b);return c}

// ---------- two-phone rooms ----------
function settingsFromForm(){var near=window.tbNear&&window.tbNear();return{mode:form.dataset.show==='plan'?'plan':'evening',city:el('city').value,lat:near&&near.lat,lon:near&&near.lon,start:el('start').value,day:['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()],cuisine:el('cuisine').value,mood:window.tbMood?window.tbMood():'',budget:el('budget').value,occasion:window.tbOccasion?window.tbOccasion():'dinner',special:window.tbSpecial?window.tbSpecial():''}}
function startRoom(friendUsername){notice.className='notice';var fav=el('first').value.trim();if(fav.length<2){notice.textContent=T('Type your favorite first, then invite your friend.');notice.className='notice show';el('first').focus();return}
  roomBox.hidden=false;roomBox.replaceChildren();roomBox.append(text('div','step',T('Plan on two phones')),text('h3',null,friendUsername?T("Planning with {name}",{name:friendUsername}):T("Invite your friend")),text('p',null,T('Your friend opens the link on their own phone and adds their favorite. Neither of you sees the other’s pick until the plan is ready.')));
  var row=text('div','row');var nm=input('text',me?me.display:store.get('tb-name')||'',{placeholder:T('Your name (shown to your friend)'),maxlength:'40'});var go=btn(T('Create invite'),'btn primary',function(){go.disabled=true;store.set('tb-name',nm.value);api('/api/rooms',{method:'POST',body:{name:nm.value,favorite:fav,pick:el('first').dataset.pick||undefined,settings:settingsFromForm(),invite:friendUsername||undefined}}).then(function(r){roomToken=r.token;store.set('tb-room-'+r.id,r.token);history.pushState(null,'','/r/'+r.id);openRoom(r.id)}).catch(function(x){notice.textContent=x.message;notice.className='notice show';go.disabled=false})});
  row.append(nm,go,btn(T('Cancel'),'btn',function(){roomBox.hidden=true}));roomBox.append(row);roomBox.scrollIntoView({behavior:'smooth',block:'start'})}
el('twoPhones').addEventListener('click',function(){startRoom(null)});

function hideForm(on){form.hidden=on;var top=document.querySelector('#try .section-top');if(top)top.hidden=on}
function leaveRoom(){clearInterval(poll);roomId=null;roomToken=null;roomBox.hidden=true;hideForm(false);results.classList.remove('show');agent.classList.remove('show');history.pushState(null,'','/')}
function openRoom(id){roomId=id;hideForm(true);roomToken=store.get('tb-room-'+id);roomBox.hidden=false;clearInterval(poll);load();poll=setInterval(function(){if(!document.hidden&&!planning)load()},3000)}
function load(){return api('/api/rooms/'+roomId).then(renderRoom).catch(function(x){clearInterval(poll);roomBox.replaceChildren(text('h3',null,T('Invite not found')),text('p',null,x.message));roomBox.append(btn(T('Plan your own evening'),'btn primary',leaveRoom))})}
var shownPlan=0;
function renderRoom(v){roomView=v;var host=v.members[0],friend=v.members[1];var you=v.you;roomBox.replaceChildren();var s=v.settings;
  var what=[T(s.mode==='plan'?"a quick shortlist":"tonight"),s.city?T("in {city}",{city:s.city}):T("near {name}",{name:you===0?T("you"):host.name}),s.special?'· '+T('special.'+s.special):'',s.cuisine?'· '+T('cuisine.'+s.cuisine):'',s.mood?'· '+T('mood.'+s.mood):''].filter(Boolean).join(' ');
  var head=text('div','row');head.style.justifyContent='space-between';head.style.marginTop='0';head.append(text('div','step',T('Plan on two phones')),btn(T('Leave this plan'),'vote',leaveRoom));roomBox.append(head);
  var people=text('div','people');v.members.forEach(function(m){people.append(text('span','person',(m.slot===you?T('You'):m.name)+(m.favorite?' · '+m.favorite:'')+' ✓'))});if(!friend)people.append(text('span','person wait',T('Waiting for your friend…')));
  if(v.canJoin){roomBox.append(text('h3',null,T("{name} invited you to plan {what}",{name:host.name,what:what})),text('p',null,T("Add one thing you love: an artist, film, book, show or game. {name} will not see it until the plan is ready.",{name:host.name})));
    var f=document.createElement('form');f.className='row';var nm=input('text',me?me.display:store.get('tb-name')||'',{placeholder:T('Your name'),maxlength:'40'}),fav=input('text',me&&me.favorite||'',{placeholder:T('You love… e.g. Daft Punk'),maxlength:'70',required:'',autocomplete:'off'});var favWrap=document.createElement('div');favWrap.className='field';favWrap.style.cssText='flex:1 1 220px;padding:0;background:transparent;border:0';favWrap.append(fav);setTimeout(function(){window.attachSuggest&&window.attachSuggest(fav)},0);var go=text('button','btn primary',T('Join'));go.type='submit';f.append(nm,favWrap,go);
    f.addEventListener('submit',function(e){e.preventDefault();go.disabled=true;store.set('tb-name',nm.value);api('/api/rooms/'+roomId+'/join',{method:'POST',body:{name:nm.value,favorite:fav.value,pick:fav.dataset.pick||undefined}}).then(function(r){roomToken=r.token;store.set('tb-room-'+roomId,r.token);load()}).catch(function(x){notice.textContent=x.message;notice.className='notice show';go.disabled=false})});
    roomBox.append(f);roomBox.scrollIntoView({block:'start'});return}
  if(you==null){roomBox.append(text('h3',null,T('This plan is full')),text('p',null,T("Two people have already joined. Ask {name} for a new invite.",{name:host.name})));return}
  roomBox.append(text('h3',null,v.plan?T('Your shared plan is ready'):friend?T('Both of you are in'):T('Send this invite to your friend')),people);
  if(!friend){var row=text('div','row');var link=location.origin+'/r/'+roomId;row.append(text('span','link',link),btn(T('Copy link'),'btn',function(e){navigator.clipboard&&navigator.clipboard.writeText(link).then(function(){e.target.textContent=T('Copied ✓')})}));if(navigator.share)row.append(btn(T('Share…'),'btn primary',function(){navigator.share({title:T('Plan tonight with me'),text:T('Add your favorite and TasteBridge plans a fair evening for both of us.'),url:link}).catch(function(){})}));roomBox.append(row,text('p','muted',T('The invite works for 48 hours. This page updates when your friend joins.')))}
  else if(!v.plan){var row2=text('div','row');row2.append(btn(planning?T('The agent is working…'):T(s.mode==='plan'?"Plan our shortlist ↗":"Plan our evening ↗"),'btn primary',runRoomPlan));roomBox.append(row2,text('p','muted',T('Either of you can start. The other phone shows the plan as soon as it is ready.')))}
  if(v.plan&&v.planned!==shownPlan){shownPlan=v.planned;show(v.plan)}
  if(v.plan)decorateVotes(v)}
function runRoomPlan(e){if(planning)return;planning=true;e.target.disabled=true;e.target.textContent=T('The agent is working…');notice.className='notice';results.classList.remove('show');el('steps').replaceChildren();agent.classList.add('show');
  var headers={'content-type':'application/json',accept:'application/x-ndjson'};if(roomToken)headers['x-room-token']=roomToken;
  fetch('/api/rooms/'+roomId+'/plan',{method:'POST',headers:headers,credentials:'same-origin',body:'{}'}).then(function(res){if(!res.ok||!res.body)return res.json().then(function(d){throw new Error(T(d.error||"Request failed."))});var reader=res.body.getReader(),dec=new TextDecoder(),buf='';
    function pump(){return reader.read().then(function(c){if(c.done)return;buf+=dec.decode(c.value,{stream:true});var lines=buf.split('\n');buf=lines.pop();lines.forEach(function(l){if(!l.trim())return;var m=JSON.parse(l);if(m.event==='step')addStep(m.step);else if(m.event==='error')throw new Error(T(m.error))});return pump()})}return pump()})
  .catch(function(x){notice.textContent=x.message;notice.className='notice show'}).finally(function(){planning=false;load()})}
function decorateVotes(v){document.querySelectorAll('#results [data-option]').forEach(function(card){var id=card.dataset.option;if(!id)return;var old=card.querySelector('.votes');if(old)old.remove();var t=v.votes[id]||{up:0,down:0,mine:0};var row=text('div','votes');
  [[1,'👍 '+t.up],[-1,'👎 '+t.down]].forEach(function(o){var b=btn(o[1],'vote',function(){api('/api/rooms/'+roomId+'/vote',{method:'POST',body:{option:id,value:t.mine===o[0]?0:o[0]}}).then(load)});b.setAttribute('aria-pressed',String(t.mine===o[0]));b.setAttribute('aria-label',T(o[0]>0?"Like this option":"Dislike this option"));row.append(b)});card.append(row)})}

var lastPlan=null,pageShow=window.show;
window.show=function(plan,quiet){pageShow(plan,quiet);lastPlan=plan;decorateBeen(plan);startNotice()};
function placeOf(plan,id){var all=(plan.places||[]).concat((plan.stops||[]).reduce(function(a,s){return a.concat(s.options)},[]));for(var i=0;i<all.length;i++)if(all[i].id===id)return all[i];return null}
function decorateBeen(plan){if(!me)return;document.querySelectorAll('#places [data-option]').forEach(function(card){var place=placeOf(plan,card.dataset.option);if(!place||card.querySelector('.been'))return;var b=btn(place.been?T('Been here ✓'):T('Been here?'),'vote been',function(){var withName=(plan.seeds||[]).map(function(x){return x.person}).filter(function(n){return n&&n!==me.display}).join(', ');api('/api/account/visits',{method:'POST',body:{place:place,with:withName}}).then(function(){b.textContent=T('Been here ✓');b.setAttribute('aria-pressed','true')})});b.setAttribute('aria-pressed',String(!!place.been));b.style.marginTop='8px';card.append(b)})}
function reviewBox(r){var box=el('review');if(!box){box=text('div','room');box.id='review';roomBox.parentNode.insertBefore(box,roomBox)}box.hidden=false;box.replaceChildren();
  var options=(r.plan.stops?r.plan.stops.reduce(function(a,s){return a.concat(s.options.slice(0,3))},[]):(r.plan.places||[]));var picked={};
  box.append(text('div','step',T('How was it?')),text('h3',null,T("Where did you go for “{title}”?",{title:r.title})),text('p',null,T('Tap the places you went to. TasteBridge remembers them and suggests somewhere new next time.')));
  var row=text('div','people');options.forEach(function(o){var b=btn(o.name,'vote',function(){picked[o.id]=picked[o.id]?0:1;b.setAttribute('aria-pressed',String(!!picked[o.id]))});b.setAttribute('aria-pressed','false');row.append(b)});box.append(row);
  var act=text('div','row');act.append(btn(T('Save'),'btn primary',function(){send(Object.keys(picked).filter(function(k){return picked[k]}).map(function(k){return{id:k}}))}),btn(T('We didn’t go'),'btn',function(){send([])}));box.append(act);
  function send(went){api('/api/account/review',{method:'POST',body:{id:r.id,went:went}}).then(function(){box.replaceChildren(text('p',null,went.length?T('Saved. Thanks!'):T('Okay, noted.')));setTimeout(function(){box.hidden=true},2500)})}}

// ---------- opt-in "Notice where I go" (only while the app is open) ----------
var noticer={on:store.get('tb-notice')==='1',watch:null,near:{},asked:{},here:null,plan:null};
function targets(){var plan=lastPlan||noticer.plan;if(!plan)return[];return(plan.places||[]).concat((plan.stops||[]).reduce(function(a,s){return a.concat(s.options)},[])).filter(function(o){return o.lat!=null})}
function startNotice(){if(!me||!noticer.on||!navigator.geolocation||noticer.watch!=null||document.hidden)return;noticer.watch=navigator.geolocation.watchPosition(onPosition,function(){},{enableHighAccuracy:true,maximumAge:60000,timeout:20000})}
function stopNotice(){if(noticer.watch!=null){navigator.geolocation.clearWatch(noticer.watch);noticer.watch=null}}
document.addEventListener('visibilitychange',function(){document.hidden?stopNotice():startNotice()});
function onPosition(p){var at={lat:p.coords.latitude,lon:p.coords.longitude},now=Date.now();
  if(noticer.here&&dist(at,noticer.here.place)>150){var mins=Math.round((now-noticer.here.since)/60000);var place=noticer.here.place;noticer.here=null;if(mins>=5)api('/api/account/visits',{method:'POST',body:{place:place,minutes:Math.min(mins,720)}}).catch(function(){})}
  targets().forEach(function(t){var d=dist(at,t);if(d<=80){noticer.near[t.id]=noticer.near[t.id]||now;if(now-noticer.near[t.id]>=180000&&!noticer.asked[t.id]){noticer.asked[t.id]=1;askHere(t,noticer.near[t.id])}}else if(!noticer.here||noticer.here.place.id!==t.id)delete noticer.near[t.id]})}
function askHere(t,since){var box=el('checkin');if(!box){box=text('div','room');box.id='checkin';roomBox.parentNode.insertBefore(box,roomBox)}box.hidden=false;box.replaceChildren(text('div','step',T('Noticed nearby')),text('h3',null,T("Are you at {name}?",{name:t.name})));
  var row=text('div','row');row.append(btn(T('Yes, we’re here'),'btn primary',function(){var withName=((lastPlan||noticer.plan).seeds||[]).map(function(x){return x.person}).filter(function(n){return n&&n!==me.display}).join(', ');api('/api/account/visits',{method:'POST',body:{place:t,with:withName}}).then(function(){noticer.here={place:t,since:since};box.replaceChildren(text('p',null,T('Saved to Places you’ve been ✓ While the app is open, TasteBridge also notes how long you stay.')));setTimeout(function(){box.hidden=true},4000)})}),btn(T('No'),'btn',function(){box.hidden=true}));box.append(row);box.scrollIntoView({behavior:'smooth',block:'start'})}

document.addEventListener('tb:lang',function(){refreshAccount();if(roomId&&roomView)renderRoom(roomView)});
var m=/^\/r\/([a-z0-9]{6,16})$/.exec(location.pathname);
refreshAccount().then(function(d){if(m)openRoom(m[1]);else if(d&&d.review)reviewBox(d.review);var recent=d&&d.plans&&d.plans[0];if(me&&noticer.on&&recent&&Date.now()-recent.created<12*3600000)api('/api/account/plans/'+recent.id).then(function(r){noticer.plan=r.plan;startNotice()});else startNotice()});
window.addEventListener('popstate',function(){var x=/^\/r\/([a-z0-9]{6,16})$/.exec(location.pathname);if(x)openRoom(x[1]);else{clearInterval(poll);roomBox.hidden=true;hideForm(false)}});
})();`;
