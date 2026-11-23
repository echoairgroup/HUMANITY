'use strict';

const crypto = require('node:crypto');
const engine = require('./geography-engine');

const PACKS = [
  { id:'world-mix', title:'World Mix', icon:'◎', description:'A broad expedition through countries, cities, nature and culture.', filter:()=>true },
  { id:'countries', title:'Countries & Regions', icon:'◉', description:'Explore countries from every continent and region.', filter:id=>/country|countries/.test(id) },
  { id:'cities', title:'Cities & Capitals', icon:'⌂', description:'Capital cities and major urban centres around the world.', filter:id=>/capital|major-cit/.test(id) },
  { id:'nature', title:'Nature & Earth', icon:'✧', description:'Rivers, mountains, islands, lakes, seas, deserts and more.', filter:id=>/river|mountain|island|lake|desert|sea|ocean|waterfall|volcano/.test(id) },
  { id:'landmarks', title:'Landmarks & Wonders', icon:'⌖', description:'Recognisable landmarks, remarkable bridges and natural wonders.', filter:id=>/landmark|bridge|waterfall|volcano/.test(id) },
  { id:'culture', title:'World Culture', icon:'✦', description:'Discover dishes, snacks and languages from around the globe.', filter:id=>/dish|snack|language/.test(id) }
];

const BANK = engine.listPartyQuestionBank();
const TOPICS = new Map();
for (const item of BANK) {
  if (!TOPICS.has(item.topicId)) TOPICS.set(item.topicId, []);
  TOPICS.get(item.topicId).push(item);
}
function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest().readUInt32BE(0);
}
function getPack(packId) {
  return PACKS.find(pack => pack.id === String(packId || '')) || null;
}
function packTopics(pack) {
  return [...TOPICS.entries()].filter(([id])=>pack.filter(id))
    .map(([topicId,variants])=>({topicId,variants}));
}
function listPacks() {
  return PACKS.map(pack=>({
    id:pack.id,title:pack.title,icon:pack.icon,description:pack.description,
    questionCount:packTopics(pack).length,questionsPerRound:7
  }));
}
function createBatch(packId,seed,recentTopicIds=[]) {
  const pack=getPack(packId);
  if(!pack) throw new Error('Choose a valid Practice Lab pack.');
  const all=packTopics(pack);
  if(all.length<7) throw new Error('This pack does not have enough questions yet.');
  const recent=new Set(Array.isArray(recentTopicIds)?recentTopicIds:[]);
  let candidates=all.filter(item=>!recent.has(item.topicId));
  if(candidates.length<7)candidates=all;
  return candidates.map(item=>({item,order:hash(seed+':'+item.topicId)}))
    .sort((a,b)=>a.order-b.order).slice(0,7).map(({item},index)=>{
      const variant=item.variants[hash(seed+':variant:'+item.topicId)%item.variants.length];
      const source=engine.getQuestion(variant.id);
      if(!source||!Array.isArray(source.answers)||source.answers.length<3)
        throw new Error('A question in this pack is missing its approved answer set.');
      const answers=source.answers.map(entry=>({
        name:entry.name,aliases:Array.isArray(entry.aliases)?entry.aliases:[],
        rarity:Math.max(0,Math.min(5,Number(entry.rarity)||0)),
        source:entry.source||source.source
      }));
      return {
        id:item.topicId,topicId:item.topicId,slot:index,domain:source.domain||variant.domain||'geography',
        category:source.category||variant.category,prompt:source.prompt||variant.prompt,
        note:source.note||'Find an accepted answer. Rarer discoveries earn more Discovery Points.',
        source:source.source||variant.source,
        hints:answers.slice().sort((a,b)=>a.rarity-b.rarity).slice(0,3).map(entry=>entry.name),
        answers
      };
    });
}
module.exports={listPacks,createBatch,getPack,packTopicCount:TOPICS.size};
