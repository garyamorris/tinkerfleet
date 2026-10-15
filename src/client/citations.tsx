import React from 'react';

export type CitationSource={url:string;title:string;startIndex?:number;endIndex?:number};
type SafeSource=CitationSource&{number:number};
function safeSources(sources:CitationSource[]=[]):SafeSource[]{
  const numbers=new Map<string,number>();
  return sources.flatMap(source=>{
    try{
      const url=new URL(source.url);
      if(!['http:','https:'].includes(url.protocol))return [];
      if(!numbers.has(url.href)){if(numbers.size>=20)return [];numbers.set(url.href,numbers.size+1);}
      return [{...source,url:url.href,title:source.title?.trim()||url.hostname,number:numbers.get(url.href)!}];
    }catch{return [];}
  });
}
function validBoundary(text:string,index:number){
  return !(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));
}
export function MessageText({text,sources}:{text:string;sources?:CitationSource[]}){
  const citations=safeSources(sources).filter(source=>Number.isInteger(source.startIndex)&&Number.isInteger(source.endIndex)&&source.startIndex!>=0&&source.endIndex!>=source.startIndex!&&source.endIndex!<=text.length&&validBoundary(text,source.startIndex!)&&validBoundary(text,source.endIndex!)).sort((a,b)=>a.endIndex!-b.endIndex!).filter((source,index,all)=>all.findIndex(other=>other.url===source.url&&other.endIndex===source.endIndex)===index);
  const parts:React.ReactNode[]=[];let cursor=0;
  for(const [index,source] of citations.entries()){
    const end=source.endIndex!;
    const coveredStart=Math.max(cursor,source.startIndex!);
    parts.push(text.slice(cursor,coveredStart));
    parts.push(text.slice(coveredStart,end).replace(/cite[^\r\n]*/g,''));
    parts.push(<a className="inline-citation" key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${source.number}: ${source.title} (opens in a new tab)`} title={source.title}>[{source.number}]</a>);
    cursor=end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
export function MessageSources({sources}:{sources?:CitationSource[]}){
  const links=safeSources(sources).filter((source,index,all)=>all.findIndex(other=>other.url===source.url)===index);
  if(!links.length)return null;
  return <nav className="message-sources" aria-label="Sources for this reply"><span>Sources</span>{links.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" title={`${source.title} (opens in a new tab)`}>[{source.number}] {source.title}<span className="sr-only"> (opens in a new tab)</span></a>)}</nav>;
}
