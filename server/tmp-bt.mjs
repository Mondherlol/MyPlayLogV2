import "dotenv/config";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import BlindTestVersus from "./src/models/BlindTestVersus.js";
import User from "./src/models/User.js";
import UserGame from "./src/models/UserGame.js";
import router from "./src/routes/blindtestVersus.js";

await mongoose.connect("mongodb://127.0.0.1:27017/myplaylog");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const app = express(); app.use(express.json()); app.use("/api/blindtest/versus", router);
const server = app.listen(0); const port = server.address().port;

const mk = async (n) => { const u = await User.create({ username:n, email:`${n}@v.test`, passwordHash:"x".repeat(20) });
  return { id:String(u._id), token: jwt.sign({sub:String(u._id)}, process.env.JWT_SECRET) }; };
const a = await mk(`btA${Date.now()}`), b = await mk(`btB${Date.now()}`);

// On donne une bibliothèque à A, prise parmi les jeux qui ont déjà des OST en base.
const withOst = await mongoose.connection.db.collection("customosts")
  .aggregate([{ $group: { _id: "$gameId", n: { $sum: 1 } } }, { $match: { n: { $gte: 3 } } }, { $limit: 25 }]).toArray();
await UserGame.insertMany(withOst.map((g) => ({ user: a.id, gameId: g._id, name: `Jeu ${g._id}`, status: "finished" })));
console.log(`bibliothèque de test : ${withOst.length} jeux avec OST`);

const call = async (m,p,who,body) => { const r = await fetch(`http://127.0.0.1:${port}/api/blindtest/versus${p}`,{
  method:m, headers:{"Content-Type":"application/json",Authorization:`Bearer ${who.token}`},
  body: body?JSON.stringify(body):undefined});
  const ct = r.headers.get("content-type")||"";
  return {status:r.status, ct, ...(ct.includes("json")?await r.json().catch(()=>({})):{})}; };

let fails=0; const ok=(c,l)=>{console.log(`${c?"  ✓":"  ✗"} ${l}`); if(!c)fails+=1;};

console.log("\n--- salon ---");
const created = await call("POST","",a,{rounds:3});
ok(created.status===201, `salon créé (${created.room?.code})`);
const code = created.room.code;
await call("POST",`/${code}/join`,b);
ok((await call("POST",`/${code}/start`,b)).status===403,"un invité ne peut pas lancer");

console.log("\n--- lancement (tirage + extraction audio) ---");
const t0=Date.now();
const started = await call("POST",`/${code}/start`,a);
ok(started.status===200, `partie lancée en ${((Date.now()-t0)/1000).toFixed(1)}s`);
if(started.status!==200){ console.log("  ERREUR:",started.error); }
else {
  ok(started.room.phase==="cue","phase = cue");
  const rv = started.room.round;
  ok(!!rv.clip && !rv.gameName && !rv.videoId && !rv.cover && !rv.ostName,
    "la manche ne livre QUE l'adresse de l'extrait (ni jeu, ni videoId, ni titre)");
  ok(!JSON.stringify(started.room).match(/[\w-]{11}/) || !JSON.stringify(rv).includes("youtube"),
    "aucune trace de YouTube côté client");
  ok(Array.isArray(started.candidates) && started.candidates.length>50, `liste de recherche (${started.candidates?.length})`);

  const doc = await BlindTestVersus.findOne({code});
  const ans = doc.rounds[0];
  console.log(`  (réponse manche 1 : ${ans.gameName} — « ${ans.ostName?.slice(0,40)} » à ${Math.round(ans.startFrac*100)}%${ans.climaxed?" CLIMAX MESURÉ":" estimé"})`);

  console.log("\n--- l'extrait, servi par nous ---");
  const clipRes = await fetch(`http://127.0.0.1:${port}/api/blindtest/versus/${code}/clip/0`,{headers:{Authorization:`Bearer ${a.token}`}});
  ok(clipRes.status===200 && (clipRes.headers.get("content-type")||"").includes("audio"),
     `extrait servi en audio (${clipRes.status}, ${clipRes.headers.get("content-type")})`);
  const stranger = await mk(`btX${Date.now()}`);
  const denied = await fetch(`http://127.0.0.1:${port}/api/blindtest/versus/${code}/clip/0`,{headers:{Authorization:`Bearer ${stranger.token}`}});
  ok(denied.status===403,"un non-joueur ne peut pas récupérer l'extrait");
  const ahead = await fetch(`http://127.0.0.1:${port}/api/blindtest/versus/${code}/clip/2`,{headers:{Authorization:`Bearer ${a.token}`}});
  ok(ahead.status===403,"on ne peut pas écouter les manches suivantes en avance");
  await User.deleteOne({_id:stranger.id});

  console.log("\n--- la manche ---");
  // le sas attend l'extraction : on laisse le temps
  let phase=null;
  for(let i=0;i<20;i++){ await new Promise(r=>setTimeout(r,1500)); phase=(await call("GET",`/${code}`,a)).room.phase; if(phase==="round")break; }
  ok(phase==="round",`la manche s'ouvre (phase=${phase})`);
  const w = await call("POST",`/${code}/guess`,b,{gameId:987654,name:"Un jeu inexistant"});
  ok(w.correct===false && w.lives===2,`raté → 2 vies (${w.lives})`);
  const h = await call("POST",`/${code}/guess`,a,{gameId:ans.gameId,name:ans.gameName});
  ok(h.correct===true,"bonne réponse acceptée");
  const still = await call("GET",`/${code}`,b);
  ok(still.room.phase==="round","la manche CONTINUE (pas de buzzer)");
  ok(still.room.round.livesById?.[b.id]===2,"B voit ses vies, A voit celles de B");
  ok(!JSON.stringify(still.room.round).includes("inexistant"),"le titre tapé ne fuit pas");
  const h2 = await call("POST",`/${code}/guess`,b,{gameId:ans.gameId,name:ans.gameName});
  ok(h2.correct===true,"B trouve aussi");
  await new Promise(r=>setTimeout(r,700));
  const rev = await call("GET",`/${code}`,a);
  ok(rev.room.phase==="reveal",`révélation (phase=${rev.room.phase})`);
  if(rev.room.phase==="reveal"){
    ok(rev.room.round.gameName===ans.gameName,"la réponse est enfin donnée");
    const R=(id)=>rev.room.round.results.find(x=>x.userId===id);
    ok(R(a.id).order===1 && R(a.id).points===300,`A premier → 300 (${R(a.id).points})`);
    ok(R(b.id).order===2 && R(b.id).points===Math.round(230*0.65),`B deuxième avec 1 raté → ${Math.round(230*0.65)} (${R(b.id).points})`);
  }
}
console.log(`\n${fails===0?"✅ TOUT PASSE":`❌ ${fails} ÉCHEC(S)`}\n`);
await BlindTestVersus.deleteOne({code});
await UserGame.deleteMany({user:a.id});
await User.deleteMany({_id:{$in:[a.id,b.id]}});
server.close(); await mongoose.disconnect(); process.exit(fails===0?0:1);
