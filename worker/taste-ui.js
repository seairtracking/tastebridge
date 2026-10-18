// Browser script for the taste profile sheet, served at /taste.js. A person picks genres and names a few
// favorites per section; TasteBridge shows what they really like (shared Qloo traits) and uses the whole
// profile as their signal when planning. Builds on the page's helpers (el, text, T, attachSuggest).
import { SECTIONS, INSTRUMENTS, HOBBY_GROUPS } from './taste.js';

// English labels for every chip; translations live in i18n-taste.js under the same English text.
export const LABELS = {
  action: 'Action', comedy: 'Comedy', drama: 'Drama', romance: 'Romance', horror: 'Horror', thriller: 'Thriller', science_fiction: 'Science fiction',
  animation: 'Animation', fantasy: 'Fantasy', mystery: 'Mystery', documentary: 'Documentary', crime: 'Crime', family: 'Family', adventure: 'Adventure',
  pop: 'Pop', rock: 'Rock', hip_hop: 'Hip-hop', electronic: 'Electronic', jazz: 'Jazz', classical: 'Classical', r_b_soul: 'R&B / Soul', k_pop: 'K-pop',
  indie: 'Indie', ballad: 'Ballad', metal: 'Metal', lo_fi: 'Lo-fi', edm: 'EDM',
  self_help: 'Self-help', biography: 'Biography', history: 'History', young_adult: 'Young adult', classics: 'Classics', nonfiction: 'Non-fiction',
  manga: 'Manga', business: 'Business', poetry: 'Poetry',
  soccer: 'Soccer', football: 'American football', basketball: 'Basketball', baseball: 'Baseball', hockey: 'Ice hockey', cricket: 'Cricket',
  beaches: 'Beaches', nature: 'Nature', great_nightlife: 'Nightlife', urban_destinations: 'Big cities', art_culture: 'Art & culture',
  foodie_destination: 'Food trips', romantic_getaways: 'Romantic getaways', outdoor_activities: 'Outdoor activities',
  fashion: 'Fashion', retail: 'Shopping', electronics: 'Electronics', automotive: 'Cars', travel: 'Travel', entertainment: 'Media & news',
  guitar: 'Guitar', piano: 'Piano', violin: 'Violin', drums: 'Drums', ukulele: 'Ukulele', saxophone: 'Saxophone', bass: 'Bass', flute: 'Flute',
  cello: 'Cello', trumpet: 'Trumpet', keyboards: 'Keyboards', synthesizers: 'Synthesizers', vocals: 'Singing',
  photography: 'Photography', hiking: 'Hiking', yoga: 'Yoga', running: 'Running', musician: 'Making music', video_gamer: 'Gaming',
  arts_crafts: 'Arts & crafts', dance: 'Dancing', meditation: 'Meditation', outdoors: 'The outdoors', swimming: 'Swimming', fishing: 'Fishing',
  tennis: 'Tennis', golf: 'Golf', martial_arts: 'Martial arts', motorcycles: 'Motorbikes', architecture: 'Architecture', home_decor: 'Home decor',
  street_fashion: 'Street fashion', sneakerheads: 'Sneakers', wine_enthusiast: 'Wine', foodie: 'Food', cooking: 'Cooking', coffee: 'Coffee',
  avid_reader: 'Reading', cinephile: 'Films', museums: 'Museums', music_festivals: 'Music festivals', arts_culture: 'Art & culture', exercising: 'Working out',
  adventuring: 'Adventures', adrenaline_rushers: 'Adrenaline', casual_escapists: 'Easy escapes', secret_unravelers: 'Mysteries and puzzles', spy_enthusiast: 'Spy stories',
  american_football: 'American football', wrestling: 'Wrestling', racing: 'Racing', home_organization: 'Tidying up', high_fashion: 'High fashion',
  jewellery: 'Jewellery', watches: 'Watches', perfume: 'Perfume', health_and_beauty: 'Health and beauty', tattoos: 'Tattoos', news_junkie: 'News',
  healthy_eating: 'Healthy eating', veganism: 'Vegan', organic_ingredients: 'Organic food', astrology: 'Astrology', spirituality: 'Spirituality',
  gourmand_fine_dining: 'Fine dining', discount_shoppers: 'Bargain hunting', boutique_hotels: 'Boutique hotels', vintage_apparel: 'Vintage clothes',
  technology_enthusiast: 'Tech gadgets', watch_collecting: 'Watch collecting', parents_with_young_children: 'Parent of young kids', single: 'Single',
  engaged: 'Engaged', retirement: 'Retired', business_professional: 'Business', technology_professional: 'Tech', marketing_professional: 'Marketing',
  advertising_design: 'Advertising and design', finance_professional: 'Finance', sales_professional: 'Sales', retail_professional: 'Retail',
  hospitality_professional: 'Hospitality', medical_professional: 'Healthcare', stocks_bonds: 'Stocks and bonds', real_estate: 'Real estate',
  angel_start_up_investing: 'Startups', cryptocurrency_enthusiasts: 'Crypto', nft_collectors: 'NFTs', art_collectibles: 'Art collecting',
  climate_activism: 'Climate', sustainability: 'Sustainability', ocean_health: 'Oceans', animal_issues: 'Animals', mental_health: 'Mental health',
  education_issues: 'Education', gender_equality: 'Gender equality', racial_justice: 'Racial justice', wealth_inequality: 'Inequality', fair_wages: 'Fair pay', foreign_affairs: 'World affairs',
};
const GROUPS_EN = { hobbies: 'Hobbies', leisure: 'Free time', lifestyle: 'Lifestyle', spending: 'How you spend', life: 'Life stage', work: 'Work', investing: 'Investing', causes: 'Causes you care about' };
const NAMES = { film: 'Films', tv: 'Series', music: 'Music', book: 'Books', game: 'Games', sport: 'Sports', travel: 'Travel', brand: 'Brands' };
const BOX = { film: 'Films you love', tv: 'Series you love', music: 'Artists you love', book: 'Books or authors you love', game: 'Games you love', sport: 'Teams, leagues or athletes you follow', travel: 'Places you loved visiting', brand: 'Brands you love' };

