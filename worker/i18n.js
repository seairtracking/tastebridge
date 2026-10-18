// Ten-language support for the web app, served at /i18n.js. The page is written in English; this script
// translates its static text in place and gives the page and /social.js a T(key, vars) function.
// Server messages arrive as { k, v } references (see i18n-msg.js) so they can be shown in any language.
import { PAGE } from './i18n-page.js';
import { SOCIAL } from './i18n-social.js';
import { MSG } from './i18n-msg.js';
import { TASTE } from './i18n-taste.js';

export const LANGS = [
  ['en', 'English'], ['vi', 'Tiếng Việt'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'],
  ['th', 'ไทย'], ['id', 'Indonesia'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'],
];

const client = String.raw`
var CODES=LANGS.map(function(l){return l[0]}),REV={},MEM=new WeakMap();
Object.keys(MSG).forEach(function(k){var en=MSG[k][0];if(en.indexOf('{')<0&&!(en in REV))REV[en]=k});
function detect(){var s=null;try{s=localStorage.getItem('tb-lang')}catch(e){}if(s&&CODES.indexOf(s)>=0)return s;
  var list=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en'];
  for(var i=0;i<list.length;i++){var c=String(list[i]).toLowerCase().split('-')[0];if(c==='in')c='id';if(CODES.indexOf(c)>=0)return c}return 'en'}
var lang=detect();
function idx(){return CODES.indexOf(lang)}
function raw(key){if(MSG[key])return MSG[key][idx()]||MSG[key][0];if(TEXT[key])return idx()?TEXT[key][idx()-1]||key:key;if(REV[key])return raw(REV[key]);
  var g=/^(kind|cuisine|mood|special|occ|plural|stage|stop)\.(.+)$/.exec(key);return g?g[2]:key}
function T(key,vars){if(key==null||key==='')return '';if(typeof key==='object')return T(key.k,key.v);
  return raw(String(key)).replace(/\{(\w+)(?:\|(\w+))?\}/g,function(m,name,f){if(!vars||!(name in vars))return m;var v=vars[name];
    if(v&&typeof v==='object')return T(v.k,v.v);if(v==null)return '';return f?raw(f+'.'+v):String(v)})}
T.has=function(key){return !!(MSG[key]||TEXT[key]||REV[key])};
function cap(s,like){return /^[A-Z]/.test(like)?s.charAt(0).toUpperCase()+s.slice(1):s}
var SKIP='script,style,#results,#agent,#room,#accountDialog,#notice,.suggest,#review,#checkin,#lang';
function apply(){document.documentElement.lang=lang;document.title=T('TasteBridge — find your common ground');
  var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n;
  while((n=w.nextNode())){var p=n.parentElement;if(!p||p.closest(SKIP))continue;var e=MEM.get(n),orig=e&&n.nodeValue===e.set?e.orig:n.nodeValue,t=orig.trim();
    if(!t||!T.has(t))continue;var out=orig.replace(t,cap(T(t),t));MEM.set(n,{orig:orig,set:out});n.nodeValue=out}
  document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(function(x){if(x.closest(SKIP))return;['placeholder','aria-label','title'].forEach(function(a){
    if(!x.hasAttribute(a))return;var keep='data-en-'+a,orig=x.getAttribute(keep);if(orig==null){orig=x.getAttribute(a);if(!T.has(orig))return;x.setAttribute(keep,orig)}x.setAttribute(a,T(orig))})})}
function picker(){var s=document.getElementById('lang');if(!s)return;s.replaceChildren();LANGS.forEach(function(l){var o=document.createElement('option');o.value=l[0];o.textContent=l[1];o.selected=l[0]===lang;s.append(o)});
  s.setAttribute('aria-label',T('Language'));s.onchange=function(){setLang(s.value)}}
function setLang(code){if(CODES.indexOf(code)<0||code===lang)return;lang=code;window.tbLang=code;try{localStorage.setItem('tb-lang',code)}catch(e){}apply();picker();document.dispatchEvent(new Event('tb:lang'))}
window.T=T;window.tbLang=lang;window.tbLangs=LANGS;window.tbSetLang=setLang;
apply();picker();`;

export const i18nScript = `(function(){'use strict';var TEXT=${JSON.stringify({ ...PAGE, ...SOCIAL, ...TASTE })},MSG=${JSON.stringify(MSG)},LANGS=${JSON.stringify(LANGS)};${client}})();`;
