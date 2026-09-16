// THROWAWAY demo server. Real application shell and read paths; in-memory fixtures only.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const group = { id:'prototype-costco', name:'Costco friends', icon:{type:'lucide',value:'shopping-basket'}, memberCount:3, createdBy:'alice', creatorName:'Alice', isCreator:true, createdAt:'2026-09-01', members:['Alice','Bob','Carol'].map((name,i)=>({id:name.toLowerCase(),displayName:name,isCurrentUser:i===0,isCreator:i===0,joinedAt:'2026-09-01'})) };
const summary = { netCents:5997, receivableCents:5997, payableCents:0 };
const ledger = { members:group.members.map((m,i)=>({userId:m.id,displayName:m.displayName,netCents:[5997,-5997,0][i]})), suggestions:[{fromUserId:'bob',toUserId:'alice',amountCents:5997}],incompleteBillIds:['open'] };
const bills = [['open','Saturday essentials',8450,null,'2026-09-16'],['groceries','Weekend groceries',10000,'2026-09-14','2026-09-14'],['coffee','Coffee & kitchen things',3200,'2026-09-10','2026-09-10']].map(([id,title,totalCents,completedAt,purchaseDate])=>({id,title,totalCents,completedAt,purchaseDate,groupId:group.id,initiatorId:'alice',canceledAt:null,confirmedCount:completedAt?3:1,participants:group.members.map(m=>({userId:m.id,displayName:m.displayName,isCurrentUser:m.isCurrentUser,amountCents:0,confirmedAt:null})),revision:1,notes:'',submittedCents:0,differenceCents:0,adjustmentCents:0}));
const server = await createServer({ root, configFile:false,envDir:false,cacheDir:`${root}/node_modules/.vite-prototype`,
  define:{'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY':JSON.stringify('prototype-only')},
  plugins:[{name:'prototype-fixtures',enforce:'pre',resolveId(id){if(id==='@clerk/react')return `${root}/test/clerk.prototype.tsx`;},configureServer(server){server.middlewares.use('/api',(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/events')){res.setHeader('Content-Type','text/event-stream');res.write('event: ready\ndata: {}\n\n');const timer=setInterval(()=>res.write(': heartbeat\n\n'),10000);req.on('close',()=>clearInterval(timer));return;}
    const body=req.url==='/groups'?{groups:[group]}:req.url==='/summary'?{summary}:req.url==='/attention'?{actions:[]}:req.url.endsWith('/bills')?{bills,summary,ledger,repayments:[]}:req.url===`/groups/${group.id}`?{group}:{};
    res.end(JSON.stringify(body));
  });}},react()], optimizeDeps:{exclude:['@clerk/react']},server:{host:'0.0.0.0',port:5190,strictPort:true,allowedHosts:['dev-2a1m']}});
await server.listen();
console.log('Prototype: http://dev-2a1m:5190/?variant=A#/group-bills/prototype-costco');