const client = String.raw`
var slug=function(id){return id.split(':').pop()};
var label=function(id){return T(LABELS[slug(id)]||slug(id))};
var KEY='tb-taste',state=load(),busy=false;
function load(){try{var v=JSON.parse(localStorage.getItem(KEY)||'null');if(v&&v.profile)return v}catch(e){}return{profile:{sections:{},instruments:[],hobbies:[]},active:false}}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}if(window.tbMe)fetch('/api/account/taste',{method:'PUT',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({taste:state.profile})}).catch(function(){})}
function sec(id){var s=state.profile.sections[id];if(!s){s={picks:[],genres:[]};state.profile.sections[id]=s}return s}
function size(){var n=0;Object.keys(state.profile.sections).forEach(function(k){var s=state.profile.sections[k];n+=s.picks.length+s.genres.length});return n}
function picks(){var out=[];SECTIONS.forEach(function(s){var x=state.profile.sections[s.id];if(x)out=out.concat(x.picks)});return out}
function summary(){var p=picks().map(function(x){return x.name}),g=[];SECTIONS.forEach(function(s){var x=state.profile.sections[s.id];if(x)x.genres.forEach(function(t){g.push(label(t))})});
  var all=p.concat(g);return all.slice(0,2).join(', ')+(all.length>2?' +'+(all.length-2):'')}
function toggle(list,id,max){var i=list.indexOf(id);if(i>=0)list.splice(i,1);else if(list.length<max)list.push(id);return list}
function chip(name,on,onClick){var b=text('button','chip',name);b.type='button';b.setAttribute('aria-pressed',String(on));b.addEventListener('click',onClick);return b}

// ---- the field on the main form ----
function sync(){var b=el('tasteBtn'),f=el('first');if(!b)return;var on=state.active&&size()>0;b.textContent=on?T('✨ My taste ✓'):T('✨ My taste');b.setAttribute('aria-pressed',String(on));
  if(on){f.value=summary();f.readOnly=true;f.dataset.profile='1';delete f.dataset.pick}else if(f.dataset.profile){f.value='';f.readOnly=false;delete f.dataset.profile}}
window.tbProfile=function(){return state.active&&size()>0?state.profile:null};
window.tbProfileAny=function(){return size()>0?state.profile:null};
window.tbProfileLabel=summary;

// ---- the sheet ----
var dialog=el('tasteDialog'),report=null;
function open(){render();if(!dialog.open)dialog.showModal()}
function render(){dialog.replaceChildren();var box=text('div','in');dialog.append(box);
  box.append(text('h3',null,T('Your taste profile')),text('p','muted',T('Pick the genres you enjoy and name a few favorites. Nothing is required: genres alone are enough if you cannot remember titles. TasteBridge then shows what you really like, from Qloo’s data.')));
  SECTIONS.forEach(function(s){var x=sec(s.id),d=document.createElement('details');d.className='taste-sec';if(x.picks.length||x.genres.length)d.open=true;
    var head=document.createElement('summary');head.textContent=s.icon+' '+T(NAMES[s.id])+((x.picks.length||x.genres.length)?' · '+(x.picks.length+x.genres.length):'');d.append(head);
    if(s.genres.length){var row=text('div','chips');s.genres.forEach(function(g){row.append(chip(label(g),x.genres.indexOf(g)>=0,function(){toggle(x.genres,g,4);render()}))});d.append(text('div','taste-label',T('Genres you enjoy')),row)}
    d.append(text('div','taste-label',T(BOX[s.id])+' '+T('(up to 3)')));
    var list=text('div','chips');x.picks.forEach(function(p,i){var c=chip(p.name+' ✕',true,function(){x.picks.splice(i,1);render()});c.setAttribute('aria-label',T('Remove')+' '+p.name);list.append(c)});d.append(list);
    if(x.picks.length<3){var wrap=text('div','field');var inp=document.createElement('input');inp.placeholder=T('Type a name and pick it from the list');inp.autocomplete='off';inp.maxLength=70;var hint=text('div','muted','');
      wrap.append(inp);d.append(wrap,hint);inp.addEventListener('input',function(){hint.textContent=''});
      window.attachSuggest(inp,{types:s.types,onPick:function(it){if(!x.picks.some(function(p){return p.id===it.id}))x.picks.push({id:it.id,name:it.name,kind:it.kind});render()},onEmpty:function(){hint.textContent=T('Qloo does not know this one yet. Your genres still count.')}})}
    box.append(d)});
  var h=document.createElement('details');h.className='taste-sec';var pr=state.profile;if(pr.instruments.length||pr.hobbies.length)h.open=true;var hs=document.createElement('summary');hs.textContent='🎸 '+T('Instruments and hobbies');h.append(hs);
  var r1=text('div','chips');INSTRUMENTS.forEach(function(t){r1.append(chip(label(t),pr.instruments.indexOf(t)>=0,function(){toggle(pr.instruments,t,5);render()}))});
  h.append(text('div','taste-label',T('Instruments you play')),r1);
  HOBBY_GROUPS.forEach(function(g){var r=text('div','chips');g.ids.forEach(function(t){r.append(chip(label(t),pr.hobbies.indexOf(t)>=0,function(){toggle(pr.hobbies,t,20);render()}))});h.append(text('div','taste-label',T(GROUPS_EN[g.id])),r)});
  h.append(text('p','muted',T('These describe you in your portrait. Qloo’s data on hobbies is too loose to pick places, so only a few act on the plan: vegan or healthy eating, bargain hunting, fine dining and young kids.')));box.append(h);
  var err=text('p','err','');var bar=text('div','bar-row');
  var go=text('button','btn primary',busy?T('Reading your taste…'):T('What do I really like?'));go.type='button';go.disabled=busy||!size();go.addEventListener('click',function(){ask(err)});
  var use=text('button','btn',T('Use for planning'));use.type='button';use.disabled=!size();use.addEventListener('click',function(){state.active=true;save();sync();dialog.close()});
  var off=text('button','btn',state.active?T('Use a single favorite instead'):T('Close'));off.type='button';off.addEventListener('click',function(){state.active=false;save();sync();dialog.close()});
  bar.append(off,use,go);box.append(err,bar);if(report)box.append(showReport(report))}
function ask(err){busy=true;render();fetch('/api/taste',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:state.profile})}).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(T(d.error||'Request failed.'));return d})})
  .then(function(d){report=d;save()}).catch(function(x){report=null;setTimeout(function(){var e=dialog.querySelector('.err');if(e)e.textContent=x.message},0)}).finally(function(){busy=false;render();var r=dialog.querySelector('.taste-report');if(r)r.scrollIntoView({behavior:'smooth',block:'start'})})}
var GROUPS=[['themes','Stories and themes you return to'],['moods','The feel you like'],['viewer','What kind of fan you are'],['interests','Interests that go with it'],['genres','Genres underneath']];
var FOUND=[['film','Films'],['tv','Series'],['music','Artists'],['book','Books'],['travel','Places to travel']];
function showReport(d){var box=text('section','taste-report');box.append(text('h3',null,T('What you really like')),text('p','muted',T('Traits Qloo attaches to your favorites. The more of your favorites share a trait, the stronger it is. Trait names come from Qloo in English.')));
  GROUPS.forEach(function(g){var list=(d.portrait||{})[g[0]]||[];if(!list.length)return;var row=text('div','chips');list.forEach(function(t){var c=text('span','trait',t.name+(t.from.length>1?' ×'+t.from.length:''));c.title=T('From: {list}',{list:t.from.join(', ')});row.append(c)});box.append(text('div','taste-label',T(g[1])),row)});
  var me=[];state.profile.instruments.forEach(function(t){me.push(label(t))});state.profile.hobbies.forEach(function(t){me.push(label(t))});if(me.length)box.append(text('div','taste-label',T('You also')),text('p',null,me.join(' · ')));
  if((d.standIns||[]).length)box.append(text('p','muted',T('For the genres you picked, Qloo’s best-known works stand in: {list}.',{list:d.standIns.map(function(x){return x.name}).join(', ')})));
  var more=document.createElement('div');FOUND.forEach(function(f){var list=(d.discover||{})[f[0]]||[];if(!list.length)return;var row=text('div','found');list.forEach(function(x){var c=text('div','found-card');if(x.image&&/^https:/.test(x.image)){var im=document.createElement('img');im.src=x.image;im.alt='';im.loading='lazy';im.referrerPolicy='no-referrer';im.onerror=function(){im.remove()};c.append(im)}c.append(text('b',null,x.name));if(x.year)c.append(text('small',null,String(x.year)));row.append(c)});more.append(text('div','taste-label',T(f[1])),row)});
  if(more.childNodes.length)box.append(text('h4',null,T('You might also like')),more);
  return box}

el('tasteBtn').addEventListener('click',open);window.tbOpenTaste=open;
document.addEventListener('tb:account',function(){var t=window.tbMe&&window.tbMe.taste;if(t&&!size()){state.profile={sections:t.sections||{},instruments:t.instruments||[],hobbies:t.hobbies||[]};state.active=true;try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}sync()}});
document.addEventListener('tb:lang',function(){sync();if(dialog.open)render()});
sync();`;

export const tasteScript = '(function(){\'use strict\';var SECTIONS=' + JSON.stringify(SECTIONS.map(({ id, icon, types, genres }) => ({ id, icon, types, genres })))
  + ',INSTRUMENTS=' + JSON.stringify(INSTRUMENTS) + ',HOBBY_GROUPS=' + JSON.stringify(HOBBY_GROUPS) + ',GROUPS_EN=' + JSON.stringify(GROUPS_EN) + ',LABELS=' + JSON.stringify(LABELS)
  + ',NAMES=' + JSON.stringify(NAMES) + ',BOX=' + JSON.stringify(BOX) + ';' + client + '})();';
