const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname, '../assets/js/data.js'),'utf8');
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const cats=['Moradia','Alimentação','Transporte','Lazer'];
const now='2026-11-22T12:00:00.000Z';
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const uid=i=>`aaaaaaaa-aaaa-4aaa-8aaa-${i.toString(16).padStart(12,'0')}`;
const transaction=(i,user=A)=>({id:uid(i),user_id:user,type:'expense',description:'Lançamento '+i,amount_cents:String(i+1),category:'Alimentação',date:'2026-11-22',recurring:false,installment:1,installment_count:1,series_id:null,status:'pending',created_at:now});
const profile=(user=A,name='Usuária A',balance='0')=>({user_id:user,full_name:name,opening_balance_cents:balance});
const budgets=(user=A)=>cats.map(category=>({user_id:user,category,limit_cents:'0'}));
function environment({initial={},cap=1000,hook}={}){
 const store={profiles:[],transactions:[],budgets:[],goals:[],support_messages:[],...clone(initial)};
 let user={id:A,email:'alice@example.com',user_metadata:{full_name:'  Alice  '}};
 const calls=[];
 const session={ready:Promise.resolve(),getUser:()=>user,request:async(target,options={})=>{
  const c={target,method:options.method||'GET',body:clone(options.body),headers:options.headers||{}};
  calls.push(c);const u=new URL(target,'https://nivela.test'),table=u.pathname.split('/').pop();
  if(hook){const result=await hook({c,u,table,store,setUser:u=>{user=u},session});if(result&&result.override)return result.value;}
  if(!store[table])throw new Error('Tabela desconhecida: '+table);
  const filter=(row)=>[...u.searchParams.entries()].every(([key,value])=>!value.startsWith('eq.')||String(row[key])===value.slice(3));
  if(c.method==='GET'){
   let result=store[table].filter(filter);const order=(u.searchParams.get('order')||'').split(',').filter(Boolean);
   result=result.slice().sort((a,b)=>{for(const item of order){const [key,dir]=item.split('.');const d=String(a[key]).localeCompare(String(b[key]));if(d)return dir==='desc'?-d:d;}return 0;});
   const start=Number(u.searchParams.get('offset')||0),limit=Math.min(Number(u.searchParams.get('limit')||cap),cap);
   return clone(result.slice(start,start+limit));
  }
  if(c.method==='POST'){
   const entries=Array.isArray(c.body)?c.body:[c.body],out=[];
   for(const item of entries){
    const fields=table==='profiles'?['user_id']:table==='budgets'?['user_id','category']:['id'];
    const existing=store[table].find(row=>fields.every(key=>row[key]===item[key]));
    if(existing){
     if(c.headers.Prefer?.includes('ignore-duplicates'))continue;
     if(c.headers.Prefer?.includes('merge-duplicates'))Object.assign(existing,item);
     else {const e=new Error('conflict');e.status=409;throw e;}
     out.push(existing);
    }else{const row={...item,...(table==='transactions'||table==='support_messages'?{created_at:now}:{})};store[table].push(row);out.push(row);}
   }
   return c.headers.Prefer?.includes('return=minimal')?null:clone(out);
  }
  if(c.method==='PATCH'){const selected=store[table].filter(filter);for(const row of selected)Object.assign(row,c.body);return clone(selected);}
  if(c.method==='DELETE'){const selected=store[table].filter(filter);store[table]=store[table].filter(row=>!selected.includes(row));return clone(selected.map(row=>({id:row.id})));}
  throw new Error('Método desconhecido');
 }};
 const window={NivelaSession:session};Object.defineProperty(window,'localStorage',{get(){throw new Error('Data não deve acessar dados demonstrativos');}});
 vm.runInNewContext(source,{window,URLSearchParams,Intl,Date,console,crypto:{randomUUID}});
 return {api:window.NivelaData,calls,store,window,session,getUser:()=>user,setUser:u=>{user=u}};
}
const results=[];
async function test(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(error){results.push({name,ok:false,error:error.stack});console.log('FAIL '+name+': '+error.message);}}
const valid=(extra={})=>({type:'expense',description:'  Conta de teste  ',amountCents:3334,category:'Alimentação',date:'2026-11-22',...extra});
const code=expected=>e=>e.code===expected;
(async()=>{
 await test('load pagina 2005 transações com limite servidor 137 e normaliza cents/data',async()=>{
  const e=environment({initial:{profiles:[profile(A,'Ana','-99999999999')],budgets:budgets(),transactions:Array.from({length:2005},(_,i)=>transaction(i+1)).concat([transaction(3000,B)])},cap:137});
  const value=await e.api.load();assert.equal(value.transactions.length,2005);assert.equal(value.profile.openingBalanceCents,-99999999999);assert.equal(value.transactions[0].amountCents,2);assert.equal(value.transactions[0].date,'2026-11-22');assert.equal(value.transactions[0].createdAt,now);assert.equal(value.transactions[0].installmentCount,1);assert.equal(value.transactions[0].status,'pending');
  const calls=e.calls.filter(x=>x.method==='GET'&&x.target.startsWith('/rest/v1/transactions?'));assert.ok(calls.length>=16);assert.ok(calls.every(c=>new URL(c.target,'https://x').searchParams.get('user_id')==='eq.'+A));assert.ok(calls.every(c=>new URL(c.target,'https://x').searchParams.get('select').includes('created_at')));
 });
 await test('load vazio cria perfil e quatro budgets zero sem metas/transações demonstrativas',async()=>{
  const e=environment();const value=await e.api.load();assert.equal(value.profile.fullName,'Alice');assert.equal(value.profile.openingBalanceCents,0);assert.equal(value.transactions.length,0);assert.equal(value.goals.length,0);assert.equal(value.budgets.length,4);assert.ok(value.budgets.every(x=>x.limitCents===0));assert.equal(e.store.goals.length,0);assert.ok(e.calls.filter(x=>x.method==='POST').every(x=>x.headers.Prefer==='resolution=ignore-duplicates,return=minimal'));
 });
 await test('defaults não sobrescrevem perfil ou limite criados por outra aba durante corrida',async()=>{
  const e=environment({hook:({c,table,store})=>{if(c.method==='POST'&&table==='profiles')store.profiles.push(profile(A,'Nome escolhido em outra aba','9876'));if(c.method==='POST'&&table==='budgets')store.budgets.push({user_id:A,category:'Moradia',limit_cents:'35000'});}});
  const value=await e.api.load();assert.equal(value.profile.fullName,'Nome escolhido em outra aba');assert.equal(value.profile.openingBalanceCents,9876);assert.equal(value.budgets.find(x=>x.category==='Moradia').limitCents,35000);assert.equal(value.budgets.length,4);
 });
 await test('load existente não grava defaults sobre preferências e mantém metas reais',async()=>{
  const initialBudgets=budgets();initialBudgets[0].limit_cents='12345';const e=environment({initial:{profiles:[profile(A,'Nome próprio','1000')],budgets:initialBudgets,goals:[{id:uid(77),user_id:A,name:'Reserva',target_cents:'50000',saved_cents:'12000',tone:'green'}]}});const value=await e.api.load();assert.equal(e.calls.filter(x=>x.method==='POST').length,0);assert.equal(value.goals[0].savedCents,12000);assert.equal(value.budgets.find(x=>x.category==='Moradia').limitCents,12345);
 });
 await test('batch normaliza camel snake, status, datas e dono exclusivamente da sessão',async()=>{
  const e=environment();const value=await e.api.saveTransactions([valid({id:uid(1),userId:B,user_id:B,installmentCount:3,installment:1,seriesId:uid(99),status:'paid'}),valid({type:'income',description:'Salário',amountCents:99999999999}),valid({type:'transfer',description:'Movimento interno',amountCents:500})]);
  const post=e.calls.find(x=>x.method==='POST');assert.equal(post.body.length,3);assert.ok(post.body.every(x=>x.user_id===A));assert.ok(post.body.every(x=>!Object.hasOwn(x,'userId')&&!Object.hasOwn(x,'amountCents')));assert.equal(post.body[0].amount_cents,3334);assert.equal(post.body[0].installment_count,3);assert.equal(post.body[0].series_id,uid(99));assert.equal(value[0].status,'paid');assert.equal(value[1].status,'pending');assert.equal(value[0].description,'Conta de teste');assert.equal(value[0].createdAt,now);
 });
 await test('validação rejeita centavos fracionários, acima teto, datas irreais e parcelas incompatíveis sem POST',async()=>{
  const e=environment();for(const input of [valid({amountCents:0}),valid({amountCents:1.1}),valid({amountCents:100000000000}),valid({date:'2026-02-30'}),valid({date:'1899-12-31'}),valid({category:'Inexistente'}),valid({type:'income',installmentCount:2}),valid({recurring:true,installmentCount:2}),valid({installmentCount:2,installment:3}),valid({status:'unknown'})])await assert.rejects(e.api.saveTransactions([input]),code('VALIDATION_ERROR'));assert.equal(e.calls.length,0);
  await assert.rejects(e.api.saveTransactions([valid(),valid({amountCents:0})]),code('VALIDATION_ERROR'));assert.equal(e.calls.length,0);
 });
 await test('update status e delete filtram dono e rejeitam id alheio sem alterar registro',async()=>{
  const e=environment({initial:{transactions:[transaction(1),transaction(2,B)]}});const updated=await e.api.updateTransaction(uid(1),{status:'paid',userId:B,user_id:B,id:uid(2),createdAt:'x'});assert.equal(updated.status,'paid');assert.equal(updated.userId,A);assert.deepEqual(e.calls[0].body,{status:'paid'});assert.equal(new URL(e.calls[0].target,'https://x').searchParams.get('user_id'),'eq.'+A);await assert.rejects(e.api.updateTransaction(uid(2),{status:'paid'}),code('NOT_FOUND'));await assert.rejects(e.api.deleteTransaction(uid(2)),code('NOT_FOUND'));assert.equal(e.store.transactions.find(x=>x.user_id===B).status,'pending');assert.equal((await e.api.deleteTransaction(uid(1))).id,uid(1));assert.equal(e.store.transactions.length,1);
 });
 await test('budget upsert usa identidade da sessão e valor inteiro dentro teto',async()=>{
  const e=environment({initial:{budgets:budgets()}});const result=await e.api.saveBudget('Moradia',99999999999);assert.equal(result.limitCents,99999999999);assert.equal(e.calls[0].body[0].user_id,A);assert.match(e.calls[0].headers.Prefer,/merge-duplicates/);await assert.rejects(e.api.saveBudget('Moradia',-1),code('VALIDATION_ERROR'));await assert.rejects(e.api.saveBudget('Moradia',100000000000),code('VALIDATION_ERROR'));
 });
 await test('saveBudgets valida todo lote e categorias únicas antes de HTTP',async()=>{
  const e=environment({initial:{budgets:budgets()}});
  await assert.rejects(e.api.saveBudgets([{category:'Moradia',limitCents:12000},{category:'Lazer',limitCents:-1}]),code('VALIDATION_ERROR'));assert.equal(e.calls.length,0);
  await assert.rejects(e.api.saveBudgets([{category:'Moradia',limitCents:12000},{category:'Moradia',limitCents:13000}]),code('VALIDATION_ERROR'));assert.equal(e.calls.length,0);
  const result=await e.api.saveBudgets([{category:'Moradia',limitCents:12000,user_id:B},{category:'Lazer',limitCents:13000,userId:B}]);assert.equal(e.calls.length,1);assert.equal(e.calls[0].method,'POST');assert.ok(e.calls[0].body.every(x=>x.user_id===A));assert.equal(result.length,2);assert.equal(result.find(x=>x.category==='Moradia').limitCents,12000);assert.equal(result.find(x=>x.category==='Lazer').limitCents,13000);
 });
 await test('saveGoal POST sem id, PATCH com id e delete com dono isolado',async()=>{
  const e=environment({initial:{goals:[{id:uid(2),user_id:B,name:'Alheia',target_cents:100,saved_cents:0,tone:'blue'}]}});const created=await e.api.saveGoal({name:' Minha meta ',targetCents:50000,savedCents:1200,tone:'purple',user_id:B,userId:B});assert.equal(e.calls[0].method,'POST');assert.equal(e.calls[0].body.user_id,A);assert.equal(created.name,'Minha meta');assert.equal(created.targetCents,50000);assert.equal(created.savedCents,1200);const edited=await e.api.saveGoal({...created,savedCents:2000,userId:B,user_id:B});assert.equal(e.calls[1].method,'PATCH');assert.equal(edited.savedCents,2000);assert.ok(!Object.hasOwn(e.calls[1].body,'user_id'));await assert.rejects(e.api.saveGoal({id:uid(2),name:'Hack',targetCents:500}),code('NOT_FOUND'));await assert.rejects(e.api.deleteGoal(uid(2)),code('NOT_FOUND'));assert.equal((await e.api.deleteGoal(created.id)).id,created.id);
 });
 await test('saveProfile limita saldo assinado e ignora propriedade do formulário',async()=>{
  const e=environment({initial:{profiles:[profile()]}});const result=await e.api.saveProfile({fullName:' Novo nome ',openingBalanceCents:-99999999999,user_id:B,userId:B});assert.equal(result.fullName,'Novo nome');assert.equal(result.openingBalanceCents,-99999999999);assert.ok(!Object.hasOwn(e.calls[0].body,'user_id'));await assert.rejects(e.api.saveProfile({openingBalanceCents:-100000000000}),code('VALIDATION_ERROR'));await assert.rejects(e.api.saveProfile({openingBalanceCents:100000000000}),code('VALIDATION_ERROR'));await assert.rejects(e.api.saveProfile({user_id:B}),code('VALIDATION_ERROR'));
 });
 await test('support insere proprietário correto com return minimal e devolve somente id',async()=>{
  const e=environment();const result=await e.api.sendSupport({name:' Teste ',email:'teste@example.com',subject:'Transações',message:'Mensagem com conteúdo válido',user_id:B});assert.equal(e.calls[0].body.user_id,A);assert.equal(e.calls[0].headers.Prefer,'return=minimal');assert.equal(e.calls[0].target,'/rest/v1/support_messages');assert.deepEqual(Object.keys(result),['id']);assert.equal(e.store.support_messages[0].id,result.id);await assert.rejects(e.api.sendSupport({name:'Teste',email:'inválido',subject:'Transações',message:'Mensagem com conteúdo válido'}),code('VALIDATION_ERROR'));
 });
 await test('suporte sem email associa mensagem à conta autenticada',async()=>{
  const e=environment();const result=await e.api.sendSupport({name:'Teste',subject:'Transações',message:'Mensagem sem endereço de email',user_id:B});assert.equal(e.calls[0].body.user_id,A);assert.equal(Object.hasOwn(e.calls[0].body,'email'),false);assert.equal(Object.hasOwn(e.store.support_messages[0],'email'),false);assert.equal(e.store.support_messages[0].id,result.id);assert.equal(e.calls[0].headers.Prefer,'return=minimal');
 });
 await test('falha HTTP propaga sem retorno de sucesso',async()=>{
  const boom=new Error('Servidor indisponível');boom.status=503;const e=environment({hook:()=>{throw boom;}});await assert.rejects(e.api.load(),x=>x===boom);await assert.rejects(e.api.saveTransactions([valid()]),x=>x===boom);
 });
 await test('troca de conta durante load não devolve os dados anteriores',async()=>{
  let flipped=false;const e=environment({initial:{profiles:[profile()],budgets:budgets(),transactions:[transaction(1)]},hook:({table,c,setUser})=>{if(table==='transactions'&&c.method==='GET'&&!flipped){flipped=true;setUser({id:B,email:'b@example.com'});}}});await assert.rejects(e.api.load(),code('AUTH_CHANGED'));
 });
 await test('troca de conta durante gravação não entrega resposta A para UI da conta B',async()=>{
  const e=environment({hook:async({table,c,setUser})=>{if(table==='transactions'&&c.method==='POST')setUser({id:B,email:'b@example.com'});}});await assert.rejects(e.api.saveTransactions([valid()]),code('AUTH_CHANGED'));
 });
 await test('troca de conta antes da primeira requisição impede envio',async()=>{
  const e=environment();let reads=0;e.session.getUser=()=>++reads===1?{id:A,email:'a@example.com'}:{id:B,email:'b@example.com'};await assert.rejects(e.api.saveTransactions([valid()]),code('AUTH_CHANGED'));assert.equal(e.calls.length,0);
 });
 await test('troca da instância de sessão durante await é detectada',async()=>{
  let e;e=environment({hook:()=>{e.window.NivelaSession={ready:Promise.resolve(),getUser:()=>({id:A}),request:e.session.request};}});await assert.rejects(e.api.saveTransactions([valid()]),code('AUTH_CHANGED'));
 });
 await test('ausência de usuário recusa operação sem usar armazenamento demo',async()=>{
  const e=environment();e.setUser(null);await assert.rejects(e.api.load(),code('AUTH_REQUIRED'));assert.equal(e.calls.length,0);
 });
 const result={passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};fs.writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'nivela-data-tests-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,failed:result.failed}));if(result.failed)process.exitCode=1;
})();
