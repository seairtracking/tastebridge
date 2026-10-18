// Ten-language support for the web app. The page is written in English. /i18n.js is a small core (the T()
// function, English agent messages and the static-text translator); each other language is its own pack at
// /i18n/<code>.js, so a phone downloads only the language it shows. Server messages arrive as { k, v }
// references (see i18n-msg.js) so a finished plan can be shown, and re-shown, in any language.
import { PAGE } from './i18n-page.js';
import { SOCIAL } from './i18n-social.js';
import { MSG } from './i18n-msg.js';
import { TASTE } from './i18n-taste.js';
import { MOMENTS } from './i18n-moments.js';
import { PLACES } from './i18n-places.js';

export const LANGS = [
  ['en', 'English'], ['vi', 'Tiếng Việt'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'],
  ['th', 'ไทย'], ['id', 'Indonesia'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'],
];
const CODES = LANGS.map((l) => l[0]);
// Every English key and its translations (vi…de), whichever dictionary it comes from.
export const TEXT = { ...PAGE, ...SOCIAL, ...TASTE, ...MOMENTS, ...PLACES };
const MSG_EN = Object.fromEntries(Object.entries(MSG).map(([k, v]) => [k, v[0]]));
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
export const I18N_VERSION = fnv(JSON.stringify([TEXT, MSG]));

// One language: English key → text, and message id → text.
export function langPack(code) {
  const i = CODES.indexOf(code);
  if (i < 1) return null;
  const text = Object.fromEntries(Object.entries(TEXT).map(([k, v]) => [k, v[i - 1]]).filter(([, v]) => v));
  const msg = Object.fromEntries(Object.entries(MSG).map(([k, v]) => [k, v[i]]).filter(([, v]) => v));
  return { text, msg };
}
const packs = new Map();
export function packScript(code) {
  if (!packs.has(code)) { const p = langPack(code); packs.set(code, p && `window.tbI18n(${JSON.stringify(code)},${JSON.stringify(p.text)},${JSON.stringify(p.msg)});`); }
  return packs.get(code);
}

const client = String.raw`
var CODES=LANGS.map(function(l){return l[0]}),REV={},MEM=new WeakMap(),DICT={},MSGL={},PACKS={};
// English message texts that also appear as plain words on the page ("Birthday", "Dinner"...).
Object.keys(MSGEN).forEach(function(k){var en=MSGEN[k];if(en.indexOf('{')<0&&!(en in REV))REV[en]=k});
function detect(){var s=null;try{s=localStorage.getItem('tb-lang')}catch(e){}if(s&&CODES.indexOf(s)>=0)return s;
  var list=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language||'en'];
  for(var i=0;i<list.length;i++){var c=String(list[i]).toLowerCase().split('-')[0];if(c==='in')c='id';if(CODES.indexOf(c)>=0)return c}return 'en'}
var lang=detect();
function raw(key){if(lang!=='en'){if(MSGL[key])return MSGL[key];if(DICT[key])return DICT[key];if(REV[key]&&MSGL[REV[key]])return MSGL[REV[key]]}
  if(MSGEN[key])return MSGEN[key];var g=/^(kind|cuisine|mood|special|occ|plural|stage|stop)\.(.+)$/.exec(key);return g?g[2]:key}
function T(key,vars){if(key==null||key==='')return '';if(typeof key==='object')return T(key.k,key.v);
  return raw(String(key)).replace(/\{(\w+)(?:\|(\w+))?\}/g,function(m,name,f){if(!vars||!(name in vars))return m;var v=vars[name];
    if(v&&typeof v==='object')return T(v.k,v.v);if(v==null)return '';return f?raw(f+'.'+v):String(v)})}
T.has=function(key){return lang!=='en'&&!!(DICT[key]||MSGL[key]||(REV[key]&&MSGL[REV[key]]))};
function cap(s,like){return /^[A-Z]/.test(like)?s.charAt(0).toUpperCase()+s.slice(1):s}
// Containers whose text the app writes itself (always through T); everything else is static English markup.
var SKIP='script,style,#places,#films,#filmNote,#method,#steps,#legend,#sky,#routeInfo,#routeMap,#title,#subtitle,#source,#warn,#room,#accountDialog,#tasteDialog,#momentDialog,#moments,#notice,.suggest,#review,#checkin,#lang';
function apply(){document.documentElement.lang=lang;document.title=lang==='en'?'TasteBridge — find your common ground':T('TasteBridge — find your common ground');
  var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n;
  while((n=w.nextNode())){var p=n.parentElement;if(!p||p.closest(SKIP))continue;var e=MEM.get(n),mine=e&&n.nodeValue===e.set,orig=mine?e.orig:n.nodeValue,t=orig.trim();
    if(!t)continue;if(!T.has(t)){if(mine){n.nodeValue=orig;MEM.delete(n)}continue}
    var out=orig.replace(t,cap(T(t),t));MEM.set(n,{orig:orig,set:out});n.nodeValue=out}
  document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(function(x){if(x.closest(SKIP))return;['placeholder','aria-label','title'].forEach(function(a){
    if(!x.hasAttribute(a))return;var keep='data-en-'+a,orig=x.getAttribute(keep);if(orig==null){orig=x.getAttribute(a);if(!T.has(orig))return;x.setAttribute(keep,orig)}x.setAttribute(a,T.has(orig)?T(orig):orig)})})}
function picker(){var s=document.getElementById('lang');if(!s)return;s.replaceChildren();LANGS.forEach(function(l){var o=document.createElement('option');o.value=l[0];o.textContent=l[1];o.selected=l[0]===lang;s.append(o)});
  s.setAttribute('aria-label',lang==='en'?'Language':T('Language'));s.onchange=function(){setLang(s.value)}}
function use(code){lang=code;window.tbLang=code;DICT=code==='en'?{}:PACKS[code].text;MSGL=code==='en'?{}:PACKS[code].msg}
// A language pack calls this when it loads.
window.tbI18n=function(code,text,msg){PACKS[code]={text:text,msg:msg};if(code===lang&&!window.tbI18nReady){use(code);window.tbI18nReady=true;apply();picker()}};
function setLang(code){if(CODES.indexOf(code)<0||code===lang)return;try{localStorage.setItem('tb-lang',code)}catch(e){}
  var go=function(){use(code);apply();picker();document.dispatchEvent(new Event('tb:lang'))};
  if(code==='en'||PACKS[code])return go();
  var s=document.createElement('script');s.src='/i18n/'+code+'.js?v='+VER;s.onload=function(){if(PACKS[code])go()};document.head.append(s)}
window.T=T;window.tbLang=lang;window.tbLangs=LANGS;window.tbSetLang=setLang;
// The first pack is written into the page while it is still being parsed, so the page never shows English first.
if(lang==='en'){window.tbI18nReady=true;apply();picker()}else document.write('<script src="/i18n/'+lang+'.js?v='+VER+'"><\/script>');`;

export const i18nScript = `(function(){'use strict';var MSGEN=${JSON.stringify(MSG_EN)},LANGS=${JSON.stringify(LANGS)},VER=${JSON.stringify(I18N_VERSION)};${client}})();`;
