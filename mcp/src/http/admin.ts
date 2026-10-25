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
import { loginShell } from "../login-page.js";
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
 * /mcp/admin/logs.json?from&to and draws the tiles, the per-day (or per-hour) chart and the tables.
 */
export const ADMIN_SCRIPT = String.raw`(function(){
var $=function(id){return document.getElementById(id);};
var all=[],shown=[];
function el(tag,text,cls){var e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=String(text);if(cls)e.className=cls;return e;}
function day(d){return d.toISOString().slice(0,10);}
function fmt(n){return Number(n).toLocaleString("en-US");}
function pct(a,b){return b?(100*a/b).toFixed(1)+"%":"-";}
function quant(arr,q){if(!arr.length)return null;var s=arr.slice().sort(function(a,b){return a-b;});return s[Math.min(s.length-1,Math.floor(q*s.length))];}
function ms(v){return v===null||v===undefined?"-":fmt(v)+" ms";}
function local(t){return t.slice(0,19).replace("T"," ");}
// server/discover answers 400 to every client by design, so it is noise, not an error.
function isError(l){return typeof l.status==="number"&&l.status>=400&&!(l.rpc==="server/discover"&&l.status===400);}
function kind(l){if(l.rpc)return "rpc";if(l.msg)return "event";return "other";}

var now=new Date();$("to").value=day(now);$("from").value=day(new Date(now.getTime()-6*864e5));
function load(){
  var from=$("from").value,to=$("to").value;$("status").textContent="Loading…";
  fetch("/mcp/admin/logs.json?from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to),{credentials:"same-origin"}).then(function(r){
    if(!r.ok)throw new Error("HTTP "+r.status);return r.json();
  }).then(function(d){
    all=d.lines;
    // A line from before requests carried a person borrows one from its connection's other lines.
    var owner={};all.forEach(function(l){if(l.grant&&l.user)owner[l.grant]=l.user;});
    all.forEach(function(l){if(l.grant&&!l.user&&owner[l.grant])l.user=owner[l.grant];});
    $("status").textContent=fmt(all.length)+" lines from "+from+" to "+to+(d.truncated?" (truncated to the newest "+fmt(all.length)+")":"")+".";
    fillSelects();render();
  }).catch(function(e){$("status").textContent="Could not load: "+e.message;});
}
function fillSelects(){
  [["user","user"],["grant","grant"],["tool","tool"],["rpc","rpc"],["msg","msg"]].forEach(function(p){
    var sel=$("f-"+p[0]),keep=sel.value,seen={};
    all.forEach(function(l){var v=l[p[1]];if(typeof v==="string")seen[v]=(seen[v]||0)+1;});
    while(sel.options.length>1)sel.remove(1);
    Object.keys(seen).sort(function(a,b){return seen[b]-seen[a];}).forEach(function(v){var o=el("option",v+" ("+fmt(seen[v])+")");o.value=v;sel.appendChild(o);});
    sel.value=seen[keep]?keep:"";
  });
}
function filtered(){
  var u=$("f-user").value,g=$("f-grant").value,t=$("f-tool").value,r=$("f-rpc").value,m=$("f-msg").value,s=$("f-status").value,q=$("f-q").value.toLowerCase();
  return all.filter(function(l){
    if(u&&l.user!==u)return false;if(g&&l.grant!==g)return false;if(t&&l.tool!==t)return false;if(r&&l.rpc!==r)return false;if(m&&l.msg!==m)return false;
    if(s==="ok"&&(typeof l.status!=="number"||isError(l)))return false;
    if(s==="error"&&!isError(l))return false;
    if(s==="events"&&kind(l)!=="event")return false;
    if(q&&JSON.stringify(l).toLowerCase().indexOf(q)<0)return false;
    return true;
  });
}
function tile(parent,value,label){var d=el("div",null,"tile");d.appendChild(el("b",value));d.appendChild(el("span",label));parent.appendChild(d);}
function table(id,head,rows,onPick,left){left=left||1;
  var t=$(id);t.textContent="";var tr=el("tr");head.forEach(function(h,i){tr.appendChild(el("th",h,i>=left?"num":""));});t.appendChild(tr);
  if(!rows.length){var e=el("tr");var td=el("td","Nothing in this range.");td.colSpan=head.length;e.appendChild(td);t.appendChild(e);return;}
  rows.forEach(function(r){var row=el("tr");r.cells.forEach(function(c,i){row.appendChild(el("td",c,i>=left?"num":""));});
    if(onPick){row.className="pick";row.tabIndex=0;row.title="Filter to this";row.onclick=function(){onPick(r.key);};row.onkeydown=function(e){if(e.key==="Enter")onPick(r.key);};}
    t.appendChild(row);});
}
function pick(sel){return function(v){$(sel).value=v;render();window.scrollTo({top:0,behavior:"smooth"});};}
function render(){
  shown=filtered();
  var rpc=shown.filter(function(l){return kind(l)==="rpc";}),calls=rpc.filter(function(l){return l.rpc==="tools/call";});
  var grants={},people={};rpc.forEach(function(l){if(l.grant)grants[l.grant]=1;if(l.user)people[l.user]=1;});
  var errs=shown.filter(isError).length,signins=shown.filter(function(l){return l.msg==="sign-in";});
  var callMs=calls.map(function(l){return l.ms;}).filter(function(v){return typeof v==="number";});
  var tiles=$("tiles");tiles.textContent="";
  tile(tiles,fmt(rpc.length),"requests");tile(tiles,fmt(calls.length),"tool calls");tile(tiles,fmt(Object.keys(people).length),"people");tile(tiles,fmt(Object.keys(grants).length),"connections");
  tile(tiles,pct(errs,rpc.length),"errors ("+fmt(errs)+")");tile(tiles,ms(quant(callMs,.5)),"median tool call");tile(tiles,ms(quant(callMs,.95)),"p95 tool call");
  tile(tiles,fmt(signins.filter(function(l){return l.ok===true;}).length)+" / "+fmt(signins.filter(function(l){return l.ok===false;}).length),"sign-ins ok / failed");
  chart(rpc);
  var tools={};calls.forEach(function(l){var k=l.tool||"(unnamed)",o=tools[k]||(tools[k]={n:0,e:0,ms:[]});o.n++;if(isError(l))o.e++;if(typeof l.ms==="number")o.ms.push(l.ms);});
  table("t-tools",["Tool","Calls","Errors","Median","p95","Max"],Object.keys(tools).sort(function(a,b){return tools[b].n-tools[a].n;}).map(function(k){var o=tools[k];
    return {key:k,cells:[k,fmt(o.n),o.e?fmt(o.e)+" ("+pct(o.e,o.n)+")":"0",ms(quant(o.ms,.5)),ms(quant(o.ms,.95)),ms(o.ms.length?Math.max.apply(null,o.ms):null)]};}),pick("f-tool"));
  function group(field){var out={};rpc.forEach(function(l){var k=l[field];if(!k)return;
    var o=out[k]||(out[k]={n:0,c:0,e:0,first:l.t,last:l.t,tools:{},grants:{},apps:{},user:l.user,client:l.client});o.n++;if(isError(l))o.e++;if(l.t<o.first)o.first=l.t;if(l.t>o.last)o.last=l.t;
    if(l.grant)o.grants[l.grant]=1;if(l.client)o.apps[l.client]=1;if(l.user)o.user=l.user;if(l.client)o.client=l.client;
    if(l.rpc==="tools/call"){o.c++;o.tools[l.tool]=(o.tools[l.tool]||0)+1;}});return out;}
  function byLast(m){return Object.keys(m).sort(function(a,b){return m[b].last<m[a].last?-1:1;});}
  function topTools(o,n){return Object.keys(o.tools).sort(function(a,b){return o.tools[b]-o.tools[a];}).slice(0,n).map(function(k){return k+" ×"+fmt(o.tools[k]);}).join(", ")||"-";}
  var us=group("user");
  table("t-users",["Person","Apps","Top tools","Connections","Requests","Tool calls","Tools used","Errors","First seen","Last seen"],byLast(us).map(function(k){var o=us[k];
    return {key:k,cells:[k,Object.keys(o.apps).join(", ")||"-",topTools(o,3),fmt(Object.keys(o.grants).length),fmt(o.n),fmt(o.c),fmt(Object.keys(o.tools).length),fmt(o.e),local(o.first),local(o.last)]};}),pick("f-user"),3);
  var gs=group("grant");
  table("t-grants",["Connection","Person","App","Requests","Tool calls","Top tool","First seen","Last seen"],byLast(gs).map(function(k){var o=gs[k];
    return {key:k,cells:[k,o.user||"-",o.client||"-",fmt(o.n),fmt(o.c),topTools(o,1),local(o.first),local(o.last)]};}),pick("f-grant"),3);
  var rs={};rpc.forEach(function(l){var o=rs[l.rpc]||(rs[l.rpc]={n:0,e:0});o.n++;if(isError(l))o.e++;});
  table("t-rpc",["RPC method","Requests","Errors"],Object.keys(rs).sort(function(a,b){return rs[b].n-rs[a].n;}).map(function(k){return {key:k,cells:[k,fmt(rs[k].n),fmt(rs[k].e)]};}),pick("f-rpc"));
  var ev={};shown.forEach(function(l){if(kind(l)!=="event")return;var o=ev[l.msg]||(ev[l.msg]={n:0,last:l.t});o.n++;if(l.t>o.last)o.last=l.t;});
  table("t-events",["Event","Count","Last"],Object.keys(ev).sort(function(a,b){return ev[b].n-ev[a].n;}).map(function(k){return {key:k,cells:[k,fmt(ev[k].n),local(ev[k].last)]};}),pick("f-msg"));
  var recent=shown.slice(-500).reverse();
  table("t-lines",["Time (UTC)","Person","Connection","What","Status","Duration"],recent.map(function(l){
    var what=l.tool?l.tool:l.rpc?l.rpc:l.msg?l.msg:"";var extra=kind(l)==="event"?JSON.stringify(Object.assign({},l,{t:undefined,msg:undefined})):"";
    return {cells:[local(l.t),l.user||"",l.grant||"",what+(extra&&extra!=="{}"?" "+extra:""),l.status!==undefined?l.status:(l.ok===false?"failed":l.ok===true?"ok":""),l.ms!==undefined?ms(l.ms):""]};}),null,4);
  $("lines-note").textContent=shown.length>500?"Newest 500 of "+fmt(shown.length)+" matching lines.":fmt(shown.length)+" matching lines.";
}
function chart(rpc){
  var svg=$("chart"),from=new Date($("from").value+"T00:00:00Z"),to=new Date($("to").value+"T00:00:00Z");
  var days=Math.round((to-from)/864e5)+1,hourly=days<=2,step=hourly?36e5:864e5,n=hourly?days*24:days;
  if(!(n>0)||n>2000){svg.textContent="";return;}
  var counts=new Array(n).fill(0),errs=new Array(n).fill(0);
  rpc.forEach(function(l){var i=Math.floor((Date.parse(l.t)-from.getTime())/step);if(i>=0&&i<n){counts[i]++;if(isError(l))errs[i]++;}});
  var W=720,H=180,L=36,B=22,T=8,max=Math.max(1,Math.max.apply(null,counts)),bw=(W-L)/n,ns="http://www.w3.org/2000/svg";
  svg.setAttribute("viewBox","0 0 "+W+" "+H);svg.textContent="";
  function mk(tag,a){var e=document.createElementNS(ns,tag);for(var k in a)e.setAttribute(k,a[k]);svg.appendChild(e);return e;}
  [0,.5,1].forEach(function(f){var y=H-B-f*(H-B-T);mk("line",{x1:L,x2:W,y1:y,y2:y,"class":"grid"});var t=mk("text",{x:L-6,y:y+4,"text-anchor":"end","class":"tick"});t.textContent=fmt(Math.round(f*max));});
  var every=Math.max(1,Math.ceil(n/8));
  counts.forEach(function(c,i){
    var x=L+i*bw,h=c/max*(H-B-T),label=hourly?new Date(from.getTime()+i*step).toISOString().slice(5,13).replace("T"," ")+":00":day(new Date(from.getTime()+i*step));
    if(c>0)mk("rect",{x:x+Math.min(1,bw*.1),y:H-B-h,width:Math.max(1,bw-Math.min(2,bw*.2)),height:h,rx:Math.min(4,bw/4),"class":"bar"});
    var hit=mk("rect",{x:x,y:T,width:bw,height:H-B-T,fill:"transparent"});
    hit.addEventListener("mousemove",function(e){var tip=$("tip");tip.hidden=false;tip.textContent="";tip.appendChild(el("b",label));tip.appendChild(el("div",fmt(c)+" requests"+(errs[i]?", "+fmt(errs[i])+" errors":"")));
      var r=svg.getBoundingClientRect();tip.style.left=Math.min(r.width-160,Math.max(0,e.clientX-r.left+12))+"px";tip.style.top=(e.clientY-r.top-10)+"px";});
    hit.addEventListener("mouseleave",function(){$("tip").hidden=true;});
    if(i%every===0){var t=mk("text",{x:x+bw/2,y:H-6,"text-anchor":"middle","class":"tick"});t.textContent=hourly?label.slice(6):label.slice(5);}
  });
  $("chart-title").textContent=(hourly?"Requests per hour":"Requests per day")+" (UTC)";
}
$("load").onclick=load;
["f-user","f-grant","f-tool","f-rpc","f-msg","f-status"].forEach(function(id){$(id).onchange=render;});
$("f-q").oninput=render;
$("clear").onclick=function(){["f-user","f-grant","f-tool","f-rpc","f-msg","f-status","f-q"].forEach(function(id){$(id).value="";});render();};
load();
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

const STYLE = `<style>
main{max-width:1100px}footer{max-width:1100px}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:0 0 12px}
.controls label{margin:0;font-size:.8rem;color:var(--muted)}
.controls input,.controls select{display:block;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--input);color:var(--text);font-size:.9rem;max-width:220px}
.controls button{width:auto;margin:0;padding:7px 14px;font-size:.9rem}
.controls button.plain{background:none;border:1px solid var(--line);color:var(--text)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:12px 0 20px}
.tile{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.tile b{display:block;font-size:1.35rem;font-variant-numeric:tabular-nums}.tile span{font-size:.8rem;color:var(--muted)}
h2{font-size:1rem;margin:24px 0 8px}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;font-weight:600;color:var(--muted);padding:6px 8px 6px 0;border-bottom:1px solid var(--line)}
td{padding:5px 8px 5px 0;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.pick{cursor:pointer}tr.pick:hover,tr.pick:focus-visible{background:color-mix(in srgb,var(--accent) 10%,transparent);outline:none}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:0 24px}
.grid2 td:first-child{white-space:nowrap}
.chartbox{position:relative}
#chart{display:block;width:100%;height:auto}
#chart .bar{fill:var(--accent)}#chart .grid{stroke:var(--line);stroke-width:1}#chart .tick{fill:var(--muted);font-size:11px}
#tip{position:absolute;pointer-events:none;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:.8rem;box-shadow:0 2px 8px rgba(0,0,0,.15);min-width:140px}
#status,.note{font-size:.85rem;color:var(--muted);margin:0}
</style>`;

const select = (id: string, label: string) => `<label>${label}<select id="${id}"><option value="">All</option></select></label>`;

export function adminPage(): string {
  return loginShell(
    "Garmin MCP logs",
    `${STYLE}<h1>Garmin MCP logs</h1>
