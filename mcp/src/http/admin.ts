/**
 * The operator's log viewer, /mcp/admin (and /mcp/admin/logs.json). Off unless ADMIN_PASSWORD is
 * set, linked from nowhere, and behind HTTP Basic auth (any user name, that password). The server
 * only reads the month files for the asked range; all analysis runs in the page's one script.
 * Tool names and RPC methods come from clients, so the script writes every value as text, never HTML.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { GrantOwner } from "./grants.js";
import { logFileName, type LogLine } from "./log-file.js";

/** The most lines one request returns; past it the newest are kept. */
export const MAX_LINES = 200_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: unknown): s is string => typeof s === "string" && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const digest = (s: string) => createHash("sha256").update(s).digest();

/** True when an `Authorization: Basic …` header carries `password` (the user name is ignored). */
export function checkBasicAuth(header: string | undefined, password: string): boolean {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? "");
  if (!match) return false;
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}

/** The months touched by [from, to], as their file names. */
export function monthFiles(from: string, to: string): string[] {
  const names: string[] = [];
  const at = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = `${to.slice(0, 7)}`;
  while (at.toISOString().slice(0, 7) <= end) {
    names.push(logFileName(at));
    at.setUTCMonth(at.getUTCMonth() + 1);
  }
  return names;
}

/** Every logged line whose `t` falls on a UTC day in [from, to], oldest first. */
export async function readLogs(dir: string, from: string, to: string, max = MAX_LINES): Promise<{ lines: LogLine[]; truncated: boolean }> {
  let lines: LogLine[] = [];
  let truncated = false;
  for (const name of monthFiles(from, to)) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    for await (const text of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) {
      if (!text) continue;
      let line: unknown;
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof line !== "object" || line === null) continue;
      const t = (line as LogLine)["t"];
      if (typeof t !== "string") continue;
      const day = t.slice(0, 10);
      if (day < from || day > to) continue;
      lines.push(line as LogLine);
      if (lines.length > 2 * max) {
        lines = lines.slice(-max);
        truncated = true;
      }
    }
  }
  if (lines.length > max) {
    lines = lines.slice(-max);
    truncated = true;
  }
  return { lines, truncated };
}

/**
 * Adds each line's person (`user`, the first 8 characters of the grant's pseudonym) and app
 * (`client`) from the grants still on record. Lines logged before requests carried `user` get it
 * only this way, so a purged grant's old lines stay without a person unless the page can borrow
 * one from a newer line of the same connection.
 */
export function addOwners(lines: LogLine[], owners: GrantOwner[]): LogLine[] {
  const byPrefix = new Map(owners.map((o) => [o.grantId.slice(0, 8), o]));
  return lines.map((l) => {
    const owner = typeof l["grant"] === "string" ? byPrefix.get(l["grant"]) : undefined;
    if (!owner) return l;
    return { ...l, user: typeof l["user"] === "string" ? l["user"] : owner.userHash.slice(0, 8), client: owner.clientName };
  });
}

/**
 * The page's only script. A constant, so the CSP can pin it by hash. It loads
 * /mcp/admin/logs.json?from&to and draws the overview, the chart and the tables. Each table is a
 * facet: it applies every filter except its own, so picking a tool keeps the other tools visible
 * (dimmed) and the selected one highlighted. Range and filters live in the URL hash; person names
 * and the time zone choice live in this browser's localStorage.
 */
