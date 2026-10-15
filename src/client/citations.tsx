import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type CitationSource={url:string;title:string;startIndex?:number;endIndex?:number};
type SafeSource=CitationSource&{number:number};
function safeSources(sources:CitationSource[]=[]):SafeSource[]{
  const numbers=new Map<string,number>();
  return sources.flatMap(source=>{
    try{
      const url=new URL(source.url);
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return [];
      if(!numbers.has(url.href)){if(numbers.size>=20)return [];numbers.set(url.href,numbers.size+1);}
      return [{...source,url:url.href,title:source.title?.trim()||url.hostname,number:numbers.get(url.href)!}];
    }catch{return [];}
  });
}
function validBoundary(text:string,index:number){
  return !(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));
}
type MarkdownNode={type:string;value?:string;children?:MarkdownNode[];position?:{start:{offset?:number};end:{offset?:number}};url?:string;title?:string;data?:{hProperties:Record<string,unknown>}};
export function safeMarkdownUrl(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function MessageText({text,sources}:{text:string;sources?:CitationSource[]}){
  const citations=safeSources(sources).filter(source=>Number.isInteger(source.startIndex)&&Number.isInteger(source.endIndex)&&source.startIndex!>=0&&source.endIndex!>=source.startIndex!&&source.endIndex!<=text.length&&validBoundary(text,source.startIndex!)&&validBoundary(text,source.endIndex!)).sort((a,b)=>a.endIndex!-b.endIndex!).filter((source,index,all)=>all.findIndex(other=>other.url===source.url&&other.endIndex===source.endIndex)===index);
  // Add citations only to plain text leaves whose source offsets are exact. Code,
  // links, escaped Markdown and ambiguous boundaries retain the source-list fallback.
  function citationPlugin(){return (tree:MarkdownNode)=>{
    function walk(parent:MarkdownNode){
      if(['code','inlineCode','link','image','html'].includes(parent.type)||!parent.children)return;
      parent.children=parent.children.flatMap(node=>{
        if(node.type!=='text'){walk(node);return [node];}
        const start=node.position?.start.offset,end=node.position?.end.offset;
        if(start===undefined||end===undefined||text.slice(start,end)!==node.value)return [node];
        const matches=citations.filter(source=>source.endIndex!>start&&source.endIndex!<=end);
        if(!matches.length)return [node];
        const result:MarkdownNode[]=[];let cursor=start;
        for(const source of matches){
          const boundary=source.endIndex!,covered=Math.max(cursor,source.startIndex!);
          result.push({type:'text',value:text.slice(cursor,covered)+text.slice(covered,boundary).replace(/cite[^\r\n]*/g,'')});
          result.push({type:'link',url:source.url,title:source.title,data:{hProperties:{className:'inline-citation','aria-label':`Source ${source.number}: ${source.title} (opens in a new tab)`}},children:[{type:'text',value:`[${source.number}]`}]});
          cursor=boundary;
        }
        result.push({type:'text',value:text.slice(cursor,end)});return result;
      });
    }walk(tree);
  };}
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm,citationPlugin]} urlTransform={safeMarkdownUrl} components={{
    a:({node,href,children,...props})=>href?<a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span>{children}</span>,
    img:({alt})=><span className="markdown-image">{alt?`[Image: ${alt}]`:'[Image]'}</span>,
    table:({children})=><div className="markdown-table" tabIndex={0} role="region" aria-label="Table"><table>{children}</table></div>
  }}>{text}</Markdown></div>;
}
export function MessageSources({sources}:{sources?:CitationSource[]}){
  const links=safeSources(sources).filter((source,index,all)=>all.findIndex(other=>other.url===source.url)===index);
  if(!links.length)return null;
  return <nav className="message-sources" aria-label="Sources for this reply"><span>Sources</span>{links.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" title={`${source.title} (opens in a new tab)`}>[{source.number}] {source.title}<span className="sr-only"> (opens in a new tab)</span></a>)}</nav>;
}
