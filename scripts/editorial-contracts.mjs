// Shared policy primitives; no data generation or editorial fallback content.
export function sectionPageMatches(id,base){
 const family=base.replace(/-\d+$/,'');
 return id===base||id.startsWith(base+'-')||(/^\d+$/.test(id.slice(family.length+1))&&id.startsWith(family+'-'));
}
export function dailyReserveCandidates(issue){
 return Object.entries(issue.personalization?.pools||{}).filter(([id])=>/-selection$/.test(id)).flatMap(([,pool])=>(pool.candidates||[]).filter(c=>Number(c.rank)>Number(pool.target)));
}