export const ADMIN_SCRIPT = String.raw`(function(){
"use strict";
var $=function(id){return document.getElementById(id);};
var DAY=864e5,DIMS=["user","tool","status","q","grant","rpc","msg"],MORE=["grant","rpc","msg"];
var LABEL={user:"Person",grant:"Connection",tool:"Tool",rpc:"Request type",msg:"Event",status:"Status",q:"Search"};
var STATUS={ok:"OK only",error:"Failures only",events:"Server events only"};
var all=null,truncated=false,qTimer=null,dateTimer=null,seq=0;
var st={from:"",to:"",preset:"7",f:{},sort:{},open:null,limit:{},checks:false,callsOnly:false};
function recall(k){try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;}}
function keep(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
var names=recall("gmcp-names")||{},tz=recall("gmcp-tz")==="local"?"local":"utc";
var calm=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function el(tag,text,cls){var e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(cls)e.className=cls;return e;}
function add(p,c){p.appendChild(c);return c;}
function btn(text,cls,fn){var b=el("button",text,cls);b.type="button";b.onclick=fn;return b;}
function day(d){return d.toISOString().slice(0,10);}
function isDay(s){return typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+"T00:00:00Z"));}
function fmt(n){return Number(n).toLocaleString("en-US");}
function pct(a,b){return b?(100*a/b).toFixed(1)+"%":"–";}
function quant(arr,q){var s=arr.filter(function(v){return typeof v==="number";}).sort(function(a,b){return a-b;});return s.length?s[Math.min(s.length-1,Math.floor(q*s.length))]:null;}
function dur(v){return v===null||v===undefined?"–":v>=1000?(v/1000).toFixed(1)+" s":fmt(v)+" ms";}
function two(n){return (n<10?"0":"")+n;}
function when(t){if(tz==="utc")return t.slice(0,19).replace("T"," ");var d=new Date(t);if(isNaN(d.getTime()))return t;
  return d.getFullYear()+"-"+two(d.getMonth()+1)+"-"+two(d.getDate())+" "+two(d.getHours())+":"+two(d.getMinutes())+":"+two(d.getSeconds());}
function zone(){return tz==="utc"?"UTC":"local time";}
function ago(t){var s=(Date.now()-Date.parse(t))/1000;if(!(s>=0))return when(t);if(s<60)return "just now";if(s<3600)return Math.floor(s/60)+" min ago";
  if(s<86400)return Math.floor(s/3600)+" h ago";if(s<5184000)return Math.floor(s/86400)+" d ago";return when(t).slice(0,10);}
function who(u){return u?(names[u]?names[u]+" ("+u+")":u):"–";}
// server/discover answers 400 to every client by design, so it is noise, not a failure.
function isError(l){return typeof l.status==="number"&&l.status>=400&&!(l.rpc==="server/discover"&&l.status===400);}
function bad(l){return isError(l)||(!!l.msg&&l.ok===false);}
function kind(l){return l.rpc?"rpc":l.msg?"event":"other";}
// Glama's MCP directory connects and lists the tools every ~25 minutes; it is a robot, not a user.
function isCheck(l){return !!l.client&&/glama/i.test(l.client);}
function hay(l){if(l._h===undefined)l._h=[l.user,names[l.user],l.grant,l.client,l.tool,l.rpc,l.msg,l.status,l.ok===false?"failed":""]
  .filter(function(v){return v!==undefined&&v!==null&&v!=="";}).join(" ").toLowerCase();return l._h;}
function match(l,skip){var f=st.f;
  if(!st.checks&&isCheck(l))return false;
  if(f.user&&skip!=="user"&&l.user!==f.user)return false;
  if(f.grant&&skip!=="grant"&&l.grant!==f.grant)return false;
  if(f.tool&&skip!=="tool"&&l.tool!==f.tool)return false;
  if(f.rpc&&skip!=="rpc"&&l.rpc!==f.rpc)return false;
  if(f.msg&&skip!=="msg"&&l.msg!==f.msg)return false;
  if(f.status&&skip!=="status"){var b=bad(l);if(f.status==="ok"&&(kind(l)!=="rpc"||b))return false;if(f.status==="error"&&!b)return false;if(f.status==="events"&&kind(l)!=="event")return false;}
  if(f.q&&skip!=="q"&&hay(l).indexOf(f.q.toLowerCase())<0)return false;
  return true;}
function lines(skip){return all.filter(function(l){return match(l,skip);});}
function active(){return DIMS.filter(function(d){return !!st.f[d];});}

function readHash(){var h=new URLSearchParams(location.hash.slice(1)),p=h.get("preset"),f=h.get("from"),t=h.get("to");
  if(isDay(f)&&isDay(t)){st.preset="";st.from=f;st.to=t;}else if(p&&/^\d+$/.test(p))st.preset=p;
  DIMS.forEach(function(d){var v=h.get(d);if(v)st.f[d]=v;});st.checks=h.get("checks")==="show";st.callsOnly=h.get("lines")==="calls";}
function writeHash(){var h=new URLSearchParams();if(st.preset)h.set("preset",st.preset);else{h.set("from",st.from);h.set("to",st.to);}
  DIMS.forEach(function(d){if(st.f[d])h.set(d,st.f[d]);});if(st.checks)h.set("checks","show");if(st.callsOnly)h.set("lines","calls");history.replaceState(null,"","#"+h.toString());}
function syncRange(){var t=day(new Date());$("from").value=st.from;$("to").value=st.to;$("from").max=st.to||t;$("to").min=st.from;$("to").max=t;
  Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"),function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-preset")===st.preset));});}

function load(){
  if(st.preset){st.to=day(new Date());st.from=day(new Date(Date.now()-(Number(st.preset)-1)*DAY));}
  syncRange();writeHash();
  if(!isDay(st.from)||!isDay(st.to)||st.from>st.to){problem("Pick a From date on or before the To date.");return;}
  var mine=++seq;busy(true);
  fetch("/mcp/admin/logs.json?from="+encodeURIComponent(st.from)+"&to="+encodeURIComponent(st.to),{credentials:"same-origin"}).then(function(r){
    if(r.status===401)throw "The password was not accepted or has expired. Reload the page to enter it again.";
    if(r.status===429)throw "Too many wrong passwords from your network. Wait 15 minutes, then reload the page.";
    if(!r.ok)throw "The server answered with an error ("+r.status+"). Press Reload to try again; if it keeps failing, check the server logs in Dokploy.";
    return r.json();
  }).then(function(d){
    if(mine!==seq)return;
    all=d.lines;truncated=d.truncated;
    // A line from before requests carried a person borrows one from its connection's other lines.
    var owner={};all.forEach(function(l){if(l.grant&&l.user)owner[l.grant]=l.user;});
    all.forEach(function(l){if(l.grant&&!l.user&&owner[l.grant])l.user=owner[l.grant];});
    busy(false);problem("");render();
  }).catch(function(e){if(mine!==seq)return;busy(false);problem(typeof e==="string"?e:"Could not reach the server. Check your connection, then press Reload.");});
}
function busy(on){var r=$("reload");r.disabled=on;r.classList.toggle("busy",on);r.textContent=on?"Loading…":"Reload";
  $("content").setAttribute("aria-busy",String(on));$("content").classList.toggle("loading",on);if(on)$("status").textContent="Loading "+st.from+" to "+st.to+"…";}
function problem(m){var p=$("problem");p.hidden=!m;p.textContent=m;if(m)$("status").textContent="";}

function setF(d,v){st.f[d]=v||"";st.limit={};render();}
function toggleF(d,v){setF(d,st.f[d]===v?"":v);}
function clearAll(){st.f={};st.limit={};render();}
function toggleMore(open){var b=$("more-btn"),m=$("more");if(open===undefined)open=m.hidden;m.hidden=!open;b.setAttribute("aria-expanded",String(open));b.textContent=open?"Fewer filters":"More filters";}
function syncFilters(){
  ["user","tool","grant","rpc","msg"].forEach(function(d){
    var sel=$("f-"+d),seen={};lines(d).forEach(function(l){var v=l[d];if(typeof v==="string")seen[v]=(seen[v]||0)+1;});
    if(st.f[d]&&!seen[st.f[d]])seen[st.f[d]]=0;
    sel.textContent="";add(sel,el("option","All")).value="";
    Object.keys(seen).sort(function(a,b){return seen[b]-seen[a]||(a<b?-1:1);}).forEach(function(v){add(sel,el("option",(d==="user"?who(v):v)+" ("+fmt(seen[v])+")")).value=v;});
    sel.value=st.f[d]||"";});
  $("f-status").value=st.f.status||"";
  if(document.activeElement!==$("f-q"))$("f-q").value=st.f.q||"";
  if(MORE.some(function(d){return !!st.f[d];}))toggleMore(true);
  var c=$("chips"),act=active();c.textContent="";c.hidden=!act.length;if(!act.length)return;
  add(c,el("span","Showing only","chips-label"));
  act.forEach(function(d){var v=st.f[d],text=LABEL[d]+": "+(d==="user"?who(v):d==="status"?STATUS[v]:v);
    var b=add(c,btn(text,"chip",function(){setF(d,"");}));b.setAttribute("aria-label","Remove filter "+text);add(b,el("span","×","x")).setAttribute("aria-hidden","true");});
  add(c,btn("Clear all","linkish",clearAll));
}

function render(){
  if(!all)return;
  writeHash();syncFilters();
  var shown=lines(null),rpc=shown.filter(function(l){return !!l.rpc;});
  var checks=st.checks?0:all.filter(isCheck).length;$("f-checks").checked=!st.checks;
  $("status").textContent=fmt(all.length)+" log lines, "+st.from+" to "+st.to+(checks?" · "+fmt(checks)+" Glama checks hidden":"")+(active().length?" · "+fmt(shown.length)+" match the filters":"")+".";
  var tr=$("trunc");tr.hidden=!truncated;if(truncated)tr.textContent="This range holds more lines than one load returns, so only the newest "+fmt(all.length)+" are shown. Pick a shorter range to see everything.";
  overview(shown,rpc);chart(rpc);people();connections();tools();requestTypes();events();logLines(shown);
}
function stat(id,v,crit){var e=$(id);e.textContent=v;e.classList.toggle("crit",!!crit);}
function overview(shown,rpc){
  var calls=rpc.filter(function(l){return l.rpc==="tools/call";}),g={},p={};rpc.forEach(function(l){if(l.grant)g[l.grant]=1;if(l.user)p[l.user]=1;});
  var errs=rpc.filter(isError).length,si=shown.filter(function(l){return l.msg==="sign-in";}),fail=si.filter(function(l){return l.ok===false;}).length;
  var ms=calls.map(function(l){return l.ms;});
  stat("s-req",fmt(rpc.length));stat("s-calls",fmt(calls.length));stat("s-people",fmt(Object.keys(p).length));stat("s-conns",fmt(Object.keys(g).length));
  stat("s-rate",pct(errs,rpc.length),errs>0);stat("s-errs",fmt(errs),errs>0);stat("s-med",dur(quant(ms,.5)));stat("s-p95",dur(quant(ms,.95)));
  stat("s-sok",fmt(si.length-fail));stat("s-sfail",fmt(fail),fail>0);
}

function chart(rpc){
  var svg=$("chart"),tip=$("tip"),from=new Date(st.from+"T00:00:00Z"),to=new Date(st.to+"T00:00:00Z");
  var days=Math.round((to-from)/DAY)+1,hourly=days<=2,step=hourly?36e5:DAY,n=hourly?days*24:days;
  $("chart-title").textContent=(hourly?"Requests per hour":"Requests per day")+" (UTC)";
  $("chart-hint").textContent=hourly?"Hover or focus a bar for its numbers.":"Hover or focus a bar for its numbers. Click a day to see it hour by hour.";
  svg.textContent="";tip.hidden=true;if(!(n>0)||n>2000)return;
  var ok=new Array(n).fill(0),ko=new Array(n).fill(0),max=1;
  rpc.forEach(function(l){var i=Math.floor((Date.parse(l.t)-from.getTime())/step);if(i>=0&&i<n){if(isError(l))ko[i]++;else ok[i]++;}});
  for(var k=0;k<n;k++)max=Math.max(max,ok[k]+ko[k]);
  var W=720,H=190,L=40,B=22,T=10,ph=H-B-T,bw=(W-L)/n,gap=Math.min(2,bw*.2),ns="http://www.w3.org/2000/svg",focusable=n<=100,every=Math.max(1,Math.ceil(n/8));
  svg.setAttribute("viewBox","0 0 "+W+" "+H);
  function mk(tag,a){var e=document.createElementNS(ns,tag);for(var x in a)e.setAttribute(x,a[x]);svg.appendChild(e);return e;}
  [0,.5,1].forEach(function(f){var y=H-B-f*ph;mk("line",{x1:L,x2:W,y1:y,y2:y,"class":"grid"});mk("text",{x:L-6,y:y+4,"text-anchor":"end","class":"tick"}).textContent=fmt(Math.round(f*max));});
  for(var i=0;i<n;i++)(function(i){
    var x=L+i*bw,w=Math.max(1,bw-gap),r=Math.min(4,w/4),hb=ko[i]/max*ph,ho=ok[i]/max*ph,base=H-B,at=new Date(from.getTime()+i*step);
    var hh=at.toISOString().slice(11,13)+":00",label=hourly?(days>1?day(at).slice(5)+" ":"")+hh+" UTC":day(at),total=ok[i]+ko[i];
    if(ko[i])mk("rect",{x:x,y:base-hb,width:w,height:hb,rx:ok[i]?0:r,"class":"bar-err"});
    if(ok[i])mk("rect",{x:x,y:base-hb-(ko[i]?gap:0)-ho,width:w,height:ho,rx:r,"class":"bar"});
    var hit=mk("rect",{x:x,y:T,width:bw,height:ph,"class":"hit"+(hourly?"":" go")});
    var text=label+": "+fmt(total)+" requests"+(ko[i]?", "+fmt(ko[i])+" failed":"");
    if(focusable){hit.setAttribute("tabindex","0");hit.setAttribute("role","img");hit.setAttribute("aria-label",text+(hourly?"":". Press Enter to see this day hour by hour."));}
    function show(cx,cy){var rect=svg.getBoundingClientRect();tip.hidden=false;tip.textContent="";add(tip,el("b",label));add(tip,el("div",fmt(total)+" requests"));
      if(ko[i])add(tip,el("div",fmt(ko[i])+" failed","crit"));tip.style.left=Math.max(0,Math.min(rect.width-170,cx+14))+"px";tip.style.top=Math.max(0,cy-10)+"px";}
    hit.addEventListener("mousemove",function(e){var rect=svg.getBoundingClientRect();show(e.clientX-rect.left,e.clientY-rect.top);});
    hit.addEventListener("focus",function(){var rect=svg.getBoundingClientRect();show((x+bw)/W*rect.width,rect.height*.25);});
    hit.addEventListener("mouseleave",function(){tip.hidden=true;});hit.addEventListener("blur",function(){tip.hidden=true;});
    if(!hourly){var go=function(){st.preset="";st.from=st.to=day(at);load();};hit.addEventListener("click",go);
      hit.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();go();}});}
    if(i%every===0)mk("text",{x:x+bw/2,y:H-6,"text-anchor":"middle","class":"tick"}).textContent=hourly?(days>1?day(at).slice(5)+" ":"")+hh:day(at).slice(5);
  })(i);
}

// A table whose columns may sort, whose rows may act (filter or expand), and which shows a limited number of rows.
function grid(id,cols,rows,o){
  var t=$(id);t.textContent="";o=o||{};
  var hr=add(add(t,el("thead")),el("tr")),srt=st.sort[id]||o.sort||null;
  cols.forEach(function(c,i){var th=add(hr,el("th",null,c.num?"num":""));th.scope="col";
    if(!c.s){th.textContent=c.h;return;}
    var on=!!srt&&srt.i===i;th.setAttribute("aria-sort",on?(srt.dir>0?"ascending":"descending"):"none");
    var b=add(th,btn(c.h,"sort",function(){st.sort[id]={i:i,dir:on?-srt.dir:(c.num?-1:1)};render();}));
    add(b,el("span",on?(srt.dir>0?"▲":"▼"):"↕","arrow")).setAttribute("aria-hidden","true");});
  if(srt&&cols[srt.i]&&cols[srt.i].s&&(st.sort[id]||!o.presorted)){var sf=cols[srt.i].s,dir=srt.dir;
    rows=rows.slice().sort(function(a,b){var x=sf(a),y=sf(b);return (x<y?-1:x>y?1:0)*dir;});}
  var tb=add(t,el("tbody"));
  if(!rows.length){var td=add(add(tb,el("tr")),el("td",null,"empty"));td.colSpan=cols.length;empty(td);return;}
  var lim=st.limit[id]||o.limit||rows.length;
  rows.slice(0,lim).forEach(function(r){
    var tr=add(tb,el("tr"));
    cols.forEach(function(c,ci){var cls=c.cls?c.cls(r):"",td=add(tr,el("td",null,((c.num?"num ":"")+(cls||"")).trim()||null)),v=c.v(r);
      if(ci===0&&o.act){var b=add(td,btn(v,"rowbtn",function(){o.act(r);}));
        if(o.expanded)b.setAttribute("aria-expanded",String(o.expanded(r)));else b.setAttribute("aria-pressed",String(!!(o.selected&&o.selected(r))));
        if(o.label)b.setAttribute("aria-label",o.label(r));}
      else td.textContent=v===undefined||v===null?"":String(v);
      if(c.title){var tt=c.title(r);if(tt)td.title=tt;}});
    if(o.act){tr.className="pick"+(o.selected&&o.selected(r)?" sel":"")+(o.dim&&o.dim(r)?" dim":"");
      tr.onclick=function(e){if(e.target.closest("button,input,a,select,label"))return;o.act(r);};}
    if(o.after)o.after(r,tb,cols.length);
  });
  if(rows.length>lim){var td2=add(add(tb,el("tr",null,"more")),el("td"));td2.colSpan=cols.length;
    add(td2,btn(o.step?"Show "+fmt(Math.min(o.step,rows.length-lim))+" more":"Show all "+fmt(rows.length),"plain",function(){st.limit[id]=o.step?lim+o.step:rows.length;render();}));
    add(td2,el("span","Showing "+fmt(lim)+" of "+fmt(rows.length)+".","muted"));}
}
function empty(td){
  if(active().length){add(td,el("span","No matches for these filters. "));add(td,btn("Clear filters","linkish",clearAll));}
  else td.textContent=all.length?"Nothing of this kind in this range.":"No log lines in this range. Pick a longer range above.";
}
function mini(parent,heads,rows,firstNum,crit){
  var t=add(parent,el("table",null,"mini")),hr=add(add(t,el("thead")),el("tr")),tb;
  heads.forEach(function(h,i){add(hr,el("th",h,i>=firstNum?"num":"")).scope="col";});tb=add(t,el("tbody"));
  if(!rows.length){var td=add(add(tb,el("tr")),el("td","None in this view.","empty"));td.colSpan=heads.length;return;}
  rows.forEach(function(r){var tr=add(tb,el("tr"));r.forEach(function(c,i){var td=add(tr,el("td",c,i>=firstNum?"num":""));if(crit&&crit(r,i))td.classList.add("crit");});});
}

function group(src,field){var out={};
  src.forEach(function(l){if(!l.rpc)return;var k=l[field];if(!k)return;
    var o=out[k]||(out[k]={k:k,n:0,c:0,e:0,first:l.t,last:l.t,tools:{},terr:{},tms:{},grants:{},apps:{},user:"",client:"",days:{},lines:[]});
    o.n++;if(isError(l))o.e++;if(l.t<o.first)o.first=l.t;if(l.t>o.last)o.last=l.t;o.lines.push(l);
    if(l.grant)o.grants[l.grant]=1;if(l.client){o.apps[l.client]=1;o.client=l.client;}if(l.user)o.user=l.user;
    var d=l.t.slice(0,10);o.days[d]=(o.days[d]||0)+1;
    if(l.rpc==="tools/call"){var tk=l.tool||"(unnamed)";o.c++;o.tools[tk]=(o.tools[tk]||0)+1;if(isError(l))o.terr[tk]=(o.terr[tk]||0)+1;(o.tms[tk]||(o.tms[tk]=[])).push(l.ms);}});
  return Object.keys(out).map(function(k){return out[k];});}
function n(o){return Object.keys(o).length;}
function topTools(o,k){return Object.keys(o.tools).sort(function(a,b){return o.tools[b]-o.tools[a];}).slice(0,k).map(function(t){return t+" ×"+fmt(o.tools[t]);}).join(", ")||"–";}
function lower(s){return String(s||"").toLowerCase();}

function people(){
  var src=lines("user"),rows=group(src,"user");
  grid("t-users",[
    {h:"Person",v:function(r){return who(r.k);},s:function(r){return lower(names[r.k]||"~"+r.k);}},
    {h:"Apps",v:function(r){return Object.keys(r.apps).join(", ")||"–";},s:function(r){return lower(Object.keys(r.apps).join());}},
    {h:"Top tools",v:function(r){return topTools(r,3);}},
    {h:"Connections",num:1,v:function(r){return fmt(n(r.grants));},s:function(r){return n(r.grants);}},
    {h:"Requests",num:1,v:function(r){return fmt(r.n);},s:function(r){return r.n;}},
    {h:"Tool calls",num:1,v:function(r){return fmt(r.c);},s:function(r){return r.c;}},
    {h:"Tools used",num:1,v:function(r){return fmt(n(r.tools));},s:function(r){return n(r.tools);}},
    {h:"Failed",num:1,v:function(r){return fmt(r.e);},s:function(r){return r.e;},cls:function(r){return r.e?"crit":"";}},
    {h:"Last seen",num:1,v:function(r){return ago(r.last);},s:function(r){return r.last;},title:function(r){return when(r.last)+" "+zone();}}
  ],rows,{sort:{i:8,dir:-1},limit:50,
    act:function(r){st.open=st.open===r.k?null:r.k;render();},
    expanded:function(r){return st.open===r.k;},
    label:function(r){return (st.open===r.k?"Hide":"Show")+" details for "+who(r.k);},
    selected:function(r){return st.f.user===r.k;},dim:function(r){return !!st.f.user&&st.f.user!==r.k;},
    after:function(r,tb,span){if(st.open===r.k)detail(r,tb,span);}});
}
function detail(r,tb,span){
  var td=add(add(tb,el("tr",null,"detail")),el("td"));td.colSpan=span;
  var head=add(td,el("div",null,"d-head"));add(head,el("h3",who(r.k)));
  add(head,el("span","First seen "+when(r.first)+" "+zone()+" · last seen "+ago(r.last)+" · "+fmt(r.n)+" requests, "+fmt(r.c)+" tool calls"+(active().length?" in this view":""),"muted"));
  var acts=add(td,el("div",null,"d-actions")),only=st.f.user===r.k;
  add(acts,btn(only?"Show everyone again":"Show only this person on the page",only?"plain":"primary",function(){toggleF("user",r.k);}));
  var lab=add(acts,el("label",null,"name"));add(lab,el("span","Name, saved in this browser only"));
  var inp=add(lab,el("input"));inp.type="text";inp.value=names[r.k]||"";inp.placeholder="e.g. me, tester";inp.maxLength=40;
  var save=function(){var v=inp.value.trim();if(v)names[r.k]=v;else delete names[r.k];keep("gmcp-names",names);all.forEach(function(l){delete l._h;});render();};
  inp.addEventListener("keydown",function(e){if(e.key==="Enter")save();});add(acts,btn("Save name","plain",save));
  var g=add(td,el("div",null,"d-grid")),box;
  box=add(g,el("div"));add(box,el("h4","Tools called ("+fmt(n(r.tools))+")"));
  mini(box,["Tool","Calls","Failed","Median"],Object.keys(r.tools).sort(function(a,b){return r.tools[b]-r.tools[a];}).map(function(t){
    return [t,fmt(r.tools[t]),fmt(r.terr[t]||0),dur(quant(r.tms[t]||[],.5))];}),1,function(row,i){return i===2&&row[2]!=="0";});
  box=add(g,el("div"));add(box,el("h4","Requests per day"));spark(box,r.days);
  box=add(g,el("div"));add(box,el("h4","Connections ("+fmt(n(r.grants))+")"));
  mini(box,["Connection","App","Requests","Last seen"],group(r.lines,"grant").sort(function(a,b){return a.last<b.last?1:-1;}).map(function(c){
    return [c.k,c.client||"–",fmt(c.n),ago(c.last)];}),2);
  box=add(g,el("div"));add(box,el("h4","Latest requests"));
  mini(box,["Time ("+(tz==="utc"?"UTC":"local")+")","What","Status"],r.lines.slice(-15).reverse().map(function(l){return [when(l.t),what(l),statusText(l)];}),3,
    function(row,i){return i===2&&/fail|error/.test(row[2]);});
}
function spark(parent,counts){
  var from=new Date(st.from+"T00:00:00Z"),days=Math.round((new Date(st.to+"T00:00:00Z")-from)/DAY)+1;if(!(days>0)||days>400)return;
  var W=300,H=64,max=1,total=0,vals=[],ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),i;
  for(i=0;i<days;i++){var c=counts[day(new Date(from.getTime()+i*DAY))]||0;vals.push(c);max=Math.max(max,c);total+=c;}
  svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.setAttribute("class","spark");svg.setAttribute("role","img");
  svg.setAttribute("aria-label",fmt(total)+" requests over "+days+" days, at most "+fmt(max)+" in one day");
  var bw=W/days;vals.forEach(function(v,i){if(!v)return;var h=Math.max(2,v/max*(H-4)),rc=document.createElementNS(ns,"rect");
    rc.setAttribute("x",String(i*bw+Math.min(1,bw*.15)));rc.setAttribute("width",String(Math.max(1,bw-Math.min(2,bw*.3))));rc.setAttribute("y",String(H-h));rc.setAttribute("height",String(h));
    rc.setAttribute("rx",String(Math.min(2,bw/4)));var tt=document.createElementNS(ns,"title");tt.textContent=day(new Date(from.getTime()+i*DAY))+": "+fmt(v)+" requests";rc.appendChild(tt);svg.appendChild(rc);});
  parent.appendChild(svg);add(parent,el("p",st.from+" to "+st.to+", UTC days. Peak "+fmt(max)+".","note"));
}
function connections(){
  grid("t-grants",[
    {h:"Connection",v:function(r){return r.k;},s:function(r){return lower(r.k);}},
    {h:"Person",v:function(r){return who(r.user);},s:function(r){return lower(names[r.user]||"~"+r.user);}},
    {h:"App",v:function(r){return r.client||"–";},s:function(r){return lower(r.client);}},
    {h:"Requests",num:1,v:function(r){return fmt(r.n);},s:function(r){return r.n;}},
    {h:"Tool calls",num:1,v:function(r){return fmt(r.c);},s:function(r){return r.c;}},
    {h:"Failed",num:1,v:function(r){return fmt(r.e);},s:function(r){return r.e;},cls:function(r){return r.e?"crit":"";}},
    {h:"Top tool",v:function(r){return topTools(r,1);}},
    {h:"Last seen",num:1,v:function(r){return ago(r.last);},s:function(r){return r.last;},title:function(r){return when(r.last)+" "+zone();}}
  ],group(lines("grant"),"grant"),{sort:{i:7,dir:-1},limit:50,act:function(r){toggleF("grant",r.k);},
    selected:function(r){return st.f.grant===r.k;},dim:function(r){return !!st.f.grant&&st.f.grant!==r.k;},
    label:function(r){return (st.f.grant===r.k?"Stop showing only":"Show only")+" connection "+r.k;}});
}
function tools(){
  var m={};lines("tool").forEach(function(l){if(l.rpc!=="tools/call")return;var k=l.tool||"(unnamed)",o=m[k]||(m[k]={k:k,n:0,e:0,ms:[]});o.n++;if(isError(l))o.e++;o.ms.push(l.ms);});
  var rows=Object.keys(m).map(function(k){var o=m[k];o.med=quant(o.ms,.5);o.p95=quant(o.ms,.95);o.max=quant(o.ms,1);return o;});
  grid("t-tools",[
    {h:"Tool",v:function(r){return r.k;},s:function(r){return lower(r.k);}},
    {h:"Calls",num:1,v:function(r){return fmt(r.n);},s:function(r){return r.n;}},
    {h:"Failed",num:1,v:function(r){return r.e?fmt(r.e)+" ("+pct(r.e,r.n)+")":"0";},s:function(r){return r.e/r.n;},cls:function(r){return r.e?"crit":"";}},
    {h:"Median",num:1,v:function(r){return dur(r.med);},s:function(r){return r.med||0;}},
    {h:"p95",num:1,v:function(r){return dur(r.p95);},s:function(r){return r.p95||0;}},
    {h:"Slowest",num:1,v:function(r){return dur(r.max);},s:function(r){return r.max||0;}}
  ],rows,{sort:{i:1,dir:-1},limit:50,act:function(r){toggleF("tool",r.k);},
    selected:function(r){return st.f.tool===r.k;},dim:function(r){return !!st.f.tool&&st.f.tool!==r.k;},
    label:function(r){return (st.f.tool===r.k?"Stop showing only":"Show only")+" tool "+r.k;}});
}
function requestTypes(){
  var m={};lines("rpc").forEach(function(l){if(!l.rpc)return;var o=m[l.rpc]||(m[l.rpc]={k:l.rpc,n:0,e:0});o.n++;if(isError(l))o.e++;});
  grid("t-rpc",[
    {h:"Request type",v:function(r){return r.k;},s:function(r){return lower(r.k);}},
    {h:"Requests",num:1,v:function(r){return fmt(r.n);},s:function(r){return r.n;}},
    {h:"Failed",num:1,v:function(r){return fmt(r.e);},s:function(r){return r.e;},cls:function(r){return r.e?"crit":"";}}
  ],Object.keys(m).map(function(k){return m[k];}),{sort:{i:1,dir:-1},act:function(r){toggleF("rpc",r.k);},
    selected:function(r){return st.f.rpc===r.k;},dim:function(r){return !!st.f.rpc&&st.f.rpc!==r.k;},
    label:function(r){return (st.f.rpc===r.k?"Stop showing only":"Show only")+" request type "+r.k;}});
}
function events(){
  var m={};lines("msg").forEach(function(l){if(kind(l)!=="event")return;var o=m[l.msg]||(m[l.msg]={k:l.msg,n:0,f:0,last:l.t});o.n++;if(l.ok===false)o.f++;if(l.t>o.last)o.last=l.t;});
  grid("t-events",[
    {h:"Event",v:function(r){return r.k;},s:function(r){return lower(r.k);}},
    {h:"Count",num:1,v:function(r){return fmt(r.n);},s:function(r){return r.n;}},
    {h:"Failed",num:1,v:function(r){return fmt(r.f);},s:function(r){return r.f;},cls:function(r){return r.f?"crit":"";}},
    {h:"Last",num:1,v:function(r){return ago(r.last);},s:function(r){return r.last;},title:function(r){return when(r.last)+" "+zone();}}
  ],Object.keys(m).map(function(k){return m[k];}),{sort:{i:1,dir:-1},act:function(r){toggleF("msg",r.k);},
    selected:function(r){return st.f.msg===r.k;},dim:function(r){return !!st.f.msg&&st.f.msg!==r.k;},
    label:function(r){return (st.f.msg===r.k?"Stop showing only":"Show only")+" event "+r.k;}});
}
function what(l){if(l.tool)return l.tool;if(l.rpc)return l.rpc;if(!l.msg)return "";
  var x={};Object.keys(l).forEach(function(k){if(["t","msg","_h","user","grant","client","ok","ms"].indexOf(k)<0)x[k]=l[k];});
  var s=JSON.stringify(x);return l.msg+(s!=="{}"?" "+s:"");}
function statusText(l){if(typeof l.status==="number")return isError(l)?l.status+" · failed":String(l.status);if(l.ok===false)return "failed";if(l.ok===true)return "ok";return "";}
function isCall(l){return l.rpc==="tools/call";}
// The Log lines view: everything matching the page's filters, or only its tool calls.
function lineView(shown){return st.callsOnly?shown.filter(isCall):shown;}
function logLines(shown){
  var total=shown.length;shown=lineView(shown);
  Array.prototype.forEach.call(document.querySelectorAll("[data-lines]"),function(b){b.setAttribute("aria-pressed",String((b.getAttribute("data-lines")==="calls")===st.callsOnly));});
  grid("t-lines",[
    {h:"Time ("+(tz==="utc"?"UTC":"local")+")",v:function(l){return when(l.t);},s:function(l){return l.t;}},
    {h:"Person",v:function(l){return l.user?who(l.user):"";}},
    {h:"Connection",v:function(l){return l.grant||"";}},
    {h:"What",v:what},
    {h:"Status",v:statusText,cls:function(l){return bad(l)?"crit":"";}},
    {h:"Duration",num:1,v:function(l){return l.ms!==undefined?dur(l.ms):"";},s:function(l){return typeof l.ms==="number"?l.ms:-1;}}
  ],shown.slice().reverse(),{sort:{i:0,dir:-1},presorted:true,limit:500,step:500});
  $("lines-note").textContent=st.callsOnly
    ?fmt(shown.length)+" tool call"+(shown.length===1?"":"s")+" of "+fmt(total)+" matching lines, newest first."
    :fmt(shown.length)+" matching line"+(shown.length===1?"":"s")+", newest first.";
}
function csv(){
  if(!all)return;
  var esc=function(v){if(v===undefined||v===null)return "";v=String(v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  var out=["time_utc,person,person_name,connection,app,request_type,tool,event,status,ok,ms"];
  lineView(lines(null)).forEach(function(l){out.push([l.t,l.user,names[l.user],l.grant,l.client,l.rpc,l.tool,l.msg,l.status,l.ok,l.ms].map(esc).join(","));});
  var url=URL.createObjectURL(new Blob([out.join("\r\n")],{type:"text/csv"})),a=el("a");
  a.href=url;a.download="garmin-mcp-logs-"+st.from+"-to-"+st.to+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"),function(b){b.onclick=function(){st.preset=b.getAttribute("data-preset");load();};});
Array.prototype.forEach.call(document.querySelectorAll("[data-go]"),function(b){b.onclick=function(){$(b.getAttribute("data-go")).scrollIntoView({behavior:calm?"auto":"smooth",block:"start"});};});
function onDate(){clearTimeout(dateTimer);dateTimer=setTimeout(function(){var f=$("from").value,t=$("to").value;if(!isDay(f)||!isDay(t))return;st.preset="";st.from=f;st.to=t;load();},400);}
$("from").addEventListener("change",onDate);$("to").addEventListener("change",onDate);
$("reload").onclick=load;
["user","tool","grant","rpc","msg","status"].forEach(function(d){$("f-"+d).onchange=function(){setF(d,this.value);};});
$("f-q").addEventListener("input",function(){var v=this.value;clearTimeout(qTimer);qTimer=setTimeout(function(){setF("q",v.trim());},200);});
$("more-btn").onclick=function(){toggleMore();};
$("f-checks").onchange=function(){st.checks=!this.checked;st.limit={};render();};
$("tz").value=tz;$("tz").onchange=function(){tz=this.value==="local"?"local":"utc";keep("gmcp-tz",tz);render();};
$("csv").onclick=csv;
Array.prototype.forEach.call(document.querySelectorAll("[data-lines]"),function(b){b.onclick=function(){st.callsOnly=b.getAttribute("data-lines")==="calls";st.limit["t-lines"]=0;render();};});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&st.open){st.open=null;render();}});
readHash();if(!st.preset&&!st.from)st.preset="7";load();
})();`;

