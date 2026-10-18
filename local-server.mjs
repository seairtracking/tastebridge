import http from 'node:http';
import worker from './worker/index.js';
const port=Number(process.env.PORT||8787);
http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const request=new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const response=await worker.fetch(request,{QLOO_API_KEY:process.env.QLOO_API_KEY,QLOO_API_URL:process.env.QLOO_API_URL});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port,'127.0.0.1',()=>console.log('TasteBridge: http://127.0.0.1:'+port));
