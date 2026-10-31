#!/usr/bin/env node
'use strict';
// Machine-readable, read-only tool for people and other agents. No API keys needed.
const fs = require('node:fs');
const path = require('node:path');
async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node scripts/query-chat.js [--url http://localhost:5300] [--project 1] [--participant employee-id] [--sender employee-id] [--q 关键词] [--kind question] [--since ISO时间] [--until ISO时间] [--limit 50] [--all] [--context 消息编号] [--out E:/path/history.json]');
    return;
  }
  const allowed=new Set(['url','project','participant','sender','q','kind','since','until','limit','before','snapshot','all','context','out']);
  const options={};
  for(let i=0;i<args.length;i++) {
    const key=args[i].replace(/^--/,'');
    if(!args[i].startsWith('--')||!allowed.has(key))throw new Error('未知参数：'+args[i]);
    if(key==='all'){options.all=true;continue;}
    if(args[i+1]==null||args[i+1].startsWith('--'))throw new Error('缺少参数值：'+args[i]);
    options[key]=args[++i];
  }
  const {url='http://localhost:5300',all,context,out,...query}=options;
  const base=new URL(url);
  if(!['http:','https:'].includes(base.protocol))throw new Error('服务地址必须是 http 或 https');
  const read=async route=>{const r=await fetch(new URL(route,base),{signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d;};
  let result;
  if(context)result=await read('/api/collaboration/messages/'+encodeURIComponent(context)+'/context');
  else {
    result=await read('/api/collaboration/messages?'+new URLSearchParams(query));
    while(all&&result.nextBefore){
      const next=await read('/api/collaboration/messages?'+new URLSearchParams({...query,snapshot:result.snapshot,before:result.nextBefore}));
      result.messages.push(...next.messages);result.nextBefore=next.nextBefore;
    }
  }
  const text=JSON.stringify(result,null,2)+'\n';
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,text);console.log(JSON.stringify({file:path.resolve(out),messages:result.messages?.length}));}
  else process.stdout.write(text);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
