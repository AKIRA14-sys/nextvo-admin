import { lookup } from "node:dns/promises";
import { NextResponse, type NextRequest } from "next/server";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import { isAuthorizedAdmin } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ url: z.string().trim().url().max(2048) });
const maxBytes = 1_500_000;
function publicAddress(raw: string) {
  try { const address = ipaddr.parse(raw); return address.range() === "unicast"; } catch { return false; }
}
async function validateUrl(input: URL) {
  if (input.protocol !== "https:" || input.username || input.password || (input.port && input.port !== "443")) throw new Error("Only public HTTPS product URLs on the standard port can be checked.");
  const host = input.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Local and internal network addresses are blocked.");
  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((item) => !publicAddress(item.address))) throw new Error("The supplier host did not resolve exclusively to public internet addresses.");
  return { host, pin: records[0] };
}
function decodeHtml(value: string) {
  return value.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).trim();
}
function attr(tag: string, name: string) { const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,"i")); return decodeHtml(match?.[1] || match?.[2] || match?.[3] || ""); }
function meta(html: string, key: string, value: string) { const tags = html.match(/<meta\b[^>]*>/gi) || []; for (const tag of tags) if (attr(tag,key).toLowerCase() === value.toLowerCase()) return attr(tag,"content"); return ""; }
function cleanText(value: string, limit: number) { return decodeHtml(value.replace(/<[^>]*>/g," ").replace(/\s+/g," ")).slice(0,limit); }
function productJson(html: string): any {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  function search(node: any): any { if (!node || typeof node !== "object") return null; if (Array.isArray(node)) { for (const item of node) { const found=search(item); if(found)return found; } return null; } const type=node["@type"]; if(type==="Product"||(Array.isArray(type)&&type.includes("Product"))) return node; for(const value of Object.values(node)){const found=search(value);if(found)return found;} return null; }
  for(const script of scripts){const json=script.replace(/^<script\b[^>]*>/i,"").replace(/<\/script>$/i,"").trim();try{const found=search(JSON.parse(json));if(found)return found;}catch{}}
  return null;
}
function parsePage(html: string, source: URL) {
  const structured=productJson(html); const offer=Array.isArray(structured?.offers)?structured.offers[0]:structured?.offers; const title=cleanText(structured?.name || meta(html,"property","og:title") || meta(html,"name","twitter:title") || ((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||""),240);
  const description=cleanText(structured?.description || meta(html,"property","og:description") || meta(html,"name","description"),2000);
  let imageList=structured?.image || meta(html,"property","og:image") || meta(html,"name","twitter:image") || []; if(typeof imageList==="string")imageList=[imageList]; if(!Array.isArray(imageList))imageList=[];
  const images=Array.from(new Set(imageList.map((item:any)=>typeof item==="string"?item:item?.url).filter((value:any)=>typeof value==="string").map((value:string)=>{try{const url=new URL(value,source);return url.protocol==="https:"&&!url.username&&!url.password?url.toString():"";}catch{return "";}}).filter(Boolean))).slice(0,8);
  const price=offer?.price ?? meta(html,"property","product:price:amount") ?? meta(html,"itemprop","price"); const currency=offer?.priceCurrency ?? meta(html,"property","product:price:currency") ?? meta(html,"itemprop","priceCurrency");
  return { title, description, images, price: price!==undefined && price!==null && Number.isFinite(Number(price))?String(price):"", currency: typeof currency==="string"?currency.toUpperCase().slice(0,3):"", sku:cleanText(structured?.sku||"",80), brand:cleanText(structured?.brand?.name||structured?.brand||"",120), source_url:source.toString(), supplier_host:source.hostname };
}
async function fetchLimited(url: URL) {
  const {host,pin}=await validateUrl(url);
  const pinnedLookup=(hostname:string, options:any, callback:any)=>{
    if(hostname.toLowerCase().replace(/\.$/,"")!==host)return callback(new Error("Unexpected DNS lookup host"));
    if(options?.all)return callback(null,[{address:pin.address,family:pin.family}]);
    callback(null,pin.address,pin.family);
  };
  const dispatcher=new Agent({connect:{lookup:pinnedLookup as any}});
  try {
    const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(9000),headers:{"User-Agent":"NEXTVO-Catalog-Assistant/1.0 (+manual product review)","Accept":"text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.2"},dispatcher} as RequestInit & {dispatcher:Agent});
    if(response.status>=300&&response.status<400) return {status:response.status,location:response.headers.get("location"),response,dispatcher};
    if(!response.ok) throw new Error(`The supplier page responded with HTTP ${response.status}.`);
    const length=Number(response.headers.get("content-length")||0); if(length>maxBytes) throw new Error("Supplier page is too large to retrieve safely.");
    const contentType=response.headers.get("content-type")||""; if(!/text\/html|application\/xhtml\+xml|application\/ld\+json/i.test(contentType)) throw new Error("This URL did not return a supported public product page.");
    const reader=response.body?.getReader(); if(!reader) throw new Error("The supplier response had no readable page body."); const chunks:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("Supplier page exceeded the safe 1.5 MB response limit.");}chunks.push(value);}const buffer=new Uint8Array(total);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}return {html:new TextDecoder("utf-8").decode(buffer),response,dispatcher};
  }catch(error){await dispatcher.close().catch(()=>undefined);throw error;}
}
async function record(url:string,host:string,status:"retrieved"|"failed",title:string,errorSummary:string){const supabase=await getSupabaseServerClient();if(!supabase)return null;const {data:{user}}=await supabase.auth.getUser();if(!user||!isAuthorizedAdmin(user))return null;const {data}=await supabase.from("nextvo_import_history").insert({source_url:url,supplier_host:host,status,imported_title:title,error_summary:errorSummary,created_by:user.id}).select("id").maybeSingle();return data?.id||null;}
export async function POST(request:NextRequest){const supabase=await getSupabaseServerClient();if(!supabase)return NextResponse.json({error:"Supabase is not configured."},{status:503,headers:{"Cache-Control":"no-store"}});const {data:{user}}=await supabase.auth.getUser();if(!user||!isAuthorizedAdmin(user))return NextResponse.json({error:"Administrator access required."},{status:403,headers:{"Cache-Control":"no-store"}});
  let raw:any;try{raw=await request.json();}catch{return NextResponse.json({error:"Provide a valid URL."},{status:400,headers:{"Cache-Control":"no-store"}});}const parsed=bodySchema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:"Enter a valid public product URL."},{status:400,headers:{"Cache-Control":"no-store"}});
  let url=new URL(parsed.data.url);let currentHost=url.hostname;try{let result:any;for(let hop=0;hop<=2;hop++){result=await fetchLimited(url);if(result.html!==undefined){await result.dispatcher.close().catch(()=>undefined);const product=parsePage(result.html,url);if(!product.title)throw new Error("No public product title metadata was found. Enter the product manually instead.");const history_id=await record(url.toString(),url.hostname,"retrieved",product.title,"");return NextResponse.json({...product,history_id},{headers:{"Cache-Control":"no-store"}});}await result.dispatcher.close().catch(()=>undefined);if(!result.location)throw new Error("Supplier page redirected without a safe destination.");if(hop===2)throw new Error("Too many redirects. Open the final public product page or use manual entry.");url=new URL(result.location,url);currentHost=url.hostname;}
    throw new Error("Could not retrieve public product metadata.");
  }catch(error){const message=error instanceof Error?error.message:"Supplier metadata retrieval failed.";const history_id=await record(parsed.data.url,currentHost,"failed","",message.slice(0,220));return NextResponse.json({error:message,history_id},{status:422,headers:{"Cache-Control":"no-store"}});}}
