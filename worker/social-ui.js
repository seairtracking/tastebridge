// Browser script for optional accounts and two-phone plans, served at /social.js. It builds on the page's
// own helpers (el, text, show, addStep, notice...) and never uses innerHTML for data.
export const socialScript = String.raw`(function(){
'use strict';
var me=null,friends=[],roomId=null,roomToken=null,roomView=null,poll=null,planning=false;
var store={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
var dialog=el('accountDialog'),roomBox=el('room');
function api(path,opts){opts=opts||{};var headers={'content-type':'application/json'};if(roomToken)headers['x-room-token']=roomToken;return fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined,credentials:'same-origin'}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error||'Request failed.');return d})})}
function btn(label,cls,onClick){var b=text('button',cls||'btn',label);b.type='button';b.addEventListener('click',onClick);return b}
function field(label,input){var l=text('label',null,label);var w=document.createElement('div');w.append(l,input);return w}
function input(type,value,attrs){var i=document.createElement('input');i.type=type;i.value=value||'';Object.keys(attrs||{}).forEach(function(k){i.setAttribute(k,attrs[k])});return i}
function choose(options,value){var s=document.createElement('select');options.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];if(o[0]===(value||''))op.selected=true;s.append(op)});return s}
var CUISINES=[['','Anything']].concat(['vietnamese','japanese','korean','chinese','thai','indian','italian','french','mexican','american','mediterranean','vegetarian'].map(function(c){return[c,c[0].toUpperCase()+c.slice(1)]}));
var MOODS=[['','Any'],['romantic','Romantic'],['cozy','Cozy'],['lively','Lively'],['quiet','Quiet'],['chill','Chill']];

// ---------- header + profile defaults ----------
function refreshAccount(){return api('/api/account').then(function(d){me=d.user;friends=d.friends||[];el('accountBtn').textContent=me?me.display+' ▾':'Sign in';if(me){el('firstLabel').textContent='You ('+me.display+') love';if(!el('first').value&&me.favorite)el('first').value=me.favorite;if(!el('city').value&&me.city)el('city').value=me.city;if(me.cuisine&&!el('cuisine').value)el('cuisine').value=me.cuisine}else el('firstLabel').textContent='You love';return d}).catch(function(){el('accountBtn').hidden=true;return{}})}

// ---------- account sheet ----------
function sheet(build){dialog.replaceChildren();var box=text('div','in');build(box);dialog.append(box);if(!dialog.open)dialog.showModal()}
function errorLine(){return text('p','err','')}
function authSheet(tab){sheet(function(box){box.append(text('h3',null,tab==='signup'?'Create your account':'Sign in'),text('p','muted','Optional: TasteBridge works without an account. An account remembers your favorite and lets friends plan with you.'));
  var tabs=text('div','tabs');var a=btn('Sign in','mode',function(){authSheet('login')}),b=btn('Create account','mode',function(){authSheet('signup')});a.setAttribute('aria-pressed',String(tab!=='signup'));b.setAttribute('aria-pressed',String(tab==='signup'));tabs.append(a,b);box.append(tabs);
  var f=document.createElement('form');var u=input('text','',{autocomplete:'username',maxlength:'20',required:''}),p=input('password','',{autocomplete:tab==='signup'?'new-password':'current-password',minlength:'8',required:''}),d=input('text','',{maxlength:'40'});
  f.append(field('Username',u));if(tab==='signup')f.append(field('Display name',d));f.append(field('Password',p));var err=errorLine();f.append(err);
  var row=text('div','bar-row');row.append(btn('Cancel','btn',function(){dialog.close()}));var go=text('button','btn primary',tab==='signup'?'Create account':'Sign in');go.type='submit';row.append(go);f.append(row);
  f.addEventListener('submit',function(e){e.preventDefault();go.disabled=true;api('/api/account/'+(tab==='signup'?'signup':'login'),{method:'POST',body:{username:u.value,password:p.value,display:d.value}}).then(function(){return refreshAccount()}).then(function(){dialog.close();if(tab==='signup')profileSheet()}).catch(function(x){err.textContent=x.message}).finally(function(){go.disabled=false})});
  box.append(f);setTimeout(function(){u.focus()},50)})}

function profileSheet(){refreshAccount().then(function(d){if(!me)return authSheet('login');sheet(function(box){
  box.append(text('h3',null,'Hi, '+me.display),text('p','muted','@'+me.username+' · Your favorite is shared only with friends who accept you.'));
  var f=document.createElement('form');var dn=input('text',me.display,{maxlength:'40'}),fav=input('text',me.favorite,{maxlength:'70',placeholder:'e.g. Spirited Away'}),city=input('text',me.city,{maxlength:'70',placeholder:'e.g. Ho Chi Minh City'}),cu=choose(CUISINES,me.cuisine),mo=choose(MOODS,me.mood);
  f.append(field('Display name',dn),field('Your favorite (artist, film, book, show or game)',fav),field('Home city',city),field('Usual food',cu),field('Usual mood',mo));var err=errorLine();f.append(err);
  var row=text('div','bar-row');var save=text('button','btn primary','Save profile');save.type='submit';row.append(save);f.append(row);
  f.addEventListener('submit',function(e){e.preventDefault();api('/api/account/profile',{method:'PUT',body:{display:dn.value,favorite:fav.value,city:city.value,cuisine:cu.value,mood:mo.value}}).then(function(){el('first').value=fav.value;return refreshAccount()}).then(function(){err.textContent='Saved.'}).catch(function(x){err.textContent=x.message})});
  box.append(f);
  // friends
  var fs=text('section');fs.append(text('h4',null,'Friends'));var add=document.createElement('form');add.className='row';var un=input('text','',{placeholder:'Friend’s username',maxlength:'20'});var ab=text('button','btn','Add');ab.type='submit';var row2=text('div','bar-row');row2.append(un,ab);add.append(row2);var ferr=errorLine();
  add.addEventListener('submit',function(e){e.preventDefault();api('/api/account/friends',{method:'POST',body:{username:un.value}}).then(function(r){ferr.textContent=r.status==='accepted'?'You are now friends.':'Request sent. They need to accept.';un.value='';profileSheet()}).catch(function(x){ferr.textContent=x.message})});
  fs.append(add,ferr);var ul=text('ul','list');
  (d.friends||[]).forEach(function(fr){var li=text('li');var who=text('span',null,fr.display+' @'+fr.username+(fr.status==='friend'&&fr.favorite?' · loves '+fr.favorite:''));li.append(who);var act=text('span');
    if(fr.status==='received')act.append(btn('Accept','vote',function(){api('/api/account/friends/accept',{method:'POST',body:{username:fr.username}}).then(profileSheet)}));
    if(fr.status==='friend')act.append(btn('Plan tonight','vote',function(){dialog.close();startRoom(fr.username)}));
    act.append(btn(fr.status==='friend'?'Remove':fr.status==='sent'?'Cancel':'Decline','vote',function(){api('/api/account/friends/remove',{method:'POST',body:{username:fr.username}}).then(profileSheet)}));
    if(fr.status==='sent')who.append(text('span','muted',' · waiting'));li.append(act);ul.append(li)});
  if(!(d.friends||[]).length)ul.append(text('li','muted','No friends yet. Add someone by their username.'));fs.append(ul);box.append(fs);
  // invites and plans
  var ps=text('section');ps.append(text('h4',null,'Your plans'));var pl=text('ul','list');
  (d.invites||[]).forEach(function(r){var li=text('li');li.append(text('span',null,r.host+' invited you'),btn('Open','vote',function(){location.href='/r/'+r.id}));pl.append(li)});
  (d.rooms||[]).forEach(function(r){var li=text('li');li.append(text('span',null,(r.other?'With '+r.other:'Waiting for your friend')+(r.planned?' · planned':'')),btn('Open','vote',function(){location.href='/r/'+r.id}));pl.append(li)});
  if(!pl.childNodes.length)pl.append(text('li','muted','Plans you make on two phones appear here for 48 hours.'));ps.append(pl);box.append(ps);
  // sign out, delete
  var end=text('section');var row3=text('div','bar-row');
  row3.append(btn('Delete account','btn',function(){var pw=prompt('Type your password to delete your account and all its data.');if(!pw)return;api('/api/account/delete',{method:'POST',body:{password:pw}}).then(function(){dialog.close();location.reload()}).catch(function(x){alert(x.message)})}));
  row3.append(btn('Sign out','btn',function(){api('/api/account/logout',{method:'POST'}).then(function(){dialog.close();location.reload()})}),btn('Close','btn primary',function(){dialog.close()}));end.append(row3);box.append(end)})})}
el('accountBtn').addEventListener('click',function(){me?profileSheet():authSheet('login')});

// ---------- two-phone rooms ----------
function settingsFromForm(){var near=window.tbNear&&window.tbNear();return{mode:form.dataset.show==='plan'?'plan':'evening',city:el('city').value,lat:near&&near.lat,lon:near&&near.lon,start:el('start').value,day:['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()],cuisine:el('cuisine').value,mood:window.tbMood?window.tbMood():'',budget:el('budget').value,occasion:window.tbOccasion?window.tbOccasion():'dinner',special:window.tbSpecial?window.tbSpecial():''}}
function startRoom(friendUsername){notice.className='notice';var fav=el('first').value.trim();if(fav.length<2){notice.textContent='Type your favorite first, then invite your friend.';notice.className='notice show';el('first').focus();return}
  roomBox.hidden=false;roomBox.replaceChildren();roomBox.append(text('div','step','Plan on two phones'),text('h3',null,friendUsername?'Planning with '+friendUsername:'Invite your friend'),text('p',null,'Your friend opens the link on their own phone and adds their favorite. Neither of you sees the other’s pick until the plan is ready.'));
  var row=text('div','row');var nm=input('text',me?me.display:store.get('tb-name')||'',{placeholder:'Your name (shown to your friend)',maxlength:'40'});var go=btn('Create invite','btn primary',function(){go.disabled=true;store.set('tb-name',nm.value);api('/api/rooms',{method:'POST',body:{name:nm.value,favorite:fav,settings:settingsFromForm(),invite:friendUsername||undefined}}).then(function(r){roomToken=r.token;store.set('tb-room-'+r.id,r.token);history.pushState(null,'','/r/'+r.id);openRoom(r.id)}).catch(function(x){notice.textContent=x.message;notice.className='notice show';go.disabled=false})});
  row.append(nm,go,btn('Cancel','btn',function(){roomBox.hidden=true}));roomBox.append(row);roomBox.scrollIntoView({behavior:'smooth',block:'start'})}
el('twoPhones').addEventListener('click',function(){startRoom(null)});

function hideForm(on){form.hidden=on;var top=document.querySelector('#try .section-top');if(top)top.hidden=on}
function leaveRoom(){clearInterval(poll);roomId=null;roomToken=null;roomBox.hidden=true;hideForm(false);results.classList.remove('show');agent.classList.remove('show');history.pushState(null,'','/')}
function openRoom(id){roomId=id;hideForm(true);roomToken=store.get('tb-room-'+id);roomBox.hidden=false;clearInterval(poll);load();poll=setInterval(function(){if(!document.hidden&&!planning)load()},3000)}
function load(){return api('/api/rooms/'+roomId).then(renderRoom).catch(function(x){clearInterval(poll);roomBox.replaceChildren(text('h3',null,'Invite not found'),text('p',null,x.message));roomBox.append(btn('Plan your own evening','btn primary',leaveRoom))})}
var shownPlan=0;
function renderRoom(v){roomView=v;var host=v.members[0],friend=v.members[1];var you=v.you;roomBox.replaceChildren();var s=v.settings;
  var what=[s.mode==='plan'?'a quick shortlist':'tonight',s.city?'in '+s.city:'near '+(you===0?'you':host.name),s.special?'· '+s.special.replace('-',' '):'',s.cuisine?'· '+s.cuisine:'',s.mood?'· '+s.mood:''].filter(Boolean).join(' ');
  var head=text('div','row');head.style.justifyContent='space-between';head.style.marginTop='0';head.append(text('div','step','Plan on two phones'),btn('Leave this plan','vote',leaveRoom));roomBox.append(head);
  var people=text('div','people');v.members.forEach(function(m){people.append(text('span','person',(m.slot===you?'You':m.name)+(m.favorite?' · '+m.favorite:'')+' ✓'))});if(!friend)people.append(text('span','person wait','Waiting for your friend…'));
  if(v.canJoin){roomBox.append(text('h3',null,host.name+' invited you to plan '+what),text('p',null,'Add one thing you love: an artist, film, book, show or game. '+host.name+' will not see it until the plan is ready.'));
    var f=document.createElement('form');f.className='row';var nm=input('text',me?me.display:store.get('tb-name')||'',{placeholder:'Your name',maxlength:'40'}),fav=input('text',me&&me.favorite||'',{placeholder:'You love… e.g. Daft Punk',maxlength:'70',required:''});var go=text('button','btn primary','Join');go.type='submit';f.append(nm,fav,go);
    f.addEventListener('submit',function(e){e.preventDefault();go.disabled=true;store.set('tb-name',nm.value);api('/api/rooms/'+roomId+'/join',{method:'POST',body:{name:nm.value,favorite:fav.value}}).then(function(r){roomToken=r.token;store.set('tb-room-'+roomId,r.token);load()}).catch(function(x){notice.textContent=x.message;notice.className='notice show';go.disabled=false})});
    roomBox.append(f);roomBox.scrollIntoView({block:'start'});return}
  if(you==null){roomBox.append(text('h3',null,'This plan is full'),text('p',null,'Two people have already joined. Ask '+host.name+' for a new invite.'));return}
  roomBox.append(text('h3',null,v.plan?'Your shared plan is ready':friend?'Both of you are in':'Send this invite to your friend'),people);
  if(!friend){var row=text('div','row');var link=location.origin+'/r/'+roomId;row.append(text('span','link',link),btn('Copy link','btn',function(e){navigator.clipboard&&navigator.clipboard.writeText(link).then(function(){e.target.textContent='Copied ✓'})}));if(navigator.share)row.append(btn('Share…','btn primary',function(){navigator.share({title:'Plan tonight with me',text:'Add your favorite and TasteBridge plans a fair evening for both of us.',url:link}).catch(function(){})}));roomBox.append(row,text('p','muted','The invite works for 48 hours. This page updates when your friend joins.'))}
  else if(!v.plan){var row2=text('div','row');row2.append(btn(planning?'The agent is working…':'Plan our '+(s.mode==='plan'?'shortlist':'evening')+' ↗','btn primary',runRoomPlan));roomBox.append(row2,text('p','muted','Either of you can start. The other phone shows the plan as soon as it is ready.'))}
  if(v.plan&&v.planned!==shownPlan){shownPlan=v.planned;show(v.plan)}
  if(v.plan)decorateVotes(v)}
function runRoomPlan(e){if(planning)return;planning=true;e.target.disabled=true;e.target.textContent='The agent is working…';notice.className='notice';results.classList.remove('show');el('steps').replaceChildren();agent.classList.add('show');
  var headers={'content-type':'application/json',accept:'application/x-ndjson'};if(roomToken)headers['x-room-token']=roomToken;
  fetch('/api/rooms/'+roomId+'/plan',{method:'POST',headers:headers,credentials:'same-origin',body:'{}'}).then(function(res){if(!res.ok||!res.body)return res.json().then(function(d){throw new Error(d.error||'Request failed.')});var reader=res.body.getReader(),dec=new TextDecoder(),buf='';
    function pump(){return reader.read().then(function(c){if(c.done)return;buf+=dec.decode(c.value,{stream:true});var lines=buf.split('\n');buf=lines.pop();lines.forEach(function(l){if(!l.trim())return;var m=JSON.parse(l);if(m.event==='step')addStep(m.step);else if(m.event==='error')throw new Error(m.error)});return pump()})}return pump()})
  .catch(function(x){notice.textContent=x.message;notice.className='notice show'}).finally(function(){planning=false;load()})}
function decorateVotes(v){document.querySelectorAll('#results [data-option]').forEach(function(card){var id=card.dataset.option;if(!id)return;var old=card.querySelector('.votes');if(old)old.remove();var t=v.votes[id]||{up:0,down:0,mine:0};var row=text('div','votes');
  [[1,'👍 '+t.up],[-1,'👎 '+t.down]].forEach(function(o){var b=btn(o[1],'vote',function(){api('/api/rooms/'+roomId+'/vote',{method:'POST',body:{option:id,value:t.mine===o[0]?0:o[0]}}).then(load)});b.setAttribute('aria-pressed',String(t.mine===o[0]));b.setAttribute('aria-label',(o[0]>0?'Like ':'Dislike ')+'this option');row.append(b)});card.append(row)})}

var m=/^\/r\/([a-z0-9]{6,16})$/.exec(location.pathname);
refreshAccount().then(function(){if(m)openRoom(m[1])});
window.addEventListener('popstate',function(){var x=/^\/r\/([a-z0-9]{6,16})$/.exec(location.pathname);if(x)openRoom(x[1]);else{clearInterval(poll);roomBox.hidden=true;hideForm(false)}});
})();`;