export const ADMIN_SCRIPT_HASH = `'sha256-${createHash("sha256").update(ADMIN_SCRIPT).digest("base64")}'`;

export function adminHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": `default-src 'none'; script-src ${ADMIN_SCRIPT_HASH}; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'`,
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
  };
}

// Its own document rather than the sign-in shell: a dense tool page wants a slim sticky header, not a centred card.
const STYLE = `<style>
:root{color-scheme:light dark;--bg:#f6f8fa;--card:#fff;--line:#d0d7de;--text:#1f2328;--muted:#59636e;--input:#fff;--accent:#0969da;--on-accent:#fff;--accent-soft:rgba(9,105,218,.1);--crit:#cf222e;--crit-soft:#ffebe9;--warn:#7d4e00;--warn-soft:#fff8c5;--r:10px;--t:.15s ease}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--text:#e6edf3;--muted:#9198a1;--input:#0d1117;--accent:#58a6ff;--on-accent:#0d1117;--accent-soft:rgba(88,166,255,.14);--crit:#ff7b72;--crit-soft:#3d1214;--warn:#e3b341;--warn-soft:#2e2306}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
h1,h2,h3,h4,p{margin:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bar{background:var(--card);border-bottom:1px solid var(--line);padding:12px 24px;display:flex;flex-direction:column;gap:10px}
@media (min-width:900px){.bar{position:sticky;top:0;z-index:5}section{scroll-margin-top:220px}}
.row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;width:100%;max-width:1152px;margin:0 auto}
.row.top{align-items:center}
h1{font-size:1.1rem;font-weight:700;margin-right:auto}h1 span{color:var(--muted);font-weight:500}
nav{display:flex;flex-wrap:wrap;gap:2px}
nav button{background:none;border:0;border-radius:6px;color:var(--muted);font:inherit;font-size:.85rem;padding:4px 8px;cursor:pointer;transition:background-color var(--t),color var(--t)}
nav button:hover{background:var(--accent-soft);color:var(--text)}
label{display:flex;flex-direction:column;gap:2px;font-size:.75rem;font-weight:600;color:var(--muted)}
label.inline{flex-direction:row;align-items:center;gap:6px}
label.check{flex-direction:row;align-items:center;gap:8px;min-height:36px;font-size:.85rem;font-weight:500;color:var(--text);cursor:pointer}
label.check input{width:16px;height:16px;min-height:0;margin:0;padding:0;accent-color:var(--accent);cursor:pointer}
input,select{font:inherit;font-size:.9rem;color:var(--text);background:var(--input);border:1px solid var(--line);border-radius:6px;padding:6px 8px;min-height:36px;max-width:240px}
input[type=search]{width:220px}
button{font:inherit;cursor:pointer}
.primary,.plain{min-height:36px;padding:6px 14px;border-radius:6px;font-size:.9rem;font-weight:600;transition:background-color var(--t),border-color var(--t),filter var(--t)}
.primary{background:var(--accent);border:1px solid var(--accent);color:var(--on-accent)}.primary:hover{filter:brightness(1.1)}
.primary:disabled{opacity:.65;cursor:wait;filter:none}
.plain{background:transparent;border:1px solid var(--line);color:var(--text)}.plain:hover{background:var(--accent-soft)}
.presets{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.presets button{min-height:36px;padding:6px 12px;border:0;border-right:1px solid var(--line);background:transparent;color:var(--text);font-size:.85rem;transition:background-color var(--t)}
.presets button:last-child{border-right:0}.presets button:hover{background:var(--accent-soft)}
.presets button[aria-pressed=true]{background:var(--accent);color:var(--on-accent);font-weight:600}
#status{margin-left:auto;align-self:center;font-size:.85rem;color:var(--muted)}
.busy::before{content:"";display:inline-block;width:.9em;height:.9em;margin-right:.5em;vertical-align:-.1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#more:not([hidden]){display:contents}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;width:100%;max-width:1152px;margin:0 auto}
.chips[hidden]{display:none}
.chips-label{font-size:.8rem;font-weight:600;color:var(--muted)}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--accent);background:var(--accent-soft);color:var(--text);border-radius:999px;padding:3px 10px;font-size:.85rem}
.chip .x{font-weight:700;color:var(--muted)}.chip:hover .x{color:var(--crit)}
.linkish{background:none;border:0;padding:2px 4px;color:var(--accent);font-size:.85rem;text-decoration:underline}
main{max-width:1200px;margin:0 auto;padding:24px}
section{margin-top:40px}
#overview{margin-top:0}
h2{font-size:1.2rem;font-weight:700;margin-bottom:6px}
h3{font-size:.75rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
h4{font-size:.9rem;font-weight:700;margin-bottom:8px}
.note{font-size:.85rem;color:var(--muted);margin-bottom:12px}
.muted{color:var(--muted)}
.crit{color:var(--crit)!important;font-weight:600}
.problem{background:var(--crit-soft);border:1px solid var(--crit);color:var(--crit);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-weight:600}
.warn{background:var(--warn-soft);color:var(--warn);border-radius:8px;padding:12px 16px;margin-bottom:16px}
.problem[hidden],.warn[hidden]{display:none}
.loading{opacity:.5;pointer-events:none;transition:opacity var(--t)}
.groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}
.group{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px}
.big{margin:6px 0 14px}.big b{display:block;font-size:2.1rem;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums}.big span{font-size:.85rem;color:var(--muted)}
.group dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin:0}
.group dt{font-size:.75rem;color:var(--muted)}.group dd{margin:0;font-size:1.1rem;font-weight:600;font-variant-numeric:tabular-nums}
.sec-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between}
.sec-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px}
.legend{display:flex;gap:16px;font-size:.85rem;color:var(--muted)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}.sw.ok{background:var(--accent)}.sw.err{background:var(--crit)}
.chartbox{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px;margin-bottom:6px}
#chart{display:block;width:100%;height:auto}
#chart .bar{fill:var(--accent)}#chart .bar-err{fill:var(--crit)}#chart .grid{stroke:var(--line);stroke-width:1}#chart .tick{fill:var(--muted);font-size:11px}
#chart .hit{fill:transparent}#chart .hit.go{cursor:pointer}#chart .hit:hover,#chart .hit:focus{fill:var(--accent-soft)}#chart .hit:focus{outline:none}
.tip{position:absolute;z-index:2;pointer-events:none;min-width:150px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 10px;font-size:.8rem;box-shadow:0 4px 12px rgba(0,0,0,.18)}
.tip[hidden]{display:none}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:var(--r)}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{text-align:left;white-space:nowrap;font-size:.8rem;font-weight:600;color:var(--muted);padding:8px 12px;border-bottom:1px solid var(--line)}
td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}
tbody tr:last-child>td{border-bottom:0}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
th .sort{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;border-radius:3px}
th .sort:hover{color:var(--text)}
th .sort:focus-visible,.rowbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.arrow{font-size:.7rem;opacity:.5}th[aria-sort=ascending] .arrow,th[aria-sort=descending] .arrow{opacity:1;color:var(--accent)}
tr.pick{cursor:pointer;transition:background-color var(--t)}tr.pick:hover{background:var(--accent-soft)}
tr.sel{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
tr.dim>td{opacity:.5}
.rowbtn{all:unset;cursor:pointer;font-weight:600;border-radius:3px;white-space:nowrap}
.rowbtn[aria-expanded]::before{content:"▸";display:inline-block;width:1.1em;color:var(--muted)}
.rowbtn[aria-expanded=true]::before{content:"▾"}
tr.more>td{text-align:center}tr.more .plain{margin-right:12px}
td.empty{text-align:center;color:var(--muted);padding:24px}
tr.detail>td{background:var(--bg);padding:16px}
.d-head{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin-bottom:12px}
.d-head h3{font-size:1.05rem;letter-spacing:0;text-transform:none;color:var(--text)}
.d-actions{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;margin-bottom:16px}
.d-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px}
.d-grid>div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
table.mini{font-size:.8rem}table.mini th,table.mini td{padding:4px 8px}
.spark{display:block;width:100%;height:auto;margin-bottom:6px}.spark rect{fill:var(--accent)}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:24px 32px}
.split td:first-child{white-space:nowrap}
.split h2+.wrap{margin-bottom:24px}
code{font-size:.85em}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:640px){.bar{padding:12px 16px}main{padding:16px}input[type=search],select{max-width:none;width:100%}label{flex:1 1 140px}#status{margin-left:0}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style>`;