<div class="controls">
<label>From<input id="from" type="date"></label><label>To<input id="to" type="date"></label><button id="load" type="button">Load</button>
</div>
<p id="status" role="status"></p>
<div class="controls" style="margin-top:12px">
${select("f-user", "Person")}${select("f-grant", "Connection")}${select("f-tool", "Tool")}${select("f-rpc", "RPC method")}${select("f-msg", "Event")}
<label>Status<select id="f-status"><option value="">All</option><option value="ok">OK</option><option value="error">Errors</option><option value="events">Events only</option></select></label>
<label>Search<input id="f-q" type="text" placeholder="any text"></label><button id="clear" type="button" class="plain">Clear filters</button>
</div>
<div class="tiles" id="tiles"></div>
<h2 id="chart-title">Requests</h2>
<div class="chartbox"><svg id="chart" role="img" aria-label="Requests over time; the tables below hold the numbers"></svg><div id="tip" hidden></div></div>
<h2>People</h2><p class="note">A person is the first 8 characters of their keyed Garmin pseudonym; one person can hold several connections. Click one to see only their activity.</p>
<div class="wrap"><table id="t-users"></table></div>
<h2>Connections</h2><div class="wrap"><table id="t-grants"></table></div>
<div class="grid2">
<div><h2>Tools</h2><div class="wrap"><table id="t-tools"></table></div></div>
<div><h2>RPC methods</h2><div class="wrap"><table id="t-rpc"></table></div></div>
<div><h2>Server events</h2><div class="wrap"><table id="t-events"></table></div></div>
</div>
<h2>Log lines</h2><p class="note" id="lines-note"></p>
<div class="wrap"><table id="t-lines"></table></div>
<p class="note" style="margin-top:16px">Click a row to filter by it. A <code>server/discover</code> 400 is how every client probes the server, so it does not count as an error. Times are UTC.</p>
<script>${ADMIN_SCRIPT}</script>`,
  );
}