const select = (id: string, label: string) => `<label>${label}<select id="${id}"><option value="">All</option></select></label>`;
const PRESETS: [string, string][] = [["1", "Today"], ["2", "2 days"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]];
const SECTIONS: [string, string][] = [["overview", "Overview"], ["people", "People"], ["connections", "Connections"], ["tools", "Tools"], ["lines", "Log lines"]];

export function adminPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Garmin MCP logs</title>${STYLE}</head><body>
<header class="bar">
<div class="row top"><h1>Garmin MCP <span>logs</span></h1>
<nav aria-label="Sections">${SECTIONS.map(([id, label]) => `<button type="button" data-go="${id}">${label}</button>`).join("")}</nav>
<label class="inline">Times<select id="tz"><option value="utc">UTC</option><option value="local">Local</option></select></label></div>
<div class="row" role="group" aria-label="Date range">
<div class="presets">${PRESETS.map(([days, label]) => `<button type="button" data-preset="${days}" aria-pressed="false">${label}</button>`).join("")}</div>
<label>From<input id="from" type="date"></label><label>To<input id="to" type="date"></label>
<button id="reload" type="button" class="primary">Reload</button>
<p id="status" role="status"></p></div>
<div class="row" role="group" aria-label="Filters">
${select("f-user", "Person")}${select("f-tool", "Tool")}
<label>Status<select id="f-status"><option value="">All</option><option value="ok">OK only</option><option value="error">Failures only</option><option value="events">Server events only</option></select></label>
<label>Search<input id="f-q" type="search" placeholder="Person, tool, app…" autocomplete="off"></label>
<label class="check"><input id="f-checks" type="checkbox" checked>Hide Glama checks</label>
<div id="more" hidden>${select("f-grant", "Connection")}${select("f-rpc", "Request type")}${select("f-msg", "Event")}</div>
<button id="more-btn" type="button" class="plain" aria-expanded="false" aria-controls="more">More filters</button></div>
<div id="chips" class="chips" aria-label="Active filters" hidden></div>
</header>
<main id="content" aria-busy="false">
<div id="problem" class="problem" role="alert" hidden></div>
<div id="trunc" class="warn" role="status" hidden></div>
<section id="overview" aria-labelledby="h-overview"><h2 id="h-overview" class="sr-only">Overview</h2>
<div class="groups">
<div class="group"><h3>Traffic</h3><div class="big"><b id="s-req">–</b><span>requests</span></div>
<dl><div><dt>Tool calls</dt><dd id="s-calls">–</dd></div><div><dt>People</dt><dd id="s-people">–</dd></div><div><dt>Connections</dt><dd id="s-conns">–</dd></div></dl></div>
<div class="group"><h3>Quality</h3><div class="big"><b id="s-rate">–</b><span>of requests failed (<span id="s-errs">–</span>)</span></div>
<dl><div><dt>Median tool call</dt><dd id="s-med">–</dd></div><div><dt>Slowest 5% (p95)</dt><dd id="s-p95">–</dd></div></dl></div>
<div class="group"><h3>Sign-ins</h3><div class="big"><b id="s-sok">–</b><span>succeeded</span></div>
<dl><div><dt>Failed</dt><dd id="s-sfail">–</dd></div></dl></div>
</div>
<div class="sec-head" style="margin-top:24px"><h2 id="chart-title">Requests per day (UTC)</h2><div class="legend" aria-hidden="true"><span><i class="sw ok"></i>Requests</span><span><i class="sw err"></i>Failed</span></div></div>
<div class="chartbox"><svg id="chart" role="group" aria-label="Requests over time, failed ones in red; the tables below hold the numbers"></svg><div id="tip" class="tip" hidden></div></div>
<p class="note" id="chart-hint"></p></section>
<section id="people" aria-labelledby="h-people"><h2 id="h-people">People</h2>
<p class="note">A person is the first 8 characters of their keyed Garmin pseudonym; one person can have several connections. Click a person for their tools, activity and latest requests.</p>
<div class="wrap"><table id="t-users"></table></div></section>
<section id="connections" aria-labelledby="h-conns"><h2 id="h-conns">Connections</h2>
<p class="note">One per app sign-in. Click one to show only its activity.</p>
<div class="wrap"><table id="t-grants"></table></div></section>
<section id="tools" class="split" aria-label="Tools, request types and server events">
<div><h2>Tools</h2><p class="note">Click a tool to show only its calls.</p><div class="wrap"><table id="t-tools"></table></div></div>
<div><h2>Request types</h2><div class="wrap"><table id="t-rpc"></table></div>
<h2>Server events</h2><div class="wrap"><table id="t-events"></table></div></div></section>
<section id="lines" aria-labelledby="h-lines"><div class="sec-head"><h2 id="h-lines">Log lines</h2><div class="sec-actions">
<div class="presets" role="group" aria-label="Which lines"><button type="button" data-lines="all" aria-pressed="true">All lines</button><button type="button" data-lines="calls" aria-pressed="false">Tool calls only</button></div>
<button id="csv" type="button" class="plain">Download CSV</button></div></div>
<p class="note" id="lines-note"></p>
<div class="wrap"><table id="t-lines"></table></div>
<p class="note" style="margin-top:12px">A <code>server/discover</code> 400 is how every client probes the server, so it never counts as a failure.</p></section>
</main>
<script>${ADMIN_SCRIPT}</script></body></html>`;
}
